/**
 * long-novel-tasks.ts - feature-level single-call contracts for the long novel.
 *
 * Each task uses exactly one logical AI call. Local validators may reject the
 * result, but the runner never makes a hidden second AI call.
 */
import { singleCallRunner, type SingleCallResult } from './single-call-runner';
import { parseJsonObject, validateFields, type OutputContract } from './structured-output';
import type { AIEngine } from '../ai-engine';
import type { CreationMode } from '../../shared/creation-mode';

export interface DeaiSingleCallResult {
    issues: string[];
    rewritten: string;
    selfCheck: string;
}

export interface RefineSingleCallResult {
    issues: string[];
    polished: string;
    selfCheck: string;
}

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
            type: 'object',
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

function validateRevision(value: RevisionSingleCallResult): string[] {
    const issues = validateFields(value as unknown as Record<string, unknown>, revisionContract.fields as never || []);
    if (!Array.isArray(value.dimensions)) issues.push('dimensions 必须是数组');
    if (!value.body || value.body.replace(/\s/g, '').length < 100) issues.push('修订正文过短或为空');
    return issues;
}

export class LongNovelSingleCallTasks {
    constructor(private readonly ai: AIEngine) {}

    async deai(
        bodyText: string,
        options?: { mode?: CreationMode; projectId?: string; writingRules?: string; signal?: AbortSignal }
    ): Promise<SingleCallResult<DeaiSingleCallResult>> {
        const systemPrompt = `你是一位小说编辑，负责一次性完成「AI 痕迹检查 + 重写」。
${options?.writingRules ? `\n【写作规则】\n${options.writingRules}` : ''}

流程要求：
1. 先内部检查原文的 AI 痕迹（排比、升华段、连续“然后/于是”、情绪直述等）。
2. 直接基于检查结果重写完整正文：情节、人物、章节结构不变，只改表达。
3. 输出 JSON，不解释。

${describeContract(deaiContract)}`;

        const userPrompt = `【原文】\n${bodyText}`;

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

    async refine(
        bodyText: string,
        contextPrompt: string,
        options?: { mode?: CreationMode; projectId?: string; writingRules?: string; chapNum?: string; signal?: AbortSignal }
    ): Promise<SingleCallResult<RefineSingleCallResult>> {
        const systemPrompt = `你是一位小说编辑，负责一次性完成「自检 + 精修」。
${options?.writingRules ? `\n【写作规则】\n${options.writingRules}` : ''}

自检维度：开篇钩子、冲突推进、情绪身体化、AI 痕迹、分段节奏、形容词控制、结尾情绪。
精修要求：只改表达与节奏，不改剧情、人物与设定；保持字数不减少；输出完整正文。

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

    async targetedRevision(
        bodyText: string,
        issues: string[],
        options?: { mode?: CreationMode; projectId?: string; signal?: AbortSignal }
    ): Promise<SingleCallResult<RevisionSingleCallResult>> {
        const systemPrompt = `你是一位小说修订编辑。一次调用完成所有质量维度的定向修订。
要求：
- 每个维度只修改相关段落，不改剧情走向与人物设定。
- 输出完整正文，不减少字数。
- 输出 JSON，不解释。

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
