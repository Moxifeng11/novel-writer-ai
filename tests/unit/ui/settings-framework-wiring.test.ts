/**
 * 设置框架接线测试（2026-11-16，S-02/S-03/S-06/S-07/S-09）
 *
 * 这些是「结构一致性」约束，跑真实渲染代价高、且两宿主必须同源：
 * 1. 设置页与设置弹窗都通过 createSettingsSection 创建分区（不再手动 new）；
 * 2. 统计词表 / 关键词兜底已内聚进分区，不再由宿主注入（否则弹窗缺失）；
 * 3. 异步分区带 asyncLoad 标记（宿主据此显示统一刷新条）；
 * 4. 设置页有搜索（A3）；
 * 5. 死代码 resetSettings 已删、热重载入口已移到「关于」分区。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..', '..');
const read = (relative: string): string => readFileSync(join(ROOT, relative), 'utf8');

describe('两宿主统一装配', () => {
    it('设置页使用 createSettingsSection 且不再手动 new 分区类', () => {
        const source = read('ui/settings-tab.ts');
        expect(source).toContain('createSettingsSection');
        expect(source).not.toMatch(/new (ApiSection|KnowledgeSection|FingerprintSection|McpSection|AboutSection)\(/);
    });

    it('设置弹窗使用 createSettingsSection', () => {
        const source = read('ui/mini-settings-modal.ts');
        expect(source).toContain('createSettingsSection');
    });

    it('统计词表/关键词兜底已内聚到分区（宿主持久没有特例注入）', () => {
        expect(read('ui/settings-tab.ts')).not.toContain('renderStatKeywords');
        expect(read('ui/settings-tab.ts')).not.toContain('renderRuleKeywords');
        expect(read('ui/settings/fingerprint-section.ts')).toContain('renderStatKeywords');
        expect(read('ui/settings/general-sections.ts')).toContain('renderRuleKeywords');
    });
});

describe('异步分区与刷新条', () => {
    it('四个异步分区都标记 asyncLoad', () => {
        for (const file of [
            'ui/settings/knowledge-section.ts',
            'ui/settings/fingerprint-section.ts',
            'ui/settings/deconstruction-section.ts',
            'ui/settings/foreshadow-section.ts',
        ]) {
            expect(read(file)).toContain('asyncLoad = true');
        }
    });

    it('宿主持久按 asyncLoad 显示刷新条', () => {
        expect(read('ui/settings-tab.ts')).toContain('nw-settings-async-bar');
        expect(read('ui/settings/section-base.ts')).toContain('asyncLoad');
    });
});

describe('搜索与导航', () => {
    it('设置页接入搜索（全局索引 + 当前分区过滤）', () => {
        const source = read('ui/settings-tab.ts');
        expect(source).toContain('buildStaticSearchIndex');
        expect(source).toContain('searchSettings');
        expect(source).toContain('filterSettingsItems');
        expect(source).toContain('highlightSettingItem');
    });

    it('分组记忆、设置直达命令与 openTab 入口存在', () => {
        const tab = read('ui/settings-tab.ts');
        expect(tab).toContain('groupTabMemory');
        expect(tab).toContain('openTab(');
        expect(read('main.ts')).toContain('open-settings-');
    });

    it('工作台设置入口是分区菜单（菜单逻辑抽到 settings-menu）', () => {
        expect(read('ui/full-writer/title-bar-controller.ts')).toContain('openWorkbenchSettingsMenu');
        const menu = read('ui/full-writer/settings-menu.ts');
        expect(menu).toContain('MiniSettingsModal');
        expect(menu).toContain('打开完整设置页');
        expect(menu).toContain('WORKBENCH_SETTINGS_MENU_TABS');
    });
});

describe('清理', () => {
    it('死代码 resetSettings 已删除', () => {
        expect(read('ui/settings-tab.ts')).not.toContain('resetSettings');
    });

    it('热重载入口移到「关于」分区', () => {
        expect(read('ui/settings/general-sections.ts')).toContain("settings.general.aboutReloadName");
        expect(read('ui/settings-tab.ts')).not.toContain('热重载插件');
    });

    it('注释不再写 18 个 tab（实际 20）', () => {
        expect(read('ui/settings-tab.ts')).not.toContain('18 个 tab');
    });
});
