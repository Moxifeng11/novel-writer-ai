/**
 * promise-ledger.ts — 承诺/谜团账本
 *
 * 与伏笔库的区别：伏笔是作者埋设的叙事线索；承诺账本是“角色答应过什么、
 * 读者被抛出了什么问题”，用于防止支线被遗忘。
 */
export type PromiseStatus = 'open' | 'advanced' | 'resolved' | 'dropped';
/**
 * 承诺类型。
 */
export type PromiseType = '角色承诺' | '读者问题' | '悬念' | '约定' | '威胁' | '其他';

/**
 * 承诺条目。
 */
export interface PromiseItem {
    id: number;
    name: string;
    type: PromiseType;
    openedChapter: string;
    openedBy: string;
    expectedChapter: string;
    status: PromiseStatus;
    lastAdvancedChapter: string;
    note: string;
}

/**
 * 承诺表表头。
 */
export const PROMISE_TABLE_HEADER = '| # | 承诺/谜团 | 类型 | 提出章 | 提出角色 | 预期兑现 | 状态 | 最近推进章 | 备注 |';
/**
 * 承诺表分隔行。
 */
export const PROMISE_TABLE_SEPARATOR = '|---|---|---|---|---|---|---|---|---|';

/**
 * 默认承诺账本。
 */
export const DEFAULT_PROMISE_LEDGER = `# 承诺账本

> 记录角色承诺、读者问题、悬念与约定。分析报告会按 PROMISE_* 指令更新，规划时会注入未兑现项。
> 状态：open=未兑现 / advanced=有推进 / resolved=已兑现 / dropped=已放弃。

${PROMISE_TABLE_HEADER}
${PROMISE_TABLE_SEPARATOR}
`;

function normalizeStatus(raw: string): PromiseStatus {
    const value = (raw || '').toLowerCase();
    if (value.includes('resolved') || value.includes('已兑现') || value.includes('完成')) return 'resolved';
    if (value.includes('dropped') || value.includes('放弃') || value.includes('废弃')) return 'dropped';
    if (value.includes('advanced') || value.includes('推进')) return 'advanced';
    return 'open';
}

function normalizeType(raw: string): PromiseType {
    const value = (raw || '').trim();
    if (value.includes('读者')) return '读者问题';
    if (value.includes('悬念')) return '悬念';
    if (value.includes('约定')) return '约定';
    if (value.includes('威胁')) return '威胁';
    if (value.includes('承诺')) return '角色承诺';
    return '其他';
}

export function parsePromiseLedger(content: string): PromiseItem[] {
    if (!content) return [];
    const items: PromiseItem[] = [];
    for (const line of content.split(/\r?\n/)) {
        const cells = line.split('|').map(c => c.trim());
        if (cells.length < 10) continue;
        // split 后首尾为空：['', '#', name, ..., '']
        const id = parseInt(cells[1], 10);
        if (!Number.isFinite(id)) continue;
        const name = cells[2];
        if (!name || name.includes('承诺/谜团') || name.includes('---')) continue;
        items.push({
            id,
            name,
            type: normalizeType(cells[3]),
            openedChapter: cells[4],
            openedBy: cells[5],
            expectedChapter: cells[6],
            status: normalizeStatus(cells[7]),
            lastAdvancedChapter: cells[8],
            note: cells[9],
        });
    }
    return items;
}

export function formatPromiseLedger(items: PromiseItem[]): string {
    const rows = [...items]
        .sort((a, b) => a.id - b.id)
        .map((item, index) => `| ${index + 1} | ${item.name} | ${item.type} | ${item.openedChapter} | ${item.openedBy} | ${item.expectedChapter} | ${item.status} | ${item.lastAdvancedChapter} | ${item.note} |`);
    return `# 承诺账本\n\n> 记录角色承诺、读者问题、悬念与约定。分析报告会按 PROMISE_* 指令更新，规划时会注入未兑现项。\n\n${PROMISE_TABLE_HEADER}\n${PROMISE_TABLE_SEPARATOR}\n${rows.join('\n')}\n`;
}

export function applyPromiseInstruction(
    items: PromiseItem[],
    instruction: {
        action: 'open' | 'advance' | 'resolve' | 'drop';
        name: string;
        type?: string;
        chapter?: string;
        by?: string;
        expected?: string;
        note?: string;
    },
): PromiseItem[] {
    const next = items.map(i => ({ ...i }));
    const name = instruction.name.trim();
    if (!name) return next;
    const existing = next.find(i => i.name === name);

    if (instruction.action === 'open') {
        if (existing) return next;
        next.push({
            id: next.length + 1,
            name,
            type: normalizeType(instruction.type || ''),
            openedChapter: instruction.chapter || '',
            openedBy: instruction.by || '',
            expectedChapter: instruction.expected || '',
            status: 'open',
            lastAdvancedChapter: instruction.chapter || '',
            note: instruction.note || '',
        });
        return next;
    }

    if (!existing) return next;
    if (instruction.action === 'advance') {
        existing.status = 'advanced';
        existing.lastAdvancedChapter = instruction.chapter || existing.lastAdvancedChapter;
        if (instruction.note) existing.note = instruction.note;
    } else if (instruction.action === 'resolve') {
        existing.status = 'resolved';
        existing.lastAdvancedChapter = instruction.chapter || existing.lastAdvancedChapter;
        existing.note = instruction.note || existing.note;
    } else if (instruction.action === 'drop') {
        existing.status = 'dropped';
        existing.note = instruction.note || existing.note;
    }
    return next;
}

function chapterNumber(chapter: string): number | null {
    const m = chapter.match(/第?(\d+)章/);
    return m ? parseInt(m[1], 10) : null;
}

/** 未兑现且已到/超过预期章的承诺；以及长期无推进的承诺。 */
export function getPromiseWarnings(items: PromiseItem[], currentChapter: number, idleWindow = 5): string[] {
    const warnings: string[] = [];
    for (const item of items) {
        if (item.status === 'resolved' || item.status === 'dropped') continue;
        const expected = chapterNumber(item.expectedChapter);
        if (expected !== null && currentChapter >= expected) {
            warnings.push(`承诺「${item.name}」预期在 ${item.expectedChapter} 兑现，当前已到第${currentChapter}章`);
        }
        const last = chapterNumber(item.lastAdvancedChapter || item.openedChapter);
        if (last !== null && currentChapter - last >= idleWindow) {
            warnings.push(`承诺「${item.name}」已 ${currentChapter - last} 章未推进`);
        }
    }
    return warnings;
}

export function formatOpenPromisesForPrompt(items: PromiseItem[], currentChapter: number, limit = 8): string {
    const open = items
        .filter(i => i.status === 'open' || i.status === 'advanced')
        .sort((a, b) => {
            const ae = chapterNumber(a.expectedChapter) ?? 9999;
            const be = chapterNumber(b.expectedChapter) ?? 9999;
            return ae - be;
        })
        .slice(0, limit);
    if (open.length === 0) return '';
    const lines = ['【未兑现承诺】（本章必须推进或兑现至少一条；如不推进，说明原因）'];
    for (const item of open) {
        lines.push(`- ${item.name}（${item.type}，提出：${item.openedChapter || '?'}，预期：${item.expectedChapter || '未定'}，状态：${item.status === 'advanced' ? '有推进' : '未兑现'}${item.note ? `；${item.note}` : ''}）`);
    }
    const warnings = getPromiseWarnings(open, currentChapter);
    if (warnings.length > 0) {
        lines.push('【逾期/停滞提醒】');
        for (const w of warnings.slice(0, 5)) lines.push(`- ${w}`);
    }
    return lines.join('\n');
}
