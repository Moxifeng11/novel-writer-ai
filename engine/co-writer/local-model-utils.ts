/**
 * local-model-utils.ts — 协同写作本地模型判定与 Ollama 探测
 *
 * 从 co-writer-engine.ts 抽出的纯工具函数：只依赖设置字段与 model-source 解析，
 * 不持有引擎状态（Ollama 缓存除外）。co-writer-engine 保留 re-export 兼容。
 */
import { resolveProviderSourceType } from '@/shared/model-source';
import { createLogger } from '@/shared/logger';

const log = createLogger('CoWriterEngine');

let ollamaModelCache: string[] | null = null;
let ollamaCacheTime: number = 0;
const OLLAMA_CACHE_TTL = 5 * 60 * 1000;
const OLLAMA_ENDPOINT = 'http://localhost:11434';

/** 协同模型判定只依赖这些设置字段，避免把整个 settings 传成 any */
export interface CoWriteProviderLike {
    id: string;
    endpoint: string;
    sourceType?: string;
    models: string[];
}

export interface CoWriteModelSettings {
    customProviders?: CoWriteProviderLike[];
    coWriteModel?: string;
    proModel?: string;
    defaultModel?: string;
    flashModel?: string;
    availableModels?: string[];
}

/** 外部配置里的 sourceType 是字符串；只接受两个合法字面量 */
function normalizeSourceType(value: string | undefined): 'local' | 'cloud' | undefined {
    return value === 'local' || value === 'cloud' ? value : undefined;
}

/** 运行时 JSON 窄化（Ollama /api/tags 等外部响应） */
function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}
// ============================================================
// 工具函数
// ============================================================

/**
 * 判断 provider 的 endpoint 是否指向本地
 * 统一复用 model-source 的源类型解析（含 sourceType 显式标记 + endpoint 启发式兜底）
 * @param endpoint - 接口地址
 * @returns 是否成功
 */
export function isLocalProviderEndpoint(endpoint: string): boolean {
    if (!endpoint) return false;
    return resolveProviderSourceType({ id: '', endpoint }) === 'local';
}

/**
 * 判断模型是否为本地模型
 * 判断规则：
 *   1. 若模型在某 provider 的 models 列表中，按该 provider 的 sourceType 判定
 *   2. 否则按模型名特征兜底（本地模型常带 ':' 或 'local'）
 *
 * @param modelName 模型名
 * @param settings 可选，插件 settings，用于检查模型所属 provider
 * @returns 是否成功
 */
export function isLocalModel(modelName: string, settings?: CoWriteModelSettings): boolean {
    if (!modelName) return false;
    const providers = settings?.customProviders || [];
    const owner = providers.find(p => Array.isArray(p.models) && p.models.includes(modelName));
    if (owner) {
        return resolveProviderSourceType({ id: owner.id, endpoint: owner.endpoint, sourceType: normalizeSourceType(owner.sourceType) }) === 'local';
    }
    const lower = modelName.toLowerCase();
    return lower.includes(':') || lower.includes('local');
}

/**
 * 解析协同写作本地模型（含回退逻辑）
 *
 * 本地模式必须落在本地 provider 上：显式 coWriteModel 如果属于云端 provider，
 * 返回 undefined，由调用方报错并阻断，绝不把本地内容发到云端。
 *
 * 回退优先级：coWriteModel（本地） > proModel（本地） > defaultModel（本地） > flashModel（本地）
 * @param settings - 设置
  * @returns 文本结果 或 undefined
 */
export function resolveCoWriteLocalModel(settings: CoWriteModelSettings): string | undefined {
    if (!settings) return undefined;
    const providers = settings.customProviders || [];
    const isLocalProvider = (model: string): boolean => {
        const owner = providers.find(p => Array.isArray(p.models) && p.models.includes(model));
        if (owner) {
            return resolveProviderSourceType({ id: owner.id, endpoint: owner.endpoint, sourceType: normalizeSourceType(owner.sourceType) }) === 'local';
        }
        return isLocalModel(model, settings);
    };

    if (settings.coWriteModel && String(settings.coWriteModel).trim()) {
        return isLocalProvider(settings.coWriteModel) ? settings.coWriteModel : undefined;
    }
    // 回退：从候选模型中找本地模型
    const candidates = [
        settings.proModel,
        settings.defaultModel,
        settings.flashModel,
    ];
    for (const model of candidates) {
        if (model && isLocalProvider(model)) {
            return model;
        }
    }
    return undefined;
}

/**
 * 模型列表去重并保持顺序
 * 使用 Set 去重，保持原有顺序
 * @param models - 模型列表
 * @returns 结果数组
 */
export function dedupeModels(models: string[]): string[] {
    if (!Array.isArray(models)) return [];
    return Array.from(new Set(models));
}

/**
 * fetchOllamaModels 函数。
  * @returns 结果数组 或 null
 */
export async function fetchOllamaModels(): Promise<string[] | null> {
    const now = Date.now();
    if (ollamaModelCache && now - ollamaCacheTime < OLLAMA_CACHE_TTL) {
        return ollamaModelCache;
    }

    try {
        const controller = new AbortController();
        const timeoutId = window.setTimeout(() => controller.abort(), 3000);

        const response = await fetch(`${OLLAMA_ENDPOINT}/api/tags`, {
            method: 'GET',
            signal: controller.signal,
        });

        window.clearTimeout(timeoutId);

        if (!response.ok) {
            return null;
        }

        const data: unknown = await response.json();
        const rawModels = isRecord(data) && Array.isArray(data.models) ? data.models : [];
        const models = rawModels
            .filter((m): m is { name: string } => isRecord(m) && typeof m.name === 'string')
            .map(m => m.name);

        ollamaModelCache = models;
        ollamaCacheTime = now;

        return models;
    } catch (e) {
        // S2: 原本静默 return null，Ollama 探测失败时无任何痕迹；
        // 补诊断日志便于排查「本地模型列表为空」类问题，返回契约保持不变。
        log.warn('[CoWriterEngine] Ollama 模型列表获取失败，降级为本地模型配置:', e);
        return null;
    }
}

/**
 * getFallbackLocalModels 函数。
 * @param settings - 设置
 * @returns 结果数组
 */
export function getFallbackLocalModels(settings: CoWriteModelSettings): string[] {
    if (!settings || !Array.isArray(settings.availableModels)) return [];
    return settings.availableModels.filter((m: string) => isLocalModel(m, settings));
}

/**
 * getOllamaModelsWithFallback 函数。
 * @param settings - 设置
 * @returns 结果数组
 */
export async function getOllamaModelsWithFallback(settings: CoWriteModelSettings): Promise<string[]> {
    const ollamaModels = await fetchOllamaModels();
    if (ollamaModels && ollamaModels.length > 0) {
        return ollamaModels;
    }
    return getFallbackLocalModels(settings);
}
