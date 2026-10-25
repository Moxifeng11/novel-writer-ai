import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Vault } from 'obsidian';
import { StyleFingerprintLibrary } from '../../../../engine/style-fingerprint-library';
import { projectFingerprintIntensityFile } from '../../../../shared/paths';

const PROJECT = '测试书';

type TestVault = Vault & {
    _seedFile(path: string, content: string): unknown;
    readByPath(path: string): Promise<string>;
};

function readWrittenConfig(vault: TestVault): Promise<string> {
    return vault.readByPath(projectFingerprintIntensityFile(PROJECT));
}

describe('StyleFingerprintLibrary — 项目指纹强度配置', () => {
    let vault: TestVault;
    let library: StyleFingerprintLibrary;

    beforeEach(() => {
        vault = new Vault() as TestVault;
        library = new StyleFingerprintLibrary({ vault } as any, PROJECT);
    });

    it('未加载时 getIntensityConfig 只能拿到默认值（所以读取方必须先 load）', () => {
        expect(library.getIntensityConfig('fp-a').globalIntensity).toBe(1);
    });

    it('加载后能读到磁盘上已保存的强度', async () => {
        vault._seedFile(
            projectFingerprintIntensityFile(PROJECT),
            JSON.stringify({ 'fp-a': { globalIntensity: 0.4 } })
        );

        await library.loadIntensityConfigs();

        expect(library.getIntensityConfig('fp-a').globalIntensity).toBe(0.4);
    });

    it('重复 load 会重新读盘，不以旧内存值为准', async () => {
        vault._seedFile(
            projectFingerprintIntensityFile(PROJECT),
            JSON.stringify({ 'fp-a': { globalIntensity: 0.4 } })
        );
        await library.loadIntensityConfigs();

        // 模拟另一个库实例（如强度弹窗）把磁盘配置改成 0.9
        vault._seedFile(
            projectFingerprintIntensityFile(PROJECT),
            JSON.stringify({ 'fp-a': { globalIntensity: 0.9 } })
        );
        await library.loadIntensityConfigs();

        expect(library.getIntensityConfig('fp-a').globalIntensity).toBe(0.9);
    });

    it('跨实例可见：一个实例保存后，另一个实例 load 能读到新强度', async () => {
        // 强度弹窗与协同引擎各自持有 StyleFingerprintLibrary 实例，
        // 缓存会让「弹窗里改完、协同 prompt 仍用旧强度」静默发生
        const otherLibrary = new StyleFingerprintLibrary({ vault } as any, PROJECT);

        await library.setIntensityConfig('fp-a', { globalIntensity: 0.9 });
        await otherLibrary.loadIntensityConfigs();

        expect(otherLibrary.getIntensityConfig('fp-a').globalIntensity).toBe(0.9);
    });

    it('新会话里只改一个指纹，不会抹掉其他指纹已保存的配置', async () => {
        vault._seedFile(
            projectFingerprintIntensityFile(PROJECT),
            JSON.stringify({ 'fp-a': { globalIntensity: 0.4 } })
        );

        await library.setIntensityConfig('fp-b', { globalIntensity: 0.7 });

        const saved = JSON.parse(await readWrittenConfig(vault));
        expect(saved['fp-a'].globalIntensity).toBe(0.4);
        expect(saved['fp-b'].globalIntensity).toBe(0.7);
    });

    it('删除一个指纹同样先读盘，不影响其他指纹', async () => {
        vault._seedFile(
            projectFingerprintIntensityFile(PROJECT),
            JSON.stringify({
                'fp-a': { globalIntensity: 0.4 },
                'fp-b': { globalIntensity: 0.7 },
            })
        );

        await library.removeIntensityConfig('fp-a');

        const saved = JSON.parse(await readWrittenConfig(vault));
        expect(saved['fp-a']).toBeUndefined();
        expect(saved['fp-b'].globalIntensity).toBe(0.7);
    });

    it('文件内容损坏时降级为空配置，不抛错', async () => {
        vault._seedFile(projectFingerprintIntensityFile(PROJECT), '[1,2,3]');

        const configs = await library.loadIntensityConfigs();

        expect(configs).toEqual({});
        expect(library.getIntensityConfig('fp-a').globalIntensity).toBe(1);
    });

    it('写入失败必须抛给调用方，不能静默弹「已保存」', async () => {
        vault._seedFile(projectFingerprintIntensityFile(PROJECT), JSON.stringify({}));
        const modifySpy = vi.spyOn(vault, 'modify').mockRejectedValue(new Error('disk full'));

        await expect(
            library.setIntensityConfig('fp-a', { globalIntensity: 0.9 })
        ).rejects.toThrow('disk full');

        modifySpy.mockRestore();
    });
});
