/**
 * TokenEstimator — 精细化 token 估算器 (v4.1)
 * 
 * 替代简单字符÷1.5 粗估公式，支持：
 * - 中英混合文本分层估算
 * - 模型特定的 tokenizer 特征感知
 * - Prompt 模板预留量计算
 * - 模型能力来自 shared/model-capabilities.ts（非硬编码）
 */

import { TOKEN_ESTIMATE_CN_DIVISOR, TOKEN_ESTIMATE_EN_DIVISOR } from './thresholds';
import { findModelCapability, type ModelSourceKind } from './model-capabilities';

/**
 * TokenEstimate 类型定义。
 */
export interface TokenEstimate {
    input: number;
    maxOutput: number;
    contextWindow: number;
    available: number;      // contextWindow - input
    isSafe: boolean;        // 是否安全（available >= maxOutput * 1.2）
    modelId: string;
}

/**
 * 估算文本的 token 数（中英混合）
 * 
 * 中文：约 1.5 字符/token
 * 英文：约 4 字符/token  
 * Prompt 模板/JSON：约 3.5 字符/token（中等效率）
 * @param text - 文本内容
 * @param modelId - 模型ID
 * @returns 数值结果
 */
export function estimateTokens(text: string, modelId: string = 'default'): number {
    if (!text) return 0;
    
    // 统计中文字符 vs 英文/代码字符
    let cnChars = 0;
    let enChars = 0;
    
    for (const ch of text) {
        const code = ch.charCodeAt(0);
        if (code >= 0x4e00 && code <= 0x9fff) {
            cnChars++; // CJK 统一区
        } else if (code >= 0x3400 && code <= 0x4dbf) {
            cnChars++; // CJK 扩展A
        } else if (code >= 0x20000 && code <= 0x2a6df) {
            cnChars++; // CJK 扩展B
        } else if (code === 0x3000 || (code >= 0x3001 && code <= 0x303f)) {
            cnChars++; // CJK 标点
        } else if (code >= 0xff00 && code <= 0xffef) {
            cnChars++; // 全角字符
        } else if (code <= 0x7f) {
            enChars++; // ASCII
        } else {
            enChars++; // 其他（日韩、emoji 等，按英文处理）
        }
    }
    
    // 各模型 tokenizer 效率微调系数
    let cnRatio = TOKEN_ESTIMATE_CN_DIVISOR;  // 默认 1.5
    let enRatio = TOKEN_ESTIMATE_EN_DIVISOR;  // 默认 4
    
    // GPT 系列 cl100k_base tokenizer 对中文更高效
    const m = modelId.toLowerCase();
    if (m.includes('gpt-4') || m.includes('gpt-3')) {
        cnRatio = 1.8;   // GPT tokenizer 中文约 1.8 字符/token
        enRatio = 3.5;
    } else if (m.includes('claude')) {
        cnRatio = 1.3;   // Claude 中文 token 化效率较低
        enRatio = 4.5;
    } else if (m.includes('deepseek') || m.includes('glm') || m.includes('doubao') || m.includes('qwen')) {
        cnRatio = 1.6;   // 国产模型中文 tokenizer 较优
        enRatio = 4.0;
    }
    
    return Math.ceil(cnChars / cnRatio + enChars / enRatio);
}

/**
 * 估算 API 调用的输入 token 数
 * @param systemPrompt - 系统提示词
 * @param userPrompt - 用户提示词
 * @param modelId - 模型ID
 * @returns 数值结果
 */
export function estimateInputTokens(
    systemPrompt: string,
    userPrompt: string,
    modelId: string = 'default',
): number {
    // system prompt 中 JSON/配置结构较多，额外加 10%
    const sysTokens = estimateTokens(systemPrompt, modelId) * 1.1;
    const userTokens = estimateTokens(userPrompt, modelId);
    return Math.ceil(sysTokens + userTokens);
}

/**
 * 获取模型上下文窗口大小（从 model-capabilities 查找）
 * `source` 用于未登记模型的兜底：本地模型按更保守的窗口处理
 * @param modelId - 模型ID
 * @param source - 来源
 * @returns 数值结果
 */
export function getModelContextWindow(modelId: string, source?: ModelSourceKind): number {
    return findModelCapability(modelId, source).maxContext;
}

/**
 * 获取模型最大输出 token 数（从 model-capabilities 查找）
 * `source` 用于未登记模型的兜底：本地模型按更保守的输出上限处理
 * @param modelId - 模型ID
 * @param source - 来源
 * @returns 数值结果
 */
export function getModelMaxOutput(modelId: string, source?: ModelSourceKind): number {
    return findModelCapability(modelId, source).maxOutput;
}

/**
 * ModelLimitOverrides 类型定义。
 */
export interface ModelLimitOverrides {
    maxContext?: number;
    maxOutput?: number;
}

/**
 * 计算完整的 token 预算
 * 返回是否安全、可用余量等信息，供调用方决策。
 *
 * `limits` 传入用户「模型覆盖」中的真实上限；未传时回退静态能力表。
 * 只查静态表会把未登记模型（如 deepseek-flash）误判为 32K 上下文，
 * 导致长上下文请求被错误拒绝。
 * @param systemPrompt - 系统提示词
 * @param userPrompt - 用户提示词
 * @param modelId - 模型ID
 * @param limits - 限制
  * @returns TokenEstimate 实例
 */
export function calculateTokenBudget(
    systemPrompt: string,
    userPrompt: string,
    modelId: string = 'default',
    limits?: ModelLimitOverrides,
): TokenEstimate {
    const input = estimateInputTokens(systemPrompt, userPrompt, modelId);
    const maxOutput = limits?.maxOutput && limits.maxOutput > 0
        ? limits.maxOutput
        : getModelMaxOutput(modelId);
    const contextWindow = limits?.maxContext && limits.maxContext > 0
        ? limits.maxContext
        : getModelContextWindow(modelId);
    const available = contextWindow - input;
    
    return {
        input,
        maxOutput,
        contextWindow,
        available,
        isSafe: available >= maxOutput * 1.2,
        modelId,
    };
}

/**
 * 推荐的 max_tokens：不超过可用窗口的 80% 和模型最大输出的较小值
 * @param systemPrompt - 系统提示词
 * @param userPrompt - 用户提示词
 * @param modelId - 模型ID
 * @returns 数值结果
 */
export function recommendMaxTokens(
    systemPrompt: string,
    userPrompt: string,
    modelId: string = 'default',
): number {
    const budget = calculateTokenBudget(systemPrompt, userPrompt, modelId);
    const safe = Math.min(
        Math.floor(budget.available * 0.8),
        budget.maxOutput,
    );
    return Math.max(safe, 256); // 至少 256 tokens
}
