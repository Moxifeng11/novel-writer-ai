/**
 * flow-tab.ts — 「创作流程」页签的建签/去重
 *
 * 一个项目只保留一个流程页签；重复点击入口只激活，不再堆叠副本。
 */
import type { CreationMode } from '../../shared/creation-mode';
import type { FullWriterStore, WriterTab } from './full-writer-store';

/**
 * projectShortName 函数。
 * @param project - 项目（路径或对象）
 * @returns 文本结果
 */
export function projectShortName(project: string): string {
    return project.split('/').pop() || project;
}

/**
 * flowTabId 函数。
 * @param project - 项目（路径或对象）
 * @returns 文本结果
 */
export function flowTabId(project: string): string {
    return `flow:${project}`;
}

/**
 * ensureFlowTab 函数。
 * @param state - 状态
 * @param project - 项目（路径或对象）
 * @param mode - 模式
 * @param activate - 激活回调
  * @returns WriterTab 实例
 */
export function ensureFlowTab(
    state: FullWriterStore,
    project: string,
    mode: CreationMode,
    activate = true,
): WriterTab {
    const id = flowTabId(project);
    const existing = state.findTab(id);
    if (existing) {
        if (existing.mode !== mode) state.updateTab(id, { mode });
        if (activate) state.activateTab(id);
        return existing;
    }

    const tab: WriterTab = {
        id,
        label: `🧭 创作流程 · ${projectShortName(project)}`,
        type: 'flow',
        project,
        mode,
    };
    state.addTab(tab, activate);
    return tab;
}
