/**
 * execution-events.ts — 执行流程与失败的结构化契约
 *
 * engine 只产出数据，UI 负责展示。这样「一键完成」和「逐步完成」共享同一套
 * 报错触发条件、提示文案与重试入口，不会各写一份 Notice。
 */

export type ExecutionLevel = 'debug' | 'info' | 'success' | 'warning' | 'error';

export type StepFailureKind =
    | 'validation'
    | 'api'
    | 'parse'
    | 'save'
    | 'incomplete'
    | 'truncated'
    | 'exception'
    | 'cancelled';

export interface ExecutionEventInput {
    /** 事件类型：run-start / run-progress / step-start / step-complete / step-error ... */
    type: string;
    level: ExecutionLevel;
    message: string;
    stepKey?: string;
    stepLabel?: string;
    detail?: string;
    /** 调试窗口保留完整上下文；不进入主流程时间线 */
    debug?: Record<string, string | number | boolean | undefined>;
}

export interface DiagnosticInput {
    level: ExecutionLevel;
    scope: 'step' | 'run' | 'api' | 'save' | 'prompt' | 'ui';
    message: string;
    stepKey?: string;
    stepLabel?: string;
    detail?: string;
    stack?: string;
}

export interface StepFailure {
    stepKey: string;
    stepLabel: string;
    kind: StepFailureKind;
    message: string;
    detail?: string;
    missing: string[];
    suggestion: string;
    retryable: boolean;
    at: number;
    stack?: string;
}

const SUGGESTIONS: Record<StepFailureKind, string> = {
    validation: '检查本步前置条件与缺失字段，补齐后点击「重试本步」；若提示词为空，先确认模板已填充。',
    api: '检查设置中的 API 地址、密钥、模型名与输出上限；确认网络可用后点击「重试本步」。',
    parse: '模型输出未符合步骤格式。可直接重试；连续失败时降低温度或换用更强的模型。',
    save: '检查章节目录写权限与磁盘空间，然后点击「重试本步」；已生成内容会保留在日志中。',
    incomplete: '按缺失项补齐内容后重试本步；若模型输出上限不足，可提高该任务输出上限或分段生成。',
    truncated: '提高该步骤的模型输出上限，或先缩短输入后重试；已保存的草稿不会丢失。',
    exception: '展开执行日志查看堆栈；若为网络/解析异常可直接重试，连续失败请检查控制台错误。',
    cancelled: '任务已取消；点击「重试本步」可继续，已完成步骤不会重复执行。',
};

const KIND_BY_PATTERN: Array<{ pattern: RegExp; kind: StepFailureKind }> = [
    { pattern: /截断|finish_reason\s*=\s*length|输出达到模型上限/i, kind: 'truncated' },
    { pattern: /未达到完成标准|内容不完整|缺少|缺失|字数不足|不能为空|前置校验/i, kind: 'validation' },
    { pattern: /保存失败|写入失败|权限|磁盘|ENOSPC|EACCES/i, kind: 'save' },
    { pattern: /JSON|解析|格式|parse|unexpected token/i, kind: 'parse' },
    { pattern: /API|HTTP|401|403|404|429|5\d\d|网络|超时|timeout|ECONN|fetch/i, kind: 'api' },
    { pattern: /取消|cancel|abort/i, kind: 'cancelled' },
];

export function classifyStepFailure(message: string): StepFailureKind {
    const text = String(message || '');
    for (const rule of KIND_BY_PATTERN) {
        if (rule.pattern.test(text)) return rule.kind;
    }
    return 'exception';
}

export function suggestionForFailure(kind: StepFailureKind, missing: string[] = []): string {
    if (missing.length > 0) {
        return `缺少：${missing.slice(0, 6).join('、')}。${SUGGESTIONS[kind]}`;
    }
    return SUGGESTIONS[kind];
}

export function createStepFailure(input: {
    stepKey: string;
    stepLabel: string;
    message: string;
    kind?: StepFailureKind;
    detail?: string;
    missing?: string[];
    retryable?: boolean;
    stack?: string;
    at?: number;
}): StepFailure {
    const kind = input.kind ?? classifyStepFailure(input.message);
    const missing = input.missing ?? [];
    return {
        stepKey: input.stepKey,
        stepLabel: input.stepLabel,
        kind,
        message: input.message,
        detail: input.detail,
        missing,
        suggestion: suggestionForFailure(kind, missing),
        retryable: input.retryable ?? kind !== 'cancelled',
        at: input.at ?? Date.now(),
        stack: input.stack,
    };
}
