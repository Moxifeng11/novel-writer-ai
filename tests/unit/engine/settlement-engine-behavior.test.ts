/**
 * SettlementEngine 真实行为测试（G7-6）
 *
 * 不再整体 mock settle：用内存文件系统 + 简化 frontmatter 端口跑真实步骤，
 * 覆盖 ①成功结算 ②重复结算幂等 ③部分失败按 journal 回滚。
 *
 * 只测试与「数据写入正确性」相关的步骤（实体字段/伏笔/时间线/成长/连续性/正文状态），
 * 关系 V2 与承诺账本已有各自单测，不在本文件重复。
 */
import { describe, expect, it, vi } from 'vitest';
import { TFile, TFolder } from '../../__mocks__/obsidian';
import { SettlementEngine } from '../../../engine/settlement-engine';
import { pjCharFile, pjForeshadowDB, pjTimelineBoard, pjBodyFile } from '../../../shared/paths';
import type { FileSystemPort, FrontmatterPort, VaultMetaPort } from '../../../shared/file-system-port';
import { withWriteLock } from '../../../shared/write-lock';
import { createSettleContext } from '../../../engine/settlement/settle-context';
import { parseReport } from '../../../engine/settlement/report-parser';

const PROJECT = '长篇小说/测试书';
const VOL = 1;
const CHAP = 1;
const CHAP_NAME = '第1章';
const CHAP_DIR = `${PROJECT}/03-大纲与章节/步骤结果/第${VOL}卷/第${CHAP}章`;
const CHAR_PATH = pjCharFile(PROJECT, '甲');
const BODY_PATH = pjBodyFile(PROJECT, VOL, CHAP);

function parseFm(raw: string): { fm: Record<string, unknown>; body: string } {
    const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
    if (!match) return { fm: {}, body: raw };
    const fm: Record<string, unknown> = {};
    for (const line of match[1].split('\n')) {
        const sep = line.indexOf(':');
        if (sep <= 0) continue;
        const key = line.slice(0, sep).trim();
        const value = line.slice(sep + 1).trim();
        if (value.startsWith('[') && value.endsWith(']')) {
            fm[key] = value.slice(1, -1).split(',').map(item => item.trim()).filter(Boolean);
        } else if (/^-?\d+(\.\d+)?$/.test(value)) {
            fm[key] = Number(value);
        } else if (value.startsWith('{')) {
            try { fm[key] = JSON.parse(value); } catch { fm[key] = value; }
        } else {
            fm[key] = value.replace(/^["']|["']$/g, '');
        }
    }
    return { fm, body: match[2] };
}

function serializeFm(fm: Record<string, unknown>, body: string): string {
    const lines = Object.entries(fm).map(([key, value]) => {
        if (Array.isArray(value)) return `${key}: [${value.map(String).join(', ')}]`;
        if (value && typeof value === 'object') return `${key}: ${JSON.stringify(value)}`;
        return `${key}: ${value == null ? '' : String(value)}`;
    });
    return `---\n${lines.join('\n')}\n---\n${body}`;
}

function makeHarness(
    seed: Record<string, string>,
    failWritesMatching?: RegExp,
    hooks?: {
        onProcessFrontmatter?: (file: TFile) => Promise<void> | void;
        failReadsMatching?: RegExp;
        beforeWrite?: (path: string) => Promise<void> | void;
    },
) {
    const files = new Map<string, string>(Object.entries(seed));
    const fileObjs = new Map<string, TFile>();
    const folders = new Set<string>();
    const notices: string[] = [];

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

    // 种子文件必须在 vault 索引里，否则 getAbstractFileByPath 返回 null（missingEntities）
    for (const path of Object.keys(seed)) ensureFileObj(path);

    const fs: FileSystemPort = {
        read: async (path: string) => {
            if (hooks?.failReadsMatching?.test(path)) {
                throw new Error(`模拟读取失败: ${path}`);
            }
            const content = files.get(path);
            if (content === undefined) throw new Error(`ENOENT: ${path}`);
            return content;
        },
        write: async (path: string, content: string) => {
            await hooks?.beforeWrite?.(path);
            if (failWritesMatching && failWritesMatching.test(path)) {
                throw new Error(`模拟写入失败: ${path}`);
            }
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
            const file = fileObjs.get(from);
            if (file) {
                fileObjs.delete(from);
                file.path = to;
                file.name = to.split('/').pop() || to;
                fileObjs.set(to, file);
            }
        },
    };

    const frontmatter: FrontmatterPort = {
        processFrontmatter: async (file, updater) => {
            await hooks?.onProcessFrontmatter?.(file);
            const raw = files.get(file.path) ?? '';
            const { fm, body } = parseFm(raw);
            updater(fm);
            files.set(file.path, serializeFm(fm, body));
        },
    };

    const vaultMeta: VaultMetaPort = {
        getFiles: () => Array.from(fileObjs.values()),
        getFolders: () => [],
        getAbstractFileByPath: (path: string) => fileObjs.get(path) || (folders.has(path) ? new TFolder() : null),
    };

    // mkdirp / relationship-engine 内部会 new ObsidianFileSystem(app)：给一个适配器形状
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
        // 结算内的信息债刷新会读章节 frontmatter；内存测试不提供真实索引
        metadataCache: { getFileCache: () => null },
        fileManager: {
            processFrontMatter: async (file: TFile, updater: (fm: Record<string, unknown>) => void) => {
                await frontmatter.processFrontmatter(file, updater);
            },
        },
    };

    const engine = new SettlementEngine(app as never, {
        fs,
        frontmatter,
        vaultMeta,
        notifier: { showNotice: (message: string) => { notices.push(message); } } as never,
    });

    return { files, folders, notices, engine };
}

const CHAR_SEED = `---
当前状态: 健康
---
# 甲

## 变更记录
`;

const FORESHADOW_SEED = `# 伏笔库

## 未回收伏笔

| # | 伏笔名称 | 重要程度 | 埋设章节 | 计划回收 | 相关人物 | 关联主线 | 当前状态 |
|---|---|---|---|---|---|---|---|
| 1 | 旧线 | 低 | 第1章 | 第5章 | 甲 | 主线 | 未揭示 |

## 已回收伏笔

| # | 伏笔名称 | 重要程度 | 埋设章节 | 相关人物 | 关联主线 | 回收章节 | 回收方式 |
|---|---|---|---|---|---|---|---|
`;

const TIMELINE_SEED = `# 时间线看板

## 纪元 / 时间轴

### 背景纪元（故事开始前）

| 时间 | 对应章节 | 事件 | 影响 |
|------|---------|------|------|

### 主线纪元（故事进行中）

| 时间 | 对应章节 | 事件 | 影响 |
|------|---------|------|------|
`;

const BODY_SEED = `---
status: written
---
这是正文。
`;

const REPORT = [
    'UPDATE_CHARACTER: [[甲]] | 当前状态 | 受伤',
    'UPDATE_CHARACTER: [[甲]] | 已知信息 | 玉佩来历不明',
    'GROWTH: 甲 | 境界 | 筑基 | 突破',
    'NEW_FORESHADOW: 玉佩 | 第1章 | 第5章 | 甲 | 身世线',
    'NEW_TIMELINE: 深夜 | 甲在码头遇袭',
].join('\n');

function seedAll() {
    return {
        [CHAR_PATH]: CHAR_SEED,
        [pjForeshadowDB(PROJECT)]: FORESHADOW_SEED,
        [pjTimelineBoard(PROJECT)]: TIMELINE_SEED,
        [BODY_PATH]: BODY_SEED,
    };
}

describe('SettlementEngine — 成功结算', () => {
    it('实体字段/伏笔行/时间线行/正文状态全部落盘，mode=full', async () => {
        const h = makeHarness(seedAll());
        const result = await h.engine.settle(PROJECT, CHAP_DIR, CHAP_NAME, REPORT, BODY_SEED);

        expect(result.mode).toBe('full');
        expect(result.updatedChars).toBeGreaterThanOrEqual(1);
        expect(result.createdForeshadows).toBe(1);
        expect(result.createdTimelines).toBe(1);

        const char = h.files.get(CHAR_PATH)!;
        expect(char).toContain('当前状态: 受伤');
        expect(char).toContain('筑基');

        const foreshadow = h.files.get(pjForeshadowDB(PROJECT))!;
        expect(foreshadow).toContain('玉佩');

        const timeline = h.files.get(pjTimelineBoard(PROJECT))!;
        expect(timeline).toContain('甲在码头遇袭');

        const body = h.files.get(BODY_PATH)!;
        expect(body).toContain('status: settled');
    });

    it('同项目并发 settle 串行化：第二个 run 等第一个释放项目锁', async () => {
        const h = makeHarness(seedAll());
        let releaseFirst!: () => void;
        const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
        let firstRun = true;
        const stepSpy = vi
            .spyOn(h.engine as never as { settleStep_updateCharacters: () => Promise<void> }, 'settleStep_updateCharacters')
            .mockImplementation(async () => {
                if (firstRun) {
                    firstRun = false;
                    await firstGate;
                }
            });

        const first = h.engine.settle(PROJECT, CHAP_DIR, CHAP_NAME, REPORT, BODY_SEED);
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        const second = h.engine.settle(PROJECT, CHAP_DIR, CHAP_NAME, REPORT, BODY_SEED);
        await new Promise<void>((resolve) => setTimeout(resolve, 0));

        // 第一个 run 卡在写步骤；第二个 run 必须停在项目锁外，不能开始写
        expect(stepSpy).toHaveBeenCalledTimes(1);

        releaseFirst();
        await Promise.all([first, second]);
        expect(stepSpy).toHaveBeenCalledTimes(2);
    });
});

describe('SettlementEngine — 重复结算幂等', () => {
    it('同报告结算两次：成长/连续性/时间线/伏笔都不重复', async () => {
        const h = makeHarness(seedAll());
        await h.engine.settle(PROJECT, CHAP_DIR, CHAP_NAME, REPORT, BODY_SEED);
        await h.engine.settle(PROJECT, CHAP_DIR, CHAP_NAME, REPORT, BODY_SEED);

        const char = h.files.get(CHAR_PATH)!;
        expect(char.split('第1章 | 境界 | 筑基').length - 1).toBe(1);
        expect(char.split('玉佩来历不明（第1章）').length - 1).toBe(1);

        const timeline = h.files.get(pjTimelineBoard(PROJECT))!;
        expect(timeline.split('甲在码头遇袭').length - 1).toBe(1);

        const foreshadow = h.files.get(pjForeshadowDB(PROJECT))!;
        expect(foreshadow.split('玉佩').length - 1).toBe(1);
    });
});

describe('SettlementEngine — 部分失败回滚', () => {
    it('写入失败时按 journal 回滚实体字段与成长行，updated 归零', async () => {
        const h = makeHarness(seedAll(), /伏笔库\.md$/);
        const result = await h.engine.settle(PROJECT, CHAP_DIR, CHAP_NAME, REPORT, BODY_SEED);

        // 回滚成功 → 不计入 settlementPartial，但会给出回滚统计
        expect(result.rollback).toBeDefined();
        expect(result.rollback!.reverted).toBeGreaterThan(0);
        expect(result.updated).toBe(0);

        const char = h.files.get(CHAR_PATH)!;
        expect(char).toContain('当前状态: 健康');
        expect(char).not.toContain('第1章 | 境界 | 筑基');
        expect(char).not.toContain('玉佩来历不明（第1章）');

        const body = h.files.get(BODY_PATH)!;
        expect(body).toContain('status: written');
    });
});

describe('SettlementEngine — 写锁覆盖快照（P1-3）', () => {
    it('快照读取与字段写入同一把锁：并发写入无法插进两者之间', async () => {
        let probed = false;
        let lockHeldDuringSnapshot = false;
        let externalDone: Promise<void> = Promise.resolve();

        const h = makeHarness(seedAll(), undefined, {
            onProcessFrontmatter: async (file) => {
                if (probed || file.path !== CHAR_PATH) return;
                probed = true;
                let externalEntered = false;
                // 若快照读在锁外，外部写入会在 30ms 内拿到锁
                externalDone = withWriteLock(CHAR_PATH, async () => { externalEntered = true; });
                await new Promise(r => setTimeout(r, 30));
                lockHeldDuringSnapshot = !externalEntered;
            },
        });

        await h.engine.settle(PROJECT, CHAP_DIR, CHAP_NAME, REPORT, BODY_SEED);
        await externalDone;

        expect(probed).toBe(true);
        expect(lockHeldDuringSnapshot).toBe(true);
        expect(h.files.get(CHAR_PATH)).toContain('当前状态: 受伤');
    });
});

describe('SettlementEngine — 数据一致性修复（v4.79.0 交叉审计）', () => {
    it('DELETE_ENTITY 后部分失败回滚：人物文件被 journal 恢复', async () => {
        const h = makeHarness(seedAll(), /伏笔库.md$/);
        const report = `${REPORT}
DELETE_ENTITY: 人物 | 甲`;
        const result = await h.engine.settle(PROJECT, CHAP_DIR, CHAP_NAME, report, BODY_SEED);

        expect(result.rollback).toBeDefined();
        // 旧实现：删除不进 journal，回滚后文件永久消失
        const char = h.files.get(CHAR_PATH);
        expect(char).toBeDefined();
        expect(char).toContain('甲');
    });

    it('exists=true 但读失败：不登记 createdFiles，标记 snapshotIncomplete', async () => {
        const h = makeHarness(seedAll(), undefined, { failReadsMatching: /甲.md$/ });
        const ctx = createSettleContext(PROJECT, CHAP_DIR, CHAP_NAME, BODY_SEED, '', parseReport(''));
        const record = Reflect.get(h.engine as object, 'recordWholeFileBefore') as (
            c: typeof ctx,
            path: string,
        ) => Promise<string>;

        await record.call(h.engine, ctx, CHAR_PATH);

        // 旧实现会把「存在但读失败」当成新建 → 回滚时删除用户已有文件
        expect(ctx.createdFiles).not.toContain(CHAR_PATH);
        expect(ctx.snapshotIncomplete).toBe(true);
    });

    it('回滚时 created 计数一并清零（不再报「新建 N 项」）', async () => {
        const h = makeHarness(seedAll(), /伏笔库.md$/);
        const report = `${REPORT}
NEW_CHARACTER: 乙 | 新角色 | 测试
DELETE_ENTITY: 人物 | 甲`;
        const result = await h.engine.settle(PROJECT, CHAP_DIR, CHAP_NAME, report, BODY_SEED);

        expect(result.rollback).toBeDefined();
        expect(result.created).toBe(0);
        expect(result.createdChars).toBe(0);
    });
});

describe('SettlementEngine — 并发新建同路径（v4.79.0 C-4）', () => {
    it('存在性判断与写入同锁：并发 NEW_CHARACTER 只创建一个，不重复登记 createdFiles', async () => {
        const h = makeHarness(seedAll(), undefined, {
            beforeWrite: async (path) => {
                // 第一次写人物卡前让出事件循环，强制并发的第二次创建先通过旧实现的锁外检查
                if (path === CHAR_PATH && !delayed) {
                    delayed = true;
                    await new Promise((r) => setTimeout(r, 20));
                }
            },
        });
        let delayed = false;

        const reportA = 'NEW_CHARACTER: 同名 | 甲描述 | 测试';
        const reportB = 'NEW_CHARACTER: 同名 | 乙描述 | 测试';
        const ctxA = createSettleContext(PROJECT, CHAP_DIR, CHAP_NAME, BODY_SEED, reportA, parseReport(reportA));
        const ctxB = createSettleContext(PROJECT, CHAP_DIR, CHAP_NAME, BODY_SEED, reportB, parseReport(reportB));
        const step = (SettlementEngine.prototype as unknown as {
            settleStep_createCharacters: (this: SettlementEngine, c: typeof ctxA) => Promise<void>;
        }).settleStep_createCharacters;

        await Promise.all([step.call(h.engine, ctxA), step.call(h.engine, ctxB)]);

        // 只登记一次、只计一次；文件内容来自先写入者
        expect(ctxA.createdFiles.length + ctxB.createdFiles.length).toBe(1);
        expect(ctxA.result.createdChars + ctxB.result.createdChars).toBe(1);
        expect(h.files.get(pjCharFile(PROJECT, '同名'))).toContain('甲描述');
    });
});
