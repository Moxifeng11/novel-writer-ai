/**
 * long-novel-tasks.ts - feature-level single-call contracts for the long novel.
 *
 * Each task uses exactly one logical AI call. Local validators may reject the
 * result, but the runner never makes a hidden second AI call.
 */
import { buildHumanVoiceBlock } from '../prompts/human-voice';
import { formatExemplarBlock, selectExemplars, type ExemplarSample } from '../prompts/style-exemplars';
import { singleCallRunner, type SingleCallResult } from './single-call-runner';
import { parseJsonObject, validateFields, type OutputContract } from './structured-output';
import type { AIEngine } from '../ai-engine';
import type { CreationMode } from '../../shared/creation-mode';

/**
 * DeaiSingleCallResult 类型定义。
 */
export interface DeaiSingleCallResult {
    issues: string[];
    rewritten: string;
    selfCheck: string;
}

/**
 * RefineSingleCallResult 类型定义。
 */
export interface RefineSingleCallResult {
    issues: string[];
    polished: string;
    selfCheck: string;
}

/**
 * RevisionSingleCallResult 类型定义。
 */
export interface RevisionSingleCallResult {
    dimensions: Array<{ dimension: string; changed: boolean; note: string }>;
    body: string;
}

const deaiContract: OutputContract<DeaiSingleCallResult> = {
    id: 'long.deai.single-call',
    format: 'json',
    fields: [
        { key: 'issues', type: 'string[]', required: true, description: 'AI 痕迹问题清单，每条一句话' },
        { key: 'rewritten', type: 'string', required: true, description: '完整重写后的正文' },
        { key: 'selfCheck', type: 'string', required: false, description: '自检结论' },
    ],
    parse: raw => parseJsonObject<DeaiSingleCallResult>(raw),
    describe: () => '',
};

const refineContract: OutputContract<RefineSingleCallResult> = {
    id: 'long.refine.single-call',
    format: 'json',
    fields: [
        { key: 'issues', type: 'string[]', required: true, description: '自检发现的问题清单' },
        { key: 'polished', type: 'string', required: true, description: '精修后的完整正文' },
        { key: 'selfCheck', type: 'string', required: false, description: '自检总结' },
    ],
    parse: raw => parseJsonObject<RefineSingleCallResult>(raw),
    describe: () => '',
};

const revisionContract: OutputContract<RevisionSingleCallResult> = {
    id: 'long.targeted-revision.single-call',
    format: 'json',
    fields: [
        {
            key: 'dimensions',
            // 逐维度修订说明是数组；旧声明写成 object，而 validateFields 明确拒绝数组，
            // 导致定向修订无论模型怎么输出都必然失败。
            type: 'array',
            required: true,
            description: '每个质量维度的修订说明，形如 [{"dimension":"...","changed":true,"note":"..."}]',
        },
        { key: 'body', type: 'string', required: true, description: '修订后的完整正文' },
    ],
    parse: raw => parseJsonObject<RevisionSingleCallResult>(raw),
    describe: () => '',
};

function describeContract(contract: OutputContract): string {
    if (!contract.fields) return '';
    return [
        '输出必须是一个 JSON 对象，不要解释，不要 Markdown 代码块以外的内容。',
        ...contract.fields.map(field => `- ${field.key} (${field.type}${field.required ? ', 必填' : ''}): ${field.description}`),
    ].join('\n');
}

function validateDeai(value: DeaiSingleCallResult): string[] {
    const issues = validateFields(value as unknown as Record<string, unknown>, deaiContract.fields as never || []);
    if (!value.rewritten || value.rewritten.replace(/\s/g, '').length < 100) {
        issues.push('重写正文过短或为空');
    }
    if (value.rewritten && value.rewritten === value.issues?.join('\n')) {
        issues.push('重写正文不能是问题清单');
    }
    return issues;
}

function validateRefine(value: RefineSingleCallResult): string[] {
    const issues = validateFields(value as unknown as Record<string, unknown>, refineContract.fields as never || []);
    if (!value.polished || value.polished.replace(/\s/g, '').length < 100) {
        issues.push('精修正文过短或为空');
    }
    return issues;
}

/**
 * 定向修订结果校验（导出供单测锁定「dimensions 必须是数组」）
 *
 * @param value - 值
 * @returns 结果数组
 */
export function validateRevision(value: RevisionSingleCallResult): string[] {
    const issues = validateFields(value as unknown as Record<string, unknown>, revisionContract.fields as never || []);
    if (!Array.isArray(value.dimensions)) issues.push('dimensions 必须是数组');
    if (!value.body || value.body.replace(/\s/g, '').length < 100) issues.push('修订正文过短或为空');
    return issues;
}

/**
 * LongNovelSingleCallTasks 类。
 */
export class LongNovelSingleCallTasks {
    constructor(
        private readonly ai: AIEngine,
        /** 人味约束模式（样文优先 / 旧配额）；由宿主注入，默认样文优先 */
        private readonly voiceMode: () => 'exemplar' | 'quota' = () => 'exemplar',
    ) {}

    /**
     * 人味约束块：样文优先（默认）或旧配额。
     * 样文按场景类型挑 3 段，注入「照着写」，取代旧版 23 条数值配额。
     */
    private voiceBlock(): string {
        if (this.voiceMode() === 'quota') return buildHumanVoiceBlock({ mode: 'quota' });
        const samples: ExemplarSample[] = selectExemplars({ limit: 3 });
        return buildHumanVoiceBlock({
            mode: 'exemplar',
            exemplarBlock: formatExemplarBlock(samples),
        });
    }

    /**
     * deai 方法。
     * @param bodyText - 参数值
     * @param options - 配置项
      * @returns SingleCallResult<DeaiSingleCallResult> 实例
     */
    async deai(
        bodyText: string,
        options?: { mode?: CreationMode; projectId?: string; writingRules?: string; signal?: AbortSignal }
    ): Promise<SingleCallResult<DeaiSingleCallResult>> {
        const systemPrompt = `你是一位小说编辑，负责把一篇有 AI 腔的稿子改回人写的语感。
${options?.writingRules ? `\n【写作规则】\n${options.writingRules}` : ''}

要求（按顺序做，不要跳步）：
1. 先找出**最多 3 处**最像 AI 的地方（总结式升华、排比感慨、情绪直述、每段长短整齐、对话像念台词）。只列具体句子，不要列抽象指标。
2. 对照下面的真人样文重写全文：句子长短、段落疏密、用词轻重都向样文靠；允许句子不完整、允许重复用词。
3. 情节、人物、章节结构不变；字数 ±10%。
4. 输出 JSON，不解释。

${this.voiceBlock()}

${describeContract(deaiContract)}`;

        const userPrompt = `【原文（需要改回人味）】\n${bodyText}`;

        return singleCallRunner.run<DeaiSingleCallResult>({
            taskId: 'long.deai',
            projectId: options?.projectId,
            mode: options?.mode || 'long',
            modelTask: 'body',
            ai: this.ai,
            systemPrompt,
            userPrompt,
            maxTokens: 8192,
            temperature: 0.75,
            contract: {
                parse: deaiContract.parse,
                validate: validateDeai,
            },
            signal: options?.signal,
        });
    }

    /**
     * refine 方法。
     * @param bodyText - 参数值
     * @param contextPrompt - 参数值
     * @param options - 配置项
      * @returns SingleCallResult<RefineSingleCallResult> 实例
     */
    async refine(
        bodyText: string,
        contextPrompt: string,
        options?: {
            mode?: CreationMode;
            projectId?: string;
            writingRules?: string;
            chapNum?: string;
            signal?: AbortSignal;
            /** 定向补修指令（如「把 3 处叙述改成对话」），追加在精修要求之后 */
            extraInstruction?: string;
        }
    ): Promise<SingleCallResult<RefineSingleCallResult>> {
        const systemPrompt = `你是一位小说编辑，负责一次性完成「自检 + 精修」。
${options?.writingRules ? `\n【写作规则】\n${options.writingRules}` : ''}

${options?.extraInstruction ? `
【本轮额外要求】
${options.extraInstruction}
` : ''}
自检维度：开篇钩子、冲突推进、情绪身体化、AI 痕迹、分段节奏、形容词控制、结尾情绪。
精修要求：只改表达与节奏，不改剧情、人物与设定；字数 ±10%；输出完整正文。
改写时以「真人样文」的语感为准，不要为了达标把句子写得更整齐。

${this.voiceBlock()}

${describeContract(refineContract)}`;

        const userPrompt = `【第${options?.chapNum || '当前'}章正文】\n${bodyText}${contextPrompt ? `\n\n【上下文/设定】\n${contextPrompt.slice(0, 3000)}` : ''}`;

        return singleCallRunner.run<RefineSingleCallResult>({
            taskId: 'long.refine',
            projectId: options?.projectId,
            mode: options?.mode || 'long',
            modelTask: 'body',
            ai: this.ai,
            systemPrompt,
            userPrompt,
            maxTokens: 8192,
            temperature: 0.7,
            contract: {
                parse: refineContract.parse,
                validate: validateRefine,
            },
            signal: options?.signal,
        });
    }

    /**
     * targetedRevision 方法。
     * @param bodyText - 参数值
     * @param issues - 参数值
     * @param options - 配置项
      * @returns SingleCallResult<RevisionSingleCallResult> 实例
     */
    async targetedRevision(
        bodyText: string,
        issues: string[],
        options?: { mode?: CreationMode; projectId?: string; signal?: AbortSignal; lockedFacts?: string[] }
    ): Promise<SingleCallResult<RevisionSingleCallResult>> {
        const locked = (options?.lockedFacts || []).map(f => String(f || '').trim()).filter(Boolean);
        const systemPrompt = `你是一位小说修订编辑。一次调用完成所有质量维度的定向修订。
要求：
- 每个维度只修改相关段落，不改剧情走向与人物设定。
- 输出完整正文，不减少字数。
- 输出 JSON，不解释。
${locked.length > 0 ? `- 以下事实不得改动，也不得删掉对应内容：${locked.join('；')}` : ''}

${describeContract(revisionContract)}`;

        const userPrompt = `【质量问题】\n${issues.map((issue, index) => `${index + 1}. ${issue}`).join('\n')}\n\n【正文】\n${bodyText}`;

        return singleCallRunner.run<RevisionSingleCallResult>({
            taskId: 'long.targeted-revision',
            projectId: options?.projectId,
            mode: options?.mode || 'long',
            modelTask: 'body',
            ai: this.ai,
            systemPrompt,
            userPrompt,
            maxTokens: 8192,
            temperature: 0.4,
            contract: {
                parse: revisionContract.parse,
                validate: validateRevision,
            },
            signal: options?.signal,
        });
    }
}
