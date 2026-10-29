/**
 * cowrite-persistence-guards.test.ts — 协同写作依赖的三处持久化/缓存防线
 *
 * 1. PreferenceMemory：读失败 ≠ 没有偏好。读失败后第一次保存必须先把原文件留档，
 *    否则「采纳一条建议」就会用只含新偏好的对象整体覆盖历史。
 * 2. 指纹强度配置：读失败不能缓存空对象，否则随后保存会把其他指纹的强度抹掉。
 * 3. PromptBuilder 知识缓存：签名必须包含知识库版本，否则重新拆解后一直返回旧片段。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../main', () => ({
    default: class NovelWriterPlugin {},
}));

import { PreferenceMemory } from '../../../engine/preference-memory';
import { StyleFingerprintLibrary } from '../../../engine/style-fingerprint-library';
import { PromptBuilder } from '../../../engine/prompt-builder';
import { Vault } from 'obsidian';
import { pluginPreferenceFile, projectFingerprintIntensityFile } from '../../../shared/paths';

class FakeFileSystem {
    files = new Map<string, string>();
    folders = new Set<string>();
    renames: Array<{ from: string; to: string }> = [];

    async read(path: string): Promise<string> {
        const value = this.files.get(path);
        if (value === undefined) throw new Error(`ENOENT: ${path}`);
        return value;
    }
    async write(path: string, content: string): Promise<void> {
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
        this.renames.push({ from, to });
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

function makePreferenceMemory(fs: FakeFileSystem): PreferenceMemory {
    const memory = new PreferenceMemory({ app: {} as never, plugin: {} as never, project: '测试书' });
    (memory as any).fs = fs;
    return memory;
}

describe('PreferenceMemory — 读失败不覆盖历史偏好', () => {
    it('文件损坏时首次保存先留档原文件', async () => {
        const fs = new FakeFileSystem();
        const path = pluginPreferenceFile('测试书');
        fs.files.set(path, '{ 这不是合法 JSON');
        const memory = makePreferenceMemory(fs);

        await memory.loadPreferences();
        await memory.recordPreference('style', '节奏', '偏快');
        await memory.flush();

        // 原文件被改名留档
        expect(fs.renames).toHaveLength(1);
        expect(fs.renames[0].from).toBe(path);
        expect(fs.renames[0].to).toContain('.corrupt-');
        // 新文件只含本次偏好（旧内容仍在 .corrupt 备份里）
        const saved = JSON.parse(fs.files.get(path)!);
        expect(Object.keys(saved)).toHaveLength(1);
        expect(fs.files.get(fs.renames[0].to)).toBe('{ 这不是合法 JSON');
    });

    it('文件不存在时正常加载，首次保存不做留档', async () => {
        const fs = new FakeFileSystem();
        const memory = makePreferenceMemory(fs);

        await memory.loadPreferences();
        await memory.recordPreference('style', '节奏', '偏快');
        await memory.flush();

        expect(fs.renames).toHaveLength(0);
        expect(fs.files.has(pluginPreferenceFile('测试书'))).toBe(true);
    });
});

describe('StyleFingerprintLibrary — 强度配置读失败不清空', () => {
    let fs: FakeFileSystem;
    let library: StyleFingerprintLibrary;
    const PROJECT = '测试书';

    beforeEach(() => {
        fs = new FakeFileSystem();
        const vault = new Vault();
        library = new StyleFingerprintLibrary({ vault } as any, PROJECT);
        (library as any).fs = fs;
    });

    it('配置损坏时 setIntensityConfig 抛错且不覆盖磁盘', async () => {
        const path = projectFingerprintIntensityFile(PROJECT);
        fs.files.set(path, '[1,2,3]');

        await expect(library.setIntensityConfig('fp-a', { globalIntensity: 0.4 } as never))
            .rejects.toThrow('强度配置读取失败');
        // 磁盘原内容原样保留
        expect(fs.files.get(path)).toBe('[1,2,3]');
    });

    it('配置不存在时正常写入（首次配置）', async () => {
        await library.setIntensityConfig('fp-a', { globalIntensity: 0.4 } as never);
        await library.flush();

        const saved = JSON.parse(fs.files.get(projectFingerprintIntensityFile(PROJECT))!);
        expect(saved['fp-a'].globalIntensity).toBe(0.4);
    });

    it('已有内存配置时读失败沿用内存值，不清成空对象', async () => {
        const path = projectFingerprintIntensityFile(PROJECT);
        fs.files.set(path, JSON.stringify({ 'fp-a': { globalIntensity: 0.6 } }));
        await library.loadIntensityConfigs(PROJECT);

        // 模拟文件在两次读取之间损坏
        fs.files.set(path, 'not json');
        const configs = await library.loadIntensityConfigs(PROJECT);

        expect(configs['fp-a'].globalIntensity).toBe(0.6);
    });
});

describe('PromptBuilder — 知识库缓存随数据版本失效', () => {
    let parseSpy: ReturnType<typeof vi.fn>;
    let manager: { version: number };

    function makeBuilder() {
        const builder = new PromptBuilder(() => null);
        builder.setReferenceBooks(['book-1']);
        manager = { version: 1 };
        const vectorStore = {
            search: vi.fn(async () => ([
                { sample: '风格样本片段', bookId: 'book-1', bookName: '参考书', dimension: 'style', score: 0.9 },
            ])),
            getModelMismatches: () => [],
        };
        builder.setKnowledgeBase(manager as never, vectorStore as never);
        return { builder, vectorStore };
    }

    beforeEach(() => {
        parseSpy = vi.fn();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('相同 query 命中缓存只检索一次', async () => {
        const { builder, vectorStore } = makeBuilder();

        await builder.getKnowledgePromptParts('他抬手，风从袖口灌进来。');
        await builder.getKnowledgePromptParts('他抬手，风从袖口灌进来。');

        // style + original 两次检索，只发生一轮
        expect(vectorStore.search).toHaveBeenCalledTimes(2);
    });

    it('知识库版本变化后同一 query 会重新检索', async () => {
        const { builder, vectorStore } = makeBuilder();

        await builder.getKnowledgePromptParts('他抬手，风从袖口灌进来。');
        expect(vectorStore.search).toHaveBeenCalledTimes(2);

        // 模拟重新拆解/改名/改状态：manager 版本 +1
        manager.version = 2;
        await builder.getKnowledgePromptParts('他抬手，风从袖口灌进来。');

        expect(vectorStore.search).toHaveBeenCalledTimes(4);
    });

    it('重设知识库数据源会清空缓存', async () => {
        const { builder, vectorStore } = makeBuilder();
        await builder.getKnowledgePromptParts('他抬手，风从袖口灌进来。');

        builder.setKnowledgeBase(null, null);
        builder.setKnowledgeBase(manager as never, vectorStore as never);
        await builder.getKnowledgePromptParts('他抬手，风从袖口灌进来。');

        expect(vectorStore.search).toHaveBeenCalledTimes(4);
    });
});
