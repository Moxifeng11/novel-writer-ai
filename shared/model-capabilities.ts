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
    // ── Gemini ──
    'gemini-3.1-pro-preview-search': { maxContext: 1048576, maxOutput: 65536 },
    'gemini-2.5-pro':                { maxContext: 1048576, maxOutput: 65536 },
    'gemini-2.5-flash':              { maxContext: 1048576, maxOutput: 65536 },
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
export const DEFAULT_MAX_OUTPUT = 4096;

/**
 * 按模型 ID 子串查找能力映射
 * 未找到返回默认值
 */
export function findModelCapability(modelId: string): ModelCapability {
    const lower = modelId.toLowerCase();
    for (const [key, caps] of Object.entries(MODEL_CAPABILITIES)) {
        if (lower.includes(key.toLowerCase())) return caps;
    }
    return { maxContext: DEFAULT_CONTEXT_WINDOW, maxOutput: DEFAULT_MAX_OUTPUT };
}
