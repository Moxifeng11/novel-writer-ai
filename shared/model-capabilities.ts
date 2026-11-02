/**
 * model-capabilities.ts — AI 模型能力集中配置
 * 来自各模型官方文档（2026-06 校对），供 main.ts / token-estimator.ts / ai-engine.ts 共同引用
 * 用户自定义模型可通过 CustomProvider 扩展，未在此表中列出的回退到 provider 预设值
 */
export interface ModelCapability {
    maxContext: number;
    maxOutput: number;
}

/** 主流模型能力映射表 */
export const MODEL_CAPABILITIES: Record<string, ModelCapability> = {
    // ── SenseNova（日日新）──
    'sensenova-6.7-flash-lite':      { maxContext: 262144,  maxOutput: 65536 },
    'sensenova-u1-fast':             { maxContext: 65536,   maxOutput: 4096 },
    // ── DeepSeek V4（官方 api-docs.deepseek.com）──
    'deepseek-v4-flash':             { maxContext: 1048576, maxOutput: 131072 },
    'deepseek-v4-pro':               { maxContext: 1048576, maxOutput: 131072 },
    // ── DeepSeek V3 / R1 ──
    'deepseek-v3':                   { maxContext: 131072,  maxOutput: 8192 },
    'deepseek-chat':                 { maxContext: 131072,  maxOutput: 8192 },
    'deepseek-r1':                   { maxContext: 131072,  maxOutput: 65536 },
    'deepseek-reasoner':             { maxContext: 131072,  maxOutput: 65536 },
    'deepseek-r1-0528':              { maxContext: 131072,  maxOutput: 65536 },
    // ── DeepSeek V3.2（火山引擎托管）──
    'deepseek-v3-2-251201':          { maxContext: 128000,  maxOutput: 32768 },
    // ── 豆包 Seed 2.0（火山引擎）──
    'doubao-seed-2-0-pro-260215':    { maxContext: 256000,  maxOutput: 131072 },
    'doubao-seed-2-0-code-preview-260215': { maxContext: 256000, maxOutput: 131072 },
    // 2-1 系列（按子串匹配，未登记会回退到 4096，导致长实体补全被截断）
    'doubao-seed-2-1':               { maxContext: 256000,  maxOutput: 131072 },
    // ── 豆包 Seed 1.8 ──
    'doubao-seed-1-8-251228':        { maxContext: 256000,  maxOutput: 65536 },
    // ── 豆包 Seed 1.6（旧版）──
    'doubao-seed-1-6-pro-250728':    { maxContext: 128000,  maxOutput: 16384 },
    'doubao-seed-1-6-flash-250715':  { maxContext: 128000,  maxOutput: 4096 },
    // ── GLM-4（智谱）──
    'glm-4-7-251222':                { maxContext: 128000,  maxOutput: 4096 },
    'glm-4-plus':                    { maxContext: 128000,  maxOutput: 4096 },
    'glm-4-air':                     { maxContext: 128000,  maxOutput: 16384 },
    'glm-4-flash':                   { maxContext: 128000,  maxOutput: 16384 },
    // ── OpenAI ──
    'gpt-4o':                        { maxContext: 128000,  maxOutput: 16384 },
    'gpt-4o-mini':                   { maxContext: 128000,  maxOutput: 16384 },
    'gpt-4.1':                       { maxContext: 1048576, maxOutput: 32768 },
    'gpt-4.1-mini':                  { maxContext: 1048576, maxOutput: 32768 },
    'gpt-4.1-nano':                  { maxContext: 1048576, maxOutput: 32768 },
    'o4-mini':                       { maxContext: 200000,  maxOutput: 100000 },
    'o3':                            { maxContext: 200000,  maxOutput: 100000 },
    // ── Gemini（Google）── gemini-2.5-pro 覆盖所有 2.5-pro-* 变体，gemini-3 覆盖所有 3.x 变体
    'gemini-3.1-pro-preview-search': { maxContext: 1048576, maxOutput: 65536 },
    'gemini-2.5-pro':                { maxContext: 1048576, maxOutput: 65536 },
    'gemini-2.5-flash':              { maxContext: 1048576, maxOutput: 65536 },
    'gemini-3':                      { maxContext: 1048576, maxOutput: 65536 },
    // ── Claude ──
    'claude-opus-4-8':               { maxContext: 1048576, maxOutput: 131072 },
    'claude-sonnet-4-6':             { maxContext: 1048576, maxOutput: 65536 },
    'claude-4-opus':                 { maxContext: 1048576, maxOutput: 131072 },
    'claude-4-sonnet':               { maxContext: 1048576, maxOutput: 65536 },
    'claude-3.7-sonnet':             { maxContext: 200000,  maxOutput: 8192 },
    'claude-haiku-4-5':              { maxContext: 200000,  maxOutput: 65536 },
    // ── Qwen3 ──
    'qwen3-max':                     { maxContext: 262144,  maxOutput: 32768 },
    'qwen3-plus':                    { maxContext: 1048576, maxOutput: 32768 },
    'qwen3-coder':                   { maxContext: 262144,  maxOutput: 65536 },
    'qwen-plus':                     { maxContext: 1048576, maxOutput: 32768 },
    'qwen-flash':                    { maxContext: 1048576, maxOutput: 8192 },
    // ── 本地 Ollama ──
    'qwen2.5:7b':                    { maxContext: 32768,   maxOutput: 8192 },
    'deepseek-r1:7b':                { maxContext: 32768,   maxOutput: 8192 },
};

/** 默认上下文窗口（未匹配时回退） */
export const DEFAULT_CONTEXT_WINDOW = 32768;
/**
 * 未登记模型的输出兜底。4096 会让大多数现代模型在长文本任务中被截断，
 * 因此提高到 8192；真实上限仍优先取用户「模型覆盖」配置。
 */
export const DEFAULT_MAX_OUTPUT = 8192;

/**
 * 本地模型未登记时的保守兜底。
 * 本地 7B/13B 的常见部署窗口远小于云端，沿用 32768/8192 会让 num_predict
 * 一次性开到上万 token，表现为长时间无响应。
 */
export const LOCAL_FALLBACK_CAPABILITY: ModelCapability = { maxContext: 8192, maxOutput: 4096 };

/**
 * 模型来源种类结构定义。
 */
export type ModelSourceKind = 'local' | 'cloud';

/**
 * 运行时探测到的能力（进程内缓存）。
 * 真实探测值优先于静态文档表，但用户「模型覆盖」仍优先于两者（由 ProviderManager 处理）。
 */
const detectedCapabilities = new Map<string, ModelCapability>();

/**
 * registerDetectedModelCapability 函数。
 * @param modelId - 模型ID
 * @param capability - 能力信息
 */
export function registerDetectedModelCapability(modelId: string, capability: ModelCapability): void {
    const key = (modelId || '').trim().toLowerCase();
    if (!key) return;
    if (!Number.isFinite(capability.maxContext) || capability.maxContext <= 0) return;
    detectedCapabilities.set(key, {
        maxContext: Math.floor(capability.maxContext),
        maxOutput: Math.max(1, Math.floor(capability.maxOutput)),
    });
}

/**
 * getDetectedModelCapability 函数。
 * @param modelId - 模型ID
  * @returns ModelCapability 或 null
 */
export function getDetectedModelCapability(modelId: string): ModelCapability | null {
    return detectedCapabilities.get((modelId || '').trim().toLowerCase()) ?? null;
}

/**
 * clearDetectedModelCapabilities 函数。
 */
export function clearDetectedModelCapabilities(): void {
    detectedCapabilities.clear();
}

/**
 * 按模型 ID 子串查找能力映射，**最长键优先**。
 *
 * 旧实现按对象插入顺序首次命中即返回，导致 `deepseek-r1:7b`（本地 32768/8192）
 * 先命中 `deepseek-r1`（云端 131072/65536），本地小模型被放大预算。
 * @param modelId - 模型ID
  * @returns ModelCapability 或 null
 */
export function lookupModelCapability(modelId: string): ModelCapability | null {
    const lower = (modelId || '').toLowerCase();
    if (!lower) return null;
    let bestKeyLength = 0;
    let bestCaps: ModelCapability | null = null;
    for (const [key, caps] of Object.entries(MODEL_CAPABILITIES)) {
        const k = key.toLowerCase();
        if (k.length <= bestKeyLength) continue;
        if (!lower.includes(k)) continue;
        bestKeyLength = k.length;
        bestCaps = caps;
    }
    return bestCaps;
}

/**
 * 按模型 ID 子串查找能力映射
 * 未找到时按来源回退：本地更保守，云端沿用全局默认
 * @param modelId - 模型ID
 * @param source - 来源
  * @returns ModelCapability 实例
 */
export function findModelCapability(modelId: string, source?: ModelSourceKind): ModelCapability {
    const detected = getDetectedModelCapability(modelId);
    if (detected) return detected;
    const hit = lookupModelCapability(modelId);
    if (hit) return hit;
    if (source === 'local') return LOCAL_FALLBACK_CAPABILITY;
    return { maxContext: DEFAULT_CONTEXT_WINDOW, maxOutput: DEFAULT_MAX_OUTPUT };
}
