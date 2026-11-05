/**
 * evaluation-prompt.ts — 剧情完成度评估提示词（自 co-writer-engine.ts 抽出）
 *
 * 抽取前该方法直接读取 `this.snapshot` 与 `this.plotNodes`；现在把
 * 节点列表、章节目标、伏笔库全部改为显式入参，便于单测与快照复用。
 * 输出文本与抽取前逐字一致（原实现中 `foreshadowSection ? '' : ''`
 * 两个分支都产生空串并被 filter(Boolean) 丢弃，这里直接省略）。
 */
import type { ForeshadowItem } from '@/engine/context/context-types';
import type { PlotNode, PlotProgress } from './co-writer-types';

/** buildEvaluationPrompt 的显式入参。 */
export interface EvaluationPromptInput {
    /** 当前正文（只取末尾 1500 字） */
    body: string;
    /** 剧情节点进度 */
    progress: PlotProgress;
    /** 剧情节点列表（用于渲染状态行） */
    plotNodes: PlotNode[];
    /** 本章大纲/章节目标（截断 500 字） */
    chapterPlan: string;
    /** 未揭示伏笔（最多列 10 条） */
    unrevealed: ForeshadowItem[];
    /** 已揭示伏笔（最多列 5 条） */
    revealed: ForeshadowItem[];
}

/**
 * 构建剧情完成度评估提示词。
 *
 * @param input - 正文、进度、节点、章节目标与伏笔库
 * @returns 完整提示词文本
 *
 * @example
 * ```ts
 * const prompt = buildEvaluationPrompt({
 *     body, progress, plotNodes, chapterPlan,
 *     unrevealed: snapshot.foreshadows.unrevealed,
 *     revealed: snapshot.foreshadows.revealed,
 * });
 * ```
 */
export function buildEvaluationPrompt(input: EvaluationPromptInput): string {
    const { body, progress, plotNodes, chapterPlan, unrevealed, revealed } = input;
    const wordCount = body.length;

    const nodeList = plotNodes.map((node, i) => {
        const status = i < progress.currentIndex ? '✓ 已完成' : (i === progress.currentIndex ? '→ 进行中' : '○ 未开始');
        return `${i + 1}. [${status}] ${node.goal}${node.location ? `（${node.location}）` : ''}`;
    }).join('\n');

    let foreshadowSection = '';
    if (unrevealed.length > 0 || revealed.length > 0) {
        const lines: string[] = ['【伏笔库（请交叉比对正文中的伏笔埋设与回收情况）】'];
        if (unrevealed.length > 0) {
            lines.push('未揭示伏笔（应埋设/铺垫，尚未回收）：');
            unrevealed.slice(0, 10).forEach((item, i) => {
                lines.push(`  ${i + 1}. ${item?.name || '未命名'}（计划揭示：${item?.plannedReveal || '未定'}）`);
            });
        }
        if (revealed.length > 0) {
            lines.push('已揭示伏笔（已回收）：');
            revealed.slice(0, 5).forEach((item, i) => {
                lines.push(`  ${i + 1}. ${item?.name || '未命名'}（揭示章节：${item?.revealChapter || '?'}）`);
            });
        }
        foreshadowSection = lines.join('\n') + '\n';
    }

    return [
        '你是一个小说结构分析师。所有分析和建议必须使用中文输出。请评估当前正文的剧情完成度。',
        '',
        '【本章剧情节点（按顺序）】',
        nodeList || '（暂无节点信息）',
        '',
        '【章节目标】',
        chapterPlan.slice(0, 500) || '（暂无章节目标信息）',
        '',
        foreshadowSection,
        `【当前正文】（约 ${wordCount} 字符）`,
        body.slice(-1500),
        '',
        '请评估以下维度（各 0-100 分）：',
        '1. sceneObjectivesMet：场景目标完成度（基于剧情节点完成情况）',
        '2. characterArcsAdvanced：人物弧推进度（主角内心变化/成长推进了多少）',
        '3. foreshadowingSeeded：伏笔埋设程度（对比伏笔库，正文中实际埋设/推进了多少伏笔，是否有应回收而未回收的）',
        '4. emotionalArcProgress：情绪弧进度（情绪变化是否按预期推进）',
        '5. overallCompletion：总体完成度（综合以上所有维度的加权平均）',
        '',
        '请以 JSON 格式返回（不要包含 markdown 代码块标记）：',
        '{',
        '  "sceneObjectivesMet": 80,',
        '  "characterArcsAdvanced": 52,',
        '  "foreshadowingSeeded": 30,',
        '  "emotionalArcProgress": 65,',
        '  "overallCompletion": 57,',
        '  "suggestionAdvice": "一句话建议，指出当前最应该推进的内容",',
        '  "nextDirectionHints": ["action", "dialogue", "description"]',
        '}'
    ].filter(Boolean).join('\n');
}
