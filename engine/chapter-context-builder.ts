import { App, TFile, parseFrontMatterStringArray } from 'obsidian';
import { splitTableCells } from '@/shared/chapter-table';
import { ChapterFrontmatter } from '@/shared/types';

/**
 * 从章节正文文件的 frontmatter 中提取涉及人物、地点、势力、物品功法列表
 * 使用 metadataCache 零 I/O 读取
 * @param app - Obsidian 应用实例
 * @param bodyFile - 正文文件
  * @returns string[] } 结果
 */
export function getInvolvedEntities(
    app: App,
    bodyFile: TFile | null
): { chars: string[]; locs: string[]; factions: string[]; items: string[] } {
    const empty = { chars: [] as string[], locs: [] as string[], factions: [] as string[], items: [] as string[] };
    if (!bodyFile) return empty;

    const cache = app.metadataCache.getFileCache(bodyFile);
    if (!cache?.frontmatter) return empty;

    return {
        chars: parseFrontMatterStringArray(cache.frontmatter, '涉及人物') || [],
        locs: parseFrontMatterStringArray(cache.frontmatter, '涉及地点') || [],
        factions: parseFrontMatterStringArray(cache.frontmatter, '涉及势力') || [],
        items: parseFrontMatterStringArray(cache.frontmatter, '涉及物品功法') || [],
    };
}

/**
 * 获取人物的一行状态摘要（用于非涉及实体的精简展示）。
 * 格式：- [[角色名]]：当前状态=XXX\n
 * @param content - 内容
 * @param name - 名称
 * @returns 文本结果
 */
export function getEntityStatusLine(content: string, name: string): string {
    const fm = content.match(/^---\n([\s\S]*?)\n---/);
    if (!fm) return `- [[${name}]]：当前状态=—\n`;
    const match = fm[1].match(/当前状态:\s*["']?(.+?)["']?(\n|$)/);
    const status = match ? match[1].trim() : '—';
    return `- [[${name}]]：当前状态=${status}\n`;
}

/**
 * 按章号过滤伏笔——只注入当前章相关的伏笔到提示词上下文
 * @param foreshadowTable - 伏笔表
 * @param currentChapter - 当前章节
  * @returns string } 结果
 */
export function filterForeshadowsByChapter(
    foreshadowTable: string,
    currentChapter: number
): { relevant: string; summary: string } {
    if (!foreshadowTable) return { relevant: '', summary: '' };

    const lines = foreshadowTable.split('\n');

    // ---- 1. 按列标题匹配，找到"计划回收"列的索引 ----
    let headerIdx = -1;
    let planRevealCol = -1;
    let nameCol = -1;
    let statusCol = -1;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line.startsWith('|')) continue;
        const cols = splitTableCells(line);
        if (cols.some(c => c.includes('伏笔名称') || c.includes('计划回收'))) {
            headerIdx = i;
            for (let j = 0; j < cols.length; j++) {
                const col = cols[j];
                if (col.includes('计划回收')) planRevealCol = j;
                else if (col.includes('伏笔名称')) nameCol = j;
                else if (col.includes('状态') || col.includes('当前状态')) statusCol = j;
            }
            break;
        }
    }

    // 未找到表头 → 按固定6列格式兜底（# | 伏笔名称 | 重要程度 | 埋设章节 | 计划回收 | 当前状态）
    if (planRevealCol === -1) {
        planRevealCol = 4;
        nameCol = 1;
        statusCol = 5;
        headerIdx = -1; // 没有表头行，从第0行开始
    }

    // ---- 2. 遍历数据行 ----
    const relevantNames: string[] = [];
    let otherCount = 0;

    for (let i = (headerIdx >= 0 ? headerIdx + 1 : 0); i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line.startsWith('|')) continue;
        const cols = splitTableCells(line);
        if (cols.length === 0) continue;

        const first = cols[0] || '';
        // 跳过表头分隔行、标题行
        if (first.includes('---') || first === '#' || first === '伏笔') continue;

        // 只处理未揭示的伏笔
        const status = (statusCol >= 0 && statusCol < cols.length) ? (cols[statusCol] || '') : '';
        if (status.includes('已揭示') || status.includes('揭示')) continue;

        const plannedReveal = (planRevealCol >= 0 && planRevealCol < cols.length)
            ? (cols[planRevealCol] || '')
            : '';
        const name = (nameCol >= 0 && nameCol < cols.length)
            ? (cols[nameCol] || '')
            : '';

        const chMatch = plannedReveal.match(/第(\d+)章/);
        const revealChNum: number | null = chMatch ? parseInt(chMatch[1], 10) : null;

        if (revealChNum === null) {
            // 无法解析章号（如"待揭示"、"关键转折点"）→ 保守策略，归入 relevant
            relevantNames.push(name);
        } else if (
            revealChNum === currentChapter ||       // 当前章揭示
            revealChNum < currentChapter ||          // 已过期未揭示，紧急
            revealChNum <= currentChapter + 3        // 3章内即将到期
        ) {
            relevantNames.push(name);
        } else {
            otherCount++;
        }
    }

    // ---- 3. 构建输出 ----
    const relevant = relevantNames.length > 0
        ? relevantNames.map(n => `\n- ${n}`).join('')
        : '';
    const summary = otherCount > 0
        ? `（另有 ${otherCount} 条未揭示伏笔，计划在其他章节揭示）`
        : '';

    return { relevant, summary };
}
