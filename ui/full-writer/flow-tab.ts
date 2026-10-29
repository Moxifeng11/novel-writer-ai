/**
 * flow-tab.ts — 「创作流程」页签的建签/去重
 *
 * 一个项目只保留一个流程页签；重复点击入口只激活，不再堆叠副本。
 */
import type { CreationMode } from '../../shared/creation-mode';
import type { FullWriterStore, WriterTab } from './full-writer-store';

export function projectShortName(project: string): string {
    return project.split('/').pop() || project;
}

export function flowTabId(project: string): string {
    return `flow:${project}`;
}

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
