/**
 * fingerprint-library-silent-failure.test.ts — 指纹库读写失败不得静默（DSH-20261113-22）
 *
 * 对抗性审查（high + medium）：saveTemplate/saveGlobal/saveProject 写盘异常被外层
 * `.catch(log.warn)` 吞掉正常 resolve——「保存成功」重启消失、「已删除」重启复活；
 * loadGlobalState 把读/解析失败当成空表缓存，随后的启停保存用空表整份覆盖磁盘；
 * loadGlobalIntensityConfigs 读失败清空后 setGlobalIntensityConfig 整份覆盖，
 * 全局强度永久丢失；迁移 catch 后返回 success:true。
 *
 * 本文件锁：写失败向上抛（调用方 catch 提示用户）、读失败不覆盖、迁移失败如实上报、
 * 正常路径不误伤。
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { StyleFingerprintLibrary } from '../../../../engine/style-fingerprint-library';
import { globalFingerprintsFile, projectGlobalFingerprintStateFile, globalFingerprintIntensityFile, projectFingerprintIntensityFile, projectFingerprintsFile, templateFingerprintsFile } from '../../../../shared/paths';

vi.mock('../../../main', () => ({ default: class NovelWriterPlugin {} }));

const PROJECT = '测试书';

/** 与 cowrite-persistence-guards.test.ts 同款 FakeFileSystem（含可注入写失败） */
class FakeFileSystem {
    files = new Map<string, string>();
    folders = new Set<string>();
    writeShouldFail = false;

    async read(path: string): Promise<string> {
        const value = this.files.get(path);
        if (value === undefined) throw new Error(`ENOENT: ${path}`);
        return value;
    }
    async write(path: string, content: string): Promise<void> {
        if (this.writeShouldFail) throw new Error('磁盘只读');
        this.files.set(path, content);
    }
    async exists(path: string): Promise<boolean> {
        return this.files.has(path) || this.folders.has(path);
    }
    async delete(path: string): Promise<void> {
        this.files.delete(path);
    }
    async mkdir(path: string): Promise<void> {
        this.folders.add(path);
    }
    async rename(from: string, to: string): Promise<void> {
        const value = this.files.get(from);
        if (value !== undefined) {
            this.files.delete(from);
            this.files.set(to, value);
        }
    }
    async getFile(): Promise<null> { return null; }
    async getFolder(): Promise<null> { return null; }
    async listAll(): Promise<never[]> { return []; }
    async listFiles(): Promise<never[]> { return []; }
    async listFolders(): Promise<never[]> { return []; }
}

function makeLibrary(fs: FakeFileSystem): StyleFingerprintLibrary {
    const library = new StyleFingerprintLibrary({ vault: {} } as any, PROJECT);
    (library as any).fs = fs;
    return library;
}

/** V1 形态指纹文件（会被 migrateV1ToV2Dimensions 判定需要迁移） */
const V1_ITEM = JSON.stringify({
    id: 'fp-v1',
    name: 'V1 指纹',
    scope: 'global',
    enabled: true,
    features: { sentenceRhythm: '短句为主', overallTone: '冷峻' },
    samples: ['样本'],
});

beforeEach(() => {
    vi.restoreAllMocks();
});

describe('save* 写失败：向上抛给调用方（缺陷：旧代码吞成 log.warn 正常 resolve）', () => {
    it('addTemplate：模板文件写失败 → addTemplate rejects（回归锁：旧代码静默成功）', async () => {
        const fs = new FakeFileSystem();
        fs.writeShouldFail = true;
        const library = makeLibrary(fs);
        await expect(library.addTemplate({
            id: 'fp-t', name: '模板', scope: 'template', enabled: true,
            tags: [], features: {}, samples: [],
        } as never)).rejects.toThrow();
        expect(fs.write).toBeDefined();
    });

    it('updateGlobal：全局文件写失败 → rejects', async () => {
        const fs = new FakeFileSystem();
        fs.writeShouldFail = true;
        const library = makeLibrary(fs);
        (library as any).globalFingerprints = new Map([['fp-g', { id: 'fp-g', name: 'g', enabled: true, tags: [], features: {}, samples: [] }]]);
        await expect(library.updateGlobal({ id: 'fp-g', name: 'g2' } as never)).rejects.toThrow();
    });

    it('updateProject：项目文件写失败 → rejects', async () => {
        const fs = new FakeFileSystem();
        fs.writeShouldFail = true;
        const library = makeLibrary(fs);
        (library as any).projectFingerprints = new Map([['fp-p', { id: 'fp-p', name: 'p', enabled: true, tags: [], features: {}, samples: [] }]]);
        await expect(library.updateProject({ id: 'fp-p', name: 'p2' } as never)).rejects.toThrow();
    });

    it('saveGlobalState：状态文件写失败 → saveGlobalState rejects', async () => {
        const fs = new FakeFileSystem();
        fs.writeShouldFail = true;
        const library = makeLibrary(fs);
        await expect(library.saveGlobalState(PROJECT, { 'fp-g': true })).rejects.toThrow();
    });

    it('写失败时内存状态不谎报成功（in-memory 与磁盘一致性由调用方决定重试）', async () => {
        const fs = new FakeFileSystem();
        const library = makeLibrary(fs);
        fs.writeShouldFail = true;
        await expect(library.addGlobal({
            id: 'fp-g', name: 'g', scope: 'global', enabled: true,
            tags: [], features: {}, samples: [],
        } as never)).rejects.toThrow();
        fs.writeShouldFail = false;
        // 磁盘上没有写入成功的内容
        expect(fs.files.has(globalFingerprintsFile())).toBe(false);
    });
});

describe('loadGlobalState：读失败不得当「没有」（缺陷：空表缓存后被整份覆盖）', () => {
    it('文件不存在 → 返回空表（合法状态，不抛错）', async () => {
        const fs = new FakeFileSystem();
        const library = makeLibrary(fs);
        expect(await library.loadGlobalState(PROJECT)).toEqual({});
    });

    it('文件存在但解析失败 → rejects（回归锁：旧代码返回 {} 并缓存空表）', async () => {
        const fs = new FakeFileSystem();
        fs.files.set(projectGlobalFingerprintStateFile(PROJECT), 'not json');
        const library = makeLibrary(fs);
        await expect(library.loadGlobalState(PROJECT)).rejects.toThrow();
    });

    it('读失败后 setGlobalEnabledForProject → rejects（禁止空表整份覆盖写）', async () => {
        const fs = new FakeFileSystem();
        const statePath = projectGlobalFingerprintStateFile(PROJECT);
        fs.files.set(statePath, JSON.stringify({ 'fp-g': true }));
        const library = makeLibrary(fs);
        // 破坏文件
        fs.files.set(statePath, '{corrupted');
        await expect(library.setGlobalEnabledForProject('fp-g', false, PROJECT)).rejects.toThrow();
        // 磁盘原内容原样保留（没有被空表覆盖）
        expect(fs.files.get(statePath)).toBe('{corrupted');
    });

    it('正常路径不误伤：合法 JSON 正常读取并返回', async () => {
        const fs = new FakeFileSystem();
        fs.files.set(projectGlobalFingerprintStateFile(PROJECT), JSON.stringify({ 'fp-g': false }));
        const library = makeLibrary(fs);
        expect(await library.loadGlobalState(PROJECT)).toEqual({ 'fp-g': false });
    });
});

describe('全局强度配置：损坏不洗默认（读失败禁止整份覆盖写）', () => {
    it('强度文件损坏：loadGlobalIntensityConfigs 返回空（内存态）', async () => {
        const fs = new FakeFileSystem();
        fs.files.set(globalFingerprintIntensityFile(), '[1,2,3]');
        const library = makeLibrary(fs);
        expect(await library.loadGlobalIntensityConfigs()).toEqual({});
    });

    it('损坏后 setGlobalIntensityConfig → rejects（回归锁：旧代码用空表整份覆盖）', async () => {
        const fs = new FakeFileSystem();
        const path = globalFingerprintIntensityFile();
        fs.files.set(path, JSON.stringify({ 'fp-a': { globalIntensity: 0.8 } }));
        const library = makeLibrary(fs);
        fs.files.set(path, 'not json');
        await expect(library.setGlobalIntensityConfig('fp-b', { globalIntensity: 0.5 } as never)).rejects.toThrow('整份覆盖');
        // 磁盘原内容原样保留（没有空表覆盖）
        expect(fs.files.get(path)).toBe('not json');
    });

    it('损坏后 removeGlobalIntensityConfig → rejects', async () => {
        const fs = new FakeFileSystem();
        fs.files.set(globalFingerprintIntensityFile(), 'not json');
        const library = makeLibrary(fs);
        await expect(library.removeGlobalIntensityConfig('fp-a')).rejects.toThrow('整份覆盖');
    });

    it('文件不存在 → 合法空态，后续写入正常（不误伤）', async () => {
        const fs = new FakeFileSystem();
        const library = makeLibrary(fs);
        expect(await library.loadGlobalIntensityConfigs()).toEqual({});
        await library.setGlobalIntensityConfig('fp-a', { globalIntensity: 0.6 } as never);
        await library.flush();
        const saved = JSON.parse(fs.files.get(globalFingerprintIntensityFile())!);
        expect(saved['fp-a'].globalIntensity).toBe(0.6);
    });

    it('修复后（文件恢复正常）→ 标记清除，写入恢复', async () => {
        const fs = new FakeFileSystem();
        fs.files.set(globalFingerprintIntensityFile(), 'not json');
        const library = makeLibrary(fs);
        await expect(library.setGlobalIntensityConfig('fp-a', { globalIntensity: 0.5 } as never)).rejects.toThrow();
        // 用户/系统修复文件
        fs.files.set(globalFingerprintIntensityFile(), JSON.stringify({ 'fp-a': { globalIntensity: 0.8 } }));
        await library.setGlobalIntensityConfig('fp-b', { globalIntensity: 0.5 } as never);
        const saved = JSON.parse(fs.files.get(globalFingerprintIntensityFile())!);
        expect(saved['fp-b'].globalIntensity).toBe(0.5);
        expect(saved['fp-a'].globalIntensity).toBe(0.8); // 合并而非覆盖
    });
});

describe('migrateV1ToV2Dimensions：迁移失败不得返回 success:true（缺陷：catch 后谎报成功）', () => {
    it('scope 文件损坏 → success:false + error 指明 scope（回归锁：旧代码返回 success:true）', async () => {
        const fs = new FakeFileSystem();
        fs.files.set(globalFingerprintsFile(), 'not json');
        const library = makeLibrary(fs);
        const result = await library.migrateV1ToV2Dimensions('global');
        expect(result.success).toBe(false);
        expect(result.error).toContain('global');
    });

    it('全部 scope 无文件或无需迁移 → success:true（正常路径不误伤）', async () => {
        const fs = new FakeFileSystem();
        // V2 形态（version:'v2'）不需要迁移
        fs.files.set(globalFingerprintsFile(), JSON.stringify([
            { id: 'fp-v2', version: 'v2', scope: 'global', features: { rhythm: { description: 'x', samples: [] } } },
        ]));
        const library = makeLibrary(fs);
        const result = await library.migrateV1ToV2Dimensions('global');
        expect(result.success).toBe(true);
        expect(result.migrated).toBe(0);
    });
});

describe('updateV2FingerprintFeatures：向量重建失败不得继续用旧向量（缺陷④）', () => {
    function makeV2Library() {
        const fs = new FakeFileSystem();
        const library = makeLibrary(fs);
        const fp = { id: 'fp-v2', name: 'V2 指纹', scope: 'global', enabled: true, tags: [], samples: ['样本'], features: {} };
        const features = { rhythm: { description: '新版节奏描述', samples: ['样本'] } };
        (library as any).globalFingerprints = new Map([[fp.id, fp]]);
        (library as any).v2Fingerprints = new Map([[
            fp.id,
            { id: fp.id, scope: 'global', features: { rhythm: { description: '旧版', samples: [] } }, v1Backup: { features: {}, extractedAt: 1, migratedAt: 1 }, extractedAt: 1 },
        ]]);
        const addOrUpdateVectors = vi.fn(async () => { throw new Error('embedding 降级'); });
        const deleteVectors = vi.fn(async () => {});
        (library as any).embeddingClient = {}; // getGlobalStyleVectorStoreV2 需要 embeddingClient
        (library as any).styleVectorStoreV2Global = { addOrUpdateVectors, deleteVectors };
        return { library, fp, features, addOrUpdateVectors, deleteVectors };
    }

    it('重建失败：deleteVectors 被调用（旧向量不再当最新）', async () => {
        const { library, fp, features, addOrUpdateVectors, deleteVectors } = makeV2Library();
        const result = await library.updateV2FingerprintFeatures(fp.id, 'global', features as never);
        expect(result).toMatchObject({ id: fp.id });
        expect(addOrUpdateVectors).toHaveBeenCalled();
        expect(deleteVectors).toHaveBeenCalledWith(fp.id);
    });

    it('重建成功：不删向量', async () => {
        const { library, fp, features, deleteVectors } = makeV2Library();
        (library as any).styleVectorStoreV2Global = { addOrUpdateVectors: vi.fn(async () => ({})), deleteVectors };
        await library.updateV2FingerprintFeatures(fp.id, 'global', features as never);
        expect(deleteVectors).not.toHaveBeenCalled();
    });
});

describe('正常路径回归：写成功时磁盘内容正确（不误伤）', () => {
    it('addTemplate 成功：模板文件落盘且含指纹', async () => {
        const fs = new FakeFileSystem();
        const library = makeLibrary(fs);
        await library.addTemplate({
            id: 'fp-t', name: '模板', scope: 'template', enabled: true,
            tags: [], features: {}, samples: ['样本'],
        } as never);
        const saved = JSON.parse(fs.files.get(templateFingerprintsFile())!);
        expect(saved.some((item: { id: string }) => item.id === 'fp-t')).toBe(true);
    });

    it('saveGlobalState 成功：状态文件落盘', async () => {
        const fs = new FakeFileSystem();
        const library = makeLibrary(fs);
        await library.saveGlobalState(PROJECT, { 'fp-g': true });
        expect(JSON.parse(fs.files.get(projectGlobalFingerprintStateFile(PROJECT))!)).toEqual({ 'fp-g': true });
    });
});
