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
    // DeepSeek 官方《模型 & 价格》：deepseek-flash 输入（缓存未命中）高峰 2 元 / 输出高峰 8 元
    'deepseek-flash': { inputPerM: 2, outputPerM: 8 },
    'deepseek-v3': { inputPerM: 2, outputPerM: 8 },
    'deepseek-v3.1': { inputPerM: 2, outputPerM: 8 },
    'deepseek-v4-flash': { inputPerM: 2, outputPerM: 8 },
    // 其他常见云模型（参考价）
    'gpt-4o-mini': { inputPerM: 1.1, outputPerM: 4.4 },
    'gpt-4o': { inputPerM: 18, outputPerM: 72 },
    'claude-3-5-haiku': { inputPerM: 5.8, outputPerM: 29 },
    'claude-3-5-sonnet': { inputPerM: 21.6, outputPerM: 108 },
    // 本地模型：无 API 费用
    'qwen2.5:7b': { inputPerM: 0, outputPerM: 0 },
    'ollama': { inputPerM: 0, outputPerM: 0 },
};

/**
 * 渠道参考价（元/百万 tokens）。
 *
 * 有些官方端点（DeepSeek）`/models` 不披露价格，但又确实按 token 计费；
 * 只靠用户手填会导致费用长期显示「—」。这里按**端点域名**录入官方文档价，
 * 作为参考价兜底（用户配置与端点披露永远优先）。
 *
 * 数据来源：
 * - DeepSeek《模型 & 价格》官方文档（2026-11 抓取）：
 *   deepseek-flash 输入（缓存未命中）高峰 2 元 / 输出高峰 8 元；
 *   deepseek-v4-pro 输入（缓存未命中）高峰 9 元 / 输出高峰 27 元。
 *   缓存命中价更低（0.04 / 0.30），记账按保守的未命中价估算。
 *   空闲时段为高峰价一半，这里统一按高峰价（宁可高估，不漏计）。
 * - OpenCode Go / Zen 由 `/models` 直接披露美元价，不需要本表。
 */
export const CHANNEL_PRICING: Record<string, Record<string, ModelPricing>> = {
    'api.deepseek.com': {
        // 新模型名 deepseek-flash（V4.1-Flash-1017）
        'deepseek-flash': { inputPerM: 2, outputPerM: 8 },
        // 旧模型名仍可调用、按 Flash 计费
        'deepseek-v4-flash': { inputPerM: 2, outputPerM: 8 },
        'deepseek-v4-flash-vision-exp': { inputPerM: 2, outputPerM: 8 },
        'deepseek-v4-pro': { inputPerM: 9, outputPerM: 27 },
    },
};

/** 单价来源：用户配置 / 默认参考价 */
export type PricingSource = 'user' | 'default';

/** 美元 → 人民币记账汇率（仅用于把端点披露的美元价折算成元；设置页可改） */
export const DEFAULT_USD_TO_CNY = 7.3;

/** 模型单价（元/百万 tokens）。 */
export interface ModelPricing {
    /** 输入（提示词）单价：元 / 百万 tokens */
    inputPerM: number;
    /** 输出（补全）单价：元 / 百万 tokens */
    outputPerM: number;
    /**
     * 原始币种；缺省视为人民币（兼容旧配置）。
     *
     * 端点自动识别（OpenCode/OpenRouter）披露的是美元价，标记 `USD` 后
     * `estimateCostYuan` 会按汇率折算，避免把 $0.15 当成 ¥0.15。
     */
    currency?: 'USD' | 'CNY';
}

/** 单价查找选项 */
export interface ModelPricingLookupOptions {
    /** 未配置单价时回退内置参考价 */
    allowDefaults?: boolean;
    /** 渠道端点：指定后只在该渠道内匹配，避免同名模型跨渠道串价 */
    endpoint?: string;
    /** 渠道 id：endpoint 匹配不到时的补充定位 */
    providerId?: string;
}

/** 设置里的渠道形状（只取价格查找需要的字段） */
interface PricingProviderLike {
    id?: string;
    endpoint?: string;
    modelMeta?: Record<string, {
        inputPricePerM?: number;
        outputPricePerM?: number;
        priceCurrency?: 'USD' | 'CNY';
    }>;
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
    settings?: { customProviders?: PricingProviderLike[] },
    options?: ModelPricingLookupOptions,
): ModelPricing | null {
    const key = (model || '').trim();
    if (!key) return null;
    const all = settings?.customProviders || [];
    // 指定渠道时只在该渠道里找：同名模型在不同渠道价格不同（如官方 DeepSeek 与 OpenCode 转售）
    const scoped = options?.endpoint || options?.providerId
        ? all.filter(provider => {
            if (options.providerId && provider.id === options.providerId) return true;
            if (!options.endpoint) return false;
            const target = normalizePricingEndpoint(options.endpoint);
            return !!provider.endpoint && normalizePricingEndpoint(provider.endpoint) === target;
        })
        : all;
    for (const provider of scoped) {
        const meta = provider.modelMeta?.[key];
        if (!meta) continue;
        const hasInput = typeof meta.inputPricePerM === 'number' && Number.isFinite(meta.inputPricePerM);
        const hasOutput = typeof meta.outputPricePerM === 'number' && Number.isFinite(meta.outputPricePerM);
        // meta 存在但单价两侧都没填：视为未配置，继续看其它 provider 是否配置过同名模型
        if (!hasInput && !hasOutput) continue;
        return {
            inputPerM: hasInput ? meta.inputPricePerM as number : 0,
            outputPerM: hasOutput ? meta.outputPricePerM as number : 0,
            ...(meta.priceCurrency ? { currency: meta.priceCurrency } : {}),
        };
    }
    if (options?.allowDefaults) {
        // 渠道参考价优先于全局参考价：同名模型在不同官方渠道价格不同
        const channel = findChannelPricing(options?.endpoint);
        const channelPrice = channel?.[key.toLowerCase()] ?? channel?.[key];
        if (channelPrice) return { ...channelPrice };
        const fallback = DEFAULT_MODEL_PRICING[key.toLowerCase()];
        if (fallback) return { ...fallback };
    }
    return null;
}

/**
 * 按端点匹配渠道参考价表。
 *
 * @param endpoint - 渠道端点
 * @returns 该渠道的模型参考价表；未收录返回 undefined
 * @example
 * findChannelPricing('https://api.deepseek.com/v1')?.['deepseek-flash'];
 * // { inputPerM: 2, outputPerM: 8 }
 */
export function findChannelPricing(endpoint: string | undefined): Record<string, ModelPricing> | undefined {
    if (!endpoint) return undefined;
    const lower = String(endpoint).toLowerCase();
    for (const [domain, table] of Object.entries(CHANNEL_PRICING)) {
        if (lower.includes(domain)) return table;
    }
    return undefined;
}

/**
 * 端点归一化：忽略协议尾缀差异（`/v1`、`/chat/completions`、尾部斜杠）。
 *
 * @param endpoint - 端点
 * @returns 归一化后的键
 */
function normalizePricingEndpoint(endpoint: string): string {
    return String(endpoint || '')
        .trim()
        .toLowerCase()
        .replace(/\/+$/, '')
        .replace(/\/v1\/chat\/completions$/, '')
        .replace(/\/chat\/completions$/, '')
        .replace(/\/v1$/, '');
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
 * @param options - 可选；`usdToCny` 覆盖美元→人民币汇率（缺省用 `DEFAULT_USD_TO_CNY`）
 * @returns 费用（元，6 位小数）；未配置单价时返回 null
 *
 * @example
 * ```ts
 * const pricing = { inputPerM: 2, outputPerM: 6 };
 * estimateCostYuan(pricing, 1_000_000, 500_000); // 5（2 元输入 + 3 元输出）
 * estimateCostYuan(pricing, 1000, 2000);         // 0.014
 * estimateCostYuan(null, 1000, 2000);            // null（未配置单价）
 * estimateCostYuan({ inputPerM: 1, outputPerM: 0, currency: 'USD' }, 1_000_000, 0); // 7.3
 * ```
 */
export function estimateCostYuan(
    pricing: ModelPricing | null,
    promptTokens: number,
    completionTokens: number,
    options?: { usdToCny?: number },
): number | null {
    if (!pricing) return null;
    const cost = (promptTokens / 1_000_000) * pricing.inputPerM
        + (completionTokens / 1_000_000) * pricing.outputPerM;
    // 端点自动识别给的是美元价：按汇率折成元，避免账本把 $ 当 ¥
    const rate = pricing.currency === 'USD'
        ? (Number.isFinite(options?.usdToCny) && options!.usdToCny! > 0 ? options!.usdToCny! : DEFAULT_USD_TO_CNY)
        : 1;
    return Number((cost * rate).toFixed(6));
}

/**
 * 查找单价并返回来源（价格快照用）。
 *
 * 用户配置优先；未配置时按 allowDefaults 决定是否回退默认参考价。
 *
 * @param model - 模型 ID
 * @param settings - 插件设置
 * @param options - allowDefaults 控制是否回退默认参考价
 * @returns 单价与来源；都查不到返回 null
 */
export function lookupModelPricingWithSource(
    model: string,
    settings?: { customProviders?: PricingProviderLike[] },
    options?: ModelPricingLookupOptions,
): { pricing: ModelPricing; source: 'user' | 'default' } | null {
    const userPricing = lookupModelPricing(model, settings, options);
    if (userPricing) return { pricing: userPricing, source: 'user' };
    if (!options?.allowDefaults) return null;
    const key = String(model || '').trim();
    const channelPrice = findChannelPricing(options?.endpoint)?.[key.toLowerCase()];
    if (channelPrice) return { pricing: { ...channelPrice }, source: 'default' };
    const fallback = DEFAULT_MODEL_PRICING[key.toLowerCase()];
    return fallback ? { pricing: { ...fallback }, source: 'default' } : null;
}
