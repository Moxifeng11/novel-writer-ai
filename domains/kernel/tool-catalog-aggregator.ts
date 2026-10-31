import type { CreationMode } from '../../shared/creation-mode';
import type { ToolGroup } from './tool-catalog-types';
import { TOOL_GROUPS } from '../long/tool-catalog';
import { SHORT_TOOL_GROUPS } from '../short/tool-catalog';
import { SCRIPT_TOOL_GROUPS } from '../script/tool-catalog';
import { isCommandAllowedInMode } from '../../shared/command-mode-rules';

/**
 * 按模式过滤工具按钮（v4.23 修复）。
 *
 * P1-7：短篇/剧本目录曾挂着 8 个 LONG_ONLY 命令——按钮点下去被 executor 拦下并弹
 * 「仅适用于长篇小说」，半屏按钮等于失效。这里以 command-mode-rules 为唯一口径过滤，
 * 目录只写「有什么」，能不能用由 rules 决定，避免两套口径漂移。
 */
export function filterToolGroupsByMode(groups: ToolGroup[], mode: CreationMode): ToolGroup[] {
    const filtered: ToolGroup[] = [];
    let changed = false;
    for (const group of groups) {
        const buttons = (group.buttons || []).filter((button) => {
            // 非本插件命令（如 switch-provider）没有模式规则，一律保留
            return isCommandAllowedInMode(button.commandId, mode) !== false;
        });
        if (buttons.length !== (group.buttons || []).length) changed = true;
        if (buttons.length > 0) filtered.push(changed ? { ...group, buttons } : group);
    }
    // 没有过滤掉任何按钮时返回原数组，保证「长篇目录 === TOOL_GROUPS」的既有断言
    return changed ? filtered : groups;
}

export function getToolGroupsForMode(mode: CreationMode): ToolGroup[] {
    const groups = mode === 'short' ? SHORT_TOOL_GROUPS : mode === 'script' ? SCRIPT_TOOL_GROUPS : TOOL_GROUPS;
    return filterToolGroupsByMode(groups, mode);
}

export function getModeToolTitle(mode: CreationMode): string {
    if (mode === 'short') return '⚡ 短篇快捷工具';
    if (mode === 'script') return '⚡ 剧本快捷工具';
    return '⚡ 快捷工具';
}
