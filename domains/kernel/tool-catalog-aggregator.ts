import type { CreationMode } from '../../shared/creation-mode';
import type { ToolGroup } from './tool-catalog-types';
import { TOOL_GROUPS } from '../long/tool-catalog';
import { SHORT_TOOL_GROUPS } from '../short/tool-catalog';
import { SCRIPT_TOOL_GROUPS } from '../script/tool-catalog';

export function getToolGroupsForMode(mode: CreationMode): ToolGroup[] {
    if (mode === 'short') return SHORT_TOOL_GROUPS;
    if (mode === 'script') return SCRIPT_TOOL_GROUPS;
    return TOOL_GROUPS;
}

export function getModeToolTitle(mode: CreationMode): string {
    if (mode === 'short') return '⚡ 短篇快捷工具';
    if (mode === 'script') return '⚡ 剧本快捷工具';
    return '⚡ 快捷工具';
}
