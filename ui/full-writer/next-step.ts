/**
 * next-step.ts — 「下一步该做什么」的推演（2026-11-16，D2）
 *
 * 背景（H-03）：工作台右栏此前只显示流程百分比 + 一行「下一步：xxx」文案，
 * 主操作仍是「项目向导」这类固定按钮，不随项目真实状态变化。
 *
 * 本模块把 shared/creation-flow 的完整快照（stages / nextStageId / nextUnitNumber /
 * overallRatio）翻译成一张「主操作卡」的数据：
 *   - 做什么（title + description）
 *   - 按哪个按钮（ctaLabel + action）
 *   - 为什么（blocked 阶段的依赖说明）
 *
 * 纯函数：不读 Obsidian、不写文件，便于穷举单测；动作执行在控制器里。
 */
import type { CreationFlowAction, CreationFlowSnapshot, CreationFlowStageStatus } from '@/shared/creation-flow';

/** 主操作卡数据 */
export interface NextStepPlan {
    /** 卡片标题，如「继续写第 3 章」 */
    title: string;
    /** 一句话说明 */
    description: string;
    /** 按钮文案，如「继续写作」 */
    ctaLabel: string;
    /** 按钮触发的动作 */
    action: CreationFlowAction;
    /** 该动作对应的阶段 id（执行时可能需要按阶段分叉） */
    stageId: string;
    /** 目标单元号（write-unit / create-units 时有意义） */
    unitNumber: number | null;
    /** 是否全部完成 */
    allDone: boolean;
    /** 进度百分比（0-100），用于卡片上的进度提示 */
    percent: number;
}

/**
 * 把流程快照翻译成主操作卡。
 *
 * 规则：取 nextStageId 对应阶段；全部完成时给出「导出成稿 / 查看成稿」收尾卡。
 * blocked 阶段沿 dependsOn 回溯到真正可执行的阶段，避免把用户卡在不可点的按钮上。
 *
 * @param snapshot - 流程快照
 * @returns 主操作卡数据；快照无阶段时返回 null
 * @example
 * buildNextStepPlan(snapshot)?.title === '继续写第 3 章'
 */
export function buildNextStepPlan(snapshot: CreationFlowSnapshot | null | undefined): NextStepPlan | null {
    if (!snapshot || !Array.isArray(snapshot.stages) || snapshot.stages.length === 0) return null;
    const percent = Math.round(Math.max(0, Math.min(1, snapshot.overallRatio || 0)) * 100);
    const unitLabel = snapshot.unitLabel || '章';

    const rawNext = snapshot.stages.find(stage => stage.id === snapshot.nextStageId);
    if (!rawNext) {
        return {
            title: '全部阶段已完成',
            description: `${unitLabel}与导出都已就绪，可以合并成稿或回头看质量报告。`,
            ctaLabel: '导出成稿',
            action: 'export',
            stageId: 'export',
            unitNumber: null,
            allDone: true,
            percent: 100,
        };
    }

    // blocked 阶段：沿 blockedBy 回溯到可执行的依赖（最多回溯到根，防环）
    let next = rawNext;
    const visited = new Set<string>();
    while (next.state === 'blocked' && next.blockedBy && !visited.has(next.id)) {
        visited.add(next.id);
        const dependency = snapshot.stages.find(stage => stage.id === next.blockedBy);
        if (!dependency) break;
        next = dependency;
    }

    const unitNumber = snapshot.nextUnitNumber ?? null;
    const plan = actionCopy(next, unitLabel, unitNumber);
    return {
        title: plan.title,
        description: plan.description || next.description,
        ctaLabel: plan.ctaLabel || next.ctaLabel,
        action: next.primaryAction,
        stageId: next.id,
        unitNumber,
        allDone: false,
        percent,
    };
}

/**
 * 按阶段动作生成标题与说明文案。
 *
 * @param stage - 阶段状态
 * @param unitLabel - 单元标签（章/节/集）
 * @param unitNumber - 目标单元号
 * @returns 文案片段（title/description/ctaLabel）
 */
function actionCopy(
    stage: CreationFlowStageStatus,
    unitLabel: string,
    unitNumber: number | null,
): { title: string; description: string; ctaLabel: string } {
    switch (stage.primaryAction) {
        case 'wizard':
            return {
                title: '完成初始化向导',
                description: '世界观、设定、实体与分卷大纲还没搭完，先补齐这些再写正文。',
                ctaLabel: '继续初始化',
            };
        case 'research':
            return {
                title: '完成前期调研',
                description: '类型定位、商业钩子与单元规格还没填，这是后续大纲与正文的前提。',
                ctaLabel: '去填写调研',
            };
        case 'document':
            return {
                title: `完善「${stage.label}」`,
                description: stage.description,
                ctaLabel: '打开文档',
            };
        case 'create-units':
            return {
                title: `创建${unitLabel}骨架`,
                description: `还没有${unitLabel}骨架，先按目标数量批量创建，再逐${unitLabel}写作。`,
                ctaLabel: `批量建${unitLabel}`,
            };
        case 'write-unit':
            return {
                title: unitNumber ? `继续写第 ${unitNumber} ${unitLabel}` : `继续写下一${unitLabel}`,
                description: stage.description,
                ctaLabel: '继续写作',
            };
        case 'settle':
            return {
                title: `结算已完成${unitLabel}节`,
                description: '把正文产生的实体、伏笔与时间线变动写回设定库，避免后续章节前后矛盾。',
                ctaLabel: '去结算',
            };
        case 'export':
            return {
                title: '导出成稿',
                description: '正文已齐，合并分卷并导出 Markdown / TXT / HTML。',
                ctaLabel: '导出成稿',
            };
        default:
            return { title: stage.label, description: stage.description, ctaLabel: stage.ctaLabel };
    }
}
