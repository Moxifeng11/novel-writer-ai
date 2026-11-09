/**
 * ledger-parse.ts — 故事台账唯一解析器
 *
 * 兼容历史格式：
 *  - 时间线：4 列（时间/对应章节/事件/影响）与 7 列（#/事件名称/时间/地点/涉及人物/章节/类型），
 *    支持 `### 背景纪元/主线纪元` 分节，也支持无分节的平表；
 *  - 伏笔库：未回收 8 列、已回收 8 列（少一列计划回收）、已废弃 4 列，
 *    以及分析报告历史写入的 6/7 列畸形行；
 *  - 旧 `NW-LINKAGE` / 新 `NW-LEDGER` 自动块先剥离，不参与业务解析。
 *
 * 解析原则：按表头映射列，不按固定下标；无法识别的行保留 raw 并记 issue，不丢行。
 */
import {
    chapterNumOf,
    eventIdOf,
    foreshadowIdOf,
    isSeparatorRow,
    normalizeForeshadowStatus,
    splitLedgerRow,
    stripAutoBlocks,
    type EventRecord,
    type ForeshadowRecord,
    type LedgerIssue,
} from './ledger-model';

/** 解析结果 */
export interface ForeshadowParseResult {
    records: ForeshadowRecord[];
    issues: LedgerIssue[];
}

/** 时间线解析结果 */
export interface TimelineParseResult {
    records: EventRecord[];
    eras: string[];
    issues: LedgerIssue[];
}

/** 归一化表头单元：去空格/星号/加粗 */
function normalizeHeader(cell: string): string {
    return String(cell ?? '').replace(/[*`\s]/g, '').replace(/^#$/i, '#');
}

/**
 * 在表头行之后定位数据行；返回表头映射与行号范围。
 *
 * @param lines - 全部行
 * @param startIdx - 起始扫描位置
 * @returns 表头与数据行下标；无表格时为 null
 */
function findTable(lines: string[], startIdx: number): { headers: string[]; rows: number[] } | null {
    for (let i = startIdx; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line.startsWith('|')) continue;
        if (line.startsWith('##') || line.startsWith('###')) return null;
        const cells = splitLedgerRow(line);
        if (cells.length < 2 || isSeparatorRow(line)) continue;
        if (!lines[i + 1] || !isSeparatorRow(lines[i + 1])) continue;
        const headers = cells.map(normalizeHeader);
        const rows: number[] = [];
        for (let j = i + 2; j < lines.length; j++) {
            const row = lines[j].trim();
            if (!row.startsWith('|')) break;
            if (isSeparatorRow(row)) continue;
            rows.push(j);
        }
        return { headers, rows };
    }
    return null;
}

/**
 * 按表头名取列；找不到时返回 fallback 下标。
 *
 * @param headers - 表头
 * @param names - 候选列名
 * @param fallback - 兜底下标
 * @returns 下标（找不到为 -1）
 */
function columnOf(headers: string[], names: string[], fallback: number): number {
    for (const name of names) {
        const key = normalizeHeader(name);
        const index = headers.indexOf(key);
        if (index >= 0) return index;
    }
    return fallback;
}

/**
 * 解析伏笔库（三节）。
 *
 * @param content - 文件内容
 * @param sourcePath - 文件路径（写入 issue）
 * @returns ForeshadowParseResult
 */
export function parseForeshadowLibrary(content: string, sourcePath = ''): ForeshadowParseResult {
    const issues: LedgerIssue[] = [];
    const records: ForeshadowRecord[] = [];
    const lines = stripAutoBlocks(content).split('\n');

    let section: 'unrevealed' | 'revealed' | 'abandoned' | 'unknown' = 'unknown';
    let idx = 0;
    while (idx < lines.length) {
        const line = lines[idx].trim();
        if (line.startsWith('##')) {
            const title = line.replace(/^#+\s*/, '');
            if (title.includes('未回收') || title.includes('未揭示')) section = 'unrevealed';
            else if (title.includes('已回收') || title.includes('已揭示')) section = 'revealed';
            else if (title.includes('废弃')) section = 'abandoned';
            else section = 'unknown';
            idx++;
            continue;
        }
        if (!line.startsWith('|')) {
            idx++;
            continue;
        }
        const table = findTable(lines, idx);
        if (!table) {
            idx++;
            continue;
        }
        for (const rowIdx of table.rows) {
            const cells = splitLedgerRow(lines[rowIdx]);
            const record = buildForeshadowRecord(cells, table.headers, section, sourcePath, rowIdx + 1, issues);
            if (record) records.push(record);
        }
        idx = (table.rows[table.rows.length - 1] ?? idx) + 1;
    }

    // 同 ID 去重：保留信息量最大的一条
    const deduped = new Map<string, ForeshadowRecord>();
    for (const record of records) {
        const existing = deduped.get(record.id);
        if (!existing) {
            deduped.set(record.id, record);
            continue;
        }
        const keep = record.raw.length > existing.raw.length ? record : existing;
        deduped.set(record.id, keep);
        issues.push({
            type: 'duplicate-row',
            message: `伏笔「${record.name}」存在重复行，已合并保留信息量最大的一条`,
            sourcePath,
            lineNo: record.lineNo,
            recordId: record.id,
            severity: 'low',
        });
    }

    return { records: [...deduped.values()], issues };
}

/**
 * 单行 → 伏笔记录
 *
 * @param cells - 单元格
 * @param headers - 表头
 * @param section - 所在分节
 * @param sourcePath - 路径
 * @param lineNo - 行号
 * @param issues - 问题收集
 * @returns 记录或 null
 */
function buildForeshadowRecord(
    cells: string[],
    headers: string[],
    section: 'unrevealed' | 'revealed' | 'abandoned' | 'unknown',
    sourcePath: string,
    lineNo: number,
    issues: LedgerIssue[],
): ForeshadowRecord | null {
    if (cells.length < 2) return null;
    const nameIndex = columnOf(headers, ['伏笔名称', '名称', '伏笔'], 1);
    const name = String(cells[nameIndex] ?? '').trim();
    if (!name || name === '伏笔名称' || name === '名称') return null;

    const importance = cellAt(cells, headers, ['重要程度', '重要度'], 2);
    const buryChapter = cellAt(cells, headers, ['埋设章节', '埋设'], 3);
    const statusText = cellAt(cells, headers, ['当前状态', '状态'], -1);

    let plannedReveal = '';
    let revealChapter = '';
    let relatedChars = '';
    let mainline = '';
    let method = '';
    let reason = '';
    let abandonChapter = '';

    if (section === 'unrevealed') {
        plannedReveal = cellAt(cells, headers, ['计划回收', '计划揭示'], 4);
        relatedChars = cellAt(cells, headers, ['相关人物', '涉及人物'], 5);
        mainline = cellAt(cells, headers, ['关联主线', '主线'], 6);
    } else if (section === 'revealed') {
        relatedChars = cellAt(cells, headers, ['相关人物', '涉及人物'], 4);
        mainline = cellAt(cells, headers, ['关联主线', '主线'], 5);
        revealChapter = cellAt(cells, headers, ['回收章节', '揭示章节'], 6);
        method = cellAt(cells, headers, ['回收方式', '揭示方式'], 7);
    } else if (section === 'abandoned') {
        reason = cellAt(cells, headers, ['原因', '废弃原因'], 2);
        abandonChapter = cellAt(cells, headers, ['废弃章节'], 3);
    } else {
        // 未知分节：按 8 列未回收兜底，至少保留可读字段
        plannedReveal = cells[4] ?? '';
        relatedChars = cells[5] ?? '';
        mainline = cells[6] ?? '';
    }

    const status = normalizeForeshadowStatus(statusText, section);
    const id = foreshadowIdOf(name);
    if (section === 'unknown') {
        issues.push({
            type: 'unknown-row',
            message: `伏笔「${name}」不在已知分节内，已按原始字段保留`,
            sourcePath,
            lineNo,
            recordId: id,
            severity: 'low',
        });
    }

    return {
        id,
        name,
        importance,
        buryChapter,
        plannedReveal,
        revealChapter,
        status,
        relatedRefs: relatedChars ? relatedChars.split(/[,，、/]/).map((item) => item.trim()).filter(Boolean).map((item) => ({
            id: '', name: item, kind: 'unknown', resolved: false,
        })) : [],
        mainline,
        eventRefs: [],
        method: method || (section === 'abandoned' ? `废弃：${reason}` : ''),
        reason: reason || (status === 'abandoned' ? abandonChapter : ''),
        sourcePath,
        lineNo,
        raw: cells.join(' | '),
    };
}

/**
 * 取单元格
 *
 * @param cells - 单元格
 * @param headers - 表头
 * @param names - 候选列名
 * @param fallback - 兜底下标
 * @returns 文本
 */
function cellAt(cells: string[], headers: string[], names: string[], fallback: number): string {
    const index = columnOf(headers, names, fallback);
    if (index < 0) return '';
    return String(cells[index] ?? '').trim();
}

/**
 * 解析时间线看板。
 *
 * @param content - 文件内容
 * @param sourcePath - 文件路径
 * @returns TimelineParseResult
 */
export function parseTimelineBoard(content: string, sourcePath = ''): TimelineParseResult {
    const issues: LedgerIssue[] = [];
    const records: EventRecord[] = [];
    const eras: string[] = [];
    const lines = stripAutoBlocks(content).split('\n');

    let eraName = '';
    let era: EventRecord['era'] = 'unknown';
    let prevChapter: number | null = null;
    let idx = 0;

    while (idx < lines.length) {
        const line = lines[idx].trim();
        if (line.startsWith('###') || (line.startsWith('##') && !line.startsWith('###'))) {
            const title = line.replace(/^#+\s*/, '').trim();
            if (line.startsWith('###') && title && !title.includes('|')) {
                eraName = title;
                era = /背景|纪元前|上古|远古|传说|肇始/.test(title) ? 'background' : 'main';
                if (!eras.includes(title)) eras.push(title);
                prevChapter = null;
            }
            idx++;
            continue;
        }
        if (!line.startsWith('|')) {
            idx++;
            continue;
        }
        const table = findTable(lines, idx);
        if (!table) {
            idx++;
            continue;
        }
        const rich = table.headers.some((header) => header.includes('事件名称')) || table.headers.length >= 6;
        for (const rowIdx of table.rows) {
            const cells = splitLedgerRow(lines[rowIdx]);
            const record = buildEventRecord(cells, table.headers, rich, era, eraName, sourcePath, rowIdx + 1, issues);
            if (!record) continue;
            records.push(record);
            if (record.chapterNum !== null) {
                if (prevChapter !== null && record.chapterNum < prevChapter) {
                    issues.push({
                        type: 'out-of-order',
                        message: `${eraName || '默认纪元'}：章节倒序 第${prevChapter}章 → 第${record.chapterNum}章`,
                        sourcePath,
                        lineNo: record.lineNo,
                        recordId: record.id,
                        severity: 'medium',
                    });
                }
                prevChapter = record.chapterNum;
            } else {
                issues.push({
                    type: 'invalid-chapter',
                    message: `事件「${record.name}」的章节无法解析：${record.chapterKey || '空'}`,
                    sourcePath,
                    lineNo: record.lineNo,
                    recordId: record.id,
                    severity: 'low',
                });
            }
        }
        idx = (table.rows[table.rows.length - 1] ?? idx) + 1;
    }

    // 同 ID 去重
    const deduped = new Map<string, EventRecord>();
    for (const record of records) {
        if (!deduped.has(record.id)) {
            deduped.set(record.id, record);
            continue;
        }
        issues.push({
            type: 'duplicate-event',
            message: `事件「${record.name}」重复（${record.chapterKey}）`,
            sourcePath,
            lineNo: record.lineNo,
            recordId: record.id,
            severity: 'low',
        });
    }

    return { records: [...deduped.values()], eras, issues };
}

/**
 * 单行 → 事件记录
 *
 * @param cells - 单元格
 * @param headers - 表头
 * @param rich - 是否 7 列富表
 * @param era - 纪元类型
 * @param eraName - 纪元名
 * @param sourcePath - 路径
 * @param lineNo - 行号
 * @param issues - 问题收集
 * @returns 记录或 null
 */
function buildEventRecord(
    cells: string[],
    headers: string[],
    rich: boolean,
    era: EventRecord['era'],
    eraName: string,
    sourcePath: string,
    lineNo: number,
    issues: LedgerIssue[],
): EventRecord | null {
    let name = '';
    let time = '';
    let chapter = '';
    let location = '';
    let involved = '';
    let type = '';
    let impact = '';

    if (rich) {
        name = cellAt(cells, headers, ['事件名称', '事件'], 1);
        time = cellAt(cells, headers, ['时间'], 2);
        location = cellAt(cells, headers, ['地点'], 3);
        involved = cellAt(cells, headers, ['涉及人物', '人物'], 4);
        chapter = cellAt(cells, headers, ['章节', '对应章节'], 5);
        type = cellAt(cells, headers, ['类型'], 6);
        impact = cellAt(cells, headers, ['影响'], -1);
    } else {
        time = cellAt(cells, headers, ['时间'], 0);
        chapter = cellAt(cells, headers, ['对应章节', '章节'], 1);
        name = cellAt(cells, headers, ['事件', '事件名称'], 2);
        impact = cellAt(cells, headers, ['影响'], 3);
        location = cellAt(cells, headers, ['地点'], -1);
        involved = cellAt(cells, headers, ['涉及人物'], -1);
        type = cellAt(cells, headers, ['类型'], -1);
    }

    if (!name && !time) return null;
    if (name === '事件名称' || name === '事件') return null;
    if (isSeparatorRow(`|${cells.join('|')}|`)) return null;

    const chapterNum = chapterNumOf(chapter);
    const chapterKey = chapterNum !== null ? `第${chapterNum}章` : chapter;
    const id = eventIdOf({ era, chapterKey, time, name });
    if (!chapter && !time) {
        issues.push({
            type: 'missing-column',
            message: `事件「${name}」缺少章节与时间`,
            sourcePath,
            lineNo,
            recordId: id,
            severity: 'low',
        });
    }
    return {
        id,
        name,
        time,
        chapterNum,
        chapterKey,
        era,
        eraName,
        location,
        entityRefs: involved ? involved.split(/[,，、/]/).map((item) => item.trim()).filter(Boolean).map((item) => ({
            id: '', name: item, kind: 'unknown', resolved: false,
        })) : [],
        foreshadowRefs: [],
        impact,
        type,
        importance: normalizeImportance(type),
        status: chapterNum !== null ? 'occurred' : 'unknown',
        source: 'manual',
        sourcePath,
        lineNo,
        raw: cells.join(' | '),
    };
}

/**
 * 类型列 → 重要度（历史分析报告把 主线/支线 写在类型列）
 *
 * @param type - 类型文本
 * @returns 重要度
 */
function normalizeImportance(type: string): EventRecord['importance'] {
    if (type.includes('主线')) return 'high';
    if (type.includes('支线')) return 'medium';
    if (type.includes('日常') || type.includes('过渡')) return 'low';
    return 'unknown';
}
