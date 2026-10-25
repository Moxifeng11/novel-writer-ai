/**
 * local-model-probe.ts — 本地 Ollama 模型能力自动探测
 *
 * 静态能力表不可能覆盖用户本地拉取的每个模型。这里调用 Ollama `/api/show`
 * 读取真实的 `*.context_length`，注册到 `shared/model-capabilities` 的运行时缓存，
 * 让预算计算/num_ctx 不再依赖「未登记即 8192」的猜测。
 */
import { createLogger } from '../shared/logger';
import {
    getDetectedModelCapability,
    lookupModelCapability,
    registerDetectedModelCapability,
    type ModelCapability,
} from '../shared/model-capabilities';

const log = createLogger('LocalModelProbe');

export const LOCAL_PROBE_TIMEOUT_MS = 4_000;
/** 探测失败后的冷却时间，避免每次请求都为不可用的本地服务多等一次超时 */
const PROBE_FAILURE_TTL_MS = 5 * 60 * 1000;
/** 输出上限占窗口的比例（Ollama 的输入与输出共享同一个 num_ctx） */
const OUTPUT_CONTEXT_RATIO = 0.25;
const MAX_PROBED_OUTPUT = 8192;

const probedKeys = new Set<string>();
const failedAt = new Map<string, number>();
const inflight = new Map<string, Promise<ModelCapability | null>>();

/** 把任意 Ollama 端点收敛为 base（去掉 /v1/chat/completions、/api/generate 等路径） */
export function normalizeOllamaBaseUrl(endpoint: string): string | null {
    if (!endpoint) return null;
    try {
        const url = new URL(endpoint);
        return `${url.protocol}//${url.host}`;
    } catch {
        return null;
    }
}

function buildCapability(contextLength: number): ModelCapability | null {
    if (!Number.isFinite(contextLength) || contextLength < 512) return null;
    return {
        maxContext: Math.floor(contextLength),
        maxOutput: Math.min(
            MAX_PROBED_OUTPUT,
            Math.max(512, Math.floor(contextLength * OUTPUT_CONTEXT_RATIO)),
        ),
    };
}

/**
 * 从 `/api/show` 响应解析上下文长度。
 * 优先 `model_info[<arch>.context_length]`，其次 `general.context_length`，
 * 最后回退 `parameters` 里的 `num_ctx`。
 */
export function parseOllamaShowContextLength(payload: unknown): number | null {
    const data = payload as {
        model_info?: Record<string, unknown>;
        parameters?: unknown;
    } | null;

    const info = data?.model_info;
    if (info && typeof info === 'object') {
        const arch = typeof info['general.architecture'] === 'string'
            ? info['general.architecture']
            : '';
        const candidates = [
            arch ? info[`${arch}.context_length`] : undefined,
            info['general.context_length'],
            info['context_length'],
        ];
        for (const value of candidates) {
            const n = typeof value === 'number' ? value : Number(value);
            if (Number.isFinite(n) && n >= 512) return n;
        }
    }

    if (typeof data?.parameters === 'string') {
        const match = data.parameters.match(/^\s*num_ctx\s+(\d+)\s*$/m);
        if (match) {
            const n = Number(match[1]);
            if (Number.isFinite(n) && n >= 512) return n;
        }
    }

    return null;
}

/**
 * 探测单个模型的能力（带缓存与并发去重）。
 * 失败会进入 5 分钟冷却，冷却期内直接返回 null，不再发起请求。
 */
export async function probeOllamaModelCapability(
    endpoint: string,
    modelId: string,
    options?: { timeoutMs?: number },
): Promise<ModelCapability | null> {
    const base = normalizeOllamaBaseUrl(endpoint);
    if (!base || !modelId) return null;

    const key = `${base}::${modelId.toLowerCase()}`;
    if (probedKeys.has(key)) return getDetectedModelCapability(modelId);

    const failedTimestamp = failedAt.get(key);
    if (failedTimestamp && Date.now() - failedTimestamp < PROBE_FAILURE_TTL_MS) return null;

    const running = inflight.get(key);
    if (running) return running;

    const task = (async (): Promise<ModelCapability | null> => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), options?.timeoutMs ?? LOCAL_PROBE_TIMEOUT_MS);
        try {
            const response = await fetch(`${base}/api/show`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ model: modelId }),
                signal: controller.signal,
            });
            if (!response.ok) {
                failedAt.set(key, Date.now());
                return null;
            }
            const payload = await response.json();
            const contextLength = parseOllamaShowContextLength(payload);
            const capability = contextLength ? buildCapability(contextLength) : null;
            if (capability) {
                registerDetectedModelCapability(modelId, capability);
                probedKeys.add(key);
                log.info(`[LocalModelProbe] ${modelId} 上下文窗口 ${capability.maxContext}`);
            } else {
                failedAt.set(key, Date.now());
            }
            return capability;
        } catch (e) {
            failedAt.set(key, Date.now());
            log.debug(`[LocalModelProbe] ${modelId} 能力探测失败: ${String(e)}`);
            return null;
        } finally {
            clearTimeout(timer);
            inflight.delete(key);
        }
    })();

    inflight.set(key, task);
    return task;
}

/**
 * 仅在静态表未登记时探测：已登记模型直接使用文档值，避免每次启动多一次请求。
 */
export async function ensureLocalModelCapability(
    endpoint: string,
    modelId: string,
    options?: { timeoutMs?: number },
): Promise<void> {
    if (!endpoint || !modelId) return;
    if (getDetectedModelCapability(modelId) || lookupModelCapability(modelId)) return;
    await probeOllamaModelCapability(endpoint, modelId, options);
}

/** 清空探测缓存（测试与设置变更时使用） */
export function clearLocalModelProbeCache(): void {
    probedKeys.clear();
    failedAt.clear();
    inflight.clear();
}
