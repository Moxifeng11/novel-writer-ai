/**
 * revision-prompts.ts — 定向修订的维度提示词
 */
import type { RevisionDimension, RevisionIssue } from './revision-types';
import { buildCraftConstraintBlock } from '../craft-constraints';

const DIMENSION_RULES: Record<RevisionDimension, string> = {
    dialogue: `只改对话：
- 删除“愤怒地说/冷冷地说道”等副词标签，用动作、停顿、沉默替代。
- 每段对话必须有功能：推进剧情/揭露信息/塑造人物/改变关系。
- 保留人物原有称呼、语气和口头禅，不把所有人改成同一种声音。`,
    rhythm: `只改节奏：
- 长短句交替；连续三段不要用相同句式开头。
- 拖沓处压缩重复信息；仓促处补一个动作或感官停顿。
- 不改变事件顺序和情节节点。`,
    description: `只改描写：
- 把抽象概括换成可被五感验证的具体细节（物件/声音/气味/温度/身体感受）。
- 删除堆叠形容词和空泛比喻；每个场景至少保留 2 个具体细节。
- 不新增设定，不改变场景地点与时间。`,
    hook: `只改开篇/结尾钩子：
- 开篇第一段必须尽快出现具体动作、异常或问题，不写背景介绍。
- 结尾停在动作、画面或未回答的问题上，不写总结句和升华句。
- 不新增下一章才该发生的事件。`,
    continuity: `只改连续性：
- 修正与上一章状态、人物位置、已知信息、时间线、伏笔状态冲突的句子。
- 不删除必要情节；无法在不改情节的前提下修正时，只标注“需人工确认”，不要编造新设定。
- 保持人物状态变化有过渡。`,
    style: `只改文风/AI 味：
- 删除模板短语、套话、重复连接词和“不是A而是B”句式。
- 用具体动作和细节替代直接命名情绪。
- 保持原叙述视角和人物声音，不把文字改成另一种风格。`,
};

/**
 * 构建按维度修订的系统提示词。
 *
 * @param dimension - 维度
 * @returns 提示词
 */
export function buildRevisionSystemPrompt(dimension: RevisionDimension): string {
    return `你是小说修订师。你只负责【${DIMENSION_RULES[dimension].split('\n')[0]}】这一维度。

【硬规则】
1. 只修改用户给出的文本片段，不续写、不解释、不加标题。
2. 不改变情节走向、人物关系、世界观设定和场景顺序。
3. 修订后字数保持在原文的 70%-130%；不要整段删掉。
4. 保留原叙述视角（POV）和人物称呼。
5. 输出必须是可直接替换原文的纯文本，不要 Markdown 代码块，不要“修改说明”。

${DIMENSION_RULES[dimension]}

${buildCraftConstraintBlock()}`;
}

export function buildRevisionUserPrompt(
    dimension: RevisionDimension,
    excerpt: string,
    issues: RevisionIssue[],
    context?: { before?: string; after?: string; sceneCard?: string },
): string {
    const relevant = issues.filter(i => i.dimension === dimension).slice(0, 6);
    const lines: string[] = [];
    if (context?.sceneCard) {
        lines.push('【场景卡（不得改变）】');
        lines.push(context.sceneCard.slice(0, 800));
        lines.push('');
    }
    if (context?.before) {
        lines.push('【前文（只用于保持衔接，不要修改）】');
        lines.push(context.before.slice(-500));
        lines.push('');
    }
    lines.push('【需要修订的文本片段】');
    lines.push(excerpt);
    lines.push('');
    if (relevant.length > 0) {
        lines.push('【必须解决的问题】');
        for (const issue of relevant) {
            lines.push(`- ${issue.evidence}${issue.suggestion ? `（建议：${issue.suggestion}）` : ''}`);
        }
        lines.push('');
    }
    if (context?.after) {
        lines.push('【后文（只用于保持衔接，不要修改）】');
        lines.push(context.after.slice(0, 500));
        lines.push('');
    }
    lines.push('只输出修订后的文本片段。');
    return lines.join('\n');
}
