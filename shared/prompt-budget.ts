/**
 * prompt-budget.ts — 协同写作 prompt 的输入预算裁剪
 *
 * 协同写作原有实现给每个片段单独设字符上限（如 allChars 3000 字、设定库 3000 字），
 * 但片段叠加后总量仍可能超过本地小模型窗口（未登记本地模型 8192），
 * Ollama 按 num_ctx 硬截断 prompt，模型看到的是被腰斩的上下文。
 *
 * 这里按「整段 prompt 的 token 预算」统一裁剪：
 * - 必保片段（当前情节节点、已写内容尾部、写作方向）永不丢弃；
 * - 其余片段按 priority 从低到高丢弃或截断（priority 越大越优先保留）；
 * - 可截断片段（shrinkable）先截断再考虑整段丢弃，避免一刀切丢掉全部上下文。
 */

import { estimateInputTokens, estimateTokens } from './token-estimator';
import { PROMPT_SPLIT_RATIO, TOKEN_SAFE_BUFFER } from './thresholds';

/**
 * 提示词分区结构定义。
 */
export interface PromptSection {
    /** 片段标识，用于日志/测试断言 */
    key: string;
    text: string;
    /** 越大越优先保留 */
    priority: number;
    /** 超预算时允许截断保留（默认整段丢弃） */
    shrinkable?: boolean;
    /** 关键段：绝不整段丢弃（可在段内按段落边界截断） */
    mustKeep?: boolean;
}

/**
 * 提示词预算输入结构定义。
 */
export interface PromptBudgetInput {
    systemPrompt: string;
    sections: PromptSection[];
    /** 必保片段（已写内容 / 写作方向 / 收尾指令），不参与裁剪 */
    tailParts: string[];
    maxInputTokens: number;
    modelId?: string;
}

/**
 * 提示词预算结果结构定义。
 */
export interface PromptBudgetResult {
    system: string;
    user: string;
    estimatedTokens: number;
    /** 被整段丢弃的片段 key */
    droppedSections: string[];
    /** 被截断保留的片段 key */
    trimmedSections: string[];
    /** 裁剪后仍超出预算（必保片段自身就超了） */
    overBudget: boolean;
}

/**
 * 按 token 预算截断文本（保留前缀；中文按 1.5 字符/token 估算）
 *
 * @param text - 文本内容
 * @param maxTokens - 最大 token 数
 * @param modelId - 模型ID
 * @returns 文本结果
 */
export function truncateTextToTokens(
    text: string,
    maxTokens: number,
    modelId: string = 'default',
): string {
    if (!text || maxTokens <= 0) return '';
    if (estimateTokens(text, modelId) <= maxTokens) return text;
    let lo = 0;
    let hi = text.length;
    while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (estimateTokens(text.slice(0, mid), modelId) <= maxTokens) {
            lo = mid;
        } else {
            hi = mid - 1;
        }
    }
    return text.slice(0, lo);
}

/**
 * 按 token 预算「保留头 + 尾、缩掉中段」，边界落在段落上（不切句子）。
 *
 * 旧实现只保留前缀，正文模板把最终写指令放在段尾，于是最先被吃掉；
 * 改为头尾双保，并在中段插入可读的省略标记。
 * @param text - 文本内容
 * @param maxTokens - 最大 token 数
 * @param modelId - 模型ID
 * @returns 文本结果
 */
export function truncateTextToTokensHeadTail(
    text: string,
    maxTokens: number,
    modelId: string = 'default',
): string {
    if (!text || maxTokens <= 0) return '';
    if (estimateTokens(text, modelId) <= maxTokens) return text;

    const paragraphs = text.split(/\n{2,}/).filter((p) => p.length > 0);
    if (paragraphs.length <= 2) return truncateTextToTokens(text, maxTokens, modelId);

    let headCount = Math.max(1, Math.floor(paragraphs.length * 0.6));
    const tailCount = 1;
    const marker = (dropped: number) => `〔此处省略 ${dropped} 段〕`;
    const tailText = (): string => paragraphs.slice(paragraphs.length - tailCount).join('\n\n');
    const build = (): string => {
        const head = paragraphs.slice(0, headCount).join('\n\n');
        return `${head}\n\n${marker(paragraphs.length - headCount - tailCount)}\n\n${tailText()}`;
    };
    const over = (value: string): boolean => estimateTokens(value, modelId) > maxTokens;

    // 先缩头，保住结尾的写指令/动作
    let result = build();
    while (over(result) && headCount > 1) {
        headCount -= 1;
        result = build();
    }

    if (!over(result)) return result;

    // 头缩到 1 段仍超：保留尾部，头部只放“能放下的前缀”，不再反向扩尾。
    const tail = tailText();
    const markerText = marker(paragraphs.length - 1);
    const tailTokens = estimateTokens(`${markerText}\n\n${tail}`, modelId);
    if (tailTokens >= maxTokens) {
        // 尾部本身超预算：保留尾部后缀（写指令在最后，不能丢），前面加省略标记
        const suffix = truncateTextToTokensTail(tail, Math.max(1, maxTokens - estimateTokens(markerText, modelId)), modelId);
        return `${markerText}\n\n${suffix}`;
    }
    const headBudget = Math.max(1, maxTokens - tailTokens - 4);
    const head = truncateTextToTokens(paragraphs[0], headBudget, modelId);
    const combined = `${head}\n\n${markerText}\n\n${tail}`;
    if (!over(combined)) return combined;

    // 极端兜底：仍超说明估算与真实分词差异过大，保留尾部后缀而不是纯前缀
    return `${markerText}\n\n${truncateTextToTokensTail(tail, Math.max(1, maxTokens - estimateTokens(markerText, modelId)), modelId)}`;
}

/**
 * 保留文本尾部（与 `truncateTextToTokens` 相反）：写指令/动作通常在段尾。
 *
 * @param text - 文本
 * @param maxTokens - 最大 token
 * @param modelId - 模型
 * @returns 尾部文本
 */
export function truncateTextToTokensTail(text: string, maxTokens: number, modelId: string = 'default'): string {
    if (!text || maxTokens <= 0) return '';
    if (estimateTokens(text, modelId) <= maxTokens) return text;
    let low = 0;
    let high = text.length;
    while (low < high) {
        const mid = Math.floor((low + high) / 2);
        if (estimateTokens(text.slice(mid), modelId) <= maxTokens) high = mid;
        else low = mid + 1;
    }
    const suffix = text.slice(low);
    if (suffix) return suffix;
    return text.slice(-Math.max(1, Math.floor(maxTokens * 1.5)));
}

/**
 * 统计 parts 中有多少条被完整保留在最终 prompt 文本里。
 *
 * 预算裁剪只会从片段尾部截断（`truncateTextToTokens` 取前缀），
 * 因此「完整出现」等价于「实际注入」；被整段丢弃或截断到一半的条目不计入。
 * @param parts - 片段列表
 * @param promptText - 提示词文本
 * @returns 数值结果
 */
export function countRetainedPromptParts(parts: string[], promptText: string): number {
    if (!promptText) return 0;
    let retained = 0;
    for (const part of parts) {
        if (!part || !part.trim()) continue;
        if (promptText.includes(part)) retained++;
    }
    return retained;
}

/** 「已写内容」默认字符上限（无预算时的历史行为） */
export const DEFAULT_PRECEDING_CHARS = 800;
/** 「已写内容」最大字符上限，与 `snapshot.precedingText` 保留的 2000 字对齐 */
export const MAX_PRECEDING_CHARS = 2000;

/**
 * PrecedingLimitOptions 类型定义。
 */
export interface PrecedingLimitOptions {
    minChars?: number;
    maxChars?: number;
    /** 前文可占用的输入预算比例（token），默认 0.2 */
    ratio?: number;
}

/**
 * 计算「已写内容」片段可带多少字符。
 *
 * 原先固定取尾部 800 字，而快照收集 2000 字：大窗口下 92% 的预算空着，
 * 前文却被静默截掉 1200 字。这里按输入预算的 20%（中文约 1.5 字符/token）
 * 换算后夹在 [800, 2000]：本地 8192 窗口取满 2000，云端大窗口同样 2000，
 * 极小窗口回落到 800，不弱于旧行为。
 * @param maxInputTokens - 最大输入 token 数
 * @param options - 配置项
 * @returns 数值结果
 */
export function resolvePrecedingCharLimit(
    maxInputTokens?: number,
    options?: PrecedingLimitOptions,
): number {
    const minChars = options?.minChars ?? DEFAULT_PRECEDING_CHARS;
    const maxChars = options?.maxChars ?? MAX_PRECEDING_CHARS;
    const ratio = options?.ratio ?? 0.2;
    if (!maxInputTokens || maxInputTokens <= 0) return minChars;
    const charBudget = Math.floor(maxInputTokens * ratio * 1.5);
    return Math.min(maxChars, Math.max(minChars, charBudget));
}

/**
 * BudgetLimits 类型定义。
 */
export interface BudgetLimits {
    maxContext: number;
    maxOutput: number;
}

/**
 * 把「全局设置里的窗口/输出上限」收窄到「当前模型的实际能力」。
 *
 * `settings.maxContext` / `maxOutput` 是全局单值：11 步流水线的每一步可能用不同模型
 * （flash / pro），切换模型后设置值也可能还是上一只模型的残留。只按设置值做 prompt 闸门，
 * 本地 8K/32K 模型永远不会触发裁剪，请求要么被 `ai-api-client` 以「输入过长」直接拒绝，
 * 要么被 Ollama 从尾部静默截断（最先丢的是输出约束）。
 *
 * 规则：模型能力有效时取两者的较小值——模型能力是硬上限，设置值是用户主动设的成本上限。
 * @param configured - 已配置值
 * @param modelLimits - 模型限制
  * @returns BudgetLimits 实例
 */
export function clampBudgetToModelLimits(
    configured: BudgetLimits,
    modelLimits?: Partial<BudgetLimits> | null,
): BudgetLimits {
    const pick = (conf: number, actual?: number): number =>
        typeof actual === 'number' && Number.isFinite(actual) && actual > 0
            ? Math.min(conf, actual)
            : conf;
    return {
        maxContext: pick(configured.maxContext, modelLimits?.maxContext),
        maxOutput: pick(configured.maxOutput, modelLimits?.maxOutput),
    };
}

function totalTokens(
    systemPrompt: string,
    sections: PromptSection[],
    tailText: string,
    modelId: string,
): number {
    const sectionTokens = sections.reduce((sum, s) => sum + estimateTokens(s.text, modelId), 0);
    return estimateInputTokens(systemPrompt, tailText, modelId) + sectionTokens;
}

/**
 * 按预算装配 prompt。正常窗口下输出与未裁剪时一致（顺序不变）。
 * @param input - 输入
  * @returns PromptBudgetResult 实例
 */
export function assemblePromptWithinBudget(input: PromptBudgetInput): PromptBudgetResult {
    const modelId = input.modelId || 'default';
    // 复制一份，避免裁剪时污染调用方持有的对象
    const alive = input.sections
        .filter((s) => s.text && s.text.trim().length > 0)
        .map((s) => ({ ...s }));
    const tailText = input.tailParts.filter((p) => p !== undefined && p !== null).join('\n');

    const droppedSections: string[] = [];
    const trimmedSections: string[] = [];
    let total = totalTokens(input.systemPrompt, alive, tailText, modelId);

    while (total > input.maxInputTokens && alive.length > 0) {
        // 优先级最低者先动；同优先级时先动更长的片段，收益更大
        const candidates = alive
            .map((section, index) => ({ section, index }))
            .sort((a, b) => a.section.priority - b.section.priority || b.section.text.length - a.section.text.length);
        const { section, index } = candidates[0];
        const over = total - input.maxInputTokens;
        const sectionTokens = estimateTokens(section.text, modelId);

        // 关键段永不整段丢弃：即使 shrinkable 未显式声明，也按头尾截断处理
        const canShrink = section.shrinkable || section.mustKeep;
        if (canShrink && sectionTokens > over) {
            const next = truncateTextToTokensHeadTail(section.text, sectionTokens - over, modelId);
            if (next && next.trim().length > 0 && next.length < section.text.length) {
                section.text = next;
                if (!trimmedSections.includes(section.key)) trimmedSections.push(section.key);
                total = totalTokens(input.systemPrompt, alive, tailText, modelId);
                continue;
            }
        }

        if (section.mustKeep) {
            // 只剩关键段且缩不动：停止裁剪，交给 overBudget 让上层提示
            break;
        }
        droppedSections.push(section.key);
        alive.splice(index, 1);
        total = totalTokens(input.systemPrompt, alive, tailText, modelId);
    }

    const user = [...alive.map((s) => s.text), tailText].filter((p) => p && p.trim().length > 0).join('\n');
    return {
        system: input.systemPrompt,
        user,
        estimatedTokens: estimateInputTokens(input.systemPrompt, user, modelId),
        droppedSections,
        trimmedSections,
        overBudget: total > input.maxInputTokens,
    };
}

/**
 * PromptFitInput 类型定义。
 */
export interface PromptFitInput {
    systemPrompt: string;
    userPrompt: string;
    /**
     * 追加到 userPrompt 末尾的增强内容（如大纲摘要的知识注入）。
     * 它不参与头尾截断，超预算时整段丢弃——增强层永远先于任务主体让路。
     */
    extraTail?: string;
    maxContext: number;
    maxOutput: number;
    /**
     * 直接给定输入 token 预算（任务预算 maxInput）。给了就优先于
     * `maxContext - maxOutput - safeBuffer`，避免闸门与真实模型窗口不一致。
     */
    maxInputTokens?: number;
    modelId?: string;
    /** 安全余量，默认 `TOKEN_SAFE_BUFFER` */
    safeBuffer?: number;
    /** 头部保留比例，默认 `PROMPT_SPLIT_RATIO` */
    headRatio?: number;
    /** 尾部至少保留的字符数（模板把任务约束放在尾部） */
    tailKeepChars?: number;
    /**
     * 分段优先级裁剪：超预算时先丢低优先段（场景风格/节奏建议），
     * 再缩高优先段，最后才缩关键段（世界观/设定库/人物/大纲/Scene/格式）。
     * 默认 false，保持协同写作等既有链路的头尾截断行为。
     */
    sectionAware?: boolean;
}

/**
 * PromptFitResult 类型定义。
 */
export interface PromptFitResult {
    user: string;
    estimatedTokens: number;
    /** 主体被头尾截断 */
    truncated: boolean;
    /** `extraTail` 因超预算被整体丢弃 */
    droppedExtra: boolean;
    /** 被整段丢弃的段名（分段裁剪时） */
    droppedSections: string[];
    /** 被段内截断的段名（分段裁剪时） */
    trimmedSections: string[];
    /** 本次实际生效的输入 token 预算 */
    maxInputTokens: number;
    /** 关键段缩完仍超预算 */
    overBudget: boolean;
}

/** 章节模板里的分段标题：行首的【……】 */
const SECTION_HEADING_RE = /^【([^】\n]{1,40})】/;

const CRITICAL_SECTION_KEYWORDS = [
    '世界观', '这个世界', '设定库', '人物', '身边的人', '大纲', '场景展开', '情节节点',
    '信息规划', '分卷定位', '输出格式', '写作规则', '写的时候注意', '情绪规划', '情绪弧',
    '角色灵魂层', '同人', '约束',
];
const LOW_SECTION_KEYWORDS = ['场景风格参考', '叙事节奏建议', '关系推进'];

/**
 * 关键段：绝不整段丢弃（只允许段内按段落边界缩）。
 * 实测事故：旧实现先丢 P1/P2，再按前缀截 P3，正文的「最终写指令」在段尾先被吃掉，
 * 世界观/人物/本章规划也会整段消失 → 剧情跳步、人物 OOC。
 */
const MUST_KEEP_SECTION_KEYWORDS = [
    '写作指令', '输出格式', '写作规则', '世界观', '设定库', '人物', '大纲', '信息规划',
    '情绪弧', '情绪规划', '场景展开', '场景卡', '伏笔', '上一章结尾', '故事上下文', '对话骨架',
];

function isMustKeepSection(title: string): boolean {
    return MUST_KEEP_SECTION_KEYWORDS.some((k) => title.includes(k));
}

function classifySectionPriority(title: string): number {
    if (CRITICAL_SECTION_KEYWORDS.some((k) => title.includes(k))) return 4;
    if (LOW_SECTION_KEYWORDS.some((k) => title.includes(k))) return 1;
    if (title.includes('前文') || title.includes('上一章') || title.includes('伏笔') ||
        title.includes('时间线') || title.includes('文笔') || title.includes('记忆')) return 3;
    return 2;
}

/**
 * 把已填充的 prompt 按行首【标题】切成段落。
 * 没有标题时返回单段，调用方应回退到头尾截断。
 * @param prompt - 提示词
 * @returns 结果数组
 */
export function splitPromptIntoSections(prompt: string): PromptSection[] {
    const lines = prompt.split('\n');
    const raw: Array<{ title: string; lines: string[] }> = [];
    let current = { title: '__preamble__', lines: [] as string[] };
    for (const line of lines) {
        const match = line.match(SECTION_HEADING_RE);
        if (match) {
            if (current.lines.length > 0) raw.push(current);
            current = { title: match[1], lines: [line] };
        } else {
            current.lines.push(line);
        }
    }
    if (current.lines.length > 0) raw.push(current);

    return raw
        .map((section, index) => {
            const text = section.lines.join('\n').trim();
            const priority = section.title === '__preamble__' ? 3 : classifySectionPriority(section.title);
            return {
                key: section.title === '__preamble__' ? `preamble-${index}` : `${section.title}#${index}`,
                text,
                priority,
                // 低优先段整段丢弃；高优先段才允许截断保留
                shrinkable: priority > 1,
                // 关键段永不整段丢弃（只允许段内头尾缩）
                mustKeep: section.title !== '__preamble__' && isMustKeepSection(section.title),
            };
        })
        .filter((section) => section.text.length > 0);
}

/**
 * 分段裁剪：丢弃/缩短低优先段，关键段最后才动。
 * 返回 null 表示无法在预算内完成（调用方回退头尾截断）。
 */
export interface SectionFitDetail {
    user: string;
    truncated: boolean;
    /** 被整段丢弃的段名（去重、去序号） */
    droppedSections: string[];
    /** 被段内截断的段名（去重、去序号） */
    trimmedSections: string[];
    /** 关键段缩完仍超预算 */
    overBudget: boolean;
}

function fitBySectionPriority(
    systemPrompt: string,
    userPrompt: string,
    maxInputTokens: number,
    modelId: string,
): SectionFitDetail | null {
    const sections = splitPromptIntoSections(userPrompt);
    if (sections.length < 2) return null;

    const result = assemblePromptWithinBudget({
        systemPrompt,
        sections,
        tailParts: [],
        maxInputTokens,
        modelId,
    });
    if (result.overBudget) return null;

    const namesOf = (keys: string[]): string[] => [...new Set(keys.map((key) => key.split("#")[0]))];
    const omitted = namesOf(result.droppedSections);
    const trimmed = namesOf(result.trimmedSections);
    let user = result.user;
    if (omitted.length > 0) {
        user += `\n\n〔预算不足，已省略以下段落：${omitted.join("、")}〕`;
    }
    return {
        user,
        truncated: omitted.length > 0 || trimmed.length > 0,
        droppedSections: omitted,
        trimmedSections: trimmed,
        overBudget: false,
    };
}

/**
 * 把「system + user + 增强尾部」压进模型可用窗口（11 步流水线的 prompt 闸门）。
 *
 * 原实现只按 `system.length + user.length` 估算，漏掉它刚刚拼进 user 的知识注入，
 * 于是要么超预算不触发、要么在重建 prompt 时静默丢掉注入。
 * 这里按优先级处理：完整原文 → 丢增强尾部 → 分段优先级裁剪（sectionAware）→ 主体头尾截断。
 * 增量一律以 `estimateInputTokens` 为准，与协同链路共用同一估算器。
 * @param input - 输入
  * @returns PromptFitResult 实例
 */
export function fitPromptToContext(input: PromptFitInput): PromptFitResult {
    const modelId = input.modelId || 'default';
    const safeBuffer = input.safeBuffer ?? TOKEN_SAFE_BUFFER;
    const headRatio = input.headRatio ?? PROMPT_SPLIT_RATIO;
    const tailKeepChars = input.tailKeepChars ?? 2500;
    // 输入预算：任务层给的 maxInput 优先（按真实模型窗口算），否则回退窗口差
    const safeThreshold = input.maxInputTokens && input.maxInputTokens > 0
        ? input.maxInputTokens
        : input.maxContext - input.maxOutput - safeBuffer;
    const extra = (input.extraTail || '').trim();
    const full = extra ? `${input.userPrompt}\n\n${extra}` : input.userPrompt;

    const fullTokens = estimateInputTokens(input.systemPrompt, full, modelId);
    if (fullTokens <= safeThreshold) {
        return {
            user: full, estimatedTokens: fullTokens, truncated: false, droppedExtra: false,
            droppedSections: [], trimmedSections: [], maxInputTokens: safeThreshold, overBudget: false,
        };
    }

    // 先让增强层让路：主体本身放得下就不截断主体
    const baseTokens = estimateInputTokens(input.systemPrompt, input.userPrompt, modelId);
    if (extra && baseTokens <= safeThreshold) {
        return {
            user: input.userPrompt, estimatedTokens: baseTokens, truncated: false, droppedExtra: true,
            droppedSections: [], trimmedSections: [], maxInputTokens: safeThreshold, overBudget: false,
        };
    }

    // 分段优先级裁剪：不再按字符腰斩中间，避免世界观/设定库/人物/大纲被切掉
    if (input.sectionAware) {
        const sectionFit = fitBySectionPriority(input.systemPrompt, input.userPrompt, safeThreshold, modelId);
        if (sectionFit) {
            return {
                user: sectionFit.user,
                estimatedTokens: estimateInputTokens(input.systemPrompt, sectionFit.user, modelId),
                truncated: sectionFit.truncated,
                droppedExtra: Boolean(extra),
                droppedSections: sectionFit.droppedSections,
                trimmedSections: sectionFit.trimmedSections,
                maxInputTokens: safeThreshold,
                overBudget: sectionFit.overBudget,
            };
        }
    }

    const splitPoint = Math.floor(input.userPrompt.length * headRatio);
    const tailKeep = Math.min(tailKeepChars, Math.floor(input.userPrompt.length * 0.25));
    const headKeep = Math.max(0, splitPoint - tailKeep);
    const notice = `\n\n[⚠️ 上下文过长（~${baseTokens} tokens），已自动保留头部+尾部，中间资料已截断]\n\n`;
    const user = input.userPrompt.slice(0, headKeep)
        + notice
        + input.userPrompt.slice(input.userPrompt.length - tailKeep);

    return {
        user,
        estimatedTokens: estimateInputTokens(input.systemPrompt, user, modelId),
        truncated: true,
        droppedExtra: Boolean(extra),
        droppedSections: [],
        trimmedSections: [],
        maxInputTokens: safeThreshold,
        overBudget: false,
    };
}
