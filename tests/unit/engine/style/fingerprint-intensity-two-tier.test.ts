/**
 * 指纹强度：全局默认 + 项目覆盖（v4.83.1）
 *
 * 用户决策（2026-11-11）：指纹强度采用「全局默认 + 项目覆盖」两层。
 *
 * 背景：全局指纹跨项目通用，但强度此前只存项目级文件
 * （`pjControlDir(project)/写作指纹库/fingerprint-intensity-config.json`），
 * 于是在项目 A 配好的强度，切到项目 B 就回退成引擎默认 1.0——用户得每个项目配一遍。
 *
 * 读取优先级：
 * 1. 项目覆盖（用户在本项目里微调过）
 * 2. 全局默认（`data/global-fingerprint-intensity.json`）
 * 3. 引擎默认（完全启用）
 */

import { describe, expect, it } from 'vitest';
import { Vault } from 'obsidian';
import { StyleFingerprintLibrary } from '../../../../engine/style-fingerprint-library';
import type { StyleIntensityConfig } from '../../../../engine/style/style-intensity-engine';

const PROJECT_A = '项目甲';
const PROJECT_B = '项目乙';

/** 直接 new（不走单例缓存） */
function makeLibrary(vault: Vault, project?: string): StyleFingerprintLibrary {
    return new StyleFingerprintLibrary({ vault } as never, project);
}

/** 构造强度配置 */
function config(intensity: number): StyleIntensityConfig {
    return { globalIntensity: intensity };
}

describe('全局默认 + 项目覆盖', () => {
    it('只有全局默认时，任意项目都读到它', async () => {
        const vault = new Vault();
        const writer = makeLibrary(vault);
        await writer.setGlobalIntensityConfig('fp-global', config(0.4));

        const reader = makeLibrary(vault, PROJECT_A);
        await reader.loadIntensityConfigs(PROJECT_A);
        expect(reader.getIntensityConfig('fp-global', PROJECT_A).globalIntensity).toBe(0.4);

        // 换到另一个项目：仍读到全局默认（旧实现这里会回退成 1.0）
        expect(reader.getIntensityConfig('fp-global', PROJECT_B).globalIntensity).toBe(0.4);
    });

    it('项目覆盖优先于全局默认', async () => {
        const vault = new Vault();
        const writer = makeLibrary(vault);
        await writer.setGlobalIntensityConfig('fp-global', config(0.4));
        await writer.setIntensityConfig('fp-global', config(0.9), PROJECT_A);

        const reader = makeLibrary(vault, PROJECT_A);
        await reader.loadIntensityConfigs(PROJECT_A);
        expect(reader.getIntensityConfig('fp-global', PROJECT_A).globalIntensity).toBe(0.9);  // 覆盖
        expect(reader.getIntensityConfig('fp-global', PROJECT_B).globalIntensity).toBe(0.4);  // 全局默认
    });

    it('移除项目覆盖后回落到全局默认', async () => {
        const vault = new Vault();
        const writer = makeLibrary(vault);
        await writer.setGlobalIntensityConfig('fp-global', config(0.4));
        await writer.setIntensityConfig('fp-global', config(0.9), PROJECT_A);
        await writer.removeIntensityConfig('fp-global', PROJECT_A);

        const reader = makeLibrary(vault, PROJECT_A);
        await reader.loadIntensityConfigs(PROJECT_A);
        expect(reader.getIntensityConfig('fp-global', PROJECT_A).globalIntensity).toBe(0.4);
        expect(reader.hasIntensityOverride('fp-global', PROJECT_A)).toBe(false);
    });

    it('两层都没有时用引擎默认（1.0）', async () => {
        const vault = new Vault();
        const reader = makeLibrary(vault, PROJECT_A);
        await reader.loadIntensityConfigs(PROJECT_A);
        expect(reader.getIntensityConfig('fp-unknown', PROJECT_A).globalIntensity).toBe(1.0);
    });

    it('hasIntensityOverride 只在有项目覆盖时为真', async () => {
        const vault = new Vault();
        const writer = makeLibrary(vault);
        await writer.setGlobalIntensityConfig('fp-global', config(0.4));

        const reader = makeLibrary(vault, PROJECT_A);
        await reader.loadIntensityConfigs(PROJECT_A);
        // 只有全局默认 → 不算项目覆盖
        expect(reader.hasIntensityOverride('fp-global', PROJECT_A)).toBe(false);

        await writer.setIntensityConfig('fp-global', config(0.7), PROJECT_A);
        const reader2 = makeLibrary(vault, PROJECT_A);
        await reader2.loadIntensityConfigs(PROJECT_A);
        expect(reader2.hasIntensityOverride('fp-global', PROJECT_A)).toBe(true);
    });

    it('写入全局默认不会抹掉其他全局指纹的强度', async () => {
        const vault = new Vault();
        const writer = makeLibrary(vault);
        await writer.setGlobalIntensityConfig('fp-a', config(0.3));
        await writer.setGlobalIntensityConfig('fp-b', config(0.8));

        const reader = makeLibrary(vault, PROJECT_A);
        await reader.loadGlobalIntensityConfigs();
        expect(reader.getIntensityConfig('fp-a', PROJECT_A).globalIntensity).toBe(0.3);
        expect(reader.getIntensityConfig('fp-b', PROJECT_A).globalIntensity).toBe(0.8);
    });

    it('移除不存在的全局默认是幂等的', async () => {
        const vault = new Vault();
        const writer = makeLibrary(vault);
        await expect(writer.removeGlobalIntensityConfig('fp-none')).resolves.toBeUndefined();
    });

    it('loadIntensityConfigs 会顺带加载全局默认（注入路径只调它一个）', async () => {
        const vault = new Vault();
        const writer = makeLibrary(vault);
        await writer.setGlobalIntensityConfig('fp-global', config(0.25));

        const reader = makeLibrary(vault, PROJECT_A);
        // 只调项目层加载（prompt-builder 的实际调用方式）
        await reader.loadIntensityConfigs(PROJECT_A);
        expect(reader.getIntensityConfig('fp-global', PROJECT_A).globalIntensity).toBe(0.25);
    });
});
