/**
 * ledger-index.ts — 故事台账索引与查询
 *
 * 唯一读 API：上下文装配、压缩、关联查询、图谱校验、章节摘要都从这里取，
 * 不再各自解析 Markdown。索引是纯内存对象，可整体重建（文件签名由调用方缓存）。
 */
import { normalizeLedgerName, type EventRecord, type ForeshadowRecord, type LedgerIssue, type LinkRecord, type PromiseRecord, type RelationRecord } from './ledger-model';
import { parseForeshadowLibrary, parseTimelineBoard } from './ledger-parse';
import { isForeshadowDue } from './ledger-write';

/** 台账索引 */
export interface StoryLedger {
    events: EventRecord[];
    foreshadows: ForeshadowRecord[];
    promises: PromiseRecord[];
    relations: RelationRecord[];
    links: LinkRecord[];
    issues: LedgerIssue[];
    eras: string[];
}

/** 构建输入 */
export interface LedgerSource {
    timelineContent?: string;
    foreshadowContent?: string;
    timelinePath?: string;
    foreshadowPath?: string;
    promises?: PromiseRecord[];
    relations?: RelationRecord[];
    links?: LinkRecord[];
}

/**
 * 从句柄内容构建索引。
 *
 * @param source - 台账来源
 * @returns StoryLedger
 */
export function buildLedgerIndex(source: LedgerSource): StoryLedger {
    const timeline = parseTimelineBoard(source.timelineContent ?? '', source.timelinePath ?? '');
    const foreshadow = parseForeshadowLibrary(source.foreshadowContent ?? '', source.foreshadowPath ?? '');
    return {
        events: timeline.records,
        foreshadows: foreshadow.records,
        promises: source.promises ?? [],
        relations: source.relations ?? [],
        links: source.links ?? [],
        issues: [...timeline.issues, ...foreshadow.issues],
        eras: timeline.eras,
    };
}

/**
 * 已到期/逾期的未回收伏笔（到期在前，其次按计划章升序）。
 *
 * @param ledger - 台账
 * @param chapter - 当前章
 * @returns 伏笔列表
 */
export function dueForeshadows(ledger: StoryLedger, chapter: number | null): ForeshadowRecord[] {
    if (chapter === null) return [];
    return ledger.foreshadows
        .filter((record) => record.status === 'unrevealed' && isForeshadowDue(record, chapter))
        .sort((a, b) => {
            const aNum = a.plannedReveal ? Number.parseInt(a.plannedReveal.replace(/[^\d]/g, ''), 10) : Number.MAX_SAFE_INTEGER;
            const bNum = b.plannedReveal ? Number.parseInt(b.plannedReveal.replace(/[^\d]/g, ''), 10) : Number.MAX_SAFE_INTEGER;
            return aNum - bNum;
        });
}

/**
 * 最近 n 章内已发生的事件（新→旧）。
 *
 * @param ledger - 台账
 * @param chapter - 当前章（null 表示不过滤）
 * @param n - 条数
 * @returns 事件列表
 */
export function timelineWindow(ledger: StoryLedger, chapter: number | null, n = 30): EventRecord[] {
    const filtered = chapter === null
        ? [...ledger.events]
        : ledger.events.filter((event) => event.chapterNum !== null && event.chapterNum <= chapter);
    return filtered
        .sort((a, b) => {
            const chapterDiff = (b.chapterNum ?? 0) - (a.chapterNum ?? 0);
            if (chapterDiff !== 0) return chapterDiff;
            // 同章：主线事件在前，背景纪要在后（背景是更早的上下文）
            const eraRank = (event: EventRecord): number => (event.era === 'background' ? 1 : 0);
            return eraRank(a) - eraRank(b);
        })
        .slice(0, Math.max(1, n));
}

/**
 * 与某实体相关的事件（按名称匹配；实体 ID 解析在 association 层完成）。
 *
 * @param ledger - 台账
 * @param nameOrId - 名称或实体 ID
 * @param chapter - 当前章（可空）
 * @returns 事件列表
 */
export function eventsForEntity(ledger: StoryLedger, nameOrId: string, chapter: number | null = null): EventRecord[] {
    const key = normalizeLedgerName(nameOrId);
    return ledger.events.filter((event) => {
        if (chapter !== null && event.chapterNum !== null && event.chapterNum > chapter) return false;
        return event.entityRefs.some((ref) => normalizeLedgerName(ref.name) === key || (ref.id && ref.id === nameOrId));
    });
}

/**
 * 与某伏笔显式关联的事件。
 *
 * @param ledger - 台账
 * @param foreshadowId - 伏笔 ID 或名称
 * @returns 事件列表
 */
export function eventsForForeshadow(ledger: StoryLedger, foreshadowId: string): EventRecord[] {
    const key = normalizeLedgerName(foreshadowId);
    return ledger.events.filter((event) => event.foreshadowRefs.some((ref) => ref === foreshadowId || normalizeLedgerName(ref) === key));
}

/**
 * 某角色的关系记录。
 *
 * @param ledger - 台账
 * @param entityId - 实体 ID 或名称
 * @returns 关系列表
 */
export function relationsFor(ledger: StoryLedger, entityId: string): RelationRecord[] {
    const key = normalizeLedgerName(entityId);
    return ledger.relations.filter((relation) =>
        relation.a.id === entityId || relation.b.id === entityId
        || normalizeLedgerName(relation.a.name) === key || normalizeLedgerName(relation.b.name) === key);
}

/**
 * 未兑现承诺（到当前章仍未 resolved/dropped）。
 *
 * @param ledger - 台账
 * @param chapter - 当前章
 * @returns 承诺列表
 */
export function openPromises(ledger: StoryLedger, chapter: number | null = null): PromiseRecord[] {
    // F-3 二轮复核（2026-11-10）：旧实现按 `expected >= chapter` 过滤会把「已逾期
    // 仍 open」的承诺剔除——恰是最该提醒的条目。改为仅按状态过滤，逾期项排序置前。
    // 安全盲审（NW-SEC 附注）：子串匹配会把「未兑现/未放弃/未解决」误判为已关闭——
    // 改精确枚举（parsePromiseLedger 已归一化为 open/advanced/resolved/dropped，
    // 中文原文按整词匹配）。
    const CLOSED = new Set(['resolved', 'dropped', '已兑现', '已解决', '已放弃', '已回收']);
    return ledger.promises
        .filter((promise) => {
            const status = String(promise.status || '').trim().toLowerCase();
            return !CLOSED.has(status);
        })
        .sort((a, b) => {
            if (chapter === null) return 0;
            const expectedOf = (promise: PromiseRecord): number => {
                const parsed = Number.parseInt(String(promise.expectedChapter).replace(/[^\d]/g, ''), 10);
                return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
            };
            return expectedOf(a) - expectedOf(b);
        });
}

/**
 * 台账是否为空（用于降级判断）
 *
 * @param ledger - 台账
 * @returns 是否为空
 */
export function isEmptyLedger(ledger: StoryLedger): boolean {
    return ledger.events.length === 0 && ledger.foreshadows.length === 0
        && ledger.promises.length === 0 && ledger.relations.length === 0;
}
