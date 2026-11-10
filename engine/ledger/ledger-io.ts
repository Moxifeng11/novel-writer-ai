/**
 * ledger-io.ts — 台账文件读取、缓存与旧结构适配
 *
 * ContextManager 与后续 association/digest 共用这一层：
 *  - 只读时间线看板、伏笔库与承诺账本，解析后缓存（按 mtime+size 签名失效，
 *    F-3 修复：承诺账本纳入签名，否则结算写承诺后摘要读到空/陈旧承诺）；
 *  - 提供旧版 `ForeshadowData` / `TimelineEvent` 映射，避免一次性改所有下游。
 */
import { App, TFile } from 'obsidian';
import { pjForeshadowDB, pjPromiseLedger, pjTimelineBoard } from '@/shared/paths';
import type { ForeshadowData, ForeshadowItem, TimelineEvent } from '@/engine/context/context-types';
import { parsePromiseLedger } from '@/engine/promise-ledger';
import { buildLedgerIndex, timelineWindow, type StoryLedger } from './ledger-index';
import type { ForeshadowRecord, PromiseRecord } from './ledger-model';

interface CacheEntry {
    signature: string;
    ledger: StoryLedger;
}

const cache = new Map<string, CacheEntry>();

/**
 * 内容指纹（FNV-1a 32 位，仅用于缓存失效，不用于安全场景）。
 *
 * mtime+size 在粗粒度文件系统/同长度改写时不变，会把旧台账一直喂给摘要与上下文。
 *
 * @param content - 文件内容
 * @returns 36 进制指纹
 */
function hashContent(content: string): string {
    let hash = 0x811c9dc5;
    for (let i = 0; i < content.length; i++) {
        hash ^= content.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(36);
}

/**
 * 读取文件内容（不存在返回空串，不抛错）
 *
 * @param app - Obsidian 应用
 * @param path - 路径
 * @returns 文本、签名与读取是否成功
 */
async function readIfExists(app: App, path: string): Promise<{ content: string; signature: string; ok: boolean }> {
    try {
        const file = app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) return { content: '', signature: 'absent', ok: true };
        const content = await app.vault.cachedRead(file);
        const mtime = file.stat?.mtime ?? 0;
        const size = file.stat?.size ?? content.length;
        // D3-9：内容指纹参与签名，同 mtime/size 的改写也能失效缓存
        return { content, signature: `${mtime}:${size}:${hashContent(content)}`, ok: true };
    } catch {
        // 读失败（权限/临时 IO）：签名标记 error，调用方不得把空账本写进缓存
        return { content: '', signature: 'error', ok: false };
    }
}

/**
 * PromiseItem → 台账 PromiseRecord（字段口径统一映射）
 *
 * @param promise - 承诺账本条目
 * @returns PromiseRecord
 */
function toPromiseRecord(promise: {
    id: number;
    name: string;
    type: string;
    openedChapter: string;
    openedBy: string;
    expectedChapter: string;
    status: string;
    lastAdvancedChapter: string;
    note: string;
}): PromiseRecord {
    return {
        id: String(promise.id),
        name: promise.name,
        type: promise.type,
        raisedChapter: promise.openedChapter,
        raisedBy: promise.openedBy,
        expectedChapter: promise.expectedChapter,
        status: promise.status,
        lastAdvancedChapter: promise.lastAdvancedChapter,
        note: promise.note,
    };
}

/**
 * 加载项目台账（带缓存；签名含承诺账本文件）。
 *
 * @param app - Obsidian 应用
 * @param project - 项目路径
 * @returns StoryLedger
 */
export async function loadStoryLedger(app: App, project: string): Promise<StoryLedger> {
    const timelinePath = pjTimelineBoard(project);
    const foreshadowPath = pjForeshadowDB(project);
    const promisePath = pjPromiseLedger(project);
    const [timeline, foreshadow, promise] = await Promise.all([
        readIfExists(app, timelinePath),
        readIfExists(app, foreshadowPath),
        readIfExists(app, promisePath),
    ]);
    const signature = `${timeline.signature}|${foreshadow.signature}|${promise.signature}`;
    const cached = cache.get(project);
    if (cached && cached.signature === signature) return cached.ledger;

    let promises: PromiseRecord[] = [];
    if (promise.content.trim()) {
        try {
            promises = parsePromiseLedger(promise.content).map(toPromiseRecord);
        } catch {
            promises = [];
        }
    }

    const ledger = buildLedgerIndex({
        timelineContent: timeline.content,
        foreshadowContent: foreshadow.content,
        timelinePath,
        foreshadowPath,
        promises,
    });
    // D3-9：任一文件读失败时返回的 ledger 可能是「空账本」，绝不能写进缓存，
    // 否则整会话都会拿到空/残缺台账（下次成功读取也会被签名命中挡住）。
    if (timeline.ok && foreshadow.ok && promise.ok) {
        cache.set(project, { signature, ledger });
    }
    return ledger;
}

/**
 * 失效项目台账缓存（写入后调用）
 *
 * @param project - 项目路径
 */
export function invalidateStoryLedger(project?: string): void {
    if (project) cache.delete(project);
    else cache.clear();
}

/**
 * 记录 → 旧版伏笔结构
 *
 * @param record - 台账记录
 * @returns ForeshadowItem
 */
function toForeshadowItem(record: ForeshadowRecord): ForeshadowItem {
    const statusText = record.status === 'revealed' ? '已揭示' : record.status === 'abandoned' ? '已废弃' : '未揭示';
    return {
        id: record.id,
        name: record.name,
        importance: record.importance,
        buryChapter: record.buryChapter,
        plannedReveal: record.plannedReveal,
        relatedChars: record.relatedRefs.map((ref) => ref.name).join('、'),
        relatedMainline: record.mainline,
        revealChapter: record.revealChapter,
        method: record.method,
        status: statusText,
        reason: record.reason,
        abandonChapter: record.status === 'abandoned' ? record.reason : '',
    };
}

/**
 * 台账 → 旧版伏笔数据
 *
 * @param ledger - 台账
 * @returns ForeshadowData
 */
export function toForeshadowData(ledger: StoryLedger): ForeshadowData {
    return {
        unrevealed: ledger.foreshadows.filter((record) => record.status === 'unrevealed').map(toForeshadowItem),
        revealed: ledger.foreshadows.filter((record) => record.status === 'revealed').map(toForeshadowItem),
        abandoned: ledger.foreshadows.filter((record) => record.status === 'abandoned').map(toForeshadowItem),
    };
}

/**
 * 台账 → 旧版时间线事件（可按当前章过滤、按章号倒序）
 *
 * @param ledger - 台账
 * @param currentChapter - 当前章
 * @param limit - 最多返回条数（null 表示不限）
 * @returns TimelineEvent[]
 */
export function toTimelineEvents(ledger: StoryLedger, currentChapter?: string | number | null, limit: number | null = null): TimelineEvent[] {
    const chapter = typeof currentChapter === 'number'
        ? currentChapter
        : Number.parseInt(String(currentChapter ?? '').match(/第?(\d+)/)?.[1] ?? '', 10);
    const current = Number.isFinite(chapter) && chapter > 0 ? chapter : null;
    // 没有当前章时不排序、不截断：旧行为是返回文件顺序全部事件（测试与关联索引依赖它）
    const records = current === null ? ledger.events : timelineWindow(ledger, current, limit ?? (ledger.events.length || 1));
    return records.map((record) => ({
        time: record.time,
        chapter: record.chapterKey,
        event: record.name,
        eventName: record.name,
        impact: record.impact,
        location: record.location,
        involvedEntities: record.entityRefs.map((ref) => ref.name),
        type: record.type,
        idx: '',
        era: record.eraName,
    }));
}
