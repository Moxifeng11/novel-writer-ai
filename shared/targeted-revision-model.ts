/**
 * targeted-revision-model.ts — 定向修订任务模型（B2）
 *
 * 把 B1 校验报告转成**可执行的修订任务**：每条任务只针对一个问题，
 * 带定位信息与约束，避免整章重写带来的风格漂移与成本浪费。
 */

import type { CheckItem, CheckKind, CheckSeverity, PostGenerationCheckReport } from './post-generation-check-model';

/** 修订任务 */
export interface RevisionTask {
    /** 来源校验项 */
    kind: CheckKind;
    severity: CheckSeverity;
    /** 问题说明（给作者/日志） */
    problem: string;
    /** 给模型的修订指令（只改这一处） */
    instruction: string;
    /** 关联实体/定位线索 */
    refs: string[];
}

/** 各类问题的修订指令模板 */
const INSTRUCTION_TEMPLATES: Record<CheckKind, (item: CheckItem) => string> = {
    coverage: item => `场景中出现的角色「${(item.refs ?? []).join('、')}」缺少设定卡。不要虚构该角色的详细设定，只按上下文已有信息写，并在该角色首次出现处用一句话交代身份。`,
    foreshadow: item => `伏笔「${(item.refs ?? []).join('、')}」已超过计划回收章节。若本章情节可容纳，用 1–2 句自然回收或推进；否则不要强行插入。`,
    rhythm: item => `本章节奏问题：${item.message}。只调整对应场景的事件密度或情绪落点（补铺垫/压缩平铺），不要改动其他场景。`,
    consistency: item => `本章存在一致性问题：${item.message}。按矛盾记录修正相关表述，保持与已建立事实一致。`,
    voice: item => `人物口吻偏差：${item.message}。按人物卡的口吻样本调整对白，不要改动情节。`,
    quality: item => `质量门禁问题：${item.message}。按建议修正相关段落，保持叙事视角与文风不变。`,
};

/**
 * 把校验报告转成修订任务（error 优先，warn 次之）。
 *
 * @param report - B1 报告
 * @param maxTasks - 最多任务数（默认 5，避免一次改太多）
 * @returns 修订任务
 */
export function buildRevisionTasks(report: PostGenerationCheckReport, maxTasks = 5): RevisionTask[] {
    const order: Record<CheckSeverity, number> = { error: 0, warn: 1, info: 2 };
    return [...report.items]
        .filter(item => item.severity !== 'info')
        .sort((a, b) => order[a.severity] - order[b.severity])
        .slice(0, maxTasks)
        .map(item => ({
            kind: item.kind,
            severity: item.severity,
            problem: item.message,
            instruction: (INSTRUCTION_TEMPLATES[item.kind] ?? (() => item.message))(item),
            refs: item.refs ?? [],
        }));
}

/**
 * 渲染给模型的修订提示词（要求只输出修订后的正文，不解释）。
 *
 * @param body - 当前正文
 * @param tasks - 修订任务
 * @returns 提示词
 */
export function buildRevisionPrompt(body: string, tasks: readonly RevisionTask[]): string {
    const instructions = tasks.map((task, index) => `${index + 1}. ${task.instruction}`).join('\n');
    return [
        '下面是一章正文，请只做清单里列出的定向修订，其他内容原样保留。',
        '',
        '【修订清单】',
        instructions,
        '',
        '【硬性要求】',
        '- 只输出修订后的完整正文，不要解释、不要输出清单；',
        '- 保持视角、时态、文风与原稿一致；',
        '- 不得新增清单之外的情节或角色；',
        '- 修订幅度最小化。',
        '',
        '【原文】',
        body,
    ].join('\n');
}

/** 修订闭环结果 */
export interface RevisionLoopResult {
    /** 最终是否通过校验 */
    passed: boolean;
    /** 实际尝试次数（0 表示无需修订） */
    attempts: number;
    /** 最终正文 */
    body: string;
    /** 最终报告 */
    report: PostGenerationCheckReport;
    /** 未解决的问题（需人工） */
    pending: RevisionTask[];
}
