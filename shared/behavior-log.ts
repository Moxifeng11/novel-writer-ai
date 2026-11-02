/**
 * behavior-log.ts — 角色按章行为摘要（出场记录）
 *
 * 对标云笔 AI 的 characters 模型：角色不是一张静态卡，而是
 * 「档案 + 按章行为摘要」——每章结算时从分析报告抽取
 * 「CHARACTER_BEHAVIOR: 角色名 | 本章做了什么」，按（章节, 角色）
 * 去重合并到 `01-世界架构/人物/出场记录.md`。
 *
 * 与角色识别流水线的区别：识别流水线按需触发、面向审核；
 * 这里走结算链路，每章自动落一份结构化摘要，供续写上下文与
 * 「角色最近做了什么」查询使用。
 *
 * 纯函数，不依赖 Obsidian。
 */

export interface BehaviorRow {
    /** 章节显示名，如「第12章」 */
    chapter: string;
    /** 章号，用于排序；解析失败为 0 */
    chapterNum: number;
    /** 角色名 */
    name: string;
    /** 本章行为摘要（一句话） */
    summary: string;
}

export const BEHAVIOR_LOG_TITLE = '# 角色出场记录';
export const BEHAVIOR_LOG_COLUMNS = ['章节', '角色', '本章行为摘要'] as const;

function parseChapterNum(chapter: string): number {
    const matched = String(chapter || '').match(/第\s*(\d+)\s*[章节集回幕]/);
    return matched ? parseInt(matched[1], 10) : 0;
}

/**
 * 解析出场记录文件内容；空文件/无表格返回空数组
 *
 * @param content - 内容
 * @returns 结果数组
 */
export function parseBehaviorLog(content: string): BehaviorRow[] {
    const rows: BehaviorRow[] = [];
    for (const line of String(content || '').replace(/\r\n/g, '\n').split('\n')) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('|')) continue;
        const cells = trimmed.split('|').slice(1, -1).map((cell) => cell.trim());
        if (cells.length < 3) continue;
        // 跳过表头与分隔行
        if (cells[0] === '章节' || /^[-:\s]+$/.test(cells[0])) continue;
        rows.push({
            chapter: cells[0],
            chapterNum: parseChapterNum(cells[0]),
            name: cells[1],
            summary: cells[2],
        });
    }
    return rows;
}

/**
 * 合并现有记录与本章新记录。
 * 去重键 = (章号, 角色名)（v4.25：改用数字章号，不再用「章节」字符串——章名带标题/格式
 * 变化就会重复一行）；本章新摘要**直接覆盖**旧摘要（最新优先，不比长短——旧实现会
 * 用被改短的旧摘要压制新的短摘要，矛盾长期存在）。
 * @param existing - 已有
 * @param incoming - 输入
 * @returns 结果数组
 */
export function mergeBehaviorRows(existing: BehaviorRow[], incoming: BehaviorRow[]): BehaviorRow[] {
    const byKey = new Map<string, BehaviorRow>();
    for (const row of existing) {
        if (!row.name || !row.summary) continue;
        byKey.set(`${row.chapterNum}\u0000${row.name}`, row);
    }
    for (const row of incoming) {
        if (!row.name || !row.summary) continue;
        byKey.set(`${row.chapterNum}\u0000${row.name}`, row);
    }
    return [...byKey.values()].sort((a, b) => {
        if (a.chapterNum !== b.chapterNum) return a.chapterNum - b.chapterNum;
        return a.name.localeCompare(b.name, 'zh-Hans-CN');
    });
}

/**
 * 序列化为完整文件内容（覆盖写语义）
 *
 * @param rows - 行列表
 * @returns 文本结果
 */
export function formatBehaviorLog(rows: BehaviorRow[]): string {
    const lines = [
        BEHAVIOR_LOG_TITLE,
        '',
        '> 每章结算时自动追加：角色在本章做了什么。供续写上下文与进度查询使用。',
        '',
        `| ${BEHAVIOR_LOG_COLUMNS.join(' | ')} |`,
        `|${BEHAVIOR_LOG_COLUMNS.map(() => '---').join('|')}|`,
    ];
    for (const row of rows) {
        lines.push(`| ${row.chapter} | ${row.name} | ${row.summary.replace(/\|/g, '／')} |`);
    }
    return `${lines.join('\n')}\n`;
}

/**
 * 从分析报告的 CHARACTER_BEHAVIOR 指令行构造本章记录
 *
 * @param chapter - 章节
 * @param behaviors - 行为列表
 * @returns 结果数组
 */
export function buildChapterBehaviorRows(
    chapter: string,
    behaviors: Array<{ name: string; summary: string }>,
): BehaviorRow[] {
    return behaviors
        .filter((item) => String(item.name || '').trim() && String(item.summary || '').trim())
        .map((item) => ({
            chapter,
            chapterNum: parseChapterNum(chapter),
            name: item.name.trim(),
            summary: item.summary.trim(),
        }));
}
