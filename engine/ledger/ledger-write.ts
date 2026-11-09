/**
 * ledger-write.ts — 故事台账唯一写入器（纯内容变换）
 *
 * 只负责「给一份 Markdown 内容，返回变更后的内容」，不碰文件系统；
 * 调用方负责 `withWriteLock` 与 journal。规则：
 *  - 按目标表现有表头写行，不把 7 列行塞进 4 列表；
 *  - 按纪元选节，不固定插第一条分隔线；
 *  - 幂等按稳定 ID / 归一化三元组；
 *  - `#` 序号只在单表内重排。
 */
import {
    chapterNumOf,
    eventIdOf,
    foreshadowIdOf,
    isSeparatorRow,
    normalizeLedgerName,
    plannedRevealNumber,
    splitLedgerRow,
    type EventRecord,
    type ForeshadowRecord,
} from './ledger-model';
import { parseForeshadowLibrary, parseTimelineBoard } from './ledger-parse';

/** 写入结果 */
export interface LedgerWriteResult {
    content: string;
    changed: boolean;
    id?: string;
    reason?: string;
}

/** 表格定位结果 */
interface TableLocation {
    headerIdx: number;
    separatorIdx: number;
    endIdx: number;
    headers: string[];
}

/** 归一化表头 */
function normalizeHeader(cell: string): string {
    return String(cell ?? '').replace(/[*`\s]/g, '');
}

/**
 * 从指定行向下找第一张表
 *
 * @param lines - 行
 * @param from - 起始下标
 * @returns 表格位置或 null
 */
function locateTable(lines: string[], from: number): TableLocation | null {
    for (let i = from; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith('##') || line.startsWith('###')) return null;
        if (!line.startsWith('|') || isSeparatorRow(line)) continue;
        if (!lines[i + 1] || !isSeparatorRow(lines[i + 1])) continue;
        const headers = splitLedgerRow(line).map(normalizeHeader);
        let end = i + 2;
        while (end < lines.length && lines[end].trim().startsWith('|')) end++;
        return { headerIdx: i, separatorIdx: i + 1, endIdx: end, headers };
    }
    return null;
}

/**
 * 找分节标题后第一张表
 *
 * @param lines - 行
 * @param titleMatcher - 标题匹配
 * @returns 表格位置或 null
 */
function locateSectionTable(lines: string[], titleMatcher: (title: string) => boolean): TableLocation | null {
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line.startsWith('##')) continue;
        const title = line.replace(/^#+\s*/, '');
        if (!titleMatcher(title)) continue;
        const table = locateTable(lines, i + 1);
        if (table) return table;
    }
    return null;
}

/**
 * 取列下标（表头名优先，其次兜底）
 *
 * @param headers - 表头
 * @param names - 候选
 * @param fallback - 兜底
 * @returns 下标
 */
function columnOf(headers: string[], names: string[], fallback: number): number {
    for (const name of names) {
        const index = headers.indexOf(normalizeHeader(name));
        if (index >= 0) return index;
    }
    return fallback;
}

/**
 * 生成一行：按表头把值放到位；未知列留空
 *
 * @param headers - 表头
 * @param values - 列名 → 值
 * @param fallback - 兜底数组（按位置）
 * @returns Markdown 行
 */
function buildRow(headers: string[], values: Record<string, string>, fallback: string[]): string {
    const cells = headers.map((header, index) => {
        for (const [name, value] of Object.entries(values)) {
            if (header === normalizeHeader(name)) return value;
        }
        return fallback[index] ?? '';
    });
    return `| ${cells.join(' | ')} |`;
}

/**
 * 表内下一个序号
 *
 * @param lines - 行
 * @param table - 表格
 * @returns 序号
 */
function nextRowNumber(lines: string[], table: TableLocation): number {
    const index = table.headers.indexOf('#');
    if (index < 0) return 0;
    let max = 0;
    for (let i = table.separatorIdx + 1; i < table.endIdx; i++) {
        const cells = splitLedgerRow(lines[i]);
        const num = Number.parseInt(cells[index] ?? '', 10);
        if (Number.isFinite(num)) max = Math.max(max, num);
    }
    return max + 1;
}

/**
 * 重排某张表的 `#` 列
 *
 * @param lines - 行
 * @param table - 表格
 * @returns 是否变更
 */
function renumber(lines: string[], table: TableLocation): boolean {
    const index = table.headers.indexOf('#');
    if (index < 0) return false;
    let changed = false;
    let num = 1;
    for (let i = table.separatorIdx + 1; i < table.endIdx; i++) {
        const cells = splitLedgerRow(lines[i]);
        if (cells.length <= index) continue;
        if (cells[index] !== String(num)) {
            cells[index] = String(num);
            lines[i] = `| ${cells.join(' | ')} |`;
            changed = true;
        }
        num++;
    }
    return changed;
}

/** 时间线默认双纪元模板（4 列，兼容旧项目） */
function defaultTimelineTemplate(): string {
    return `# 时间线看板\n\n> 按时间顺序排列的关键事件，用于整体把控叙事节奏。\n\n## 纪元 / 时间轴\n\n### 背景纪元（故事开始前）\n\n| 时间 | 对应章节 | 事件 | 影响 |\n|------|---------|------|------|\n\n### 主线纪元（故事进行中）\n\n| 时间 | 对应章节 | 事件 | 影响 |\n|------|---------|------|------|\n`;
}

/** 伏笔库默认双节模板（8 列） */
function defaultForeshadowTemplate(): string {
    return `# 伏笔库\n\n> 所有伏笔总览，追踪状态，避免遗漏。\n\n## 未回收伏笔\n\n| # | 伏笔名称 | 重要程度 | 埋设章节 | 计划回收 | 相关人物 | 关联主线 | 当前状态 |\n|---|---------|---------|---------|---------|---------|---------|---------|\n\n## 已回收伏笔\n\n| # | 伏笔名称 | 重要程度 | 埋设章节 | 相关人物 | 关联主线 | 回收章节 | 回收方式 |\n|---|---------|---------|---------|---------|---------|---------|---------|\n`;
}

/** 事件写入参数 */
export interface EventWriteInput {
    name: string;
    time?: string;
    chapterKey: string;
    impact?: string;
    location?: string;
    involved?: string[];
    type?: string;
    era?: EventRecord['era'];
    importance?: EventRecord['importance'];
    source?: EventRecord['source'];
}

/**
 * 追加时间线事件（按目标表列宽、按纪元选节、按 ID/三元组幂等）。
 *
 * @param content - 原内容
 * @param input - 事件
 * @returns LedgerWriteResult
 */
export function appendEventToContent(content: string, input: EventWriteInput): LedgerWriteResult {
    const chapterNum = chapterNumOf(input.chapterKey);
    const chapterKey = chapterNum !== null ? `第${chapterNum}章` : input.chapterKey;
    const era = input.era ?? (/(背景纪元|纪元前|上古|远古|传说|肇始)/.test(`${input.time ?? ''}${input.impact ?? ''}`) ? 'background' : 'main');
    const id = eventIdOf({ era, chapterKey, time: input.time ?? '', name: input.name });

    let base = content && content.trim() ? content : defaultTimelineTemplate();
    const parsed = parseTimelineBoard(base);
    const exists = parsed.records.some((record) => record.id === id)
        || parsed.records.some((record) => normalizeLedgerName(record.name) === normalizeLedgerName(input.name)
            && normalizeLedgerName(record.time) === normalizeLedgerName(input.time ?? '')
            && record.chapterKey === chapterKey);
    if (exists) return { content: base, changed: false, id, reason: 'duplicate' };

    const lines = base.split('\n');
    const sectionMatcher = era === 'background'
        ? (title: string) => /背景纪元|纪元前/.test(title)
        : (title: string) => /主线纪元|故事进行中/.test(title);
    let table = locateSectionTable(lines, sectionMatcher);

    // 没有纪元分节：若文件是平表（分析报告历史创建），写平表；否则补默认分节
    if (!table) {
        table = locateTable(lines, 0);
        if (!table) {
            if (!base.trim()) base = defaultTimelineTemplate();
            const rebuilt = base.split('\n');
            table = locateSectionTable(rebuilt, sectionMatcher);
            if (!table) return { content: base, changed: false, id, reason: 'no-table' };
            return appendEventToContent(rebuilt.join('\n'), input);
        }
    }

    const values: Record<string, string> = {
        '#': String(nextRowNumber(lines, table)),
        '事件名称': input.name,
        '事件': input.name,
        '时间': input.time ?? '',
        '地点': input.location ?? '',
        '涉及人物': (input.involved ?? []).join('、'),
        '章节': chapterKey,
        '对应章节': chapterKey,
        '类型': input.type ?? (input.importance === 'high' ? '主线' : input.importance === 'medium' ? '支线' : ''),
        '影响': input.impact ?? '',
    };
    const fallback = [values['时间'] ?? '', chapterKey, input.name, input.impact ?? ''];
    const row = buildRow(table.headers, values, fallback);

    if (!base.endsWith('\n')) base += '\n';
    const working = base.split('\n');
    const target = locateSectionTable(working, sectionMatcher) ?? locateTable(working, 0);
    if (!target) return { content: base, changed: false, id, reason: 'no-table' };
    working.splice(target.endIdx, 0, row);
    target.endIdx += 1;
    renumber(working, target);
    return { content: working.join('\n'), changed: true, id };
}

/** 伏笔写入参数 */
export interface ForeshadowWriteInput {
    name: string;
    importance?: string;
    buryChapter?: string;
    plannedReveal?: string;
    relatedChars?: string;
    mainline?: string;
    statusText?: string;
}

/**
 * 追加未回收伏笔（按目标表表头写行，按名称幂等）。
 *
 * @param content - 原内容
 * @param input - 伏笔
 * @returns LedgerWriteResult
 */
export function appendForeshadowToContent(content: string, input: ForeshadowWriteInput): LedgerWriteResult {
    const name = String(input.name ?? '').trim();
    if (!name) return { content, changed: false, reason: 'empty-name' };
    const id = foreshadowIdOf(name);
    let base = content && content.trim() ? content : defaultForeshadowTemplate();
    const parsed = parseForeshadowLibrary(base);
    if (parsed.records.some((record) => normalizeLedgerName(record.name) === normalizeLedgerName(name))) {
        return { content: base, changed: false, id, reason: 'duplicate' };
    }

    let lines = base.split('\n');
    let table = locateSectionTable(lines, (title) => /未回收|未揭示/.test(title));
    if (!table) {
        // 兼容旧文件：只有一张表且没有分节
        table = locateTable(lines, 0);
        if (!table) {
            base = `${base.trimEnd()}\n\n## 未回收伏笔\n\n| # | 伏笔名称 | 重要程度 | 埋设章节 | 计划回收 | 相关人物 | 关联主线 | 当前状态 |\n|---|---------|---------|---------|---------|---------|---------|---------|\n`;
            lines = base.split('\n');
            table = locateSectionTable(lines, (title) => /未回收|未揭示/.test(title));
            if (!table) return { content: base, changed: false, id, reason: 'no-table' };
        }
    }

    const values: Record<string, string> = {
        '#': String(nextRowNumber(lines, table)),
        '伏笔名称': name,
        '名称': name,
        '重要程度': input.importance ?? '中',
        '埋设章节': input.buryChapter ?? '',
        '计划回收': input.plannedReveal ?? '待定',
        '相关人物': input.relatedChars ?? '',
        '关联主线': input.mainline ?? '',
        '当前状态': input.statusText ?? '未揭示',
    };
    const fallback = [
        values['#'], name, values['重要程度'], values['埋设章节'],
        values['计划回收'], values['相关人物'], values['关联主线'], values['当前状态'],
    ];
    const row = buildRow(table.headers, values, fallback);
    if (!base.endsWith('\n')) base += '\n';
    const working = base.split('\n');
    const target = locateSectionTable(working, (title) => /未回收|未揭示/.test(title)) ?? locateTable(working, 0);
    if (!target) return { content: base, changed: false, id, reason: 'no-table' };
    working.splice(target.endIdx, 0, row);
    target.endIdx += 1;
    renumber(working, target);
    return { content: working.join('\n'), changed: true, id };
}

/**
 * 把伏笔从未回收移到已回收（表头感知，缺节时补节）。
 *
 * @param content - 原内容
 * @param name - 伏笔名
 * @param revealChapter - 回收章
 * @param method - 回收方式
 * @returns LedgerWriteResult
 */
export function moveForeshadowToRevealedInContent(
    content: string,
    name: string,
    revealChapter: string,
    method = '正文揭示',
): LedgerWriteResult {
    const parsed = parseForeshadowLibrary(content);
    const record = parsed.records.find((item) => item.status === 'unrevealed'
        && normalizeLedgerName(item.name) === normalizeLedgerName(name));
    if (!record) return { content, changed: false, reason: 'not-found' };

    const lines = content.split('\n');
    const unrevealedTable = locateSectionTable(lines, (title) => /未回收|未揭示/.test(title));
    if (!unrevealedTable) return { content, changed: false, reason: 'no-table' };

    // 按名称 + 所在表定位原始行（不依赖 stripped 后的行号）
    let sourceRow = -1;
    for (let i = unrevealedTable.separatorIdx + 1; i < unrevealedTable.endIdx; i++) {
        const cells = splitLedgerRow(lines[i]);
        if (normalizeLedgerName(cells[columnOf(unrevealedTable.headers, ['伏笔名称', '名称'], 1)]) === normalizeLedgerName(name)) {
            sourceRow = i;
            break;
        }
    }
    if (sourceRow < 0) return { content, changed: false, reason: 'row-not-found' };

    lines.splice(sourceRow, 1);
    // 删除行后表尾前移，重新定位
    let revealedTable = locateSectionTable(lines, (title) => /已回收|已揭示/.test(title));
    if (!revealedTable) {
        const insertAt = lines.length;
        lines.push('', '## 已回收伏笔', '',
            '| # | 伏笔名称 | 重要程度 | 埋设章节 | 相关人物 | 关联主线 | 回收章节 | 回收方式 |',
            '|---|---------|---------|---------|---------|---------|---------|---------|');
        revealedTable = { headerIdx: insertAt + 2, separatorIdx: insertAt + 3, endIdx: insertAt + 4, headers: ['#', '伏笔名称', '重要程度', '埋设章节', '相关人物', '关联主线', '回收章节', '回收方式'] };
    }

    const values: Record<string, string> = {
        '#': String(nextRowNumber(lines, revealedTable)),
        '伏笔名称': record.name,
        '名称': record.name,
        '重要程度': record.importance || '中',
        '埋设章节': record.buryChapter,
        '相关人物': record.relatedRefs.map((ref) => ref.name).join('、'),
        '关联主线': record.mainline,
        '回收章节': revealChapter,
        '回收方式': method,
    };
    const fallback = [
        values['#'], record.name, values['重要程度'], record.buryChapter,
        values['相关人物'], values['关联主线'], revealChapter, method,
    ];
    const row = buildRow(revealedTable.headers, values, fallback);
    lines.splice(revealedTable.endIdx, 0, row);
    revealedTable.endIdx += 1;
    renumber(lines, revealedTable);

    // 未回收表因删行需要重排
    const refreshed = locateSectionTable(lines, (title) => /未回收|未揭示/.test(title));
    if (refreshed) renumber(lines, refreshed);

    return { content: lines.join('\n'), changed: true, id: record.id };
}

/**
 * 把记录还原成旧版 `ForeshadowData`（供现有上下文结构使用）
 *
 * @param records - 台账记录
 * @returns 三组伏笔
 */
export function toForeshadowGroups(records: ForeshadowRecord[]): {
    unrevealed: ForeshadowRecord[];
    revealed: ForeshadowRecord[];
    abandoned: ForeshadowRecord[];
} {
    return {
        unrevealed: records.filter((record) => record.status === 'unrevealed'),
        revealed: records.filter((record) => record.status === 'revealed'),
        abandoned: records.filter((record) => record.status === 'abandoned'),
    };
}

/**
 * 计划回收是否已到期
 *
 * @param record - 伏笔记录
 * @param currentChapter - 当前章
 * @returns 是否到期/逾期
 */
export function isForeshadowDue(record: ForeshadowRecord, currentChapter: number | null): boolean {
    const planned = plannedRevealNumber(record.plannedReveal);
    if (planned === null || currentChapter === null) return false;
    return planned <= currentChapter;
}
