/**
 * style-distill-service.ts — 文笔风格蒸馏（样本优先）
 *
 * 旧实现只输入书名，模型凭记忆写报告，无法验证。这里把“样本分析”和
 * “书名推测”分开：样本模式必须引用原文证据；书名模式必须标注不确定性。
 */
import type { AIEngine } from '@/engine/ai-engine';
import { StyleFeaturesAnalyzerV2, formatFeaturesV2Section, type StyleAnalysisResultV2 } from './style-features-v2';
import { createLogger } from '@/shared/logger';

const log = createLogger('StyleDistillService');import { resolveTaskModelConfig, type TaskModelSettings } from '@/shared/task-model';

/**
 * 文风提炼来源模式。
 */
export type StyleSourceMode = 'name' | 'paste' | 'project' | 'file';

/**
 * 提炼输入。
 */
export interface StyleDistillInput {
    mode: StyleSourceMode;
    label: string;
    sampleText?: string;
}

/**
 * 提炼依赖。
 */
export interface StyleDistillDeps {
    settings: TaskModelSettings;
    resolveLimits: (model: string, endpoint?: string) => { maxContext: number; maxOutput: number };
}

/**
 * 提炼提示词。
 */
export interface StyleDistillPrompts {
    system: string;
    user: string;
}

/**
 * 构建文风提炼提示词。
 *
 * @param input - 输入
 * @returns 提示词集合
 */
export function buildStyleDistillPrompts(input: StyleDistillInput): StyleDistillPrompts {
    const sample = (input.sampleText || '').trim();
    const hasSample = input.mode !== 'name' && sample.length > 0;
    const system = hasSample
        ? `你是一位严谨的文笔风格分析师。请只根据用户提供的样本文本分析，不得使用模型记忆，不得臆测作者其他作品。

【硬性要求】
1. 每条结论必须附 1-2 条原文短句作为证据（用「证据：……」标注）。
2. 样本没有体现的特征写「样本未体现」，不要推断。
3. 输出 Markdown，严格包含以下章节：
## 一、叙事视角与 tense
## 二、句式与节奏（长短句、段落长度、标点习惯）
## 三、用词与修辞（口语/文雅、特色词、比喻密度）
## 四、对话风格（占比、标签、潜台词）
## 五、描写偏好（环境/动作/心理，感官分布）
## 六、情绪表达方式
## 七、可模仿规则（5-8 条，写成可执行指令）
## 八、禁用/慎用
## 九、证据摘录（3-5 条原文短句）
4. 不要写“作者可能”“一般来说”这类空话；有数据就给数据（如平均句长、对话占比）。`
        : `你是一位文笔风格分析师。用户只提供了作品名/作者名，没有样本文本。
请明确标注这是“基于模型记忆的推测”，可能不准确；不要伪造原文引用。

【输出要求】
1. 开头写：「⚠️ 未提供样本文本，以下为基于模型记忆的推测，建议补充样章后重新分析。」
2. 输出 Markdown，包含：
## 一、叙事视角与 tense
## 二、句式与节奏
## 三、用词与修辞
## 四、对话风格
## 五、描写偏好
## 六、情绪表达方式
## 七、可模仿规则（5-8 条）
## 八、禁用/慎用
## 九、可信度说明
3. 不要编造具体原文句子；不确定的地方写「不确定」。`;

    const user = hasSample
        ? `【来源】${input.label || '用户样本'}
【样本字数】${sample.replace(/\s/g, '').length}

【样本文本】
${sample.slice(0, 12000)}`
        : `请分析《${input.label}》的文笔风格。再次提醒：没有样本文本，必须标注为模型记忆推测，不要伪造原文证据。`;
    return { system, user };
}

/**
 * analyzeStyleFromSource 函数。
 * @param aiEngine - AI 引擎
 * @param input - 输入
 * @param deps - 依赖
 * @param signal - 取消信号
 * @returns 报告正文 + 模型；样本模式额外携带本地十二维特征 featuresV2
 */
export async function analyzeStyleFromSource(
    aiEngine: AIEngine,
    input: StyleDistillInput,
    deps: StyleDistillDeps,
    signal?: AbortSignal,
): Promise<{ content: string; error?: string; model: string; featuresV2?: StyleAnalysisResultV2 }> {
    const prompts = buildStyleDistillPrompts(input);
    const config = resolveTaskModelConfig(
        deps.settings,
        'quality',
        deps.resolveLimits,
    );
    const response = await aiEngine.callAI(
        prompts.system,
        prompts.user,
        config.model,
        0.6,
        Math.min(8192, config.maxOutput),
        {
            signal,
            endpoint: config.endpoint,
            apiKey: config.apiKey,
            disableFallback: config.sourceType === 'local',
            thinkingMode: config.thinkingMode,
            thinkingBudget: config.thinkingBudget,
        },
    );
    let content = response.content || '';
    // 样本模式追加十二维本地统计（V2 能力并入蒸馏链；失败不阻断主流程，仅缺省该小节）
    const sample = (input.sampleText || '').trim();
    if (input.mode !== 'name' && sample.length > 0) {
        try {
            const featuresV2 = await new StyleFeaturesAnalyzerV2().analyze(sample);
            content = `${content}

${formatFeaturesV2Section(featuresV2.features)}`;
            return { content, error: response.error, model: config.model, featuresV2 };
        } catch (e) {
            log.warn('[style-distill] 十二维特征统计失败，报告不含该小节:', e);
        }
    }
    return { content, error: response.error, model: config.model };
}