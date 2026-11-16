/**
 * settings-menu.ts — 工作台「⚙️ 设置」菜单（2026-11-16，C2）
 *
 * 从 title-bar-controller 抽出，原因有二：
 * 1. title-bar-controller 本身超过 200 行后必须可测（门禁），抽成纯逻辑便于单测；
 * 2. 常用分区清单是产品决策，独立成常量后调整只需改一处。
 *
 * 行为：点「⚙️ 设置」弹出菜单 → 常用分区（直接打开设置弹窗对应页签）+ 打开完整设置页。
 */
import { App, Menu } from 'obsidian';
import type NovelWriterPlugin from '@/main';
import { MiniSettingsModal } from '@/ui/mini-settings-modal';
import { SETTINGS_TAB_DEFINITIONS } from '@/ui/settings/section-factory';

/**
 * 工作台设置菜单里的常用分区（顺序即菜单顺序）。
 *
 * 只放「写作时最可能要改」的分区；完整设置页仍可通过菜单最后一项进入。
 */
export const WORKBENCH_SETTINGS_MENU_TABS: readonly string[] = [
    'api',
    'cowrite',
    'writing',
    'rules',
    'mcp',
    'appearance',
];

/** 菜单条目（纯数据，便于单测） */
export interface WorkbenchSettingsMenuItem {
    /** 分区 id；`null` 表示「打开完整设置页」 */
    tabId: string | null;
    /** 菜单显示文案 */
    label: string;
}

/**
 * 构建菜单条目。
 *
 * @param tabs - 页签定义（默认取装配表）
 * @returns 菜单条目列表（常用分区 + 分隔后的完整设置页）
 * @example
 * buildWorkbenchSettingsMenuItems(); // [{ tabId: 'api', label: '🔌 API 配置' }, ...]
 */
export function buildWorkbenchSettingsMenuItems(
    tabs: ReadonlyArray<{ id: string; label: string }> = SETTINGS_TAB_DEFINITIONS,
): WorkbenchSettingsMenuItem[] {
    const items: WorkbenchSettingsMenuItem[] = [];
    for (const tabId of WORKBENCH_SETTINGS_MENU_TABS) {
        const tab = tabs.find(item => item.id === tabId);
        if (!tab) continue;
        items.push({ tabId: tab.id, label: tab.label });
    }
    items.push({ tabId: null, label: '打开完整设置页…' });
    return items;
}

/**
 * 打开工作台设置菜单。
 *
 * @param app - Obsidian 应用
 * @param plugin - 插件实例（用于打开完整设置页）
 * @param event - 触发点击事件（菜单位置）
 * @example
 * openWorkbenchSettingsMenu(app, plugin, event);
 */
export function openWorkbenchSettingsMenu(app: App, plugin: NovelWriterPlugin, event: MouseEvent): void {
    const menu = new Menu();
    const items = buildWorkbenchSettingsMenuItems();
    for (const item of items) {
        if (item.tabId === null) {
            menu.addSeparator();
            menu.addItem(entry => entry
                .setTitle(item.label)
                .onClick(() => plugin.openSettingsTab('api')));
            continue;
        }
        const tabId = item.tabId;
        menu.addItem(entry => entry
            .setTitle(item.label)
            .onClick(() => new MiniSettingsModal(app, plugin, tabId).open()));
    }
    menu.showAtMouseEvent(event);
}
