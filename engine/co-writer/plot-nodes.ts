/**
 * plot-nodes.ts — 剧情节点提取（自 co-writer-engine.ts 抽出）
 *
 * 只负责「从章节大纲/Scene 展开文本中提取 PlotNode 列表」这一件事：
 *  - 无引擎状态、无 this 依赖：显式传入 chapPlan / sceneExpansion 两个只读快照字段
 *  - 提取优先级（与抽取前完全一致）：
 *    1. 大纲摘要「## 关键场景」表格（| 序号 | 地点 | 人物 | 冲突 | 目标 | 信息增量 |）
 *    2. Scene 展开的「场景N」小节（location/characters/objective/conflict/info_increment 字段行）
 *    3. 都没有时回落「## 情节节点规划」列表（- 节点N：…）
 *
 * co-writer-engine.ts 中原私有方法已删除，调用点直接使用本模块的纯函数。
 */
import { splitTableCells } from '@/shared/chapter-table';
import { splitSceneSections } from '@/engine/scene-expander';
import type { PlotNode } from './co-writer-types';

/**
 * 提取 Markdown 中指定二级标题下的内容（纯函数，与抽取前行为完全一致）。
 *
 * 从首个匹配 headingRegex 的行之后开始收集，遇到下一个 `##`+ 标题行即停止，
 * 结果按行拼接并 trim。
 *
 * @param content - Markdown 全文
 * @param headingRegex - 匹配标题行的正则（如 /##\s*关键场景/i）
 * @returns 标题下的内容；找不到标题时返回 null
 * @example
 * ```ts
 * extractSection('## 关键场景\n| 1 | 客栈 | …\n## 其他', /##\s*关键场景/i);
 * // '| 1 | 客栈 | …'
 * ```
 */
export function extractSection(content: string, headingRegex: RegExp): string | null {
    const lines = content.split('\n');
    let start = -1;
    for (let i = 0; i < lines.length; i++) {
        if (headingRegex.test(lines[i])) {
            start = i + 1;
            break;
        }
    }
    if (start < 0) return null;
    const result: string[] = [];
    for (let i = start; i < lines.length; i++) {
        if (/^##+\s+/.test(lines[i])) break;
        result.push(lines[i]);
    }
    return result.join('\n').trim();
}

/**
 * 从大纲摘要和 Scene 展开中提取剧情节点（纯函数，与抽取前行为完全一致）。
 *
 * 三级回退：关键场景表格 > 场景展开小节 > 情节节点规划列表；
 * 节点 id 前缀分别对应 outline_ / scene_ / node_，completed 初始均为 false。
 *
 * @param chapPlan - 快照中的章节大纲（snapshot.chapPlan，可为空串）
 * @param sceneExpansion - 快照中的 Scene 展开文本（snapshot.sceneExpansion，可为空串）
 * @returns 按提取顺序排列的剧情节点列表（三个来源都无内容时为空数组）
 * @example
 * ```ts
 * const nodes = extractPlotNodes(outline, sceneExp);
 * // [{ id: 'outline_1', index: 1, location: '客栈', characters: '林秋',
 * //    conflict: '…', goal: '…', infoIncrement: '…', source: 'outline', completed: false }]
 * ```
 */
export function extractPlotNodes(chapPlan: string, sceneExpansion: string): PlotNode[] {
    const nodes: PlotNode[] = [];

    // 1. 从大纲摘要的"关键场景"表格提取
    const keySceneSection = extractSection(chapPlan, /##\s*关键场景/i);
    if (keySceneSection) {
        const tableRows = keySceneSection.match(/^\|\s*\d+\s*\|.*$/gm) || [];
        for (const row of tableRows) {
            const cells = splitTableCells(row);
            if (cells.length >= 3) {
                nodes.push({
                    id: `outline_${nodes.length + 1}`,
                    index: nodes.length + 1,
                    location: cells[1] || '',
                    characters: cells[2] || '',
                    conflict: cells[3] || '',
                    goal: cells[4] || cells[3] || '',
                    infoIncrement: cells[5] || '',
                    source: 'outline',
                    completed: false
                });
            }
        }
    }

    // 2. 从Scene展开中提取场景（兼容 ##/### 与 场景N/sceneN 标题）
    if (sceneExpansion) {
        for (const { heading, body } of splitSceneSections(sceneExpansion)) {
            const title = heading.name || `场景${heading.index}`;
            const locationMatch = body.match(/(?:location|场景地点|地点)\s*[：:]\s*([^\n]+)/i);
            const charMatch = body.match(/(?:characters|出场人物|人物)\s*[：:]\s*([^\n]+)/i);
            const goalMatch = body.match(/(?:objective|叙事目标|场景目标|核心事件)\s*[：:]\s*([^\n]+)/i);
            const conflictMatch = body.match(/conflict\s*[：:]\s*([^\n]+)/i);
            const infoMatch = body.match(/(?:info_increment|信息增量)\s*[：:]\s*([^\n]+)/i);

            nodes.push({
                id: `scene_${heading.index}`,
                index: nodes.length + 1,
                location: locationMatch ? locationMatch[1].trim() : '',
                characters: charMatch ? charMatch[1].trim() : '',
                conflict: conflictMatch ? conflictMatch[1].trim() : '',
                goal: goalMatch ? goalMatch[1].trim() : title,
                infoIncrement: infoMatch ? infoMatch[1].trim() : '',
                source: 'scene_expand',
                completed: false
            });
        }
    }

    // 3. 如果都没有，从情节蒸馏的"情节节点规划"提取
    if (nodes.length === 0) {
        const nodeSection = extractSection(chapPlan, /##\s*情节节点规划/i);
        if (nodeSection) {
            const nodeMatches = nodeSection.match(/^-\s*节点\d+[：:]\s*.+$/gm) || [];
            let idx = 0;
            for (const m of nodeMatches) {
                idx++;
                const text = m.replace(/^-\s*节点\d+[：:]\s*/, '').trim();
                nodes.push({
                    id: `node_${idx}`,
                    index: idx,
                    location: '',
                    characters: '',
                    conflict: '',
                    goal: text,
                    infoIncrement: '',
                    source: 'plot_distill',
                    completed: false
                });
            }
        }
    }

    return nodes;
}
