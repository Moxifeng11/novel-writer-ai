/**
 * fingerprint-library-persist-guard.test.ts — 指纹库读写回归
 *
 * 锁定四条曾经真实出错的契约：
 * 1. `extractV1FeaturesFromV2` 的映射方向（曾经把 V1 字段名当 V2 键去查，
 *    恒为 undefined → 投影恒为空 → 保存时判定「V2 已过期」→ 每次启停都把
 *    磁盘上的 12 维结构降级成 7 维字符串）。
 * 2. `save*` 只允许覆盖 V1 可变字段（enabled/name/tags），V2 结构原样回写。
 * 3. `load*` / `delete*` 必须清理同作用域的 V2 缓存，否则删除后的指纹
 *    仍会被 12 维检索命中。
 * 4. `computeFingerprintSignature` 走 `getFileStamp`：全局指纹文件在配置目录，
 *    走 `getAbstractFileByPath` 恒为 null（签名永远 `:missing`），文件变化
 *    触发不了 `reloadIfChanged`。
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Vault } from 'obsidian';
import { StyleFingerprintLibrary } from '../../../../engine/style-fingerprint-library';
import type { EmbeddingProvider, EmbeddingAvailability, ProviderInfo } from '../../../../engine/embedding/embedding-provider';
import type { StyleFingerprintFeaturesV2, StyleDimensionKeyV2, V2Fingerprint } from '../../../../engine/style/style-dimensions-v2';
import { STYLE_DIMENSION_KEYS_V2 } from '../../../../engine/style/style-dimensions-v2';
import { globalFingerprintsFile, projectFingerprintsFile, projectGlobalFingerprintStateFile } from '../../../../shared/paths';

class MockEmbeddingProvider implements EmbeddingProvider {
    async embed(text: string): Promise<number[]> {
        if (!text) return [];
        const vec = new Array(8).fill(0);
        for (let i = 0; i < text.length; i++) vec[i % 8] += text.charCodeAt(i);
        const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
        return vec.map(v => v / norm);
    }
    async embedBatch(texts: string[]): Promise<number[][]> {
        return Promise.all(texts.map(t => this.embed(t)));
    }
    async isAvailable(): Promise<EmbeddingAvailability> {
        return { available: true, model: 'mock-embed', dimensions: 8 };
    }
    getProviderInfo(): ProviderInfo {
        return { type: 'mock', name: 'mock', model: 'mock-embed' };
    }
    getModelName(): string { return 'mock-embed'; }
    async getDimensions(): Promise<number> { return 8; }
}

function makeFeatures(seed: string): StyleFingerprintFeaturesV2 {
    const features = {} as StyleFingerprintFeaturesV2;
    for (const key of STYLE_DIMENSION_KEYS_V2 as readonly StyleDimensionKeyV2[]) {
        (features as any)[key] = {
            description: `${seed}-${key} 的结构化描述`,
            samples: [`${seed}-${key}-示例`],
            status: 'complete' as const,
        };
    }
    return features;
}

/**
 * 迁移产物：`migrateV1ToV2` 把 V1 字符串原样写进 V2 description，
 * 同时把 V1 原文存进 v1Backup。两者必然一致——这是投影比较的前提。
 */
function makeV2Fingerprint(id: string, seed: string, scope: 'template' | 'global' | 'project' = 'global'): V2Fingerprint {
    const features = makeFeatures(seed);
    return {
        id,
        name: `${seed} 风格`,
        source: 'test',
        scope,
        enabled: true,
        tags: [],
        version: 'v2',
        stats: {
            avgSentenceLength: 12,
            avgParagraphLength: 40,
            dialogueRatio: 0.3,
            descriptionRatio: 0.2,
            wordCount: 10000,
        },
        features,
        samples: [`${seed} 示例文本`],
        extractedAt: 1_700_000_000_000,
        v1Backup: {
            features: {
                sentenceRhythm: features.rhythm.description,
                wordPreference: features.wordChoice.description,
                narrativeStyle: features.perspective.description,
                rhetoric: features.rhetoric.description,
                dialogueStyle: features.dialogue.description,
                paragraphStructure: features.narration.description,
                overallTone: features.languageTexture.description,
            },
            extractedAt: 1_700_000_000_000,
            migratedAt: 1_700_000_100_000,
        },
    };
}

function seedGlobal(vault: Vault, items: V2Fingerprint[]): void {
    (vault as any)._seedFile(globalFingerprintsFile(), JSON.stringify(items, null, 2));
}

async function readGlobalFile(vault: Vault): Promise<any[]> {
    const raw = await (vault as any).readByPath(globalFingerprintsFile());
    return JSON.parse(raw);
}

describe('StyleFingerprintLibrary — 保存不得降级 V2', () => {
    let vault: Vault;
    let library: StyleFingerprintLibrary;

    beforeEach(async () => {
        vault = new Vault();
        seedGlobal(vault, [makeV2Fingerprint('fp-a', '甲'), makeV2Fingerprint('fp-b', '乙')]);
        library = new StyleFingerprintLibrary({ vault } as any);
        library.setEmbeddingClient(new MockEmbeddingProvider());
        await library.loadGlobal();
    });

    it('enable/disable 后落盘仍是 12 维 V2，且逐维样本未被抹掉', async () => {
        await library.disableGlobal('fp-a');

        const onDisk = await readGlobalFile(vault);
        const a = onDisk.find(fp => fp.id === 'fp-a');
        const b = onDisk.find(fp => fp.id === 'fp-b');

        expect(a.version).toBe('v2');
        expect(a.enabled).toBe(false);
        expect(Object.keys(a.features)).toHaveLength(STYLE_DIMENSION_KEYS_V2.length);
        // 只回写 V1 可变字段：结构与样本必须原样保留
        expect(a.features.dialogue.samples).toEqual(['甲-dialogue-示例']);
        expect(a.v1Backup.features.sentenceRhythm).toBe('甲-rhythm 的结构化描述');

        expect(b.version).toBe('v2');
        expect(b.enabled).toBe(true);
    });

    it('V1 特征被重新提取后不再回写陈旧 V2', async () => {
        const fp = library.getGlobal('fp-b')!;
        fp.features.sentenceRhythm = '重新提取后的节奏描述';
        await library.updateGlobal(fp);

        const onDisk = await readGlobalFile(vault);
        const b = onDisk.find(item => item.id === 'fp-b');

        expect(b.version).toBeUndefined();
        expect(b.features.sentenceRhythm).toBe('重新提取后的节奏描述');
    });

    it('deleteGlobal 同步清理 V2 缓存', async () => {
        expect(library.getV2Fingerprint('fp-a')).toBeDefined();

        await library.deleteGlobal('fp-a');

        expect(library.getV2Fingerprint('fp-a')).toBeUndefined();
        expect(library.listV2Fingerprints('global').map(fp => fp.id)).toEqual(['fp-b']);
    });

    it('重新加载同作用域会丢弃已不存在的 V2 条目', async () => {
        seedGlobal(vault, [makeV2Fingerprint('fp-b', '乙')]);
        await library.loadGlobal();

        expect(library.getV2Fingerprint('fp-a')).toBeUndefined();
        expect(library.getV2Fingerprint('fp-b')).toBeDefined();
    });
});

describe('StyleFingerprintLibrary — 融合指纹', () => {
    let vault: Vault;
    let library: StyleFingerprintLibrary;

    beforeEach(async () => {
        vault = new Vault();
        seedGlobal(vault, []);
        library = new StyleFingerprintLibrary({ vault } as any);
        library.setEmbeddingClient(new MockEmbeddingProvider());
    });

    function makeBlended(id: string, seed: string): any {
        const { v1Backup: _drop, ...rest } = makeV2Fingerprint(id, seed);
        return {
            ...rest,
            id,
            scope: 'template',
            blendSource: {
                fingerprints: [{ id: 'fp-a', name: '甲 风格', scope: 'global', weight: 1 }],
                blendedAt: 1_700_000_200_000,
                vectorsBlended: false,
            },
        };
    }

    it('融合结果保留 12 维结构并以 V2 落盘', async () => {
        const saved = await library.saveBlendedFingerprint(makeBlended('blend-1', '丙'), 'global');

        // P0：V1 兼容视图必须真有内容（映射写反时这里恒为空对象）
        expect(saved).not.toBeNull();
        expect(saved!.features.sentenceRhythm).toBe('丙-rhythm 的结构化描述');

        const entry = (await readGlobalFile(vault)).find(fp => fp.id === 'blend-1');
        expect(entry.version).toBe('v2');
        expect(Object.keys(entry.features)).toHaveLength(STYLE_DIMENSION_KEYS_V2.length);
        expect(entry.features.dialogue.samples).toEqual(['丙-dialogue-示例']);
        expect(entry.blendSource.vectorsBlended).toBe(false);

        // 重新加载后 12 维检索视图可用，V1 视图从合成的 v1Backup 还原
        await library.loadGlobal();
        expect(library.getV2Fingerprint('blend-1')).toBeDefined();
        expect(library.getGlobal('blend-1')!.features.sentenceRhythm).toBe('丙-rhythm 的结构化描述');
    });

    it('未打开项目时保存到 project 层直接返回 null，且不污染 V2 缓存', async () => {
        const result = await library.saveBlendedFingerprint(makeBlended('blend-2', '丁'), 'project');

        expect(result).toBeNull();
        expect(library.getV2Fingerprint('blend-2')).toBeUndefined();
    });
});

describe('StyleFingerprintLibrary — 坏文件不毁库', () => {
    it('JSON 解析失败时保留内存数据，损坏文件改名留档', async () => {
        const vault = new Vault();
        seedGlobal(vault, [makeV2Fingerprint('fp-a', '甲')]);
        const library = new StyleFingerprintLibrary({ vault } as any);
        await library.loadGlobal();
        expect(library.listGlobal().map(fp => fp.id)).toEqual(['fp-a']);

        // 模拟外部写入半截 JSON（同步冲突、磁盘截断）
        (vault as any)._seedFile(globalFingerprintsFile(), '[{"id":"fp-a",');

        const after = await library.loadGlobal();
        expect(after.map(fp => fp.id)).toEqual(['fp-a']);
        expect(library.getV2Fingerprint('fp-a')).toBeDefined();

        // 损坏内容被改名留档，原路径不再持有坏数据
        const backups = (vault as any)._store as Map<string, string>;
        const corrupt = [...backups.keys()].filter(p => p.includes('.corrupt-'));
        expect(corrupt.length).toBe(1);
        expect(backups.get(corrupt[0])).toBe('[{"id":"fp-a",');
    });

    it('文件确实不存在时才清空（真空库）', async () => {
        const vault = new Vault();
        seedGlobal(vault, [makeV2Fingerprint('fp-a', '甲')]);
        const library = new StyleFingerprintLibrary({ vault } as any);
        await library.loadGlobal();

        await vault.adapter.remove(globalFingerprintsFile());

        expect(await library.loadGlobal()).toEqual([]);
        expect(library.listGlobal()).toEqual([]);
    });
});

describe('StyleFingerprintLibrary — 项目切换与跨项目复制', () => {
    it('setProject 清空项目层内存表与项目层 V2 缓存', async () => {
        const vault = new Vault();
        (vault as any)._seedFile(
            projectFingerprintsFile('作品A'),
            JSON.stringify([makeV2Fingerprint('fp-p', '丙', 'project')]),
        );
        const library = new StyleFingerprintLibrary({ vault } as any, '作品A');
        library.setEmbeddingClient(new MockEmbeddingProvider());
        await library.loadProject();

        expect(library.listProject().map(fp => fp.id)).toEqual(['fp-p']);
        expect(library.getV2Fingerprint('fp-p')).toBeDefined();

        library.setProject('作品B');

        expect(library.activeProject).toBe('作品B');
        expect(library.listProject()).toEqual([]);
        expect(library.getV2Fingerprint('fp-p')).toBeUndefined();
    });

    it('跨项目复制写进目标项目文件，并保留 V2 结构', async () => {
        const vault = new Vault();
        seedGlobal(vault, [makeV2Fingerprint('fp-a', '甲')]);
        const library = new StyleFingerprintLibrary({ vault } as any, '作品A');
        library.setEmbeddingClient(new MockEmbeddingProvider());
        await library.loadGlobal();

        const copy = await library.copyFingerprint('global', 'project', 'fp-a', '作品B');

        expect(copy).not.toBeNull();
        const targetRaw = await (vault as any).readByPath(projectFingerprintsFile('作品B'));
        const targetEntries = JSON.parse(targetRaw);
        expect(targetEntries.map((fp: any) => fp.id)).toEqual([copy!.id]);
        expect(targetEntries[0].version).toBe('v2');
        expect(Object.keys(targetEntries[0].features)).toHaveLength(STYLE_DIMENSION_KEYS_V2.length);
        expect(copy!.features.sentenceRhythm).toBe('甲-rhythm 的结构化描述');

        // 当前项目（作品A）不该被写入
        expect(await (vault as any).readByPath(projectFingerprintsFile('作品A'))).toBe('');
    });
});

describe('StyleFingerprintLibrary — 项目级全局启用覆盖', () => {
    it('覆盖值优先于全局默认，并写入项目状态文件', async () => {
        const vault = new Vault();
        seedGlobal(vault, [makeV2Fingerprint('fp-a', '甲')]);
        const library = new StyleFingerprintLibrary({ vault } as any, '作品A');
        await library.loadGlobal();

        // 没写过覆盖时，回落到全局默认
        expect(library.isGlobalEnabledForProject('fp-a', '作品A')).toBe(true);

        await library.setGlobalEnabledForProject('fp-a', false, '作品A');

        expect(library.isGlobalEnabledForProject('fp-a', '作品A')).toBe(false);
        // 其它项目不受影响
        expect(library.isGlobalEnabledForProject('fp-a', '作品B')).toBe(true);
        // 全局默认值没被改写
        expect(library.getGlobal('fp-a')!.enabled).toBe(true);

        const stateRaw = await (vault as any).readByPath(projectGlobalFingerprintStateFile('作品A'));
        expect(JSON.parse(stateRaw)).toEqual({ 'fp-a': false });

        // 新实例读盘后仍然生效
        const reloaded = new StyleFingerprintLibrary({ vault } as any, '作品A');
        await reloaded.loadGlobal();
        await reloaded.loadGlobalState('作品A');
        expect(reloaded.isGlobalEnabledForProject('fp-a')).toBe(false);
    });
});

describe('StyleFingerprintLibrary — 指纹文件签名', () => {
    /**
     * 真实 Obsidian 里配置目录文件不在 vault 索引：getAbstractFileByPath 恒为 null。
     * mock 的 Vault 共用同一个 Map，会误报 TFile，这里显式隔离以复现真实路径。
     */
    function makeConfigVault(): { vault: Vault; setMtime: (v: number) => void } {
        const vault = new Vault();
        let mtime = 1_000;
        const original = vault.getAbstractFileByPath.bind(vault);
        (vault as any).getAbstractFileByPath = (path: string) =>
            path === globalFingerprintsFile() ? null : original(path);
        const baseStat = vault.adapter.stat.bind(vault.adapter);
        (vault.adapter as any).stat = async (path: string) => {
            const stat = await baseStat(path);
            return stat ? { ...stat, mtime } : null;
        };
        return { vault, setMtime: v => { mtime = v; } };
    }

    it('文件不存在时签名为 :missing', async () => {
        const { vault } = makeConfigVault();
        const library = new StyleFingerprintLibrary({ vault } as any);

        const signature = await library.computeFingerprintSignature();

        expect(signature).toContain('missing');
    });

    it('mtime 变化会改变签名并触发 reloadIfChanged', async () => {
        const { vault, setMtime } = makeConfigVault();
        seedGlobal(vault, [makeV2Fingerprint('fp-a', '甲')]);
        const library = new StyleFingerprintLibrary({ vault } as any);

        const first = await library.computeFingerprintSignature();
        expect(first).not.toContain('missing');

        // 首次 reloadIfChanged 建立基线，第二次同签名应短路
        expect(await library.reloadIfChanged()).toBe(true);
        expect(await library.reloadIfChanged()).toBe(false);

        // 模拟外部写入（另一个实例新增指纹）只改了 mtime
        setMtime(2_000);
        expect(await library.computeFingerprintSignature()).not.toBe(first);
        expect(await library.reloadIfChanged()).toBe(true);
    });
});
