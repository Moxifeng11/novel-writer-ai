/**
 * 伏笔 / 账本文件并发「读-改-写」不丢更新
 *
 * 背景：P1-3 遗留「写锁覆盖不足」——结算、分析报告、批量建章可能同时对
 * 伏笔库.md / 承诺账本.md 做 read → 计算 → write。若整段不在 withWriteLock 内，
 * 后写者会用旧快照覆盖先写者的新增/删除。
 *
 * 本文件用真实 withWriteLock + 内存 fs 假件，并在 read 中让出事件循环放大交错窗口：
 * - 伏笔库：结算「新增伏笔」与「删除伏笔行」并发，最终两条效果都在；
 * - 承诺账本：两个并发 PROMISE_OPEN 结算，最终两条承诺都在。
 */
import { describe, expect, it } from 'vitest';
import { TFile, TFolder } from '../../__mocks__/obsidian';
import { SettlementEngine } from '../../../engine/settlement-engine';
import { createSettleContext, type SettleContext } from '../../../engine/settlement/settle-context';
import { parseReport } from '../../../engine/settlement/report-parser';
import { parsePromiseLedger } from '../../../engine/promise-ledger';
import { pjForeshadowDB, pjPromiseLedger, pjTimelineBoard } from '../../../shared/paths';
import type { FileSystemPort, VaultMetaPort } from '../../../shared/file-system-port';

const CHAP_DIR = '03-大纲与章节/步骤结果/第1卷/第1章';

type StepFn = (this: SettlementEngine, ctx: SettleContext) => Promise<void>;
type DeleteEntityFn = (this: SettlementEngine, ctx: SettleContext, entityType: string, entityName: string) => Promise<void>;

const createForeshadowsStep = (SettlementEngine.prototype as unknown as {
    settleStep_createForeshadows: StepFn;
}).settleStep_createForeshadows;
const promiseLedgerStep = (SettlementEngine.prototype as unknown as {
    settleStep_updatePromiseLedger: StepFn;
}).settleStep_updatePromiseLedger;
const deleteEntity = (SettlementEngine.prototype as unknown as {
    deleteEntity: DeleteEntityFn;
}).deleteEntity;

function makeHarness(seed: Record<string, string>) {
    const files = new Map<string, string>(Object.entries(seed));
    const fileObjs = new Map<string, TFile>();
    const folders = new Set<string>();

    const ensureFileObj = (path: string): TFile => {
        let file = fileObjs.get(path);
        if (!file) {
            file = new TFile();
            file.path = path;
            file.name = path.split('/').pop() || path;
            file.basename = file.name.replace(/\.md$/, '');
            fileObjs.set(path, file);
        }
        return file;
    };
    for (const path of Object.keys(seed)) ensureFileObj(path);

    const fs: FileSystemPort = {
        read: async (path: string) => {
            // 模拟真实 IO 的 await 让出：无锁时两个读者会在任一写入前拿到同一旧快照
            await new Promise<void>(resolve => setTimeout(resolve, 0));
            const content = files.get(path);
            if (content === undefined) throw new Error(`ENOENT: ${path}`);
            return content;
        },
        write: async (path: string, content: string) => {
            files.set(path, content);
            ensureFileObj(path);
        },
        exists: async (path: string) => files.has(path) || folders.has(path),
        getFile: async (path: string) => fileObjs.get(path) || null,
        getFolder: async (path: string) => (folders.has(path) ? new TFolder() : null),
        listFiles: async () => Array.from(fileObjs.values()),
        listFolders: async () => [],
        mkdir: async (path: string) => { folders.add(path); },
        delete: async (path: string) => { files.delete(path); fileObjs.delete(path); },
        listAll: async () => [],
        rename: async (from: string, to: string) => {
            const content = files.get(from);
            if (content !== undefined) {
                files.delete(from);
                files.set(to, content);
            }
        },
    };

    const vaultMeta: VaultMetaPort = {
        getFiles: () => Array.from(fileObjs.values()),
        getFolders: () => [],
        getAbstractFileByPath: (path: string) => fileObjs.get(path) || (folders.has(path) ? new TFolder() : null),
    };

    const app = {
        vault: {
            adapter: {
                read: async (path: string) => fs.read(path),
                write: async (path: string, content: string) => fs.write(path, content),
                exists: async (path: string) => fs.exists(path),
                mkdir: async (path: string) => fs.mkdir(path),
                list: async () => ({ files: [], folders: [] }),
                remove: async (path: string) => fs.delete(path),
            },
            getFiles: () => Array.from(fileObjs.values()),
            getAllFolders: () => [],
            getAbstractFileByPath: (path: string) => fileObjs.get(path) || (folders.has(path) ? new TFolder() : null),
            read: async (file: TFile) => fs.read(file.path),
            modify: async (file: TFile, content: string) => fs.write(file.path, content),
        },
        metadataCache: { getFileCache: () => null },
    };

    const engine = new SettlementEngine(app as never, { fs, vaultMeta });
    return { files, engine };
}

const FORESHADOW_SEED = `# 伏笔库

## 未回收伏笔

| # | 伏笔名称 | 重要程度 | 埋设章节 | 计划回收 | 相关人物 | 关联主线 | 当前状态 |
|---|---------|---------|---------|---------|---------|---------|---------|
| 1 | 保留伏笔 | 高 | 第1章 | 第9章 | 甲 | 主线 | 未揭示 |
| 2 | 待删伏笔 | 低 | 第1章 | 第9章 | 乙 | 支线 | 未揭示 |

## 已回收伏笔

| # | 伏笔名称 | 重要程度 | 埋设章节 | 相关人物 | 关联主线 | 回收章节 | 回收方式 |
|---|---------|---------|---------|---------|---------|---------|---------|
`;

describe('伏笔库 — 并发读改写不丢更新', () => {
    it('结算新增伏笔与删除伏笔行并发：新增保留、删除生效', async () => {
        const project = '长篇小说/并发锁测试-伏笔';
        const h = makeHarness({ [pjForeshadowDB(project)]: FORESHADOW_SEED });

        const addCtx = createSettleContext(
            project,
            `${project}/${CHAP_DIR}`,
            '第2章',
            '',
            'NEW_FORESHADOW: 新增伏笔 | 第2章 | 第9章 | 甲 | 主线',
            parseReport('NEW_FORESHADOW: 新增伏笔 | 第2章 | 第9章 | 甲 | 主线'),
        );

        const delCtx = createSettleContext(project, `${project}/${CHAP_DIR}`, '第2章', '', '', parseReport(''));
        await Promise.all([
            createForeshadowsStep.call(h.engine, addCtx),
            deleteEntity.call(h.engine, delCtx, '伏笔', '待删伏笔'),
        ]);

        const content = h.files.get(pjForeshadowDB(project)) || '';
        expect(content).toContain('新增伏笔');
        expect(content).toContain('保留伏笔');
        expect(content).not.toContain('待删伏笔');
    });

    it('伏笔库尚不存在时并发创建：两条都要保留（存在性判断必须在锁内）', async () => {
        const project = '长篇小说/并发锁测试-新建';
        const h = makeHarness({});

        const reportA = 'NEW_FORESHADOW: 并发甲 | 第1章 | 第9章 | 甲 | 主线';
        const reportB = 'NEW_FORESHADOW: 并发乙 | 第1章 | 第9章 | 乙 | 支线';
        const ctxA = createSettleContext(project, `${project}/${CHAP_DIR}`, '第1章', '', reportA, parseReport(reportA));
        const ctxB = createSettleContext(project, `${project}/${CHAP_DIR}`, '第1章', '', reportB, parseReport(reportB));

        await Promise.all([
            createForeshadowsStep.call(h.engine, ctxA),
            createForeshadowsStep.call(h.engine, ctxB),
        ]);

        const content = h.files.get(pjForeshadowDB(project)) || '';
        expect(content).toContain('并发甲');
        expect(content).toContain('并发乙');
    });

    it('不同项目/不同路径互不阻塞（锁按文件路径分桶）', async () => {
        const projectA = '长篇小说/并发锁测试-路径A';
        const projectB = '长篇小说/并发锁测试-路径B';
        const h = makeHarness({
            [pjForeshadowDB(projectA)]: FORESHADOW_SEED,
            [pjTimelineBoard(projectB)]: '# 时间线看板\n',
        });

        const t0 = Date.now();
        const delCtxA = createSettleContext(projectA, `${projectA}/${CHAP_DIR}`, '第1章', '', '', parseReport(''));
        const delCtxB = createSettleContext(projectB, `${projectB}/${CHAP_DIR}`, '第1章', '', '', parseReport(''));
        await Promise.all([
            deleteEntity.call(h.engine, delCtxA, '伏笔', '待删伏笔'),
            deleteEntity.call(h.engine, delCtxB, '时间线', '不存在的事件'),
        ]);
        // 不同路径各用各的队列：两个调用都正常完成且各自文件状态正确
        expect(Date.now() - t0).toBeLessThan(2000);
        expect(h.files.get(pjForeshadowDB(projectA))).not.toContain('待删伏笔');
        expect(h.files.get(pjTimelineBoard(projectB))).toBe('# 时间线看板\n');
    });
});

describe('承诺账本 — 并发读改写不丢更新', () => {
    it('两个并发 PROMISE_OPEN 结算：两条承诺都落盘', async () => {
        const project = '长篇小说/并发锁测试-账本';
        const path = pjPromiseLedger(project);
        const h = makeHarness({});

        const reportA = 'PROMISE_OPEN: 甲的承诺 | 角色承诺 | 第3章 | 备注A';
        const reportB = 'PROMISE_OPEN: 乙的约定 | 约定 | 第4章 | 备注B';
        const ctxA = createSettleContext(project, `${project}/${CHAP_DIR}`, '第2章', '', reportA, parseReport(reportA));
        const ctxB = createSettleContext(project, `${project}/${CHAP_DIR}`, '第2章', '', reportB, parseReport(reportB));

        await Promise.all([
            promiseLedgerStep.call(h.engine, ctxA),
            promiseLedgerStep.call(h.engine, ctxB),
        ]);

        const items = parsePromiseLedger(h.files.get(path) || '');
        expect(items.map(i => i.name).sort()).toEqual(['乙的约定', '甲的承诺']);
        expect(items).toHaveLength(2);
    });
});
