/**
 * model-pricing.ts — 模型单价配置与费用估算（元/百万 tokens）
 *
 * 单价由用户在「设置 → API → 编辑模型」中按模型填写，存储在
 * `CustomProvider.modelMeta` 的 `inputPricePerM` / `outputPricePerM` 字段；
 * AI 调用记账（engine/ai-api-client.ts）时用 `estimateCostYuan` 估算每笔费用，
 * 用量账本（services/usage-ledger.ts）按模型/项目/来源聚合展示。
 *
 * 设计取舍：默认**不**内置价格表——各家定价随版本与渠道频繁变动，硬编码极易过时
 * 并给出看似精确的错值；用户未配置单价时默认返回 null（未计费）。
 *
 * 但「费用永远是 —」等于没有成本可见性，因此提供**默认参考价**兜底：
 * 调用方可显式传 `{ allowDefaults: true }` 启用，界面需标注「参考价」；
 * 用户配置的单价永远优先于默认值。
 */

/**
 * 默认参考单价（元/百万 tokens）。
 *
 * 仅作兜底展示，来源为各家官方公示价（2026-11 口径），可能随官方调价过时；
 * 用户配置的单价永远优先。键为小写模型 id 的**精确匹配**。
 */
export const DEFAULT_MODEL_PRICING: Record<string, ModelPricing> = {
    // DeepSeek 官方（缓存未命中价）
    'deepseek-chat': { inputPerM: 2, outputPerM: 8 },
    'deepseek-reasoner': { inputPerM: 4, outputPerM: 16 },
    'deepseek-flash': { inputPerM: 0.5, outputPerM: 2 },
    'deepseek-v3': { inputPerM: 2, outputPerM: 8 },
    'deepseek-v3.1': { inputPerM: 2, outputPerM: 8 },
    'deepseek-v4-flash': { inputPerM: 0.5, outputPerM: 2 },
    // 其他常见云模型（参考价）
    'gpt-4o-mini': { inputPerM: 1.1, outputPerM: 4.4 },
    'gpt-4o': { inputPerM: 18, outputPerM: 72 },
    'claude-3-5-haiku': { inputPerM: 5.8, outputPerM: 29 },
    'claude-3-5-sonnet': { inputPerM: 21.6, outputPerM: 108 },
    // 本地模型：无 API 费用
    'qwen2.5:7b': { inputPerM: 0, outputPerM: 0 },
    'ollama': { inputPerM: 0, outputPerM: 0 },
};

/** 单价来源：用户配置 / 默认参考价 */
export type PricingSource = 'user' | 'default';

/** 模型单价（元/百万 tokens）。 */
export interface ModelPricing {
    /** 输入（提示词）单价：元 / 百万 tokens */
    inputPerM: number;
    /** 输出（补全）单价：元 / 百万 tokens */
    outputPerM: number;
}

/**
 * 按模型 ID 精确查找用户在自定义供应商里配置的单价。
 *
 * 只做精确键匹配（不做子串猜测），遍历任一 provider 的 `modelMeta[model]`；
 * 命中但两侧单价都未填、或任何地方都查不到时返回 null（未配置，不计费）。
 * 只填一侧单价时，另一侧按 0 处理（例如只关心输出成本的推理模型）。
 *
 * @param model - 模型 ID（与请求时的 model 字段口径一致）
 * @param settings - 插件设置（只需 customProviders 形状，传入 plugin.settings 即可）
 * @param options - 可选；`allowDefaults: true` 时未配置单价回退到内置参考价
 * @returns 命中的单价；未配置返回 null
 *
 * @example
 * ```ts
 * const pricing = lookupModelPricing('deepseek-v4-flash', plugin.settings);
 * // pricing === { inputPerM: 1, outputPerM: 4 }（用户填了 输入 1 元、输出 4 元 / 百万 tokens）
 * const unknown = lookupModelPricing('not-configured', plugin.settings);
 * // unknown === null（未配置单价，不估算费用）
 * ```
 */
export function lookupModelPricing(
    model: string,
    settings?: { customProviders?: Array<{ modelMeta?: Record<string, { inputPricePerM?: number; outputPricePerM?: number }> }> },
    options?: { allowDefaults?: boolean },
): ModelPricing | null {
    const key = (model || '').trim();
    if (!key) return null;
    for (const provider of settings?.customProviders || []) {
        const meta = provider.modelMeta?.[key];
        if (!meta) continue;
        const hasInput = typeof meta.inputPricePerM === 'number' && Number.isFinite(meta.inputPricePerM);
        const hasOutput = typeof meta.outputPricePerM === 'number' && Number.isFinite(meta.outputPricePerM);
        // meta 存在但单价两侧都没填：视为未配置，继续看其它 provider 是否配置过同名模型
        if (!hasInput && !hasOutput) continue;
        return {
            inputPerM: hasInput ? meta.inputPricePerM as number : 0,
            outputPerM: hasOutput ? meta.outputPricePerM as number : 0,
        };
    }
    if (options?.allowDefaults) {
        const fallback = DEFAULT_MODEL_PRICING[key.toLowerCase()];
        if (fallback) return { ...fallback };
    }
    return null;
}

/**
 * 估算一次调用的费用（元）。
 *
 * 公式：`promptTokens / 1e6 * inputPerM + completionTokens / 1e6 * outputPerM`，
 * 结果四舍五入保留 6 位小数（元，足够表达单次调用的最小量级）。
 *
 * @param pricing - 模型单价；null 表示未配置单价
 * @param promptTokens - 输入 token 数
 * @param completionTokens - 输出 token 数
 * @returns 费用（元，6 位小数）；未配置单价时返回 null
 *
 * @example
 * ```ts
 * const pricing = { inputPerM: 2, outputPerM: 6 };
 * estimateCostYuan(pricing, 1_000_000, 500_000); // 5（2 元输入 + 3 元输出）
 * estimateCostYuan(pricing, 1000, 2000);         // 0.014
 * estimateCostYuan(null, 1000, 2000);            // null（未配置单价）
 * ```
 */
export function estimateCostYuan(pricing: ModelPricing | null, promptTokens: number, completionTokens: number): number | null {
    if (!pricing) return null;
    const cost = (promptTokens / 1_000_000) * pricing.inputPerM
        + (completionTokens / 1_000_000) * pricing.outputPerM;
    return Number(cost.toFixed(6));
}
