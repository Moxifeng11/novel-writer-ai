/**
 * ledger-model.ts — 故事台账的统一记录模型
 *
 * 时间线、伏笔、承诺、关系、关联索引过去各有一套解析/写入/去重实现，
 * 只共享「第N章」字符串和人物名称。本模块定义唯一记录与稳定 ID：
 *  - ID 由自然键派生，重复写入得到同一 ID；
 *  - 状态统一枚举，修掉 `待回收` 被误判为已揭示的问题；
 *  - 自动块（NW-LINKAGE/NW-LEDGER）在解析前统一剥离。
 *
 * 纯函数，不依赖 Obsidian。
 */
import { chapterNumber, parseChapterRange } from '../../shared/chapter-ref';

/** 记录 ID 前缀 */
export const EVENT_ID_PREFIX = 'EV-';
export const FORESHADOW_ID_PREFIX = 'FS-';
export const PROMISE_ID_PREFIX = 'PR-';
export const RELATION_ID_PREFIX = 'REL-';

/** 伏笔状态（唯一枚举） */
export type ForeshadowStatus = 'unrevealed' | 'revealed' | 'abandoned' | 'unknown';

/** 旧状态文案 → 新枚举 */
export const FORESHADOW_STATUS_LABEL: Record<ForeshadowStatus, string> = {
    unrevealed: '未回收',
    revealed: '已回收',
    abandoned: '已废弃',
    unknown: '未知',
};

/** 实体引用（名称原文 + 解析结果） */
export interface EntityRef {
    id: string;
    name: string;
    kind: string;
    path?: string;
    resolved: boolean;
}

/** 时间线事件记录 */
export interface EventRecord {
    id: string;
    name: string;
    time: string;
    chapterNum: number | null;
    chapterKey: string;
    era: 'background' | 'main' | 'unknown';
    eraName: string;
    location: string;
    entityRefs: EntityRef[];
    foreshadowRefs: string[];
    impact: string;
    type: string;
    importance: 'high' | 'medium' | 'low' | 'unknown';
    status: 'planned' | 'occurred' | 'unknown';
    source: 'settlement' | 'analysis' | 'manual' | 'import';
    sourcePath: string;
    lineNo: number;
    raw: string;
}

/** 伏笔记录 */
export interface ForeshadowRecord {
    id: string;
    name: string;
    importance: string;
    buryChapter: string;
    plannedReveal: string;
    revealChapter: string;
    status: ForeshadowStatus;
    relatedRefs: EntityRef[];
    mainline: string;
    eventRefs: string[];
    method: string;
    reason: string;
    sourcePath: string;
    lineNo: number;
    raw: string;
}

/** 承诺记录 */
export interface PromiseRecord {
    id: string;
    name: string;
    type: string;
    raisedChapter: string;
    raisedBy: string;
    expectedChapter: string;
    status: string;
    lastAdvancedChapter: string;
    note: string;
}

/** 关系记录（数值权威仍是 关系状态.md） */
export interface RelationRecord {
    id: string;
    a: EntityRef;
    b: EntityRef;
    trust: number;
    attraction: number;
    fear: number;
    resentment: number;
    dependence: number;
    status: string;
    historyKeys: string[];
    lastUpdatedChapter: string;
}

/** 关联边 */
export interface LinkRecord {
    id: string;
    from: string;
    to: string;
    kind: 'mention' | 'sets-up' | 'pays-off' | 'related' | 'location';
    weight: number;
    chapterNum: number | null;
    source: 'explicit' | 'derived';
}

/** 台账问题（解析/校验/未解析引用） */
export interface LedgerIssue {
    type:
        | 'unknown-row'
        | 'duplicate-row'
        | 'unresolved-entity'
        | 'ambiguous-entity'
        | 'out-of-order'
        | 'invalid-chapter'
        | 'duplicate-event'
        | 'missing-column';
    message: string;
    sourcePath?: string;
    lineNo?: number;
    recordId?: string;
    severity: 'high' | 'medium' | 'low';
}

/**
 * FNV-1a 32 位哈希（与 entity-index 同算法，稳定且无依赖）
 *
 * @param text - 输入
 * @returns 8 位十六进制
 */
function fnv1a(text: string): string {
    let hash = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
}

/**
 * 归一化名称（去空白/标点/书名号/双链括号，英文小写）
 *
 * @param text - 输入
 * @returns 归一化文本
 */
export function normalizeLedgerName(text: unknown): string {
    return String(text ?? '')
        .replace(/\[\[|\]\]/g, '')
        .replace(/[《》〈〉「」『』【】（）()\s·・,，。.:：;；、"'“”‘’!！?？]/g, '')
        .toLowerCase();
}

/**
 * 事件稳定 ID：纪元 + 章节 + 时间 + 事件名
 *
 * @param parts - 字段
 * @returns EV-xxxxxxxx
 */
export function eventIdOf(parts: { era?: string; chapterKey?: string; time?: string; name?: string }): string {
    return `${EVENT_ID_PREFIX}${fnv1a([
        parts.era ?? '',
        parts.chapterKey ?? '',
        normalizeLedgerName(parts.time),
        normalizeLedgerName(parts.name),
    ].join('|'))}`;
}

/**
 * 伏笔稳定 ID：名称
 *
 * @param name - 伏笔名称
 * @returns FS-xxxxxxxx
 */
export function foreshadowIdOf(name: unknown): string {
    return `${FORESHADOW_ID_PREFIX}${fnv1a(normalizeLedgerName(name))}`;
}

/**
 * 承诺稳定 ID：名称
 *
 * @param name - 承诺名称
 * @returns PR-xxxxxxxx
 */
export function promiseIdOf(name: unknown): string {
    return `${PROMISE_ID_PREFIX}${fnv1a(normalizeLedgerName(name))}`;
}

/**
 * 关系稳定 ID：两个实体名排序后拼接
 *
 * @param a - 实体 A 名称
 * @param b - 实体 B 名称
 * @returns REL-xxxxxxxx
 */
export function relationIdOf(a: unknown, b: unknown): string {
    const left = normalizeLedgerName(a);
    const right = normalizeLedgerName(b);
    const [first, second] = [left, right].sort();
    return `${RELATION_ID_PREFIX}${fnv1a(`${first}|${second}`)}`;
}

/**
 * 统一伏笔状态。
 *
 * 关键修复：`待回收` 是「未回收」而不是「已揭示」——旧判定用裸 `回收` 子串，
 * 会把模板默认值判成 revealed，导致伏笔被跳过。
 *
 * @param status - 原始状态文案
 * @param section - 所在分节（unrevealed/revealed/abandoned，来自表头）
 * @returns ForeshadowStatus
 */
export function normalizeForeshadowStatus(
    status: unknown,
    section: 'unrevealed' | 'revealed' | 'abandoned' | 'unknown' = 'unknown',
): ForeshadowStatus {
    const text = String(status ?? '').trim();
    if (text.includes('废弃')) return 'abandoned';
    if (text.includes('待回收') || text.includes('未回收') || text.includes('未揭示') || text.includes('待揭示') || text.includes('铺垫') || text.includes('埋设')) {
        return 'unrevealed';
    }
    if (text.includes('已揭示') || text.includes('已回收') || text.includes('已兑现') || text.includes('回收') || text.includes('揭示')) {
        return 'revealed';
    }
    if (section !== 'unknown') return section;
    return 'unknown';
}

/**
 * 计划回收章号（支持区间/多章；无法解析返回 null）
 *
 * @param plannedReveal - 计划回收文本
 * @returns 首个章号
 */
export function plannedRevealNumber(plannedReveal: unknown): number | null {
    const range = parseChapterRange(plannedReveal);
    return range.nums.length > 0 ? range.nums[0] : null;
}

/**
 * 章节号（统一入口）
 *
 * @param chapter - 章节文本
 * @returns 章号或 null
 */
export function chapterNumOf(chapter: unknown): number | null {
    return chapterNumber(typeof chapter === 'number' ? chapter : String(chapter ?? ''));
}

/** 自动块标记 */
export const LEGACY_LINKAGE_BEGIN = '<!-- NW-LINKAGE:BEGIN';
export const LEGACY_LINKAGE_END = '<!-- NW-LINKAGE:END -->';
export const LEDGER_BLOCK_BEGIN = '<!-- NW-LEDGER:BEGIN';
export const LEDGER_BLOCK_END = '<!-- NW-LEDGER:END -->';

/**
 * 剥离所有自动块（旧关联索引块 + 新台账块）。
 * 解析业务表格前必须调用，否则块内表格会被当成业务数据。
 *
 * @param content - 原始内容
 * @returns 剥离后的内容
 */
export function stripAutoBlocks(content: string): string {
    let result = String(content ?? '');
    for (const [begin, end] of [
        [LEGACY_LINKAGE_BEGIN, LEGACY_LINKAGE_END],
        [LEDGER_BLOCK_BEGIN, LEDGER_BLOCK_END],
    ] as const) {
        let guard = 0;
        while (guard++ < 20) {
            const start = result.indexOf(begin);
            if (start < 0) break;
            const stop = result.indexOf(end, start);
            if (stop < 0) {
                result = result.slice(0, start);
                break;
            }
            result = result.slice(0, start) + result.slice(stop + end.length);
        }
    }
    return result;
}

/**
 * 拆分 Markdown 表格行（去掉首尾空单元格，保留中间空位）
 *
 * @param line - 表格行
 * @returns 单元格数组
 */
export function splitLedgerRow(line: string): string[] {
    const trimmed = String(line ?? '').trim();
    if (!trimmed.startsWith('|')) return [];
    return trimmed.split('|').slice(1, -1).map((cell) => cell.trim());
}

/**
 * 分隔行 `|---|:--:|`
 *
 * @param line - 行
 * @returns 是否分隔行
 */
export function isSeparatorRow(line: string): boolean {
    return /^\|[\s:|-]+\|$/.test(String(line ?? '').trim());
}
