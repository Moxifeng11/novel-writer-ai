/**
 * co-write-options.ts — 协同写作模型解析与 callAI options 构建
 *
 * 从 co-writer-engine.ts 抽出的纯函数（第四批拆分）：只依赖 settings 快照、
 * 可选的 `resolveModelLimits` 回调与 AbortSignal，不持有引擎可变状态，也不读取
 * `this.snapshot` / `this.plotNodes` 等会话数据。co-writer-engine 保留同名薄委托，
 * 既有调用点与测试无需改动。
 *
 * 行为逐行等价于原 `getCoWriteModel` / `resolveLocalProvider` / `getCoWriteOptions`：
 * - 本地模式必须落在本地 provider 上，找不到就阻断，绝不静默回退云端；
 * - 云端模式按 providerId 取端点与 API Key，并允许 fallback；
 * - numCtx 取用户配置与 provider 窗口的较小值，最低 2048。
 */
import { findModelCapability } from '@/shared/model-capabilities';
import { resolveProviderSourceType } from '@/shared/model-source';
import {
    resolveCoWriteLocalModel,
    type CoWriteModelSettings,
    type CoWriteProviderLike,
} from './local-model-utils';

/**
 * callAI 的供应商覆盖参数（与原 `getCoWriteOptions` 返回结构一致）。
 */
export interface CoWriteCallOptions {
    /** 透传的取消信号 */
    signal?: AbortSignal;
    /** 覆盖全局 apiEndpoint 的端点 */
    endpoint?: string;
    /** 覆盖全局 apiKey 的密钥 */
    apiKey?: string;
    /** 是否禁用云端回退；本地模式固定为 true */
    disableFallback?: boolean;
    /** Ollama num_ctx（仅本地模式） */
    numCtx?: number;
    /** 本地路由失败原因；非空时调用方应直接返回错误而不是发起请求 */
    localRouteError?: string;
    /** 本地模式未选本地模型，已自动切换到云端（调用方可提示用户） */
    autoSwitchedToCloud?: boolean;
}

/**
 * 本地 provider 路由结果。
 */
export interface LocalProviderRoute {
    /** provider 唯一标识 */
    providerId: string;
    /** provider 的 API 端点 */
    endpoint: string;
    /** 实测/配置可用的 API Key（本地 provider 缺省为 'ollama'） */
    apiKey: string;
    /** 上下文窗口上限 */
    maxContext: number;
}

/**
 * 协同写作 options 所需的最小 settings 视图。
 *
 * 只声明本模块读取的字段，避免把整个插件 settings 传成 any；
 * 真实 `NovelWriterSettings` 结构上兼容本接口。
 */
export interface CoWriteOptionsSettings extends CoWriteModelSettings {
    /** 'local'（默认）或 'cloud' */
    coWriteModelMode?: 'local' | 'cloud';
    /** 云端模型所属 provider ID */
    coWriteCloudProvider?: string;
    /** 云端协同模型名；留空回退 defaultModel */
    coWriteCloudModel?: string;
    /** 本地 num_ctx；0/缺省表示按 provider 窗口自动 */
    coWriteNumCtx?: number;
    /** provider ID -> API Key */
    providerKeys?: Record<string, string>;
    /** 用户自定义 provider 列表（覆盖基类的 models 必填约束） */
    customProviders?: CoWriteOptionsProvider[];
}

/**
 * 本模块读取的 provider 形状：比 `CoWriteProviderLike` 多一个可选的 maxContext。
 */
export interface CoWriteOptionsProvider extends CoWriteProviderLike {
    /** provider 配置的上下文窗口；非正数时回退模型能力表 */
    maxContext?: number;
}

/**
 * 插件侧模型窗口解析回调（`NovelWriterPlugin.resolveModelLimits` 的结构类型）。
 * 以回调注入而非导入插件类，保持本模块可在无 Obsidian 环境下单测。
 */
export type ResolveModelLimits = (
    modelName: string,
    endpoint?: string,
) => { maxContext: number } | undefined;

/** 外部配置里的 sourceType 是字符串；只接受两个合法字面量 */
function normalizeSourceType(value: string | undefined): 'local' | 'cloud' | undefined {
    return value === 'local' || value === 'cloud' ? value : undefined;
}

/**
 * 构建 `buildCoWriteOptions` 的显式入参。
 */
export interface BuildCoWriteOptionsInput {
    /** 插件 settings 快照；缺省时只返回 signal（与原实现一致） */
    settings?: CoWriteOptionsSettings;
    /** 透传的取消信号 */
    signal?: AbortSignal;
    /** 可选的模型窗口解析回调，用于覆盖 provider 配置的 maxContext */
    resolveModelLimits?: ResolveModelLimits;
}

/**
 * 解析协同写作使用的模型（本地模式强制本地，不回退远程）。
 *
 * 云端模式：`coWriteCloudModel || defaultModel`；
 * 本地模式：走 `resolveCoWriteLocalModel` 的本地回退链（coWriteModel > proModel >
 * defaultModel > flashModel），显式云端模型返回 undefined 以阻断本地调用。
 *
 * @param settings - 插件 settings 快照；未加载时返回 undefined
 * @returns 模型名或 undefined
 * @example
 * ```ts
 * resolveCoWriteModel({ coWriteModelMode: 'cloud', coWriteCloudModel: 'gpt-4o' });
 * // => 'gpt-4o'
 * resolveCoWriteModel({ coWriteModel: 'deepseek-chat', customProviders: [] });
 * // => undefined（显式云端模型在本地模式下被阻断）
 * ```
 */
export function resolveCoWriteModel(
    settings?: CoWriteOptionsSettings,
): string | undefined {
    if (!settings) return undefined;
    const mode = resolveEffectiveCoWriteMode(settings);
    if (mode === 'cloud') {
        return settings.coWriteCloudModel || settings.defaultModel || undefined;
    }
    return resolveCoWriteLocalModel(settings);
}

/**
 * 解析协同写作的实际生效模式。
 *
 * M-2（2026-11-10 用户拍板）：本地模式未选择任何本地模型时**自动切换云端**，
 * 而不是把请求打到 localhost 后失败。只有显式选中的本地模型才留在本地模式。
 *
 * @param settings - 插件 settings 快照
 * @returns 'local' | 'cloud'
 *
 * @example
 * resolveEffectiveCoWriteMode({ coWriteModelMode: 'local', customProviders: [ollama] }) // 'cloud'
 * resolveEffectiveCoWriteMode({ coWriteModelMode: 'local', coWriteModel: 'qwen2.5:7b' }) // 'local'
 */
export function resolveEffectiveCoWriteMode(
    settings?: CoWriteOptionsSettings,
): 'local' | 'cloud' {
    if (!settings) return 'local';
    const mode = settings.coWriteModelMode || 'local';
    if (mode === 'local' && !resolveCoWriteLocalModel(settings)) return 'cloud';
    return mode;
}

/**
 * 解析协同写作本地模型所属的 provider。
 *
 * 旧实现只认 id === 'ollama'：用户重命名/新增本地 provider 后 opts.endpoint 为空，
 * callAI 会回退到全局 apiEndpoint（通常是云端），造成「本地模式静默打云端」。
 * 选择顺序：包含目标模型的本地 provider > id === 'ollama' > 第一个本地 provider。
 *
 * @param settings - 插件 settings 快照；未加载时返回 null
 * @param model - 首选模型名；缺省时用 provider 的第一个模型
 * @param resolveModelLimits - 可选的插件窗口解析回调，抛出时保留 provider 配置值
 * @returns 路由结果或 null（无可用本地 provider）
 * @example
 * ```ts
 * const route = resolveCoWriteLocalProvider(
 *     {
 *         customProviders: [
 *             { id: 'local-x', endpoint: 'http://localhost:1234/v1', sourceType: 'local', models: ['qwen:7b'], maxContext: 8192 },
 *         ],
 *     },
 *     'qwen:7b',
 * );
 * // => { providerId: 'local-x', endpoint: 'http://localhost:1234/v1', apiKey: 'ollama', maxContext: 8192 }
 * ```
 */
export function resolveCoWriteLocalProvider(
    settings: CoWriteOptionsSettings | undefined,
    model?: string,
    resolveModelLimits?: ResolveModelLimits,
): LocalProviderRoute | null {
    if (!settings) return null;
    const providers = (settings.customProviders || []).filter(
        p => p?.endpoint && resolveProviderSourceType({ id: p.id, endpoint: p.endpoint, sourceType: normalizeSourceType(p.sourceType) }) === 'local',
    );
    const chosen = (model ? providers.find(p => p.models?.includes(model)) : undefined)
        || providers.find(p => p.id === 'ollama')
        || providers[0];
    if (!chosen) return null;

    const modelName = model || chosen.models?.[0] || '';
    const configured = chosen.maxContext;
    let maxContext = typeof configured === 'number' && Number.isFinite(configured) && configured > 0
        ? configured
        : findModelCapability(modelName, 'local').maxContext;
    try {
        const resolved = resolveModelLimits?.(modelName, chosen.endpoint)?.maxContext;
        if (typeof resolved === 'number' && Number.isFinite(resolved) && resolved > 0) {
            maxContext = resolved;
        }
    } catch {
        // 保留 provider 配置值
    }
    return {
        providerId: chosen.id,
        endpoint: chosen.endpoint,
        apiKey: settings.providerKeys?.[chosen.id] || 'ollama',
        maxContext,
    };
}

/**
 * 构建协同写作的 callAI options（本地模型使用 Ollama 端点 + settings 参数）。
 *
 * 云端模式：按 `coWriteCloudProvider` 查找自定义 provider，取端点和 API Key，
 * 并显式允许 fallback。本地模式：解析本地 provider 并强制 `disableFallback = true`；
 * 找不到本地 provider 时返回 `localRouteError` + 不可达兜底端点，让调用失败而不是
 * 把本地内容发到云端。`numCtx` 取用户配置与 provider 窗口的较小值，最低 2048。
 *
 * @param input - settings 快照、取消信号与可选的窗口解析回调
 * @returns callAI options（settings 未加载时仅含 signal）
 * @example
 * ```ts
 * const options = buildCoWriteOptions({
 *     settings: plugin.settings,
 *     signal: controller.signal,
 *     resolveModelLimits: (model, endpoint) => plugin.resolveModelLimits(model, endpoint),
 * });
 * if (options.localRouteError) return { content: '', error: options.localRouteError };
 * plugin.callAI(system, user, model, temperature, maxTokens, options);
 * ```
 */
export function buildCoWriteOptions(
    input: BuildCoWriteOptionsInput = {},
): CoWriteCallOptions {
    const opts: CoWriteCallOptions = {};
    if (input.signal) opts.signal = input.signal;
    const settings = input.settings;
    if (!settings) return opts;

    const mode = resolveEffectiveCoWriteMode(settings);
    if (mode === 'cloud') {
        // M-2：本地模式没有可用本地模型时自动走这里；显式云端模式行为不变
        const autoSwitched = (settings.coWriteModelMode || 'local') === 'local';
        // 云端模式：根据供应商查找端点和 API Key
        const providerId = settings.coWriteCloudProvider || '';
        if (providerId) {
            // 从自定义供应商查找
            const custom = settings.customProviders?.find(p => p.id === providerId);
            if (custom?.endpoint) {
                opts.endpoint = custom.endpoint;
            }
            // API Key
            const apiKey = settings.providerKeys?.[providerId] || '';
            if (apiKey) {
                opts.apiKey = apiKey;
            }
        }
        // 云端模式允许 fallback
        opts.disableFallback = false;
        if (autoSwitched) opts.autoSwitchedToCloud = true;
    } else {
        // 本地模式：按模型所属本地 provider 解析端点；找不到就阻断，绝不回退云端
        const model = resolveCoWriteModel(settings);
        const local = resolveCoWriteLocalProvider(settings, model, input.resolveModelLimits);
        opts.disableFallback = true;
        if (!local) {
            opts.localRouteError = '未找到可用的本地模型供应商：请在设置中配置 Ollama/本地端点，或切换为云端模式';
            // 兜底端点仅用于让调用失败而不是把本地内容发到云端
            opts.endpoint = 'http://127.0.0.1:1/v1/chat/completions';
            opts.apiKey = 'ollama';
        } else {
            opts.endpoint = local.endpoint;
            opts.apiKey = local.apiKey;
            const configured = settings.coWriteNumCtx && settings.coWriteNumCtx > 0
                ? Math.min(settings.coWriteNumCtx, local.maxContext)
                : local.maxContext;
            opts.numCtx = Math.max(2048, configured);
        }
    }
    return opts;
}
