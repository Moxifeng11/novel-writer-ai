/**
 * single-call-runner.ts - one logical AI call per feature task.
 *
 * The runner owns: context pack + rules + prompt assembly + one AI call +
 * structured parsing + local validation. It never makes a second AI call;
 * failures are returned for the caller/user to retry explicitly.
 */
import type { AIEngine } from '@/engine/ai-engine';
import type { CreationMode } from '@/shared/creation-mode';
import type { Rule, RuleViolation, RuleValidationContext } from './rule-engine';
import { RuleEngine } from './rule-engine';
import { callLedger } from './call-ledger';
import { createLogger } from '@/shared/logger';

const log = createLogger('SingleCallRunner');

/**
 * 模型任务类型。
 */
export type ModelTask = 'planning' | 'body' | 'quality' | 'analysis' | 'default';

/**
 * 单次调用任务输入。
 */
export interface SingleCallTaskInput<T> {
    taskId: string;
    projectId?: string;
    mode: CreationMode;
    modelTask: ModelTask;
    ai: AIEngine;
    model?: string;
    systemPrompt: string;
    userPrompt: string;
    maxTokens?: number;
    temperature?: number;
    contract?: {
        parse: (raw: string) => T | null;
        validate?: (value: T) => string[];
    };
    contextPack?: {
        projectId: string;
        taskKey: string;
        sections: Array<{ title: string; content: string }>;
        promptText: string;
        totalChars: number;
        builtAt: number;
    };
    /** 编译后的提示词产物；提供时优先于 systemPrompt/userPrompt */
    promptArtifact?: {
        taskId: string;
        systemPrompt: string;
        userPrompt: string;
        tokenBudget: { maxInputTokens?: number; maxOutput?: number };
        hash: string;
        createdAt: number;
    };
    rules?: Rule[];
    validationContext?: RuleValidationContext;
    signal?: AbortSignal;
    thinkingMode?: 'off' | 'auto' | 'on';
    thinkingBudget?: number;
}

/**
 * 调用成功结果。
 */
export interface SingleCallSuccess<T> {
    ok: true;
    taskId: string;
    value?: T;
    raw: string;
    violations: RuleViolation[];
    networkCalls: number;
    durationMs: number;
}

/**
 * 调用失败结果。
 */
export interface SingleCallFailure {
    ok: false;
    taskId: string;
    error: string;
    raw?: string;
    parseIssues?: string[];
    violations: RuleViolation[];
    networkCalls: number;
    durationMs: number;
}

/**
 * 调用结果联合类型。
 */
export type SingleCallResult<T> = SingleCallSuccess<T> | SingleCallFailure;

/**
 * 单次调用执行器。
 */
export class SingleCallRunner {
    private ruleEngine = new RuleEngine();

    /**
     * 执行。
     * @param input - 输入
      * @returns SingleCallResult<T> 实例
     */
    async run<T>(input: SingleCallTaskInput<T>): Promise<SingleCallResult<T>> {
        const started = Date.now();
        const ledgerKey = callLedger.start(input.taskId, input.projectId);
        callLedger.markLogical(ledgerKey);

        const compiled = this.ruleEngine.compile({
            mode: input.mode,
            scope: input.modelTask === 'body' ? 'body' : input.modelTask === 'quality' ? 'quality' : 'global',
            creationModePrompt: '',
            extraRules: input.rules,
        });
        const systemPrompt = compiled.promptBlock
            ? `${input.systemPrompt}\n\n${compiled.promptBlock}`
            : input.systemPrompt;
        const effectiveSystemPrompt = input.promptArtifact?.systemPrompt || systemPrompt;
        const effectiveUserPrompt = input.promptArtifact?.userPrompt || input.userPrompt;
        const effectiveMaxTokens = input.promptArtifact?.tokenBudget.maxOutput ?? input.maxTokens;

        let networkCalls = 0;
        try {
            const response = await input.ai.callAI(
                effectiveSystemPrompt,
                effectiveUserPrompt,
                input.model,
                input.temperature ?? 0.7,
                effectiveMaxTokens,
                {
                    signal: input.signal,
                    isWritingTask: input.modelTask === 'body',
                    thinkingMode: input.thinkingMode,
                    thinkingBudget: input.thinkingBudget,
                },
            );
            networkCalls += 1;
            callLedger.markNetwork(ledgerKey);

            if (response.error || !response.content?.trim()) {
                const error = response.error || 'AI 返回为空';
                callLedger.end(ledgerKey, false);
                return {
                    ok: false,
                    taskId: input.taskId,
                    error,
                    networkCalls,
                    durationMs: Date.now() - started,
                    violations: [],
                };
            }

            let value: T | undefined;
            let parseIssues: string[] = [];
            if (input.contract) {
                const parsed = input.contract.parse(response.content);
                if (!parsed) {
                    parseIssues = ['无法解析结构化输出'];
                } else if (input.contract.validate) {
                    parseIssues = input.contract.validate(parsed);
                }
                if (parseIssues.length === 0 && parsed !== null) value = parsed;
            }

            const violations = this.ruleEngine.validate(
                compiled.rules,
                response.content,
                input.validationContext || { mode: input.mode, scope: input.modelTask === 'body' ? 'body' : 'global' },
            );
            const blocking = violations.filter(item => item.severity === 'must').length > 0
                || (input.contract && parseIssues.length > 0);

            if (blocking) {
                callLedger.end(ledgerKey, false);
                return {
                    ok: false,
                    taskId: input.taskId,
                    error: input.contract && parseIssues.length > 0
                        ? `结构化输出校验失败：${parseIssues.join('；')}`
                        : '本地规则校验失败',
                    raw: response.content,
                    parseIssues,
                    violations,
                    networkCalls,
                    durationMs: Date.now() - started,
                };
            }

            const entry = callLedger.end(ledgerKey, true);
            log.info('single call completed', { task: input.taskId, ms: entry?.endedAt ? entry.endedAt - entry.startedAt : Date.now() - started });
            return {
                ok: true,
                taskId: input.taskId,
                value,
                raw: response.content,
                violations,
                networkCalls,
                durationMs: Date.now() - started,
            };
        } catch (e) {
            const error = e instanceof Error ? e.message : String(e);
            callLedger.end(ledgerKey, false);
            return {
                ok: false,
                taskId: input.taskId,
                error,
                networkCalls: Math.max(networkCalls, 1),
                durationMs: Date.now() - started,
                violations: [],
            };
        }
    }
}

/**
 * 全局单次调用执行器。
 */
export const singleCallRunner = new SingleCallRunner();
