/**
 * settlement-silent-paths.test.ts — 结算静默漏写可见化回归（DSH-20261113-23）
 *
 * 对抗性审查（medium，用户可见）：强制揭示找不到伏笔库/名字未命中、GROWTH/
 * UPDATE_EMOTION 人物卡缺失、关系互信息区块缺失、快照读取失败——此前全部静默
 * 跳过或只 log.warn，用户以为结算完整。
 *
 * 本文件锁：这些路径必须进 missingEntities / markPostStepFailure / snapshotIncomplete。
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { TFile } from 'obsidian';

vi.mock('../../../main', () => ({ default: class NovelWriterPlugin {} }));

const { SettlementEngine } = await import('../../../engine/settlement-engine');

/** 最小引擎：只暴露被测私有方法所需的宿主面 */
function makeEngine(vaultFiles: Map<string, string>): InstanceType<typeof SettlementEngine> {
    const notifier = { showNotice: vi.fn() };
    const engine = new SettlementEngine(
        {
            vault: {
                getAbstractFileByPath: (p: string) => {
                    if (!vaultFiles.has(p)) return null;
                    const f = new TFile();
                    (f as unknown as { path: string; name: string; basename: string }).path = p;
                    (f as unknown as { name: string }).name = p.split('/').pop() || '';
                    (f as unknown as { basename: string }).basename = (p.split('/').pop() || '').replace(/\.\w+$/, '');
                    return f;
                },
                // ObsidianFileSystem.write(file) 走 vault.modify(file, content)
                modify: async (file: { path: string }, content: string) => {
                    if (!vaultFiles.has(file.path)) throw new Error('File not found');
                    vaultFiles.set(file.path, content);
                },
                // ObsidianFileSystem.read(file) 走 vault.read
                read: async (file: { path: string }) => {
                    const content = vaultFiles.get(file.path);
                    if (content === undefined) throw new Error('File not found');
                    return content;
                },
                // Obsidian fileManager.processFrontMatter 语义：解析 frontmatter → fn → 回写
                processFrontMatter: async (file: { path: string }, fn: (fm: Record<string, unknown>) => void) => {
                    const content = vaultFiles.get(file.path) ?? '';
                    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
                    const fm: Record<string, unknown> = match ? JSON.parse(match[1]) : {};
                    fn(fm);
                    const body = match ? content.slice(match[0].length) : content;
                    vaultFiles.set(file.path, '---\n' + JSON.stringify(fm, null, 2) + '\n---' + body);
                },
                getFiles: () => [],
            },
            fileManager: {
                processFrontMatter: async (file: { path: string }, fn: (fm: Record<string, unknown>) => void) => {
                    const content = vaultFiles.get(file.path) ?? '';
                    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
                    const fm: Record<string, unknown> = match ? JSON.parse(match[1]) : {};
                    fn(fm);
                    const body = match ? content.slice(match[0].length) : content;
                    vaultFiles.set(file.path, '---\n' + JSON.stringify(fm, null, 2) + '\n---' + body);
                },
            },
            workspace: {},
        } as never,
        // deps 重载：vaultMeta 供 getVaultMeta()——必须返回真 TFile（调用方做 instanceof 检查）
        {
            vaultMeta: {
                getAbstractFileByPath: (p: string) => {
                    if (!vaultFiles.has(p)) return null;
                    const f = new TFile();
                    (f as unknown as { path: string; name: string; basename: string }).path = p;
                    (f as unknown as { name: string }).name = p.split('/').pop() || '';
                    (f as unknown as { basename: string }).basename = (p.split('/').pop() || '').replace(/\.\w+$/, '');
                    return f;
                },
            },
            notifier: { showNotice: vi.fn() },
        } as never,
    );
    return engine as unknown as InstanceType<typeof SettlementEngine>;
}

function charFile(vaultFiles: Map<string, string>, name: string, body: string): void {
    vaultFiles.set(`长篇小说/测试项目/01-世界架构/人物/${name}.md`, body);
}

const EMPTY_CHAR = '# 张三\n\n人物卡（缺成长记录区块）';

beforeEach(() => {
    // 结算提示走 Notice 桩：避免测试环境缺宿主
});

describe('结算静默路径可见化（DSH-20261113-23）', () => {
    it('强制揭示的名字未命中伏笔库 → 进 missingEntities（category 伏笔）', async () => {
        const files = new Map<string, string>();
        const fpPath = '长篇小说/测试项目/02-时间线与伏笔/伏笔库.md';
        files.set(fpPath, [
            '# 伏笔库',
            '',
            '## 未回收伏笔',
            '',
            '| # | 伏笔名称 | 重要程度 | 埋设章节 | 计划回收 | 相关人物 | 关联主线 | 当前状态 |',
            '|---|---|---|---|---|---|---|---|',
            '| 1 | 断剑 | 高 | 第1章 | 第5章 | 张三 | 主线 | 未揭示 |',
            '',
            '## 已回收伏笔',
            '',
            '| # | 伏笔名称 | 重要程度 | 埋设章节 | 相关人物 | 关联主线 | 回收章节 | 回收方式 |',
            '|---|---|---|---|---|---|---|---|',
            '',
        ].join('\n'));
        const engine = makeEngine(files);
        const engineAny = engine as unknown as {
            settleStep_updateForeshadows: (ctx: Record<string, unknown>) => Promise<void>;
        };
        const ctx = {
            project: '长篇小说/测试项目',
            chapName: '第3章',
            instr: { uf: [], forceRevealNames: [] },
            options: { forceReveal: ['不存在的伏笔'] },
            result: { updatedForeshadows: 0, missingEntities: [] as Array<{ category: string; name: string; field: string }>, partialFailure: [] as string[] },
            hasPartialFailure: false,
        };
        // resolveForceRevealNames 需要 instr.uf 上下文——直接驱动私有方法
        await engineAny.settleStep_updateForeshadows({
            project: '长篇小说/测试项目',
            chapName: '第3章',
            instr: { uf: [] },
            options: { forceReveal: ['不存在的伏笔'] },
            result: ctx.result,
            hasPartialFailure: false,
        });
        expect(ctx.result.missingEntities.some(m => m.category === '伏笔' && m.name === '不存在的伏笔')).toBe(true);
    });

    it('伏笔库文件不存在且有强制揭示请求 → markPostStepFailure（partialFailure 可见）', async () => {
        const engine = makeEngine(new Map()); // 空 vault：伏笔库不存在
        const engineAny = engine as unknown as {
            settleStep_updateForeshadows: (ctx: Record<string, unknown>) => Promise<void>;
        };
        const result = { updatedForeshadows: 0, missingEntities: [], partialFailure: [] as string[] };
        await engineAny.settleStep_updateForeshadows({
            project: '长篇小说/测试项目',
            chapName: '第3章',
            instr: { uf: [{ name: '断剑', field: '状态', value: '已回收' }] },
            options: { forceReveal: ['断剑'] },
            result,
            hasPartialFailure: false,
        });
        expect(result.partialFailure).toContain('伏笔库');
    });

    it('GROWTH 指令人物卡缺失 → 进 missingEntities（category 人物/成长记录）', async () => {
        const files = new Map<string, string>();
        charFile(files, '张三', EMPTY_CHAR); // 张三存在但没有「## 变更记录」
        // 李四完全不存在
        const engine = makeEngine(files);
        const engineAny = engine as unknown as {
            settleStep_updateGrowth: (ctx: Record<string, unknown>) => Promise<void>;
        };
        const result = { updatedGrowth: 0, missingEntities: [] as Array<{ category: string; name: string; field: string }> };
        const journal = { recordAppend: vi.fn(), recordField: vi.fn() };
        await engineAny.settleStep_updateGrowth({
            journal,
            project: '长篇小说/测试项目',
            chapName: '第3章',
            instr: {
                growth: [
                    { name: '张三', type: '实力', value: '筑基', desc: '突破' },
                    { name: '李四', type: '实力', value: '炼气', desc: '入门' },
                ],
            },
            result,
        });
        // 李四卡缺失 → 可见；张三写入成功（无「变更记录」区块时追加到文末）
        expect(result.missingEntities.some(m => m.category === '人物' && m.name === '李四')).toBe(true);
        expect(result.updatedGrowth).toBe(1);
    });

    it('UPDATE_EMOTION 人物卡缺失 → 进 missingEntities（category 人物/当前情绪）', async () => {
        const engine = makeEngine(new Map());
        const engineAny = engine as unknown as {
            settleStep_updateEmotions: (ctx: Record<string, unknown>) => Promise<void>;
        };
        const result = { updatedEmotions: 0, missingEntities: [] as Array<{ category: string; name: string; field: string }> };
        await engineAny.settleStep_updateEmotions({
            project: '长篇小说/测试项目',
            chapName: '第3章',
            instr: { emotion: [{ name: '李四', emotion: '恐惧' }] },
            result,
        });
        expect(result.missingEntities.some(m => m.category === '人物' && m.name === '李四' && m.field === '当前情绪')).toBe(true);
    });

    it('关系指令两侧实体卡缺失 → 进 missingEntities（category 实体/关系互信息）', async () => {
        const engine = makeEngine(new Map());
        const engineAny = engine as unknown as {
            updateRelation: (
                project: string,
                a: string,
                b: string,
                relType: string,
                desc: string,
                chapName: string,
                journal: { recordAppend: (path: string, entry: string) => void } | undefined,
                onMissing?: (name: string) => void,
            ) => Promise<void>;
        };
        const missing: string[] = [];
        await engineAny.updateRelation('长篇小说/测试项目', '王五', '赵六', '敌对', '夺宝反目', '第3章', undefined, (name) => missing.push(name));
        expect(missing).toContain('王五');
        expect(missing).toContain('赵六');
    });

    it('互信息区块缺失（实体卡存在但无该区块）→ onMissing 被回调（可见）', async () => {
        const files = new Map<string, string>();
        charFile(files, '王五', EMPTY_CHAR); // 存在但无互信息区块
        const engine = makeEngine(files);
        const engineAny = engine as unknown as {
            updateRelation: (
                project: string,
                a: string,
                b: string,
                relType: string,
                desc: string,
                chapName: string,
                journal: { recordAppend: (path: string, entry: string) => void } | undefined,
                onMissing?: (name: string) => void,
            ) => Promise<void>;
        };
        const missing: string[] = [];
        await engineAny.updateRelation('长篇小说/测试项目', '王五', '赵六', '敌对', '夺宝反目', '第3章', { recordAppend: vi.fn() }, (name) => missing.push(name));
        // 王五卡存在但无互信息区块 → 追加落空 → 可见；赵六卡缺失 → 也可见
        expect(missing).toContain('王五');
        expect(missing).toContain('赵六');
    });

    it('快照读取失败 → snapshotIncomplete 置位（finalizeRollback 据此标 settlement_partial）', async () => {
        const files = new Map<string, string>();
        charFile(files, '张三', EMPTY_CHAR);
        // processFrontmatter 会真正解析——文件内容合法，但让 getFS().read 抛错：
        // snapshotField 走 processFrontmatter(file)，其内部 read 失败 → 抛错进 catch
        const engine = makeEngine(files);
        const engineAny = engine as unknown as {
            snapshotField: (ctx: Record<string, unknown>, file: TFile, field: string) => Promise<void>;
        };
        const ctx: Record<string, unknown> = {
            snapshots: new Map<string, Map<string, unknown>>(),
            journal: { recordField: vi.fn() },
            snapshotIncomplete: false,
        };
        const file = (files as unknown as { has: (p: string) => boolean }) && null;
        void file;
        // 构造一个不存在的 TFile → processFrontmatter 读失败 → catch 置位
        // 让 fileManager.processFrontMatter 抛错（数据读取异常场景）
        const fileManager = (engine as unknown as { app: { fileManager: { processFrontMatter: (f: unknown, fn: unknown) => Promise<void> } } }).app.fileManager;
        fileManager.processFrontMatter = vi.fn(async () => { throw new Error('磁盘读取异常'); });
        const missingFile = new TFile();
        (missingFile as unknown as { path: string }).path = '长篇小说/测试项目/01-世界架构/人物/张三.md';
        await engineAny.snapshotField(ctx, missingFile, '当前情绪');
        expect(ctx.snapshotIncomplete).toBe(true);
    });
});
