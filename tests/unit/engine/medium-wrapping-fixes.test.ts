/**
 * medium 收尾回归（DSH-20261113-25）：四个静默缺陷的失败/正常路径
 *
 * ① 章节摘要：台账读失败 → 跳过写盘（空账本不得覆盖已有摘要）
 * ② 知识归因：metadataCache 未索引 → 回退读取（命中率不假阴性）
 * ③ 批量导入：重试找不到任务 → { retried, missing }（不静默空转）
 * ④ 流式 usage：缺失标记 usageUnavailable（0 ≠ 正常用量）
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Vault, TFile } from 'obsidian';
import { writeChapterDigestFromProject } from '../../../engine/memory/chapter-digest';
import { collectKnowledgeUsage } from '../../../engine/knowledge-usage';
import { BatchImportManager } from '../../../engine/batch-import-manager';
import { usageUnavailableFor } from '../../../engine/ai-api-client';

describe('① 章节摘要：台账读失败跳过写盘', () => {
    function makeDigestEnv(options: { foreshadowContent?: string; foreshadowBroken?: boolean }) {
        const written: Map<string, string> = new Map();
        const vaultFiles = new Map<string, string>();
        const fs = {
            exists: async (p: string) => vaultFiles.has(p) || written.has(p),
            read: async (p: string) => {
                if (options.foreshadowBroken && p.includes('伏笔库')) throw new Error('EIO: 临时读失败');
                if (vaultFiles.has(p)) return vaultFiles.get(p)!;
                if (written.has(p)) return written.get(p)!;
                throw new Error(`ENOENT: ${p}`);
            },
            write: async (p: string, c: string) => { written.set(p, c); },
            mkdir: async () => {},
            modify: async (p: string, c: string) => { vaultFiles.set(p, c); },
            rename: async () => {},
        };
        const app = {
            vault: {
                getAbstractFileByPath: (p: string) => (vaultFiles.has(p) ? ({ path: p } as never) : null),
                cachedRead: async (file: { path: string }) => vaultFiles.get(file.path) ?? '',
                read: async (file: { path: string }) => vaultFiles.get(file.path) ?? '',
            },
            fileManager: {
                processFrontMatter: async (file: { path: string }, fn: (fm: Record<string, unknown>) => void) => {
                    const content = vaultFiles.get(file.path) ?? '';
                    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
                    const fm: Record<string, unknown> = match ? JSON.parse(match[1]) : {};
                    fn(fm);
                },
            },
        };
        // 台账文件存在（有内容或损坏均可触发「存在但读失败」分支）
        vaultFiles.set('长篇小说/测试书/02-时间线与伏笔/时间线看板.md', '# 时间线看板\n\n（空）');
        vaultFiles.set(
            '长篇小说/测试书/02-时间线与伏笔/伏笔库.md',
            options.foreshadowContent ?? '# 伏笔库\n\n## 未回收伏笔\n\n| # | 伏笔名称 | 重要程度 | 埋设章节 | 计划回收 | 相关人物 | 关联主线 | 当前状态 |\n|---|---|---|---|---|---|---|---|\n| 1 | 断剑 | 高 | 第1章 | 第5章 | 张三 | 主线 | 未揭示 |\n',
        );
        return { app, fs: fs as never, written };
    }

    it('台账正常：摘要写盘（正常路径回归）', async () => {
        const { app, fs, written } = makeDigestEnv({});
        const digest = await writeChapterDigestFromProject(app as never, fs, '长篇小说/测试书', '第1章', '正文');
        expect(digest.chapterKey).toBe('第1章');
        const digestFile = [...written.keys()].find(k => k.includes('剧情记忆/第1章_摘要.md'));
        expect(digestFile).toBeTruthy();
    });

    it('台账读失败：跳过写盘并留痕（空账本不得覆盖已有摘要）', async () => {
        const { app, fs, written } = makeDigestEnv({ foreshadowBroken: true });
        // 先写一份「上一轮的正确摘要」到磁盘
        const digestPath = '长篇小说/测试书/04-项目总控/剧情记忆/第1章_摘要.md';
        written.set(digestPath, '上一轮正确摘要');
        const digest = await writeChapterDigestFromProject(app as never, fs, '长篇小说/测试书', '第1章', '正文');
        expect(digest.chapterKey).toBe('第1章');
        // 磁盘上的旧摘要未被空账本覆盖
        expect(written.get(digestPath)).toBe('上一轮正确摘要');
    });
});

describe('② 知识归因：metadataCache 未索引回退读取', () => {
    function makeApp(options: { indexed: boolean; vaultContent: string }) {
        return {
            vault: {
                getAbstractFileByPath: () => null,
                // listFolderFiles 需要的树接口由调用方注入——这里用最小形状
            },
            metadataCache: {
                getFileCache: () => (options.indexed ? { frontmatter: { step_status: 'generated' } } : null),
            },
            cachedRead: vi.fn(async () => options.vaultContent),
        };
    }

    it('getFileCache 为 null 且缓存内容带 rag_sources → 回退解析计入 records（命中率不假阴性）', async () => {
        const path = '长篇小说/测试书/03-大纲与章节/步骤结果/第1卷/第1章/第1章_大纲摘要.md';
        // listFolderFiles 需要真实目录树（项目根 → 递归 children；文件节点靠 extension 区分）
        // isFolder() 判定依据是 children 为数组——文件节点必须不带 children，否则被当目录跳过
        const fileNode = { path, name: '第1章_大纲摘要.md', stat: { mtime: 1 }, extension: 'md' };
        const folder = (p: string, children: unknown[] = []) => ({ path: p, name: p.split('/').pop(), children, extension: '' });
        const tree = folder('长篇小说/测试书', [
            folder('长篇小说/测试书/03-大纲与章节', [
                folder('长篇小说/测试书/03-大纲与章节/步骤结果', [
                    folder('长篇小说/测试书/03-大纲与章节/步骤结果/第1卷', [
                        folder('长篇小说/测试书/03-大纲与章节/步骤结果/第1卷/第1章', [fileNode]),
                    ]),
                ]),
            ]),
        ]);
        const app = {
            vault: {
                getAbstractFileByPath: (p: string) => (p === '长篇小说/测试书' ? tree : (p === path ? fileNode : null)),
            },
            // cachedRead 是 app 根能力（KnowledgeUsageAppLike.cachedRead），不在 vault 上
            cachedRead: vi.fn(async (file: { path: string }) => {
                if (file.path !== path) throw new Error('ENOENT');
                return '---\n{"rag_sources":[{"book":"晨星志","dimension":"original","score":1,"excerpt":"x"}]}\n---\n正文';
            }),
            metadataCache: { getFileCache: () => null },
        };
        const usage = await collectKnowledgeUsage(app as never, '长篇小说/测试书');
        expect(app.cachedRead).toHaveBeenCalled();
        expect(usage.stepsTotal).toBe(1);
        expect(usage.totalSources).toBe(1);
        expect(usage.byBook[0]?.book).toBe('晨星志');
    });
});

describe('③ 批量导入：重试找不到任务返回 { retried, missing }', () => {
    it('任务记录已过期：missing 列出书名且不静默空转（回归锁：旧代码返回 void）', async () => {
        const manager = new BatchImportManager({} as never, {} as never, {} as never);
        const historyId = 'h1';
        // 直接构造历史：一本失败书，tasks 里没有对应任务（重启场景）
        (manager as unknown as { history: Array<Record<string, unknown>> }).history = [{
            id: historyId,
            books: [{ bookName: '过期书', status: 'failed' }],
        }];
        const result = manager.retryFailedFromHistory(historyId);
        expect(result).toEqual({ retried: 0, missing: ['过期书'] });
    });

    it('对应任务存在：正常重试', () => {
        const manager = new BatchImportManager({} as never, {} as never, {} as never);
        const historyId = 'h2';
        const retryTask = vi.fn();
        (manager as unknown as { history: Array<Record<string, unknown>>; tasks: Map<string, { id: string; bookName: string; status: string }>; retryTask: (id: string) => void }).history = [{
            id: historyId,
            books: [{ bookName: '存活书', status: 'failed' }],
        }];
        (manager as unknown as { tasks: Map<string, { id: string; bookName: string; status: string }> }).tasks = new Map([
            ['t1', { id: 't1', bookName: '存活书', status: 'failed' }],
        ]);
        (manager as unknown as { retryTask: (id: string) => void }).retryTask = retryTask;
        const result = manager.retryFailedFromHistory(historyId);
        expect(result.retried).toBe(1);
        expect(result.missing).toEqual([]);
        expect(retryTask).toHaveBeenCalled();
    });
});

describe('④ 流式 usage 缺失标记 usageUnavailable', () => {
    it('成功响应缺 usage → usageUnavailableFor 返回 true', () => {
        expect(usageUnavailableFor({ content: '正文', finishReason: 'stop' } as never)).toBe(true);
    });

    it('usage 存在 → false（正常路径不误伤）', () => {
        expect(usageUnavailableFor({ content: '正文', usage: { prompt: 100, completion: 50, total: 150 } } as never)).toBe(false);
    });

    it('error 响应 → false（失败路径不标记 usage 问题）', () => {
        expect(usageUnavailableFor({ error: 'HTTP 500' } as never)).toBe(false);
    });
});
