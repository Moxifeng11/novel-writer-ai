/**
 * provider-ui-model.ts — 供应商配置的纯逻辑（预设收敛 / 启用语义 / 渠道分配 / 思考能力 / 请求头）
 *
 * 背景：API 配置模块此前把「启用」当成「切换当前供应商」，切换渠道还会把
 * 全局模型分配重置成 models[0..1]；思考参数只按端点硬编码；请求头无法自定义。
 * 这里把判定逻辑集中成纯函数，UI 与服务层共用，便于单测。
 */

/** 预设供应商固定顺序（只有这 4 个是内置预设） */
export const PRESET_PROVIDER_IDS = ['ollama', 'deepseek', 'sensenova', 'opencode'] as const;

/** 与配置相关的供应商最小形状 */
export interface ProviderLike {
    id: string;
    name: string;
    endpoint: string;
    models: string[];
    sourceType?: 'cloud' | 'local';
    apiFormat?: string;
    isDefault?: boolean;
}

/** 全局模型分配 */
export interface ProviderAssignment {
    defaultModel: string;
    flashModel: string;
    proModel: string;
}

/**
 * 某供应商是否出现在其他模块（快切/工作台等）。
 *
 * enabledProviderIds 未设置 = 全部可见；设置后只有列表内可见。
 *
 * @param providerId - 供应商 id
 * @param enabledProviderIds - 允许显示的 id 列表
 * @returns 是否可见
 * @example
 * isProviderVisible('deepseek', undefined);            // true（默认全显示）
 * isProviderVisible('volc', ['deepseek', 'ollama']);   // false
 */
export function isProviderVisible(providerId: string, enabledProviderIds: readonly string[] | undefined): boolean {
    if (!enabledProviderIds) return true;
    return enabledProviderIds.includes(providerId);
}

/**
 * 切换某供应商在其他模块的可见性。
 *
 * @param enabledProviderIds - 现有可见列表（undefined = 全部）
 * @param allIds - 当前全部供应商 id（用于把「全部可见」展开成列表）
 * @param providerId - 目标供应商
 * @param visible - 是否可见
 * @returns 新的可见列表
 * @example
 * toggleProviderVisibility(undefined, ['a', 'b'], 'a', false); // ['b']
 */
export function toggleProviderVisibility(
    enabledProviderIds: readonly string[] | undefined,
    allIds: readonly string[],
    providerId: string,
    visible: boolean,
): string[] {
    const base = enabledProviderIds ? [...enabledProviderIds] : [...allIds];
    const set = new Set(base);
    if (visible) set.add(providerId);
    else set.delete(providerId);
    return allIds.filter(id => set.has(id));
}

/**
 * 渠道默认模型分配（首次切换到该渠道时使用）。
 *
 * @param provider - 供应商
 * @returns 分配（第一个模型作默认/Flash，第二个作 Pro）
 * @example
 * defaultAssignmentFor({ id: 'x', name: 'x', endpoint: 'e', models: ['a', 'b'] });
 * // { defaultModel: 'a', flashModel: 'a', proModel: 'b' }
 */
export function defaultAssignmentFor(provider: ProviderLike): ProviderAssignment {
    const first = provider.models[0] ?? '';
    return {
        defaultModel: first,
        flashModel: first,
        proModel: provider.models[1] ?? first,
    };
}

/**
 * 把分配值收敛到该渠道真实存在的模型（旧配置可能指向别的渠道模型）。
 *
 * @param assignment - 已保存/默认分配
 * @param models - 该渠道模型列表
 * @returns 收敛后的分配
 * @example
 * clampAssignment({ defaultModel: 'ghost', flashModel: 'a', proModel: 'zzz' }, ['a', 'b']);
 * // { defaultModel: 'a', flashModel: 'a', proModel: 'b' }
 */
export function clampAssignment(
    assignment: Partial<ProviderAssignment>,
    models: readonly string[],
): ProviderAssignment {
    const fallback = models[0] ?? '';
    const pick = (value: string | undefined, index: number): string => {
        if (value && models.includes(value)) return value;
        return models[index] ?? fallback;
    };
    return {
        defaultModel: pick(assignment.defaultModel, 0),
        flashModel: pick(assignment.flashModel, 0),
        proModel: pick(assignment.proModel, 1),
    };
}

/** 思考参数形态（决定下发哪个字段） */
export type ThinkingKind = 'reasoning_effort' | 'thinking' | 'anthropic-budget' | 'none';

/** 思考能力识别结果 */
export interface ThinkingCapability {
    /** 该渠道/模型是否支持可控思考强度 */
    supported: boolean;
    /** 下发形态 */
    kind: ThinkingKind;
    /** 给设置页的说明 */
    hint: string;
}

/**
 * 按渠道/模型自动识别思考强度支持的参数形态（不再要求用户手选协议）。
 *
 * 规则：
 * - `apiFormat=anthropic-messages` → budget_tokens（Anthropic thinking）
 * - OpenAI o 系 / gpt-5 系 / 端点含 openai → reasoning_effort
 * - 火山 / DeepSeek / SenseNova / OpenCode Zen（Zen 支持 thinking 透传的模型）→ thinking.type
 * - 本地（Ollama 等）→ 不支持（下发会被忽略或报错）
 *
 * @param provider - 供应商信息（端点/协议）
 * @param model - 模型名
 * @returns 思考能力
 * @example
 * resolveThinkingCapability({ endpoint: 'https://api.deepseek.com/v1/chat/completions' }, 'deepseek-v4-pro').kind;
 * // 'thinking'
 */
export function resolveThinkingCapability(
    provider: Pick<ProviderLike, 'endpoint' | 'apiFormat' | 'sourceType'>,
    model: string,
): ThinkingCapability {
    const endpoint = String(provider.endpoint ?? '').toLowerCase();
    const lowerModel = String(model ?? '').toLowerCase();
    if (provider.apiFormat === 'anthropic-messages') {
        return { supported: true, kind: 'anthropic-budget', hint: 'Anthropic 协议：按 budget_tokens 下发思考预算' };
    }
    if (provider.sourceType === 'local' || /localhost|127\.0\.0\.1|ollama/.test(endpoint)) {
        return { supported: false, kind: 'none', hint: '本地渠道通常不支持思考强度参数' };
    }
    if (/^(o1|o3|o4|gpt-5)/.test(lowerModel) || /openai\.com/.test(endpoint)) {
        return { supported: true, kind: 'reasoning_effort', hint: 'OpenAI 风格：下发 reasoning_effort（low/medium/high）' };
    }
    if (/volces\.com|deepseek\.com|sensenova\.cn|opencode\.ai/.test(endpoint)) {
        return { supported: true, kind: 'thinking', hint: '该渠道支持 thinking.type + budget_tokens' };
    }
    return { supported: false, kind: 'none', hint: '未识别的渠道：不下发思考参数，避免 400' };
}

/**
 * 思考强度档位（0–100）= 预算换算。
 *
 * @param level - 强度档位
 * @returns 思考预算 tokens（0 = 关闭）
 * @example
 * thinkingBudgetFromLevel(50); // 6400
 */
export function thinkingBudgetFromLevel(level: number): number {
    const clamped = Math.max(0, Math.min(100, Math.round(Number(level) || 0)));
    return clamped === 0 ? 0 : Math.round(clamped * 128);
}

/**
 * 思考档位 → 展示文本。
 *
 * @param level - 强度档位
 * @returns 展示文本（关闭/低/中/高）
 * @example
 * describeThinkingLevel(85); // '高（深入）'
 */
export function describeThinkingLevel(level: number): string {
    const clamped = Math.max(0, Math.min(100, Math.round(Number(level) || 0)));
    if (clamped === 0) return '关闭';
    if (clamped <= 30) return '低（快速）';
    if (clamped <= 70) return '中（平衡）';
    return '高（深入）';
}

/**
 * 请求头文本 → 对象（每行 `Key: Value`，忽略空行与 # 注释）。
 *
 * @param text - 文本
 * @returns 请求头对象
 * @example
 * parseHeaderLines('HTTP-Referer: https://a.com\nX-Title: nw'); // { 'HTTP-Referer': 'https://a.com', 'X-Title': 'nw' }
 */
export function parseHeaderLines(text: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const raw of String(text ?? '').split(/\r?\n/)) {
        const line = raw.trim();
        if (!line || line.startsWith('#')) continue;
        const idx = line.indexOf(':');
        if (idx <= 0) continue;
        const key = line.slice(0, idx).trim();
        const value = line.slice(idx + 1).trim();
        if (!key || !value) continue;
        out[key] = value;
    }
    return out;
}

/**
 * 请求头对象 → 文本（设置页展示）。
 *
 * @param headers - 请求头
 * @returns 文本
 * @example
 * serializeHeaderLines({ 'X-Title': 'nw' }); // 'X-Title: nw'
 */
export function serializeHeaderLines(headers: Record<string, string> | undefined): string {
    if (!headers) return '';
    return Object.entries(headers)
        .filter(([key, value]) => key && value)
        .map(([key, value]) => `${key}: ${value}`)
        .join('\n');
}

/**
 * 旧预设迁移：历史上有火山/CatCat 等预设，现在不再是预设。
 * 把用户仍保留且未修改的旧预设转成普通自定义供应商，避免升级后「消失」。
 *
 * @param providers - 现有供应商列表
 * @param presetIds - 当前预设 id 集合
 * @returns 迁移后的列表（幂等）
 * @example
 * migrateRemovedPresets([{ id: 'volc', name: '火山引擎豆包', endpoint: 'e', models: [], isDefault: true }], ['ollama']);
 * // [{ ..., isDefault: false }]
 */
export function migrateRemovedPresets<T extends { id: string; isDefault?: boolean }>(
    providers: readonly T[],
    presetIds: readonly string[],
): T[] {
    if (!Array.isArray(providers)) return [];
    return providers.map(provider => (
        provider.isDefault && !presetIds.includes(provider.id)
            ? { ...provider, isDefault: false }
            : provider
    ));
}

/** 内置请求头适配结果（渠道自动补全，用户自定义值可覆盖） */
export interface ProviderDefaultHeaders {
    /** 需要补的请求头 */
    headers: Record<string, string>;
    /** 适配说明（设置页展示） */
    note: string;
}

/**
 * 按渠道补内置请求头（OpenRouter 必带 Referer/Title、Anthropic 必带版本号）。
 * 用户自定义 headers 在调用侧覆盖这里的默认值。
 *
 * @param provider - 供应商（端点/协议）
 * @returns 需要补的请求头与说明
 * @example
 * defaultHeadersForProvider({ endpoint: 'https://openrouter.ai/api/v1/chat/completions' }).headers;
 * // { 'HTTP-Referer': 'https://github.com/...', 'X-Title': 'Novel Writer AI' }
 */
export function defaultHeadersForProvider(
    provider: Pick<ProviderLike, 'endpoint' | 'apiFormat'>,
): ProviderDefaultHeaders {
    const endpoint = String(provider.endpoint ?? '').toLowerCase();
    if (provider.apiFormat === 'anthropic-messages') {
        return { headers: { 'anthropic-version': '2023-06-01' }, note: 'Anthropic 协议：自动补 anthropic-version' };
    }
    if (endpoint.includes('openrouter.ai')) {
        return {
            headers: {
                'HTTP-Referer': 'https://github.com/novel-writer-ai',
                'X-Title': 'Novel Writer AI',
            },
            note: 'OpenRouter：自动补 HTTP-Referer / X-Title（可在自定义请求头覆盖）',
        };
    }
    if (endpoint.includes('opencode.ai')) {
        return { headers: {}, note: 'OpenCode Zen 无需额外请求头' };
    }
    return { headers: {}, note: '该渠道没有必需的内置请求头' };
}
