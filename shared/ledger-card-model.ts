/**
 * ledger-card-model.ts — 时间线事件 / 伏笔卡片化（纯函数）
 *
 * M13：把「时间线看板.md」「伏笔库.md」这类单表 md 解析成条目卡片，
 * 并可由卡片反向渲染派生看板（原文件转为派生视图）。
 */

/** 时间线事件卡 */
export interface TimelineEventCard {
    /** 事件 ID（无则按序号生成 EVT-TMP-n，迁移时再分配正式 ID） */
    id: string;
    /** 时间（故事内） */
    time: string;
    /** 事件 */
    event: string;
    /** 章节 */
    chapter: string;
    /** 地点 */
    location: string;
    /** 涉及人物 */
    characters: string[];
    /** 类型 */
    kind: string;
}

/** 伏笔卡 */
export interface ForeshadowCard {
    /** 伏笔 ID（无则按序号生成） */
    id: string;
    /** 名称 */
    name: string;
    /** 状态（planted/progressing/resolved/abandoned 或中文） */
    status: string;
    /** 埋设章节 */
    plantedChapter: string;
    /** 计划回收章节 */
    plannedReveal: string;
    /** 实际回收章节 */
    actualReveal: string;
    /** 重要程度 */
    importance: string;
    /** 关联人物 */
    characters: string[];
}

/** 表格行 */
type Row = Record<string, string>;

/**
 * 解析 Markdown 表格。
 *
 * @param text - 文本
 * @param requiredHeader - 必须包含的表头关键字
 * @param allTables - 是否解析全部表格（默认只取第一张）
 * @returns 行
 */
export function parseMarkdownTable(text: string, requiredHeader: string, allTables = false): Row[] {
    const lines = String(text ?? '').split('\n');
    let headers: string[] | null = null;
    const rows: Row[] = [];
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('|')) {
            if (headers && rows.length > 0) {
                if (!allTables) break; // 默认只取第一张表
                headers = null; // 多表模式：遇到新表重新识别表头
            }
            continue;
        }
        const cells = trimmed.split('|').slice(1, -1).map(cell => cell.trim());
        if (!headers) {
            if (cells.some(cell => cell.includes(requiredHeader))) headers = cells;
            continue;
        }
        if (cells.every(cell => /^:?-{2,}:?$/.test(cell) || cell === '')) continue;
        const row: Row = {};
        headers.forEach((header, index) => {
            row[header] = cells[index] ?? '';
        });
        rows.push(row);
    }
    return rows;
}

/**
 * 解析时间线看板。
 *
 * @param text - 时间线看板全文
 * @returns 事件卡
 */
export function parseTimelineBoard(text: string): TimelineEventCard[] {
    const rows = parseMarkdownTable(text, '时间');
    const cards: TimelineEventCard[] = [];
    rows.forEach((row, index) => {
        const time = pick(row, ['时间', '故事时间', '时间点']);
        const event = pick(row, ['事件', '内容', '描述']);
        if (!time && !event) return;
        cards.push({
            id: pick(row, ['ID', '事件ID', '编号']) || `EVT-TMP-${index + 1}`,
            time,
            event,
            chapter: pick(row, ['章节', '章', '出处']),
            location: pick(row, ['地点', '位置']),
            characters: splitList(pick(row, ['涉及人物', '人物', '相关人物'])),
            kind: pick(row, ['类型', '类别']),
        });
    });
    return cards;
}

/**
 * 解析伏笔库（多张表，按分节标题判断状态）。
 *
 * @param text - 伏笔库全文
 * @returns 伏笔卡
 */
export function parseForeshadowLibrary(text: string): ForeshadowCard[] {
    const source = String(text ?? '');
    const rows = parseMarkdownTable(source, '伏笔', true);
    const cards: ForeshadowCard[] = [];
    rows.forEach((row, index) => {
        const name = pick(row, ['伏笔', '名称', '伏笔名', '内容']);
        if (!name) return;
        cards.push({
            id: pick(row, ['ID', '伏笔ID', '编号']) || `FSH-TMP-${index + 1}`,
            name,
            status: pick(row, ['状态', '当前状态']) || inferStatus(source, name),
            plantedChapter: pick(row, ['埋设章节', '埋设', '埋设章']),
            plannedReveal: pick(row, ['计划回收', '计划回收章节', '预计回收']),
            actualReveal: pick(row, ['回收章节', '实际回收', '回收']),
            importance: pick(row, ['重要程度', '重要度', '级别']),
            characters: splitList(pick(row, ['相关人物', '涉及人物', '人物'])),
        });
    });
    return cards;
}

/**
 * 渲染时间线看板（派生视图）。
 *
 * @param cards - 事件卡
 * @returns Markdown
 */
export function renderTimelineBoard(cards: readonly TimelineEventCard[]): string {
    const lines = [
        '# 时间线看板',
        '',
        '> 本文件由插件根据时间线事件条目生成，请勿手改。',
        '',
        '| ID | 时间 | 事件 | 章节 | 地点 | 涉及人物 | 类型 |',
        '|---|---|---|---|---|---|---|',
    ];
    for (const card of cards) {
        lines.push(`| ${card.id} | ${card.time} | ${card.event} | ${card.chapter} | ${card.location} | ${card.characters.join('、')} | ${card.kind} |`);
    }
    return lines.join('\n');
}

/**
 * 渲染伏笔库（派生视图，按状态分节）。
 *
 * @param cards - 伏笔卡
 * @returns Markdown
 */
export function renderForeshadowLibrary(cards: readonly ForeshadowCard[]): string {
    const sections: Array<{ title: string; statuses: string[] }> = [
        { title: '未回收', statuses: ['planted', 'progressing', '未回收', '进行中'] },
        { title: '已回收', statuses: ['resolved', '已回收', '已兑现'] },
        { title: '已废弃', statuses: ['abandoned', '已废弃', '放弃'] },
    ];
    const lines = ['# 伏笔库', '', '> 本文件由插件根据伏笔条目生成，请勿手改。', ''];
    const used = new Set<ForeshadowCard>();
    for (const section of sections) {
        const matched = cards.filter(card => section.statuses.includes(card.status));
        matched.forEach(card => used.add(card));
        lines.push(`## ${section.title}`, '');
        if (matched.length === 0) {
            lines.push('（无）', '');
            continue;
        }
        lines.push('| ID | 伏笔 | 埋设章节 | 计划回收 | 回收章节 | 重要程度 | 相关人物 |');
        lines.push('|---|---|---|---|---|---|---|');
        for (const card of matched) {
            lines.push(`| ${card.id} | ${card.name} | ${card.plantedChapter} | ${card.plannedReveal} | ${card.actualReveal} | ${card.importance} | ${card.characters.join('、')} |`);
        }
        lines.push('');
    }
    const others = cards.filter(card => !used.has(card));
    if (others.length > 0) {
        lines.push('## 其他', '');
        lines.push('| ID | 伏笔 | 状态 |');
        lines.push('|---|---|---|');
        for (const card of others) lines.push(`| ${card.id} | ${card.name} | ${card.status} |`);
    }
    return lines.join('\n');
}

/** 取字段 */
function pick(row: Row, keys: readonly string[]): string {
    for (const key of keys) {
        const value = row[key];
        if (value && value.trim()) return value.trim();
    }
    return '';
}

/** 拆分列表 */
function splitList(value: string): string[] {
    if (!value) return [];
    return value.split(/[、，,;；/|]+/).map(item => item.trim()).filter(Boolean);
}

/**
 * 从全文分节标题推断状态。
 *
 * @param source - 全文
 * @param name - 伏笔名
 * @returns 状态
 */
function inferStatus(source: string, name: string): string {
    const index = source.indexOf(name);
    if (index < 0) return '';
    const before = source.slice(0, index);
    const heading = [...before.matchAll(/^##\s*(.+)$/gm)].pop()?.[1]?.trim() ?? '';
    if (heading.includes('未回收')) return 'planted';
    if (heading.includes('已回收')) return 'resolved';
    if (heading.includes('废弃')) return 'abandoned';
    return heading;
}
