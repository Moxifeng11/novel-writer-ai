/**
 * wizard-types.ts — 向导（FullWriterView）共享类型
 *
 * 从 full-writer-view.ts 提取，wizard-checker.ts 亦复用，避免重复定义。
 */

export interface WizardTab {
    id: string;
    label: string;
    type: 'wizard';
    project: string;
    projectType: 'original' | 'fanfic';
    currentStepIdx: number;
    steps: WizardStep[];
}

/** 向导步骤状态 — 与 CHAPTER_STATUS 不同，是向导流程专用状态 */
export type WizardStepStatus = 'pending' | 'active' | 'executing' | 'done' | 'skipped' | 'retry' | 'complete_with_warnings';

/** 子步骤状态 — 向导子步骤专用，比主步骤少几个状态 */
export type WizardSubStepStatus = 'pending' | 'active' | 'done' | 'skipped';

/**
 * WizardStep 类型定义。
 */
export interface WizardStep {
    id: string;
    label: string;
    icon: string;
    status: WizardStepStatus;
    subSteps?: { id: string; label: string; status: WizardSubStepStatus }[];
}

/**
 * 按项目类型构建向导步骤定义（original / fanfic 两套固定流程）
 *
 * @param projectType - 项目类型
 * @returns 结果数组
 */
export function buildWizardSteps(projectType: 'original' | 'fanfic'): WizardStep[] {
    if (projectType === 'fanfic') {
        return [
            { id: 'fanfic', label: '原作设定导入', icon: '📖', status: 'active' },
            { id: 'story_structure', label: '故事结构', icon: '🧬', status: 'pending' },
            { id: 'entities', label: '实体生成', icon: '👥', status: 'pending',
              subSteps: [
                  { id: 'characters', label: '人物', status: 'pending' },
                  { id: 'locations', label: '地点', status: 'pending' },
                  { id: 'factions', label: '势力', status: 'pending' },
                  { id: 'items', label: '物品功法', status: 'pending' },
              ] },
            { id: 'worldview', label: '世界观设定', icon: '🌍', status: 'pending' },
            { id: 'setting_lib', label: '设定库', icon: '📚', status: 'pending' },
            { id: 'writing_style', label: '文笔风格', icon: '✍️', status: 'pending' },
            { id: 'outline', label: '全书规划', icon: '📋', status: 'pending' },
            { id: 'chapters', label: '批量建章', icon: '📝', status: 'pending' },
            { id: 'complete', label: '完成', icon: '🎉', status: 'pending' },
        ];
    }
    return [
        { id: 'story_structure', label: '故事结构', icon: '🧬', status: 'active' },
        { id: 'worldview', label: '世界观设定', icon: '🌍', status: 'pending' },
        { id: 'setting_lib', label: '设定库', icon: '📚', status: 'pending' },
        { id: 'writing_style', label: '文笔风格', icon: '✍️', status: 'pending' },
        { id: 'entities', label: '实体生成', icon: '👥', status: 'pending',
          subSteps: [
              { id: 'characters', label: '人物', status: 'pending' },
              { id: 'locations', label: '地点', status: 'pending' },
              { id: 'factions', label: '势力', status: 'pending' },
              { id: 'items', label: '物品功法', status: 'pending' },
          ] },
        { id: 'outline', label: '全书规划', icon: '📋', status: 'pending' },
        { id: 'chapters', label: '批量建章', icon: '📝', status: 'pending' },
        { id: 'complete', label: '完成', icon: '🎉', status: 'pending' },
    ];
}
