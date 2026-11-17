/**
 * appearance-settings-i18n.test.ts — 外观设置页双语渲染回归
 *
 * 外观页文案改成 t('settings.appearance.*') 之后，最怕「英文环境仍显示中文」或
 * 「某个下拉选项漏迁」。这里用假 DOM 直跑 renderAppearanceSettings，中英各渲染一次，
 * 断言关键控件文案跟随 locale 切换。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { setLocale } from '../../../i18n';
import { renderAppearanceSettings } from '../../../ui/appearance-settings';
import { FakeEl, stubCreateDiv, stubDocument } from './support/fake-dom';

/** 最小宿主：外观页只用到 settings.themeColors/theme/themePresets 与三个副作用方法 */
function makePlugin(): Record<string, unknown> {
    return {
        settings: {
            theme: 'auto',
            themeColors: {},
            themePresets: [],
            language: 'en-US',
        },
        app: {},
        saveSettings: async () => {},
        injectThemeVariables: () => {},
    };
}

function renderText(): string {
    stubCreateDiv();
    stubDocument();
    const container = new FakeEl('div');
    renderAppearanceSettings(
        container as unknown as HTMLElement,
        makePlugin() as never,
        { compact: false, rerender: () => {} },
    );
    return container.allText();
}

afterEach(() => {
    setLocale('zh-CN');
});

describe('外观设置页：文案走 i18n', () => {
    it('英文下整页关键文案为英文，且不再出现已迁移的中文标题', () => {
        setLocale('en-US');
        const text = renderText();
        expect(text).toContain('🎨 Appearance');
        expect(text).toContain('Theme mode');
        expect(text).toContain('Surface atmosphere');
        expect(text).toContain('Base color');
        expect(text).toContain('Card color');
        expect(text).toContain('Accent color');
        expect(text).toContain('🎨 Built-in themes');
        expect(text).toContain('💾 Color presets');
        // 底部「恢复默认配色」是 Setting.addButton 的按钮文案：假 DOM 下按钮挂在
        // stubDocument 上而非 FakeEl 子树，allText 取不到，故不在此断言。
        for (const zh of ['外观设置', '主题模式', '界面氛围', '基底色', '卡片色', '强调色', '内置主题', '配色方案']) {
            expect(text).not.toContain(zh);
        }
    });

    it('中文下保持原中文文案', () => {
        setLocale('zh-CN');
        const text = renderText();
        expect(text).toContain('🎨 外观设置');
        expect(text).toContain('主题模式');
        expect(text).toContain('界面氛围');
        expect(text).toContain('🎨 内置主题');
        expect(text).toContain('💾 配色方案');
    });
});
