/**
 * 工作台设置菜单测试（2026-11-16，C2）
 *
 * 菜单条目是产品决策（常用分区清单），抽成纯函数后锁定：
 * 常用分区按约定顺序出现、缺失分区被跳过、末尾始终有「打开完整设置页」。
 */
import { describe, expect, it, vi } from 'vitest';

const { TABS } = vi.hoisted(() => ({
    TABS: [
        { id: 'api', label: '🔌 API 配置' },
        { id: 'cowrite', label: '🖥 协同写作' },
        { id: 'writing', label: '✍️ 写作配置' },
        { id: 'rules', label: '📜 写作规则' },
        { id: 'mcp', label: '🔌 MCP 服务' },
        { id: 'appearance', label: '🎨 外观设置' },
        { id: 'about', label: 'ℹ️ 关于' },
    ],
}));

vi.mock('obsidian', () => ({ Menu: class {}, App: class {} }));
vi.mock('@/ui/mini-settings-modal', () => ({ MiniSettingsModal: class { open(): void {} } }));
vi.mock('@/ui/settings/section-factory', () => ({ SETTINGS_TAB_DEFINITIONS: TABS }));
vi.mock('@/main', () => ({ default: class {} }));

import {
    buildWorkbenchSettingsMenuItems,
    WORKBENCH_SETTINGS_MENU_TABS,
} from '../../../ui/full-writer/settings-menu';

describe('buildWorkbenchSettingsMenuItems', () => {
    it('常驻 6 个常用分区，末尾是完整设置页', () => {
        const items = buildWorkbenchSettingsMenuItems();
        expect(items.map(item => item.tabId)).toEqual([...WORKBENCH_SETTINGS_MENU_TABS, null]);
        expect(items[items.length - 1].label).toBe('打开完整设置页…');
    });

    it('文案取自页签定义（含 emoji）', () => {
        const items = buildWorkbenchSettingsMenuItems();
        expect(items[0].label).toBe('🔌 API 配置');
        expect(items.some(item => item.label.includes('MCP 服务'))).toBe(true);
    });

    it('页签定义里缺失的分区被跳过（不产生空菜单项）', () => {
        const items = buildWorkbenchSettingsMenuItems([
            { id: 'api', label: 'A' },
            { id: 'mcp', label: 'M' },
        ]);
        expect(items.map(item => item.tabId)).toEqual(['api', 'mcp', null]);
    });
});
