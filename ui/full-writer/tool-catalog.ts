/**
 * tool-catalog.ts - three domain tool catalog aggregator.
 *
 * Domain catalogs live in domains/long, domains/short and domains/script.
 * This file only re-exports types and compatibility helpers.
 */
export type { ToolButton, ToolGroup } from '@/domains/kernel/tool-catalog-types';
export { TOOL_GROUPS, LONG_TOOL_GROUPS, CHAPTER_QUICK_TOOL_IDS, findLongToolByCommandId } from '@/domains/long/tool-catalog';
export { SHORT_TOOL_GROUPS } from '@/domains/short/tool-catalog';
export { SCRIPT_TOOL_GROUPS } from '@/domains/script/tool-catalog';
export { getToolCatalogForMode, getHiddenToolLabels, getToolGroupsForMode, getModeToolTitle } from '@/domains/kernel/tool-catalog-aggregator';
