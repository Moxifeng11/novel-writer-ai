/**
 * shared/quality-history.ts — 质量历史的序列化 / 解析 / 合并（纯函数）
 *
 * 落盘位置由调用方决定（默认 `项目/04-项目总控/质量历史.json`），
 * 这里不做任何 IO，便于单测与跨视图复用。
 */
import { QUALITY_CHAPTER_TREND, QUALITY_HISTORY_MAX_RECORDS, QUALITY_LIVE_PERSIST_MIN_CHARS } from './thresholds';

export interface QualityHistoryRecord {
    /** 章节键（如「第3章」），用于区分不同章节的曲线 */
    chapterKey: string;
    timestamp: number;
    wordCount: number;
    overallScore: number;
    languageScore: number;
    rhythmScore: number;
    characterScore: number;
    plotScore: number;
    atmosphereScore: number;
    structureScore: number;
    grade: string;
    trend: string;
}

export interface QualityHistoryFile {
    version: 1;
    entries: QualityHistoryRecord[];
}

const NUMERIC_FIELDS = [
    'timestamp',
    'wordCount',
    'overallScore',
    'languageScore',
    'rhythmScore',
    'characterScore',
    'plotScore',
    'atmosphereScore',
    'structureScore',
] as const;

function toFiniteNumber(value: unknown): number {
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) ? n : 0;
}

function clampScore(value: number): number {
    return Math.min(100, Math.max(0, value));
}

/** 容错解析单条记录；结构不合法返回 null */
export function parseQualityHistoryRecord(input: unknown): QualityHistoryRecord | null {
    if (!input || typeof input !== 'object') return null;
    const raw = input as Record<string, unknown>;
    const timestamp = toFiniteNumber(raw.timestamp);
    if (timestamp <= 0) return null;

    const record: QualityHistoryRecord = {
        chapterKey: typeof raw.chapterKey === 'string' ? raw.chapterKey : '',
        timestamp,
        wordCount: Math.max(0, Math.round(toFiniteNumber(raw.wordCount))),
        overallScore: clampScore(toFiniteNumber(raw.overallScore)),
        languageScore: clampScore(toFiniteNumber(raw.languageScore)),
        rhythmScore: clampScore(toFiniteNumber(raw.rhythmScore)),
        characterScore: clampScore(toFiniteNumber(raw.characterScore)),
        plotScore: clampScore(toFiniteNumber(raw.plotScore)),
        atmosphereScore: clampScore(toFiniteNumber(raw.atmosphereScore)),
        structureScore: clampScore(toFiniteNumber(raw.structureScore)),
        grade: typeof raw.grade === 'string' ? raw.grade : '',
        trend: typeof raw.trend === 'string' ? raw.trend : 'stable',
    };
    return record;
}

/** 解析历史文件；坏 JSON / 旧结构一律降级为空数组，不抛错 */
export function parseQualityHistoryFile(raw: string): QualityHistoryRecord[] {
    if (!raw || !raw.trim()) return [];
    try {
        const data = JSON.parse(raw) as unknown;
        const list = Array.isArray(data)
            ? data
            : (data && typeof data === 'object' && Array.isArray((data as QualityHistoryFile).entries)
                ? (data as QualityHistoryFile).entries
                : []);
        return list
            .map(parseQualityHistoryRecord)
            .filter((item): item is QualityHistoryRecord => item !== null)
            .sort((a, b) => a.timestamp - b.timestamp);
    } catch {
        return [];
    }
}

export function serializeQualityHistoryFile(entries: QualityHistoryRecord[]): string {
    const payload: QualityHistoryFile = {
        version: 1,
        entries: normalizeQualityHistory(entries, QUALITY_HISTORY_MAX_RECORDS),
    };
    return JSON.stringify(payload, null, 2);
}

/** 章号片段（含中文数字），用于把「项目名-第3章_标题」归一化为「第3章」 */
const CHAPTER_KEY_PATTERN = /第\s*[0-9零一二三四五六七八九十百千两]+\s*章/;

/**
 * 归一化章节键。
 *
 * 仪表盘传入的是 `${project}-${chapterName}`，协同写作落盘的是 `第N章`；
 * 同一章两种 key 会被基线当成两章，重复计入样本。统一取「第N章」片段，
 * 无匹配时原样返回（兼容自定义章节命名）。
 */
export function normalizeChapterKey(key: string): string {
    const trimmed = (key || '').trim();
    if (!trimmed) return '';
    const matched = trimmed.match(CHAPTER_KEY_PATTERN);
    return matched ? matched[0].replace(/\s+/g, '') : trimmed;
}

/**
 * 构造质量历史的章键（`${project}-第N章`）。
 *
 * 协同写作有两条写入口：面板 B 的实时评估与实时质量落盘。若一处用章节名、
 * 一处用章号，同一章会以两种 key 进入历史，基线把一章算成两章。
 * 因此两条入口统一由本函数派生；落盘前再经 `normalizeChapterKey` 去掉项目前缀。
 * 章号非法时回退章节名（自定义命名仍可落到同一键）。
 */
export function buildQualityChapterKey(
    project: string,
    chapterNum?: number,
    chapterName?: string,
): string {
    const p = (project || '').trim();
    if (!p) return '';
    if (typeof chapterNum === 'number' && Number.isFinite(chapterNum) && chapterNum > 0) {
        return `${p}-第${Math.trunc(chapterNum)}章`;
    }
    const name = (chapterName || '').trim();
    return name ? `${p}-${name}` : p;
}

/**
 * 是否值得记入质量历史 / 基线。
 *
 * 正文过短时 `WritingQualityEngine` 返回「内容不足 100 字」的空结果（总分与六维全 0），
 * 直接写入会把基线均值拉低、把「当前分高于基线」判反，并挤占 200 条历史配额。
 * 协同实时落盘与面板 B 节流落盘共用同一门槛。
 */
export function isQualitySampleUsable(wordCount: number): boolean {
    return Number.isFinite(wordCount) && wordCount >= QUALITY_LIVE_PERSIST_MIN_CHARS;
}

/** 质量评估/落盘的章节身份（项目 + 章号 + 正文路径） */
export interface QualityEvalTarget {
    project: string;
    chapterNum: number;
    bodyPath: string;
}

/**
 * 评估发起时与结果返回时的章节身份是否一致。
 *
 * 实时评估是异步的：评估期间切章/切项目后，旧正文的分数不能显示到新章节，
 * 更不能写进新章节的质量历史——否则新章会凭空多出一条与自身内容无关的记录，
 * 污染趋势与基线（与「跨书同章号串用上一章正文」同类）。
 */
export function isSameQualityEvalTarget(a: QualityEvalTarget, b: QualityEvalTarget): boolean {
    return a.project === b.project
        && a.chapterNum === b.chapterNum
        && a.bodyPath === b.bodyPath;
}

/**
 * 按章聚合：同一章多次评估只保留最后一次（时间最大）作为该章样本。
 *
 * 基线/趋势的统计单位必须是「章」：协同写作会按节流对同一章反复评估，
 * 若按记录条数加权，写得越久的章节权重越大，基线会偏离真实章节水平。
 * 分组前统一走 `normalizeChapterKey`；`chapterKey` 为空的旧记录无法归组，
 * 按各自时间独立保留。
 */
export function aggregateQualityHistoryByChapter(
    records: QualityHistoryRecord[],
): QualityHistoryRecord[] {
    const latestByChapter = new Map<string, QualityHistoryRecord>();
    const standalone: QualityHistoryRecord[] = [];

    for (const entry of records) {
        const key = normalizeChapterKey(entry.chapterKey);
        if (!key) {
            standalone.push(entry);
            continue;
        }
        const previous = latestByChapter.get(key);
        if (!previous || entry.timestamp >= previous.timestamp) {
            latestByChapter.set(key, entry);
        }
    }

    return [...standalone, ...latestByChapter.values()].sort((a, b) => a.timestamp - b.timestamp);
}

export type QualityChapterTrend = 'rising' | 'falling' | 'stable';

/**
 * 章级趋势：当前章总分与前序章（按章聚合）比较。
 *
 * 实时评估每 2.5s 一次，同一章内「最近 5 次」只反映十几秒的打字波动，
 * 不能作为「趋势」；这里以章为单位：前序章各取最后一次评估，同章记录全部排除。
 * 当前章无章键（无法归章）或前序章不足 `minChapters` 时一律返回 stable，
 * 宁可少报也不凭空给方向。
 */
export function computeChapterTrend(
    current: Pick<QualityHistoryRecord, 'chapterKey' | 'timestamp' | 'overallScore'>,
    history: QualityHistoryRecord[],
): QualityChapterTrend {
    const currentKey = normalizeChapterKey(current.chapterKey);
    if (!currentKey || !Number.isFinite(current.overallScore)) return 'stable';

    const previousChapters = aggregateQualityHistoryByChapter(
        history.filter(entry => {
            const key = normalizeChapterKey(entry.chapterKey);
            if (!key || key === currentKey) return false;
            // 只允许用当前章之前的历史：磁盘里若有更晚的章，不能反过来影响本章趋势
            return entry.timestamp <= current.timestamp;
        }),
    ).slice(-QUALITY_CHAPTER_TREND.windowSize);

    if (previousChapters.length < QUALITY_CHAPTER_TREND.minChapters) return 'stable';

    const average = previousChapters.reduce((sum, entry) => sum + entry.overallScore, 0)
        / previousChapters.length;
    const diff = current.overallScore - average;
    if (diff > QUALITY_CHAPTER_TREND.delta) return 'rising';
    if (diff < -QUALITY_CHAPTER_TREND.delta) return 'falling';
    return 'stable';
}

/**
 * 合并并裁剪：按时间升序保留最后 max 条。
 * 完全重复（章节 + 时间 + 总分 + 字数）的记录会被丢弃，
 * 避免同一毫秒内重复渲染造成曲线噪声。
 */
export function mergeQualityHistory(
    existing: QualityHistoryRecord[],
    incoming: QualityHistoryRecord[],
    max: number = QUALITY_HISTORY_MAX_RECORDS,
): QualityHistoryRecord[] {
    return normalizeQualityHistory([...existing, ...incoming], max);
}

function normalizeQualityHistory(entries: QualityHistoryRecord[], max: number): QualityHistoryRecord[] {
    const seen = new Set<string>();
    const deduped: QualityHistoryRecord[] = [];
    for (const entry of entries) {
        const key = `${entry.chapterKey}|${entry.timestamp}|${entry.overallScore}|${entry.wordCount}`;
        if (seen.has(key)) continue;
        seen.add(key);
        deduped.push(entry);
    }
    deduped.sort((a, b) => a.timestamp - b.timestamp);
    const safeMax = Math.max(1, Math.floor(max));
    return deduped.length > safeMax ? deduped.slice(deduped.length - safeMax) : deduped;
}
