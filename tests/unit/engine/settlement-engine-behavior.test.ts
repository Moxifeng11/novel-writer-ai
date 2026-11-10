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
import { getRelationshipFilePath } from '../../../engine/relationship-engine';
import { pjCharFile, pjForeshadowDB, pjTimelineBoard, pjBodyFile, pjPromiseLedger, pjCharacterArcTable } from '../../../shared/paths';
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
        // D-1：涉及* 名单由结算在锁内写入，一键成文无需再二次改写正文
        expect(parseFm(body).fm['涉及人物']).toEqual(['甲']);
    });

    it('item6-a：EMOTION 指令写 entity_last_changed_at 为 ISO、章名入 entity_last_changed_chapter', async () => {
        const h = makeHarness(seedAll());
        const report = `${REPORT}
EMOTION: [[甲]] | 惊疑 | 长老念出陌生姓氏后既不安又隐隐期待`;
        await h.engine.settle(PROJECT, CHAP_DIR, CHAP_NAME, report, BODY_SEED);

        const char = h.files.get(CHAR_PATH)!;
        const fm = parseFm(char).fm;
        expect(fm['entity_last_changed_chapter']).toBe('第1章');
        expect(String(fm['entity_last_changed_at'])).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
        expect(fm['entity_last_changed_reason']).toContain('情绪更新为惊疑');
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

    it('F2：数组型 frontmatter 回滚保持 list 类型（不降级成字符串）', async () => {
        const bodyWithList = `---
status: written
涉及人物: [乙]
---
这是正文。
`;
        const h = makeHarness({ ...seedAll(), [BODY_PATH]: bodyWithList });
        const instr = parseReport(REPORT);
        const ctx = createSettleContext(PROJECT, CHAP_DIR, CHAP_NAME, BODY_SEED, REPORT, instr);
        const steps = SettlementEngine.prototype as unknown as {
            settleStep_updateBodyFrontmatter: (this: SettlementEngine, c: typeof ctx) => Promise<void>;
            settleStep_finalizeRollback: (this: SettlementEngine, c: typeof ctx) => Promise<void>;
        };

        await steps.settleStep_updateBodyFrontmatter.call(h.engine, ctx);
        // 写入后是本次结算的实体列表
        expect(parseFm(h.files.get(BODY_PATH)!).fm['涉及人物']).toEqual(['甲']);

        ctx.hasPartialFailure = true;
        await steps.settleStep_finalizeRollback.call(h.engine, ctx);

        // 旧实现用 String() 快照，回滚后这里会变成 '乙'（类型漂移）
        const restored = parseFm(h.files.get(BODY_PATH)!).fm['涉及人物'];
        expect(Array.isArray(restored)).toBe(true);
        expect(restored).toEqual(['乙']);
    });

    it('F3：正文 frontmatter 写失败触发 partial 回滚（不再报成功）', async () => {
        const h = makeHarness(seedAll(), undefined, {
            onProcessFrontmatter: async (file) => {
                if (file.path === BODY_PATH) throw new Error('body fm fail');
            },
        });
        const result = await h.engine.settle(PROJECT, CHAP_DIR, CHAP_NAME, REPORT, BODY_SEED);

        expect(result.rollback).toBeDefined();
        expect(result.updated).toBe(0);
        expect(h.files.get(CHAR_PATH)).toContain('当前状态: 健康');
    });

    it('F3：回滚恢复 entity_last_changed_at/chapter 溯源字段', async () => {
        const charWithTrace = `---
当前状态: 健康
entity_last_changed_at: 2020-01-01T00:00:00.000Z
entity_last_changed_chapter: 第0章
---
# 甲

## 变更记录
`;
        const h = makeHarness({ ...seedAll(), [CHAR_PATH]: charWithTrace }, /伏笔库\.md$/);
        const result = await h.engine.settle(PROJECT, CHAP_DIR, CHAP_NAME, REPORT, BODY_SEED);

        expect(result.rollback).toBeDefined();
        const restored = parseFm(h.files.get(CHAR_PATH)!).fm;
        expect(restored['entity_last_changed_at']).toBe('2020-01-01T00:00:00.000Z');
        expect(restored['entity_last_changed_chapter']).toBe('第0章');
    });
});

describe('SettlementEngine — 回滚后不写 V2/承诺/弧线（D-3，2026-11-10 审计）', () => {
    const RELATION_PATH = getRelationshipFilePath(PROJECT);
    const RELATION_SEED = `---
tags: [关系状态]
---

# 角色关系状态
`;
    const D3_REPORT = `${REPORT}
RELATION_5D: 甲|乙|trust+6|并肩作战
PROMISE_OPEN: 三年之约 | 角色承诺 | 第6章 | 破案线`;

    it('部分失败回滚后：V2 关系与承诺账本不写入（旧实现会在回滚后脏写且不可回滚）', async () => {
        const h = makeHarness({ ...seedAll(), [RELATION_PATH]: RELATION_SEED }, /伏笔库\.md$/);
        const result = await h.engine.settle(PROJECT, CHAP_DIR, CHAP_NAME, D3_REPORT, BODY_SEED);

        expect(result.rollback).toBeDefined();
        // 回滚后 journal 已清空：这三个附加写入若执行，将永久残留
        expect(h.files.get(RELATION_PATH)).toBe(RELATION_SEED);
        expect(h.files.get(pjPromiseLedger(PROJECT))).toBeUndefined();
    });

    it('结算成功时守卫不误伤：V2 关系增量正常写入', async () => {
        const h = makeHarness({ ...seedAll(), [RELATION_PATH]: RELATION_SEED });
        const result = await h.engine.settle(PROJECT, CHAP_DIR, CHAP_NAME, D3_REPORT, BODY_SEED);

        expect(result.rollback).toBeUndefined();
        const relation = h.files.get(RELATION_PATH)!;
        expect(relation).toContain('甲 ↔ 乙');
        expect(relation).toContain('trust: 56');
        expect(relation).toContain('history_keys');
    });

    it('回滚后不写角色弧线（ARC 指令让该路径可观测）', async () => {
        // 旧 D-3 用例只有 RELATION/PROMISE，弧线步骤在空表上是 no-op；补 ARC 后才能
        // 证明「回滚后三步全部跳过」不是靠某一个端口碰巧没数据。
        const h = makeHarness({ ...seedAll(), [RELATION_PATH]: RELATION_SEED }, /伏笔库\.md$/);
        const report = `${REPORT}
RELATION_5D: 甲|乙|trust+6|并肩作战
PROMISE_OPEN: 三年之约 | 角色承诺 | 第6章 | 破案线
ARC: 甲 | 起点 | 转折 | 码头遇袭 | 是`;
        const result = await h.engine.settle(PROJECT, CHAP_DIR, CHAP_NAME, report, BODY_SEED);

        expect(result.rollback).toBeDefined();
        expect(h.files.get(pjCharacterArcTable(PROJECT))).toBeUndefined();
        expect(h.files.get(RELATION_PATH)).toBe(RELATION_SEED);
        expect(h.files.get(pjPromiseLedger(PROJECT))).toBeUndefined();
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
    it('D-6：情绪字段写入失败时，四字段经 journal 回滚到写入前原值', async () => {
        const h = makeHarness(seedAll(), undefined, {
            // 情绪步骤经 processFrontmatter 写人物卡；注入失败触发部分失败→回滚
            onProcessFrontmatter: async (file) => {
                if (file.path === CHAR_PATH) throw new Error('模拟 frontmatter 写入失败');
            },
        });
        const report = `${REPORT}
EMOTION: [[甲]] | 惊疑 | 长老念出陌生姓氏后既不安又隐隐期待`;
        const result = await h.engine.settle(PROJECT, CHAP_DIR, CHAP_NAME, report, BODY_SEED);

        expect(result.rollback).toBeDefined();
        const char = h.files.get(CHAR_PATH)!;
        // D-6 修复前：当前情绪/entity_last_changed_* 不进 journal，回滚后残留
        expect(char).not.toContain('当前情绪: 惊疑');
        expect(char).toContain('当前状态: 健康');
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
