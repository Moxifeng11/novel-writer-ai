/**
 * writing-rules-format.ts — 把结构化写作规则渲染成提示词文本
 *
 * 从 `co-writer-engine.ts` 抽出：那里原来直接 `mandatory.join('\n')`，对象被转成
 * `[object Object]` 注入协作文案（v4.23 修复）。抽成独立的纯函数后：
 * - 协作引擎与步骤链路都能复用；
 * - 单测不需要拖起整个引擎（co-writer-engine 的 import 链会加载 main.ts）。
 */

export interface WritingRuleItem {
    title?: string;
    description?: string;
    points?: string[];
}

/**
 * WritingRulesLike 类型定义。
 */
export interface WritingRulesLike {
    mandatory?: WritingRuleItem[];
    checklist?: string[];
    style?: string;
}

/**
 * RuleItem[] → `### 标题 / 说明 / - 要点`，空项自动跳过
 *
 * @param rules - 规则集
 * @returns 文本结果
 */
export function formatWritingRulesForPrompt(rules: WritingRulesLike | undefined): string {
    if (!rules) return '';
    const lines: string[] = [];
    for (const item of rules.mandatory || []) {
        const title = String(item?.title || '').trim();
        const description = String(item?.description || '').trim();
        const points = (item?.points || []).map((point) => String(point || '').trim()).filter(Boolean);
        if (title) lines.push(`### ${title}`);
        if (description) lines.push(description);
        for (const point of points) lines.push(`- ${point}`);
    }
    for (const item of rules.checklist || []) {
        const text = String(item || '').trim();
        if (text) lines.push(`- ${text}`);
    }
    return lines.join('\n');
}
