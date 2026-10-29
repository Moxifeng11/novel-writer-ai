/**
 * unit-tab.ts — 单元写作页签的建签/去重
 *
 * 短篇/剧本以「节 / 集」为单位，每个单元一个页签；
 * 同一项目同一单元只保留一个页签，重复点击只激活。
 */
import type { CreationMode } from '../../shared/creation-mode';
import { modeUnitDisplay } from '../../shared/mode-content';
import type { FullWriterStore, WriterTab } from './full-writer-store';

export function unitTabId(project: string, unitNumber: number): string {
    return `unit:${project}:${unitNumber}`;
}

export function ensureUnitTab(
    state: FullWriterStore,
    project: string,
    mode: CreationMode,
    unitNumber: number,
    activate = true,
): WriterTab {
    const id = unitTabId(project, unitNumber);
    const existing = state.findTab(id);
    if (existing) {
        if (activate) state.activateTab(id);
        return existing;
    }

    const unitName = modeUnitDisplay(unitNumber, mode);
    const tab: WriterTab = {
        id,
        label: `✍️ ${unitName}`,
        type: 'unit',
        project,
        mode,
        unitNumber,
        unitName,
    };
    state.addTab(tab, activate);
    return tab;
}
