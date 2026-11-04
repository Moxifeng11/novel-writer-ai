/**
 * ai-response-parse.ts — 协同写作 AI 响应的 JSON 解析（自 co-writer-engine.ts 抽出）
 *
 * 只负责「把协同 AI 的原始响应文本解析为结构化结果」这一件事：
 *  - 无引擎状态、无 this 依赖：输入原始响应字符串，输出纯数据对象
 *  - 共同前置处理：思考型模型会带 <think> 前缀与代码围栏解释，
 *    必须先 stripThinkingBlock + stripCodeFence 再提取 JSON，
 *    否则必然 parse 失败、落入「默认通过/空指标」分支，等于没有解析
 *  - 解析失败不抛异常：返回 degraded 标记或空指标，由调用方/UI 显式提示，
 *    绝不静默给一个「像成功」的分数
 *
 * co-writer-engine.ts 保留同名私有方法薄委托（既有测试经实例访问），
 * 其余调用点直接使用本模块导出的纯函数。
 */
import { extractJsonObject, stripCodeFence, stripThinkingBlock } from '@/shared/api-response-utils';
import { EDIT_VALIDATION_PASS_SCORE } from '@/shared/thresholds';
import { createLogger } from '@/shared/logger';
import type { EditValidation, PlotCompletionMetrics, SuggestionDirection } from '@/shared/types';

const log = createLogger('CoWriterEngine');

/**
 * 构造「尚未评估」的空完成度指标（纯函数，与抽取前行为完全一致）。
 *
 * 四维分数全 0、overallCompletion 为 0、建议文案固定为「尚未评估」，
 * 用于会话初始化、正文/模型不可用时的占位返回值。
 *
 * @returns 全 0 的 PlotCompletionMetrics（evaluatedAt 为当前时间戳）
 * @example
 * ```ts
 * const metrics = getEmptyMetrics();
 * // { sceneObjectivesMet: 0, characterArcsAdvanced: 0, foreshadowingSeeded: 0,
 * //   emotionalArcProgress: 0, overallCompletion: 0,
 * //   suggestionAdvice: '尚未评估', nextDirectionHints: ['action', 'emotion', 'dialogue'],
 * //   evaluatedAt: 1730000000000 }
 * ```
 */
export function getEmptyMetrics(): PlotCompletionMetrics {
    return {
        sceneObjectivesMet: 0,
        characterArcsAdvanced: 0,
        foreshadowingSeeded: 0,
        emotionalArcProgress: 0,
        overallCompletion: 0,
        suggestionAdvice: '尚未评估',
        nextDirectionHints: ['action', 'emotion', 'dialogue'],
        evaluatedAt: Date.now()
    };
}

/**
 * 构造「校验未真正完成」的降级校验结果（纯函数，与抽取前行为完全一致）。
 *
 * 不拦截用户继续使用（isValid 保持 true），但必须显式标记 degraded，
 * 由 UI 显示「校验未完成」——不能用 70 分伪装成通过。
 *
 * @param reason - 降级原因（如「验证已取消」「AI 返回中找不到校验 JSON」）
 * @returns degraded: true 的 EditValidation，三项分数均为 0
 * @example
 * ```ts
 * const v = buildDegradedValidation('验证已取消');
 * // { isValid: true, consistencyScore: 0, styleScore: 0, plotAlignmentScore: 0,
 * //   overallScore: 0, warnings: ['验证已取消，本次未完成校验'], ..., degraded: true }
 * ```
 */
export function buildDegradedValidation(reason: string): EditValidation {
    return {
        isValid: true,
        consistencyScore: 0,
        styleScore: 0,
        plotAlignmentScore: 0,
        overallScore: 0,
        warnings: [`${reason}，本次未完成校验`],
        suggestions: ['可重试验证，或直接检查内容后继续使用'],
        validatedAt: Date.now(),
        degraded: true,
        degradedReason: reason
    };
}

/**
 * 解析编辑验证响应为 EditValidation（纯函数，与抽取前行为完全一致）。
 *
 * 解析规则：
 *  1. 剥离 <think> 块与代码围栏后提取第一个 JSON 对象
 *  2. 取不到 JSON 时回落 buildDegradedValidation（不静默放行）
 *  3. 任一维度分数低于 EDIT_VALIDATION_PASS_SCORE 即判 isValid: false
 *
 * @param raw - callCoWriteAI 返回的原始响应文本（可能含思考块/围栏/解释文字）
 * @returns 解析出的校验结果；解析异常时返回降级结果
 * @example
 * ```ts
 * const v = parseValidationResponse('结果：{"consistencyScore": 88, "styleScore": 76, "plotAlignmentScore": 91}');
 * // { isValid: true, consistencyScore: 88, styleScore: 76, plotAlignmentScore: 91, overallScore: 85, ... }
 * ```
 */
export function parseValidationResponse(raw: string): EditValidation {
    try {
        // 思考型模型会带 <think> 前缀与围栏解释，必须先剥离再提取 JSON，
        // 否则必然 parse 失败、落入「默认通过」分支，等于没有校验。
        const cleaned = stripCodeFence(stripThinkingBlock(raw)).trim();
        const jsonText = extractJsonObject(cleaned);
        if (!jsonText) {
            return buildDegradedValidation('AI 返回中找不到校验 JSON');
        }

        const json = JSON.parse(jsonText) as Record<string, unknown>;
        const consistencyScore = Number(json.consistencyScore) || 0;
        const styleScore = Number(json.styleScore) || 0;
        const plotAlignmentScore = Number(json.plotAlignmentScore) || 0;

        return {
            isValid: consistencyScore >= EDIT_VALIDATION_PASS_SCORE
                && styleScore >= EDIT_VALIDATION_PASS_SCORE
                && plotAlignmentScore >= EDIT_VALIDATION_PASS_SCORE,
            consistencyScore,
            styleScore,
            plotAlignmentScore,
            overallScore: Math.round((consistencyScore + styleScore + plotAlignmentScore) / 3),
            warnings: Array.isArray(json.warnings) ? json.warnings as string[] : [],
            suggestions: Array.isArray(json.suggestions) ? json.suggestions as string[] : [],
            validatedAt: Date.now()
        };
    } catch (e) {
        log.warn('[CoWriterEngine] 验证结果 JSON 解析失败:', e);
        return buildDegradedValidation('校验结果解析失败');
    }
}

/**
 * 解析剧情完成度评估响应为 PlotCompletionMetrics（纯函数，与抽取前行为完全一致）。
 *
 * 解析规则：
 *  1. 剥离 <think> 块与代码围栏后提取第一个 JSON 对象（失败回落空指标并告警）
 *  2. overallCompletion 优先采用 AI 给出的正值，否则取四维分数均值
 *  3. nextDirectionHints 缺失或非数组时回落默认方向 ['action', 'emotion', 'dialogue']
 *
 * @param raw - callCoWriteAI 返回的原始响应文本（可能含思考块/围栏/解释文字）
 * @returns 解析出的完成度指标；解析异常时返回 getEmptyMetrics()
 * @example
 * ```ts
 * const m = parseEvaluationResponse('{"sceneObjectivesMet": 80, "characterArcsAdvanced": 52, "foreshadowingSeeded": 30, "emotionalArcProgress": 65}');
 * // overallCompletion 为四维均值 Math.round((80+52+30+65)/4) = 57
 * ```
 */
export function parseEvaluationResponse(raw: string): PlotCompletionMetrics {
    try {
        // 思考型模型会带 <think> 前缀与尾部解释，直接 parse 必然失败（面板恒 0 并刷警告）
        const cleaned = stripCodeFence(stripThinkingBlock(raw)).trim();
        const jsonText = extractJsonObject(cleaned);
        if (!jsonText) {
            log.warn('[CoWriterEngine] 完成度响应中找不到 JSON 对象，使用默认值');
            return getEmptyMetrics();
        }

        const json = JSON.parse(jsonText) as Partial<PlotCompletionMetrics>;

        const scores = [
            Number(json.sceneObjectivesMet) || 0,
            Number(json.characterArcsAdvanced) || 0,
            Number(json.foreshadowingSeeded) || 0,
            Number(json.emotionalArcProgress) || 0
        ];

        const aiOverall = Number(json.overallCompletion);
        const avgOverall = Math.round(scores.reduce((a, b) => a + b, 0) / 4);
        const overallCompletion = !isNaN(aiOverall) && aiOverall > 0 ? aiOverall : avgOverall;

        return {
            sceneObjectivesMet: scores[0],
            characterArcsAdvanced: scores[1],
            foreshadowingSeeded: scores[2],
            emotionalArcProgress: scores[3],
            overallCompletion,
            suggestionAdvice: json.suggestionAdvice || '',
            nextDirectionHints: Array.isArray(json.nextDirectionHints)
                ? json.nextDirectionHints as SuggestionDirection[]
                : ['action', 'emotion', 'dialogue'],
            evaluatedAt: Date.now()
        };
    } catch (e) {
        log.warn('[CoWriterEngine] 完成度 JSON 解析失败，使用默认值:', e);
        return getEmptyMetrics();
    }
}
