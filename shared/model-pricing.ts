/**
 * model-pricing.ts — 模型单价配置与费用估算（元/百万 tokens）
 *
 * 单价由用户在「设置 → API → 编辑模型」中按模型填写，存储在
 * `CustomProvider.modelMeta` 的 `inputPricePerM` / `outputPricePerM` 字段；
 * AI 调用记账（engine/ai-api-client.ts）时用 `estimateCostYuan` 估算每笔费用，
 * 用量账本（services/usage-ledger.ts）按模型/项目/来源聚合展示。
 *
 * 设计取舍：不做内置价格表——各家定价随版本与渠道频繁变动，硬编码极易过时
 * 并给出看似精确的错值；查不到用户配置的单价时一律返回 null（未计费）。
 */

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
