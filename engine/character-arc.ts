/**
 * character-arc.ts — 角色弧线表
 *
 * 与角色灵魂（静态欲望/恐惧/创伤）互补：弧线表记录 want/need/lie 与阶段推进，
 * 用于信息规划声明“本章推进谁、从哪到哪”，质量控制检查变化是否可见。
 */
export interface CharacterArcRow {
    name: string;
    want: string;
    need: string;
    lie: string;
    stage: string;
    chapterChange: string;
    updatedChapter: string;
}

export const ARC_TABLE_HEADER = '| 角色 | 想要(want) | 需要(need) | 谎言/信念(lie) | 弧线阶段 | 本章推进 | 最近更新 |';
export const ARC_TABLE_SEPARATOR = '|---|---|---|---|---|---|---|';

export const DEFAULT_CHARACTER_ARC_TABLE = `# 角色弧线

> want=角色以为自己要的；need=角色真正需要的；lie=角色相信的错误信念。
> 分析报告用 ARC: 角色 | 阶段前 | 阶段后 | 触发事件 | 是否可见 更新。

${ARC_TABLE_HEADER}
${ARC_TABLE_SEPARATOR}
`;

export function parseCharacterArcTable(content: string): CharacterArcRow[] {
    if (!content) return [];
    const rows: CharacterArcRow[] = [];
    for (const line of content.split(/\r?\n/)) {
        const cells = line.split('|').map(c => c.trim());
        if (cells.length < 9) continue;
        const name = cells[1];
        if (!name || name.includes('角色') || name.includes('---')) continue;
        rows.push({
            name,
            want: cells[2],
            need: cells[3],
            lie: cells[4],
            stage: cells[5],
            chapterChange: cells[6],
            updatedChapter: cells[7],
        });
    }
    return rows;
}

export function formatCharacterArcTable(rows: CharacterArcRow[]): string {
    const body = rows.map(r =>
        `| ${r.name} | ${r.want} | ${r.need} | ${r.lie} | ${r.stage} | ${r.chapterChange} | ${r.updatedChapter} |`,
    ).join('\n');
    return `# 角色弧线\n\n> want=角色以为自己要的；need=角色真正需要的；lie=角色相信的错误信念。\n> 分析报告用 ARC: 角色 | 阶段前 | 阶段后 | 触发事件 | 是否可见 更新。\n\n${ARC_TABLE_HEADER}\n${ARC_TABLE_SEPARATOR}\n${body}${body ? '\n' : ''}`;
}

/** 从角色 frontmatter 建骨架；缺字段留空，不编造。 */
export function buildArcRowsFromCharacters(
    characters: Array<{ name: string; motivation?: string; fear?: string; weakness?: string; stage?: string }>,
): CharacterArcRow[] {
    return characters
        .filter(c => c.name)
        .map(c => ({
            name: c.name,
            want: c.motivation || '',
            need: '',
            lie: c.fear || c.weakness || '',
            stage: c.stage || '未定义',
            chapterChange: '',
            updatedChapter: '',
        }));
}

export function applyArcInstruction(
    rows: CharacterArcRow[],
    arc: { name: string; from: string; to: string; trigger: string; visible: string },
    chapter: string,
): CharacterArcRow[] {
    const next = rows.map(r => ({ ...r }));
    let row = next.find(r => r.name === arc.name);
    if (!row) {
        row = { name: arc.name, want: '', need: '', lie: '', stage: '未定义', chapterChange: '', updatedChapter: '' };
        next.push(row);
    }
    if (arc.from && row.stage === '未定义') row.stage = arc.from;
    if (arc.to) row.stage = arc.to;
    row.chapterChange = `${arc.from || '?'}→${arc.to || '?'}；${arc.trigger || ''}${arc.visible ? `；可见性：${arc.visible}` : ''}`;
    row.updatedChapter = chapter;
    return next;
}

export function formatArcsForPrompt(rows: CharacterArcRow[], relevantNames: Set<string>, limit = 6): string {
    const selected = rows
        .filter(r => relevantNames.size === 0 || relevantNames.has(r.name))
        .slice(0, limit);
    if (selected.length === 0) return '';
    const lines = ['【角色弧线】（本章必须推进至少一条，并让变化在正文中可见）'];
    for (const r of selected) {
        lines.push(`- ${r.name}：want=${r.want || '未定'}；need=${r.need || '未定'}；lie=${r.lie || '未定'}；当前阶段=${r.stage || '未定义'}；上次推进=${r.updatedChapter || '无'}`);
    }
    return lines.join('\n');
}
