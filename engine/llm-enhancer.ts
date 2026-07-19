/**
 * llm-enhancer.ts — LLM 增强拆解器
 *
 * 作为纯统计拆解的可选补充层，调用大模型对各维度结果做语义提炼。
 *
 * 设计原则：
 * - 默认不启用，由设置面板的 llmEnabled 开关控制
 * - 失败时优雅降级到纯统计结果（返回 existingResult）
 * - 不修改纯统计流程的任何核心逻辑
 * - 通过 LLMCaller 接口与具体 AI 引擎解耦，便于单元测试
 *
 * 使用方式：
 *   const enhancer = new LLMEnhancer(aiEngine, { llmModel: 'deepseek-r1:7b' });
 *   const result = await enhancer.enhanceWithLLM({ dimension: 'personality', text, existingResult });
 *   if (result.success && result.data) { ... }
 */

import type { GenreConfig } from './genre/types';
import { getDimensionPrompt, type LLMEnhanceDimension } from './llm-prompts';
import { createLogger } from '../shared/logger';


const log = createLogger('LlmEnhancer');
/** 降级标记 Symbol：enhanceResult 降级时附加在结果对象上，调用方可检查感知 */
export const LLM_DEGRADED = Symbol('llm_degraded');

/**
 * LLM 调用器接口。
 * AIEngine 天然实现该接口（callAI 方法签名兼容），测试时可注入 mock。
 */
export interface LLMCaller {
    callAI(
        systemPrompt: string,
        userPrompt: string,
        model?: string,
        temperature?: number,
        maxTokens?: number
    ): Promise<{ content: string; error?: string }>;
}

/** enhanceWithLLM 入参 */
export interface LLMEnhanceContext {
    /** 维度名 */
    dimension: LLMEnhanceDimension;
    /** 上下文摘要文本（建议 200-500 字） */
    text: string;
    /** 题材配置（可选，目前仅 genre 维度使用） */
    genreConfig?: GenreConfig;
    /** 纯统计结果（可选，LLM 参考 + 降级兜底） */
    existingResult?: unknown;
}

/** enhanceWithLLM 出参（泛型 T 默认 unknown，调用方可指定具体类型） */
export interface LLMEnhanceResult<T = unknown> {
    /** 维度名 */
    dimension: LLMEnhanceDimension;
    /** 是否成功（LLM 返回了可解析的 JSON） */
    success: boolean;
    /** LLM 提炼的数据（success=true 时有效） */
    data?: T;
    /** 是否使用了降级（LLM 失败时返回 existingResult） */
    fallbackUsed: boolean;
    /** 降级时的兜底数据（即 existingResult） */
    fallbackData?: unknown;
    /** 错误信息（success=false 时有效） */
    error?: string;
}

/** LLMEnhancer 构造选项 */
export interface LLMEnhancerOptions {
    /** LLM 模型名（不传则使用 caller 默认模型） */
    llmModel?: string;
    /** 温度（默认 0.3，低温度保证结构化输出稳定） */
    temperature?: number;
    /** 最大 tokens（默认 2048） */
    maxTokens?: number;
}

/** 默认温度：低温度保证结构化输出稳定 */
const DEFAULT_TEMPERATURE = 0.3;
const DEFAULT_MAX_TOKENS = 2048;

export class LLMEnhancer {
    private caller: LLMCaller;
    private options: LLMEnhancerOptions;

    constructor(caller: LLMCaller, options?: LLMEnhancerOptions) {
        this.caller = caller;
        this.options = options ?? {};
    }

    /**
     * 通用 LLM 增强方法。
     *
     * 流程：
     * 1. 根据 dimension 构建提示词
     * 2. 调用 LLM
     * 3. 解析 JSON
     * 4. 失败时返回 existingResult（fallbackUsed=true）
     *
     * 异常处理：任何异常（网络/解析/超时）都降级返回 existingResult，记录警告。
     */
    async enhanceWithLLM<T = unknown>(context: LLMEnhanceContext): Promise<LLMEnhanceResult<T>> {
        const { dimension, text, genreConfig, existingResult } = context;

        if (!text || text.trim().length === 0) {
            return {
                dimension,
                success: false,
                fallbackUsed: true,
                fallbackData: existingResult,
                error: 'empty text',
            };
        }

        try {
            const { systemPrompt, userPrompt } = getDimensionPrompt(
                dimension,
                text,
                genreConfig,
                existingResult
            );

            const response = await this.caller.callAI(
                systemPrompt,
                userPrompt,
                this.options.llmModel,
                this.options.temperature ?? DEFAULT_TEMPERATURE,
                this.options.maxTokens ?? DEFAULT_MAX_TOKENS
            );

            if (response.error) {
                log.warn(`[LLMEnhancer] ${dimension} LLM 调用返回错误: ${response.error}，降级到纯统计结果`);
                return {
                    dimension,
                    success: false,
                    fallbackUsed: true,
                    fallbackData: existingResult,
                    error: response.error,
                };
            }

            const data = this.parseJSONResponse<T>(response.content);
            if (data === null) {
                log.warn(`[LLMEnhancer] ${dimension} LLM 返回内容无法解析为 JSON，降级到纯统计结果`);
                return {
                    dimension,
                    success: false,
                    fallbackUsed: true,
                    fallbackData: existingResult,
                    error: 'invalid JSON response',
                };
            }

            return {
                dimension,
                success: true,
                data,
                fallbackUsed: false,
            };
        } catch (e) {
            const errMsg = e instanceof Error ? e.message : String(e);
            log.warn(`[LLMEnhancer] ${dimension} LLM 增强异常，降级到纯统计结果:`, errMsg);
            return {
                dimension,
                success: false,
                fallbackUsed: true,
                fallbackData: existingResult,
                error: errMsg,
            };
        }
    }

    /**
     * 便捷方法：增强并合并到现有结果。
     *
     * 调用 enhanceWithLLM，成功时浅合并 data 到 result，失败时原样返回 result。
     * 适用于 deconstructor 在 analyze 末尾的可选调用。
     */
    async enhanceResult<T extends object>(
        result: T,
        text: string,
        dimension: LLMEnhanceDimension,
        genreConfig?: GenreConfig
    ): Promise<T> {
        const enhanced = await this.enhanceWithLLM<Partial<T>>({
            dimension,
            text,
            genreConfig,
            existingResult: result,
        });

        if (enhanced.success && enhanced.data && typeof enhanced.data === 'object') {
            // 浅合并：LLM 提炼的字段覆盖统计结果
            return { ...result, ...enhanced.data };
        }
        // 降级：标记原始 result 使调用方可感知
        Object.defineProperty(result, LLM_DEGRADED, { value: true, enumerable: false });
        return result;
    }

    /**
     * 解析 LLM 返回的 JSON。
     *
     * 容错处理：
     * - 去除可能的 Markdown 代码块包裹（```json ... ```）
     * - 去除前后空白和非 JSON 字符
     * - 解析失败返回 null
     */
    private parseJSONResponse<T>(content: string): T | null {
        if (!content || typeof content !== 'string') {
            return null;
        }

        let trimmed = content.trim();

        // 去除 Markdown 代码块包裹
        if (trimmed.startsWith('```')) {
            trimmed = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
        }

        // 尝试找到第一个 { 和最后一个 }，提取 JSON 主体
        const start = trimmed.indexOf('{');
        const end = trimmed.lastIndexOf('}');
        if (start === -1 || end === -1 || end <= start) {
            return null;
        }
        const jsonStr = trimmed.slice(start, end + 1);

        try {
            return JSON.parse(jsonStr) as T;
        } catch {
            return null;
        }
    }

    /**
     * 静态工具：为指定维度构建上下文摘要。
     *
     * 各维度的取样策略：
     * - personality/abilities: 取段落按角色密度排序，取前 3-5 段
     * - style: 取首章首段 + 中段 + 尾段
     * - rhythm: 取章节首尾段落
     * - foreshadow: 取伏笔候选上下文（简单方案：取首中尾段）
     * - goals/genre: 取文本前 500 字（默认）
     *
     * @param dimension 维度名
     * @param fullText 完整文本
     * @param paragraphs 段落数组（可选，未提供时按 \\n\\n 切分）
     * @returns 200-500 字的上下文摘要
     */
    static buildContextForDimension(
        dimension: LLMEnhanceDimension,
        fullText: string,
        paragraphs?: string[]
    ): string {
        if (!fullText) return '';

        const paras = paragraphs ?? fullText.split(/\n\n+/).map(p => p.trim()).filter(Boolean);
        if (paras.length === 0) return fullText.slice(0, 500);

        const MAX_CHARS = 500;

        switch (dimension) {
            case 'personality':
            case 'abilities': {
                // 简化方案：取前 3-5 段（角色密度计算需要角色名表，简化为前几段）
                const count = Math.min(5, paras.length);
                return paras.slice(0, count).join('\n\n').slice(0, MAX_CHARS);
            }
            case 'style': {
                // 首段 + 中段 + 尾段
                const head = paras[0] ?? '';
                const mid = paras[Math.floor(paras.length / 2)] ?? '';
                const tail = paras[paras.length - 1] ?? '';
                return [head, mid, tail].join('\n\n').slice(0, MAX_CHARS);
            }
            case 'rhythm': {
                // 章节首尾段落
                const head = paras.slice(0, 2).join('\n\n');
                const tail = paras.slice(-2).join('\n\n');
                return `${head}\n\n...\n\n${tail}`.slice(0, MAX_CHARS);
            }
            case 'foreshadow':
            case 'goals':
            case 'genre':
            default: {
                // 默认：取前 500 字
                return fullText.slice(0, MAX_CHARS);
            }
        }
    }
}
