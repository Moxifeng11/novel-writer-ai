/**
 * overflow-recovery.ts — 上下文溢出恢复（不静默硬截断）
 *
 * 流程：预算计划 → 定向补检（可选）→ 确定性抽取压缩 → 重组去重 → 仍超则显式报错。
 * 抽取压缩保原文顺序、优先保留含在场人物/场景词的句子，并标注保留比例。
 * 不调用模型，结果按内容哈希缓存。
 */
import { estimateTokens } from '@/shared/token-estimator';
import { splitSentences } from '@/shared/character-rules';
import { truncateTextToTokensTail } from '@/shared/prompt-budget';
import {
    applyCompression,
    compressionOrder,
    planContextBudget,
    type ContextBudgetPlan,
    type ContextSectionPlan,
} from '@/shared/context/budget-plan';

/** 压缩模式 */
export type ContextCompressionMode = 'extractive' | 'off';

/** 溢出错误（调用方据此阻断并给出可操作提示，而不是发送被腰斩的 prompt） */
export class ContextOverflowError extends Error {
    readonly deficit: number;
    readonly maxInputTokens: number;
    readonly sections: string[];
    readonly suggestions: string[];

    constructor(deficit: number, maxInputTokens: number, sections: string[]) {
        const suggestions = [
            '提高「上下文 token 上限」（设置 → 写作 → 上下文预算）',
            '关闭可选增强模块（知识注入 / 指纹样章 / 关联查询）',
            '缩小本步输出上限或改用更大窗口的模型',
        ];
        super(`上下文超预算 ${deficit} token（上限 ${maxInputTokens}）：${sections.join('、') || '未知段落'}。${suggestions.join('；')}`);
        this.name = 'ContextOverflowError';
        this.deficit = deficit;
        this.maxInputTokens = maxInputTokens;
        this.sections = sections;
        this.suggestions = suggestions;
    }
}

/** 抽取压缩结果 */
export interface ExtractiveResult {
    text: string;
    keptSentences: number;
    totalSentences: number;
    tokens: number;
    compressed: boolean;
}

const compressionCache = new Map<string, ExtractiveResult>();
const CACHE_LIMIT = 200;

/**
 * FNV-1a 32 位哈希
 *
 * @param text - 输入
 * @returns 十六进制
 */
function fnv1a(text: string): string {
    let hash = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16);
}

/**
 * 确定性抽取压缩：按句子打分、保留原文顺序、首尾句优先。
 *
 * @param text - 原文
 * @param maxTokens - 目标 token
 * @param focusTerms - 在场人物/场景关键词
 * @param modelId - 模型
 * @returns ExtractiveResult
 */
export function compressExtractive(
    text: string,
    maxTokens: number,
    focusTerms: string[] = [],
    modelId = 'default',
): ExtractiveResult {
    const source = String(text ?? '');
    if (!source.trim()) return { text: '', keptSentences: 0, totalSentences: 0, tokens: 0, compressed: false };
    if (estimateTokens(source, modelId) <= maxTokens) {
        return {
            text: source,
            keptSentences: 0,
            totalSentences: 0,
            tokens: estimateTokens(source, modelId),
            compressed: false,
        };
    }

    const cacheKey = `${fnv1a(source)}|${maxTokens}|${focusTerms.join(',')}|${modelId}`;
    const cached = compressionCache.get(cacheKey);
    if (cached) return cached;

    const sentences = splitSentences(source);
    if (sentences.length <= 2) {
        const tail = truncateTextToTokensTail(source, maxTokens, modelId);
        const result: ExtractiveResult = {
            text: tail, keptSentences: 1, totalSentences: sentences.length,
            tokens: estimateTokens(tail, modelId), compressed: true,
        };
        remember(cacheKey, result);
        return result;
    }

    const terms = focusTerms.map((term) => term.trim()).filter((term) => term.length >= 2);
    const scoreOf = (sentence: string, index: number): number => {
        let score = 0;
        for (const term of terms) {
            if (sentence.includes(term)) score += 3;
        }
        if (index === 0) score += 4;
        if (index === sentences.length - 1) score += 5;
        if (/[“”「」]|说道|问道|答道/.test(sentence)) score += 1;
        return score;
    };

    const selected = new Set<number>([0, sentences.length - 1]);
    let used = estimateTokens(`${sentences[0]}\n\n${sentences[sentences.length - 1]}`, modelId) + 8;
    const ranked = sentences
        .map((sentence, index) => ({ index, sentence, score: scoreOf(sentence, index) }))
        .filter((item) => item.index !== 0 && item.index !== sentences.length - 1)
        .sort((a, b) => b.score - a.score || a.index - b.index);
    for (const item of ranked) {
        const cost = estimateTokens(item.sentence, modelId) + 2;
        if (used + cost > maxTokens) continue;
        selected.add(item.index);
        used += cost;
    }

    let kept = sentences.filter((_, index) => selected.has(index));
    let output = kept.join('\n\n');
    let marker = `\n\n〔压缩：保留 ${kept.length}/${sentences.length} 句，按原文顺序〕`;
    let tokens = estimateTokens(output + marker, modelId);
    // 标记本身超预算时继续丢中间句
    while (tokens > maxTokens && kept.length > 2) {
        kept = [kept[0], ...kept.slice(2, -1), kept[kept.length - 1]];
        output = kept.join('\n\n');
        marker = `\n\n〔压缩：保留 ${kept.length}/${sentences.length} 句，按原文顺序〕`;
        tokens = estimateTokens(output + marker, modelId);
    }
    if (tokens > maxTokens) {
        output = truncateTextToTokensTail(`${output}${marker}`, maxTokens, modelId);
        tokens = estimateTokens(output, modelId);
    }

    const result: ExtractiveResult = {
        text: `${output}${output.includes('〔压缩：') ? '' : marker}`,
        keptSentences: kept.length,
        totalSentences: sentences.length,
        tokens,
        compressed: true,
    };
    remember(cacheKey, result);
    return result;
}

/**
 * 写缓存（上限 200，超限清最早）
 *
 * @param key - 键
 * @param value - 结果
 */
function remember(key: string, value: ExtractiveResult): void {
    if (compressionCache.size >= CACHE_LIMIT) {
        const first = compressionCache.keys().next().value;
        if (first) compressionCache.delete(first);
    }
    compressionCache.set(key, value);
}

/** 恢复输入 */
export interface OverflowRecoveryInput {
    system: string;
    user: string;
    extraTail?: string;
    maxInputTokens: number;
    focusTerms?: string[];
    modelId?: string;
    mode?: ContextCompressionMode;
    /** 定向补检：缺口 token 数 → 额外文本（可空） */
    retrieve?: (deficit: number) => Promise<string>;
}

/** 恢复结果 */
export interface OverflowRecoveryResult {
    system: string;
    user: string;
    extraTail: string;
    plan: ContextBudgetPlan;
    report: string;
    retrieved: boolean;
}

/**
 * 按 `【标题】` 切分 user prompt；required 段不允许整段丢。
 *
 * @param user - user prompt
 * @returns 段落
 */
function splitUserSections(user: string): Array<Omit<ContextSectionPlan, 'currentTokens'>> {
    const text = String(user ?? '');
    const matches = [...text.matchAll(/^【([^】]+)】/gm)];
    if (matches.length === 0) {
        return [{ key: 'user', role: 'required', priority: 10, minTokens: 200, shrinkable: true, text }];
    }
    const sections: Array<Omit<ContextSectionPlan, 'currentTokens'>> = [];
    for (let i = 0; i < matches.length; i++) {
        const start = matches[i].index ?? 0;
        const end = i + 1 < matches.length ? (matches[i + 1].index ?? text.length) : text.length;
        const title = matches[i][1];
        const required = /世界观|设定库|人物|大纲|Scene|场景|信息规划|写作规则|输出格式|正文|本章|必须|风格/.test(title);
        sections.push({
            key: title,
            role: required ? 'required' : 'optional',
            priority: required ? 10 : 5,
            minTokens: required ? 200 : 40,
            shrinkable: true,
            text: text.slice(start, end),
        });
    }
    return sections;
}

/**
 * 溢出恢复：补检 → 抽取压缩 → 重组；仍超抛 ContextOverflowError。
 *
 * @param input - 输入
 * @returns 恢复结果
 */
export async function recoverOverflow(input: OverflowRecoveryInput): Promise<OverflowRecoveryResult> {
    const modelId = input.modelId ?? 'default';
    const mode = input.mode ?? 'extractive';
    const extraTail = String(input.extraTail ?? '');
    const sections = splitUserSections(input.user);
    if (extraTail) {
        sections.push({ key: 'extraTail', role: 'optional', priority: 1, minTokens: 40, shrinkable: true, text: extraTail });
    }
    let plan = planContextBudget(sections, input.maxInputTokens, modelId);
    const systemTokens = estimateTokens(input.system, modelId);
    if (systemTokens >= input.maxInputTokens) {
        throw new ContextOverflowError(input.maxInputTokens - systemTokens + 1, input.maxInputTokens, ['system']);
    }
    if (plan.deficit <= 0) {
        return { system: input.system, user: input.user, extraTail, plan, report: '', retrieved: false };
    }
    if (mode === 'off') {
        throw new ContextOverflowError(plan.deficit, input.maxInputTokens, plan.sections.map((section) => section.key));
    }

    // 1) 定向补检：只补缺口，并计入预算（不额外挤爆）
    let retrievedText = '';
    let retrieved = false;
    if (input.retrieve) {
        try {
            const raw = String(await input.retrieve(plan.deficit) ?? '');
            if (raw.trim()) {
                retrievedText = compressExtractive(raw, Math.max(40, plan.deficit), input.focusTerms ?? [], modelId).text;
                retrieved = Boolean(retrievedText);
                if (retrievedText) {
                    sections.push({
                        key: 'retrieved', role: 'optional', priority: 2, minTokens: 20, shrinkable: false, text: retrievedText,
                    });
                    plan = planContextBudget(sections, input.maxInputTokens, modelId);
                }
            }
        } catch {
            retrievedText = '';
        }
    }

    // 2) 抽取压缩：先 optional（低优先级优先），再 required
    const compressed = new Map<string, string>();
    for (const section of compressionOrder(plan)) {
        if (plan.deficit <= 0) break;
        if (!section.shrinkable || !section.text.trim()) continue;
        // 多留 16 token 余量：压缩标记本身也占 token，避免「刚好等于预算」后又溢出
        const reduceBy = Math.min(plan.deficit + 24, Math.max(0, section.currentTokens - section.minTokens));
        if (reduceBy <= 0) continue;
        const target = Math.max(section.minTokens, section.currentTokens - reduceBy);
        const result = compressExtractive(section.text, target, input.focusTerms ?? [], modelId);
        if (result.compressed) {
            compressed.set(section.key, result.text);
            plan = applyCompression(plan, compressed, modelId);
        }
    }

    // 3) 重组
    const user = plan.sections
        .filter((section) => section.key !== 'extraTail')
        .map((section) => compressed.get(section.key) ?? section.text)
        .join('');
    const nextExtra = compressed.get('extraTail') ?? extraTail;
    plan = applyCompression(plan, new Map([...compressed, ['extraTail', nextExtra]]), modelId);
    const finalTokens = estimateTokens(input.system, modelId) + plan.totalTokens;
    if (finalTokens > input.maxInputTokens) {
        throw new ContextOverflowError(finalTokens - input.maxInputTokens, input.maxInputTokens, plan.sections.map((section) => section.key));
    }

    const report = [
        `压缩 ${compressed.size} 段`,
        retrieved ? '已定向补检' : '',
        `输入 ~${finalTokens}/${input.maxInputTokens} token`,
    ].filter(Boolean).join(' · ');

    return {
        system: input.system,
        user,
        extraTail: nextExtra,
        plan,
        report,
        retrieved,
    };
}
