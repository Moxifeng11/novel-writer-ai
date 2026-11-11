/**
 * 阶段 B3：刷新契约（同步 getter 的「未加载」陷阱）
 *
 * 长期目标阶段 B 第三项。本次审计得出的规律：
 *
 * > 凡是「读共享内存 + 由调用方负责刷新」的设计，都应当改为读取前自愈。
 *
 * 但有一类 getter 改不了自愈——**同步 getter**（`getIntensityConfig` 等）：
 * 它必须在调用前由调用方 `await load...()`，否则返回引擎默认值。
 * 调用方一旦忘记，就会把「未加载」误当成「用户没改过配置」。
 *
 * 本文件锁三件事：
 * 1. 未加载时 getter 确实返回默认值（诚实描述契约，不是 bug）
 * 2. 提供 `isIntensityLoaded` 让调用方能断言，不靠猜
 * 3. 加载后能读到真实配置（含两层回落）
 */

import { describe, expect, it } from 'vitest';
import { Vault } from 'obsidian';
import { StyleFingerprintLibrary } from '../../../../engine/style-fingerprint-library';

const PROJECT = '长篇小说/刷新契约';

/** 建库 */
function makeLibrary(vault: Vault, project = PROJECT): StyleFingerprintLibrary {
    return new StyleFingerprintLibrary({ vault } as never, project);
}

describe('同步 getter 的「未加载」契约', () => {
    it('未加载时 isIntensityLoaded 为 false（调用方可据此断言）', () => {
        const vault = new Vault();
        const library = makeLibrary(vault);
        expect(library.isIntensityLoaded(PROJECT)).toBe(false);
    });

    it('未加载时 getIntensityConfig 返回引擎默认 1.0（诚实契约，不是真实配置）', () => {
        const vault = new Vault();
        const library = makeLibrary(vault);
        // 这就是陷阱本身：返回 1.0 看起来像「用户没改过强度」，
        // 实际可能是「根本没读盘」
        expect(library.getIntensityConfig('fp-x', PROJECT).globalIntensity).toBe(1.0);
    });

    it('加载后 isIntensityLoaded 为 true', async () => {
        const vault = new Vault();
        const library = makeLibrary(vault);
        await library.loadIntensityConfigs(PROJECT);
        expect(library.isIntensityLoaded(PROJECT)).toBe(true);
    });

    it('加载后能读到真实配置（不再是默认值）', async () => {
        const vault = new Vault();
        const writer = makeLibrary(vault);
        await writer.setIntensityConfig('fp-x', { globalIntensity: 0 }, PROJECT);

        const reader = makeLibrary(vault);
        // 未加载：默认
        expect(reader.getIntensityConfig('fp-x', PROJECT).globalIntensity).toBe(1.0);
        expect(reader.isIntensityLoaded(PROJECT)).toBe(false);

        // 加载后：真实值（强度 0 = 禁用）
        await reader.loadIntensityConfigs(PROJECT);
        expect(reader.isIntensityLoaded(PROJECT)).toBe(true);
        expect(reader.getIntensityConfig('fp-x', PROJECT).globalIntensity).toBe(0);
    });

    it('文件不存在时加载也算「已加载」（避免调用方反复重试）', async () => {
        const vault = new Vault();
        const library = makeLibrary(vault);
        await library.loadIntensityConfigs(PROJECT);
        // 该项目从没配过强度是合法状态，但要能区分于「没加载过」
        expect(library.isIntensityLoaded(PROJECT)).toBe(true);
        expect(library.getIntensityConfig('fp-x', PROJECT).globalIntensity).toBe(1.0);
    });

    it('不同项目的加载状态互相独立', async () => {
        const vault = new Vault();
        const library = makeLibrary(vault, PROJECT);
        await library.loadIntensityConfigs(PROJECT);
        expect(library.isIntensityLoaded(PROJECT)).toBe(true);
        expect(library.isIntensityLoaded('另一个项目')).toBe(false);
    });
});

describe('与阶段 B1/B2 的衔接', () => {
    it('「强度 0 等于禁用」的检测必须先加载，否则永远查不出来', async () => {
        const vault = new Vault();
        const writer = makeLibrary(vault);
        await writer.setIntensityConfig('fp-off', { globalIntensity: 0 }, PROJECT);

        const reader = makeLibrary(vault);
        // 模拟视图「忘了加载」：检测结果为空
        const beforeLoad = reader.isIntensityLoaded(PROJECT)
            ? reader.getIntensityConfig('fp-off', PROJECT).globalIntensity <= 0
            : false;
        expect(beforeLoad).toBe(false);

        // 正确做法：先加载
        await reader.loadIntensityConfigs(PROJECT);
        const afterLoad = reader.getIntensityConfig('fp-off', PROJECT).globalIntensity <= 0;
        expect(afterLoad).toBe(true);
    });
});
