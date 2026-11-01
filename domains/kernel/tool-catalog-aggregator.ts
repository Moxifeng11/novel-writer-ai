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
 *
 * @param groups - 原始工具分组
 * @param mode - 当前创作模式
 * @returns 过滤后的分组；没有过滤掉任何按钮时返回原数组
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

/**
 * 被模式规则过滤掉的按钮名（用于「本模式暂不支持」提示，避免整组静默消失）。
 *
 * @param groups - 原始工具分组
 * @param mode - 当前创作模式
 * @returns 被隐藏按钮的展示名
 */
export function getHiddenToolLabels(groups: ToolGroup[], mode: CreationMode): string[] {
    const labels: string[] = [];
    for (const group of groups) {
        for (const button of group.buttons || []) {
            if (isCommandAllowedInMode(button.commandId, mode) === false) labels.push(button.label);
        }
    }
    return labels;
}

/** 模式工具目录：可见分组 + 被隐藏的按钮名。 */
export interface ModeToolCatalog {
    groups: ToolGroup[];
    /** 该类目里因模式不适用被隐藏的按钮（空数组表示没有静默隐藏） */
    hiddenLabels: string[];
}

/**
 * 目录 + 隐藏项：调用方据此渲染「本模式暂不支持：…」提示。
 *
 * @param mode - 当前创作模式
 * @returns 可见分组与被隐藏按钮名
 */
export function getToolCatalogForMode(mode: CreationMode): ModeToolCatalog {
    const source = mode === 'short' ? SHORT_TOOL_GROUPS : mode === 'script' ? SCRIPT_TOOL_GROUPS : TOOL_GROUPS;
    return {
        groups: filterToolGroupsByMode(source, mode),
        hiddenLabels: getHiddenToolLabels(source, mode),
    };
}

/**
 * 只取当前模式的可见工具分组（不返回隐藏项）。
 *
 * @param mode - 当前创作模式
 * @returns 过滤后的分组
 */
export function getToolGroupsForMode(mode: CreationMode): ToolGroup[] {
    const groups = mode === 'short' ? SHORT_TOOL_GROUPS : mode === 'script' ? SCRIPT_TOOL_GROUPS : TOOL_GROUPS;
    return filterToolGroupsByMode(groups, mode);
}

/**
 * 工具区标题（按模式显示不同文案）。
 *
 * @param mode - 当前创作模式
 * @returns 标题文本
 */
export function getModeToolTitle(mode: CreationMode): string {
    if (mode === 'short') return '⚡ 短篇快捷工具';
    if (mode === 'script') return '⚡ 剧本快捷工具';
    return '⚡ 快捷工具';
}
