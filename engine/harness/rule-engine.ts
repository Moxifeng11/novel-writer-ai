/**
 * rule-engine.ts - harness rule model, compilation and local validation.
 *
 * Rules are first-class objects with id/scope/severity/source. Prompt text is
 * injected once per task; validators are pure functions and never call AI.
 */
import type { CreationMode } from '../../shared/creation-mode';

/**
 * 规则作用域。
 */
export type RuleScope = 'global' | 'planning' | 'body' | 'quality' | 'analysis';
/**
 * 规则严重度。
 */
export type RuleSeverity = 'must' | 'should' | 'hint';

/**
 * 规则违规。
 */
export interface RuleViolation {
    ruleId: string;
    severity: RuleSeverity;
    message: string;
}

/**
 * 规则定义。
 */
export interface Rule {
    id: string;
    mode: CreationMode | 'all';
    scope: RuleScope;
    severity: RuleSeverity;
    source: 'writing-rules' | 'creation-mode' | 'platform' | 'anti-ai';
    promptText: string;
    validate?: (output: string, ctx: RuleValidationContext) => RuleViolation | RuleViolation[] | null;
}

/**
 * 规则校验上下文。
 */
export interface RuleValidationContext {
    mode: CreationMode;
    scope: RuleScope;
    targetWords?: number;
    unitLabel?: string;
}

/**
 * 编译后的规则集。
 */
export interface CompiledRules {
    rules: Rule[];
    promptBlock: string;
}

/**
 * 规则引擎输入。
 */
export interface RuleEngineInput {
    mode: CreationMode;
    scope: RuleScope;
    writingRules?: string;
    creationModePrompt?: string;
    antiAiRules?: string[];
    extraRules?: Rule[];
}

function writingRulesToPrompt(writingRules?: string): string {
    const text = String(writingRules || '').trim();
    if (!text) return '';
    return `【项目写作规则】\n${text}`;
}

function antiAiToPrompt(rules?: string[]): string {
    const list = (rules || []).map(item => `- ${item}`).join('\n');
    return list ? `【AI 痕迹约束】\n${list}` : '';
}

const DEFAULT_LENGTH_RULE: Rule = {
    id: 'harness.length.min',
    mode: 'all',
    scope: 'body',
    severity: 'must',
    source: 'platform',
    promptText: '输出不得明显低于目标字数；不足时优先补足冲突与细节，不注水。',
    validate: (output, ctx) => {
        const target = ctx.targetWords || 0;
        if (!target) return null;
        const min = Math.floor(target * 0.7);
        const length = output.replace(/\s/g, '').length;
        if (length >= min) return null;
        return {
            ruleId: 'harness.length.min',
            severity: 'must',
            message: `输出 ${length} 字，低于最低要求 ${min} 字`,
        };
    },
};

const DEFAULT_META_RULE: Rule = {
    id: 'harness.output.no-meta',
    mode: 'all',
    scope: 'body',
    severity: 'must',
    source: 'platform',
    promptText: '只输出正文或要求的结构化内容；不要解释、不要总结、不要“好的，我将…”。',
    validate: (output) => {
        const head = output.slice(0, 120);
        if (/^(好的|好的，|我将|我会|以下是|下面是)/.test(head.trim())) {
            return {
                ruleId: 'harness.output.no-meta',
                severity: 'must',
                message: '输出以模型叙述开头，需要剥离元文本',
            };
        }
        return null;
    },
};

/**
 * 规则引擎。
 */
export class RuleEngine {
    /**
     * 编译规则。
     *
     * @param input - 输入
     * @returns 编译结果
     */
    compile(input: RuleEngineInput): CompiledRules {
        const rules: Rule[] = [...(input.extraRules || [])];
        if (input.scope === 'body') {
            rules.push(DEFAULT_LENGTH_RULE, DEFAULT_META_RULE);
        }

        const blocks: string[] = [];
        const writing = writingRulesToPrompt(input.writingRules);
        if (writing) blocks.push(writing);
        const modePrompt = String(input.creationModePrompt || '').trim();
        if (modePrompt) blocks.push(modePrompt);
        const antiAi = antiAiToPrompt(input.antiAiRules);
        if (antiAi) blocks.push(antiAi);
        const seenExtra = new Set<string>();
        for (const rule of rules) {
            if (rule.mode !== 'all' && rule.mode !== input.mode) continue;
            if (!rule.promptText) continue;
            const dedupeKey = rule.promptText.trim();
            if (seenExtra.has(dedupeKey)) continue;
            seenExtra.add(dedupeKey);
            blocks.push(`- ${dedupeKey}`);
        }

        // 去重时保留较长的写作规则块；若写作规则块本身包含规则文本，则优先只保留规则块。
        const uniqueBlocks = Array.from(new Set(blocks.filter(Boolean)));
        const filteredBlocks = uniqueBlocks.filter(block => {
            if (block.startsWith('【')) return true;
            return !uniqueBlocks.some(other => other !== block && other.includes(block));
        });
        const promptBlock = filteredBlocks.join('\n\n');
        return { rules, promptBlock };
    }

    /**
     * 校验文本是否违规。
     *
     * @param rules - 规则集
     * @param output - 输出
     * @param ctx - 上下文
     * @returns 违规数组
     */
    validate(rules: Rule[], output: string, ctx: RuleValidationContext): RuleViolation[] {
        const violations: RuleViolation[] = [];
        for (const rule of rules) {
            if (rule.mode !== 'all' && rule.mode !== ctx.mode) continue;
            if (!rule.validate) continue;
            const result = rule.validate(output, ctx);
            if (!result) continue;
            if (Array.isArray(result)) violations.push(...result);
            else violations.push(result);
        }
        return violations;
    }
}
