/**
 * stage-panel.ts — 工作台「创作阶段」面板的视图模型（纯函数）
 *
 * 阶段定义的唯一来源是 `shared/creation-flow.ts`；本模块只把快照投影为
 * 可渲染条目与预填话术，不复制任何阶段常量，也不读取 Obsidian。
 */
import { getCreationModeLabel } from '@/shared/creation-mode';
import type { CreationFlowSnapshot, CreationFlowStageStatus } from '@/shared/creation-flow';

/**
 * 单个阶段面板条目。
 */
export interface StagePanelItem {
    id: string;
    label: string;
    state: CreationFlowStageStatus['state'];
    /** 已完成的百分比整数（0-100） */
    ratioPercent: number;
    /** 面板第二行：进度或阻塞说明 */
    progressText: string;
    /** 点击后预填到输入框的话术 */
    prompt: string;
    /** 悬浮提示：进度 + 阻塞原因 + 点击行为 */
    tooltip: string;
}

/**
 * 阶段面板视图模型。
 */
export interface StagePanelModel {
    project: string;
    modeLabel: string;
    /** 总进度整数（0-100） */
    percent: number;
    /** 下一步阶段名；全部完成时为「全部阶段已完成」 */
    nextLabel: string;
    items: StagePanelItem[];
    /** 无快照时的占位文案（空串表示正常渲染） */
    emptyText: string;
}

/**
 * 生成阶段条目的预填话术。
 *
 * @param stage - 阶段状态
 * @returns 可直接填入输入框的一句话
 * @example
 * buildStagePrompt({ label: '章节写作', ctaLabel: '继续写第 6 章', state: 'active' } as CreationFlowStageStatus)
 */
export function buildStagePrompt(stage: CreationFlowStageStatus): string {
    const blocked = stage.state === 'blocked' && stage.blockedReason ? `（${stage.blockedReason}）` : '';
    return `继续「${stage.label}」：${stage.ctaLabel}${blocked}`;
}

/**
 * 把统一阶段快照投影为工作台面板模型。
 *
 * @param flow - 阶段快照；未采集到时为 null/undefined
 * @param project - 当前项目 ID（用于占位文案）
 * @returns 可直接渲染的面板模型
 * @example
 * buildStagePanelModel(resolveCreationFlow('long', '长篇小说/示例', facts), '长篇小说/示例')
 */
export function buildStagePanelModel(
    flow: CreationFlowSnapshot | null | undefined,
    project: string,
): StagePanelModel {
    if (!flow) {
        return {
            project,
            modeLabel: '',
            percent: 0,
            nextLabel: '',
            items: [],
            emptyText: project
                ? '阶段读取失败：切换项目或重新打开工作台后重试'
                : '未选择项目：选择或新建项目后显示真实阶段进度',
        };
    }
    const items: StagePanelItem[] = flow.stages.map(stage => ({
        id: stage.id,
        label: stage.label,
        state: stage.state,
        ratioPercent: Math.round(Math.max(0, Math.min(1, stage.ratio)) * 100),
        progressText: stage.state === 'blocked' && stage.blockedReason
            ? `${stage.progressText}（${stage.blockedReason}）`
            : stage.progressText,
        prompt: buildStagePrompt(stage),
        tooltip: `${stage.progressText}${stage.blockedReason ? `；${stage.blockedReason}` : ''}；点击预填下一步指令`,
    }));
    const next = flow.stages.find(stage => stage.id === flow.nextStageId);
    return {
        project,
        modeLabel: getCreationModeLabel(flow.mode),
        percent: Math.round(Math.max(0, Math.min(1, flow.overallRatio)) * 100),
        nextLabel: next ? next.label : '全部阶段已完成',
        items,
        emptyText: '',
    };
}
