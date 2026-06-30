import { Setting, Notice } from 'obsidian';
import NovelWriterPlugin from '../main';

export const DEFAULT_APPEARANCE_PRESET: 'soft' | 'clear' | 'paper' = 'soft';

export interface AppearanceSectionOptions {
    compact?: boolean;
    rerender: () => void;
}

function renderThemePreview(parent: HTMLElement, compact: boolean): void {
    const cls = compact ? 'nw-theme-preview nw-theme-preview-mini' : 'nw-theme-preview';
    const preview = parent.createDiv({ cls });
    const swatches = preview.createDiv({ cls: 'nw-theme-preview-swatches' });
    swatches.createDiv({ cls: 'nw-theme-preview-swatch nw-theme-preview-swatch-app' }).createSpan({ text: '底色' });
    swatches.createDiv({ cls: 'nw-theme-preview-swatch nw-theme-preview-swatch-panel' }).createSpan({ text: '面板' });
    swatches.createDiv({ cls: 'nw-theme-preview-swatch nw-theme-preview-swatch-card' }).createSpan({ text: '卡片' });
    if (!compact) {
        const sample = preview.createDiv({ cls: 'nw-theme-preview-sample' });
        sample.createDiv({ cls: 'nw-theme-preview-cover' });
        const body = sample.createDiv({ cls: 'nw-theme-preview-body' });
        body.createEl('strong', { text: '示例项目卡片' });
        body.createEl('span', { text: '底色、面板、卡片需要一眼分开。' });
    }
}

export function renderAppearanceSettings(
    container: HTMLElement,
    plugin: NovelWriterPlugin,
    opts: AppearanceSectionOptions,
): void {
    const compact = opts.compact === true;
    const rerender = opts.rerender;
    const ensureThemeColors = () => {
        if (!plugin.settings.themeColors) plugin.settings.themeColors = {};
        return plugin.settings.themeColors;
    };
    const apply = async () => {
        await plugin.saveSettings();
        plugin.injectThemeVariables();
    };
    const section = container.createDiv({ cls: compact ? 'novel-writer-mini-appearance' : 'novel-writer-appearance' });
    section.createEl(compact ? 'h4' : 'h3', { text: '🎨 外观设置' });
    section.createEl('p', {
        text: '“界面氛围”自动调节底色—面板—卡片三层明度，保证一眼分层；颜色项为可选微调。',
        cls: 'setting-item-description',
    });
    renderThemePreview(section, compact);

    // 主题（仅完整版：跟随系统/浅色/深色）
    if (!compact) {
        new Setting(section)
            .setName('主题')
            .setDesc('插件界面主题（跟随系统 / 浅色 / 深色）')
            .addDropdown(dropdown => {
                dropdown.addOption('auto', '跟随系统');
                dropdown.addOption('light', '浅色');
                dropdown.addOption('dark', '深色');
                dropdown.setValue(plugin.settings.theme);
                dropdown.onChange(async (value) => {
                    plugin.settings.theme = value as 'light' | 'dark' | 'auto';
                    await apply();
                    rerender();
                });
            });
    }

    // 界面氛围（核心：驱动三层对比）
    new Setting(section)
        .setName('界面氛围')
        .setDesc('Soft=柔和、Clear=清晰、Paper=纸质感')
        .addDropdown(dropdown => dropdown
            .addOption('soft', '柔和（推荐）')
            .addOption('clear', '清晰')
            .addOption('paper', '纸质感')
            .setValue(plugin.settings.themeColors?.appearancePreset || DEFAULT_APPEARANCE_PRESET)
            .onChange(async (value) => {
                ensureThemeColors().appearancePreset = value as 'soft' | 'clear' | 'paper';
                await apply();
                rerender();
            }));

    // 底色 / 面板色（仅完整版提供独立微调）
    if (!compact) {
        new Setting(section)
            .setName('底色')
            .setDesc('页面最底层背景色（留空则由氛围预设自动决定）')
            .addColorPicker(picker => {
                if (plugin.settings.themeColors?.appBg) picker.setValue(plugin.settings.themeColors.appBg);
                picker.onChange(async (val) => {
                    ensureThemeColors().appBg = val;
                    await apply();
                    rerender();
                });
            })
            .addExtraButton(btn => btn
                .setIcon('rotate-ccw')
                .setTooltip('恢复底色为氛围预设自动值')
                .onClick(async () => {
                    if (plugin.settings.themeColors) delete plugin.settings.themeColors.appBg;
                    await apply();
                    rerender();
                }));

        new Setting(section)
            .setName('面板色')
            .setDesc('卡片/面板的底色（留空则由氛围预设自动决定）')
            .addColorPicker(picker => {
                if (plugin.settings.themeColors?.panelBg) picker.setValue(plugin.settings.themeColors.panelBg);
                picker.onChange(async (val) => {
                    ensureThemeColors().panelBg = val;
                    await apply();
                    rerender();
                });
            })
            .addExtraButton(btn => btn
                .setIcon('rotate-ccw')
                .setTooltip('恢复面板色为氛围预设自动值')
                .onClick(async () => {
                    if (plugin.settings.themeColors) delete plugin.settings.themeColors.panelBg;
                    await apply();
                    rerender();
                }));
    }

    // 强调色
    new Setting(section)
        .setName('强调色')
        .setDesc('按钮、进度条、选中态的颜色')
        .addColorPicker(picker => {
            if (plugin.settings.themeColors?.accent) picker.setValue(plugin.settings.themeColors.accent);
            picker.onChange(async (val) => {
                ensureThemeColors().accent = val;
                await apply();
                rerender();
            });
        })
        .addExtraButton(btn => btn
            .setIcon('rotate-ccw')
            .setTooltip('恢复强调色为主题默认')
            .onClick(async () => {
                if (plugin.settings.themeColors) delete plugin.settings.themeColors.accent;
                await apply();
                rerender();
            }));

    // 自定义卡片背景（高级，默认关闭）
    new Setting(section)
        .setName('启用自定义卡片背景')
        .setDesc('高级选项：默认关闭，由氛围预设自动保证底色、面板、卡片的层级距离')
        .addToggle(toggle => toggle
            .setValue(plugin.settings.themeColors?.enableCustomCardBg === true)
            .onChange(async (val) => {
                ensureThemeColors().enableCustomCardBg = val;
                await apply();
                rerender();
            }));

    if (plugin.settings.themeColors?.enableCustomCardBg) {
        new Setting(section)
            .setName('卡片背景色')
            .setDesc('仅覆盖卡片背景；如果层级变平，建议关闭上方开关')
            .addColorPicker(picker => {
                if (plugin.settings.themeColors?.cardBg) picker.setValue(plugin.settings.themeColors.cardBg);
                picker.onChange(async (val) => {
                    ensureThemeColors().cardBg = val;
                    await apply();
                    rerender();
                });
            })
            .addExtraButton(btn => btn
                .setIcon('rotate-ccw')
                .setTooltip('删除自定义卡片背景色并关闭开关')
                .onClick(async () => {
                    const tc = plugin.settings.themeColors;
                    if (tc) {
                        delete tc.cardBg;
                        tc.enableCustomCardBg = false;
                    }
                    await apply();
                    rerender();
                    new Notice('已恢复卡片背景自动值');
                }));
    }

    // 主文字色（仅完整版）
    if (!compact) {
        new Setting(section)
            .setName('主文字色')
            .setDesc('标题和主要文字的颜色（留空则由主题决定）')
            .addColorPicker(picker => {
                if (plugin.settings.themeColors?.textPrimary) picker.setValue(plugin.settings.themeColors.textPrimary);
                picker.onChange(async (val) => {
                    ensureThemeColors().textPrimary = val;
                    await apply();
                    rerender();
                });
            })
            .addExtraButton(btn => btn
                .setIcon('rotate-ccw')
                .setTooltip('恢复文字色为主题默认')
                .onClick(async () => {
                    if (plugin.settings.themeColors) delete plugin.settings.themeColors.textPrimary;
                    await apply();
                    rerender();
                }));
    }

    // 恢复默认配色（清空所有自定义，回到纯预设派生）
    new Setting(section)
        .addButton(btn => {
            btn.setButtonText('恢复默认配色').onClick(async () => {
                plugin.settings.themeColors = {};
                await apply();
                rerender();
                new Notice('✅ 已恢复默认配色');
            });
            if (!compact) btn.setWarning();
        });
}
