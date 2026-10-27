/**
 * craft-constraints.ts — 正文生成期的工艺硬约束
 *
 * 这些内容放在 system prompt（或 systemTail），不放在可被预算裁剪的
 * extraTail 里，确保模型始终看到。
 */
import { AI_LEXICON } from './ai-lexicon';
import { AntiAIDetector } from './anti-ai-detector';

export const CRAFT_CONSTRAINT_MAX_CHARS = 1200;
export const NEGATIVE_LIST_MAX_CHARS = 600;

/** 通用小说工艺约束；与具体题材/设定无关。 */
export function buildCraftConstraintBlock(): string {
    return `【生成期工艺硬约束】
1. 具体性配额：每个场景至少 2 个可被五感验证的具体细节（物件/声音/气味/温度/身体感受），禁止用“气氛紧张/十分震撼”等抽象概括代替。
2. 情绪行为化：不得直接命名情绪（如“他感到愤怒/她非常悲伤”）；必须通过动作、生理反应、对话潜台词让读者自己判断。
3. 对话纪律：对话标签只用“说/问/答”等中性词，禁止“愤怒地说/冷冷地说道”等副词标签；每段对话必须推进剧情、揭露信息、塑造人物或改变关系中的至少一项。
4. 场景转折：每个场景必须发生一次可指认的转折（新信息/关系变化/目标受阻/决定改变），入场状态与离场状态不得相同。
5. 段落收束：禁止在段末写总结句、升华句、作者点评；场景结束停在动作、画面或未回答的问题上。
6. POV 纪律：只写视角人物能感知到的信息，不进入其他人物内心，不写视角人物不可能知道的事。
7. 节奏变化：长短句交替；连续三段不得使用相同句式开头；叙述与对话比例按场景目标调整，不得整章同一节奏。
8. 承接硬约束：本章开头必须承接上一章结尾的时间、地点、人物状态；任何跳变都必须写出过渡。`;
}

/**
 * 从现有 AI 味词库生成稳定、限长的生成期禁用清单。
 * 只取最有辨识度的短语/词/句式标签，避免 prompt 膨胀。
 */
export function buildNegativeConstraintBlock(): string {
    const phrases: string[] = [];
    const seen = new Set<string>();
    const push = (value: string) => {
        const v = (value || '').trim();
        if (!v || seen.has(v)) return;
        seen.add(v);
        phrases.push(v);
    };

    for (const phrase of AI_LEXICON.l2Phrases) push(phrase);
    for (const word of AntiAIDetector.AI_HIGH_FREQ_WORDS) push(word);

    const patternLabels = AI_LEXICON.l3Patterns.map(p => p.label);

    const header = '【生成期禁用清单】\n以下表达在正文中禁止使用；同义表达也不要换个说法重复：\n';
    const sentenceHeader = '\n禁用句式：';
    let text = header;
    for (const phrase of phrases) {
        const next = `${text}${text.endsWith('\n') ? '' : '、'}${phrase}`;
        if (next.length + sentenceHeader.length + patternLabels.join('；').length > NEGATIVE_LIST_MAX_CHARS) break;
        text = next;
    }
    const patterns = `\n禁用句式：${patternLabels.join('；')}`;
    if (text.length + patterns.length <= NEGATIVE_LIST_MAX_CHARS) {
        text += patterns;
    }
    return text;
}

/** 合并成一段可直接放进 system prompt 的工艺块。 */
export function buildCraftSystemBlock(): string {
    const craft = buildCraftConstraintBlock();
    const negative = buildNegativeConstraintBlock();
    const combined = `${craft}\n\n${negative}`;
    return combined.length <= CRAFT_CONSTRAINT_MAX_CHARS + NEGATIVE_LIST_MAX_CHARS
        ? combined
        : `${combined.slice(0, CRAFT_CONSTRAINT_MAX_CHARS + NEGATIVE_LIST_MAX_CHARS)}\n（清单已截断）`;
}
