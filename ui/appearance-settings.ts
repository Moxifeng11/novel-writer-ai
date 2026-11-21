import { Setting, Notice, Modal } from 'obsidian';
import { showErrorNotice, showSuccessNotice } from './components/notice-helpers';
import { t } from '@/i18n';
import { withWarningStyle } from '@/ui/components/button-compat';
import NovelWriterPlugin from '@/main';
import {
    capturePreset,
    normalizePreset,
    parsePresetImport,
    presetToSettings,
    sanitizePresetName,
    upsertPreset,
    type AppearancePreset,
    type ThemePreset,
} from '@/shared/theme-colors';
import {
    BUILTIN_THEMES,
    activeBuiltinTheme,
    builtinPresetId,
    galleryThemeToPreset,
    isGalleryThemeValid,
    type GalleryTheme,
    type ThemeMode,
} from '@/shared/theme-gallery';

/**
 * DEFAULT_APPEARANCE_PRESET 常量。
 */
export const DEFAULT_APPEARANCE_PRESET: AppearancePreset = 'soft';

/**
 * AppearanceSectionOptions 类型定义。
 */
export interface AppearanceSectionOptions {
    compact?: boolean;
    rerender: () => void;
}

/**
 * 三层配色预览：基底 → 卡片 → 强调。
 * 旧版预览画了「底色/面板/卡片」三块色板，让人误以为要配三个背景色；
 * 三层模型下只需看基底、卡片与强调，面板由基底派生。
 * @param parent - 父级
 * @param compact - 精简结果
 */
function renderThemePreview(parent: HTMLElement, compact: boolean): void {
    const cls = compact ? 'nw-theme-preview nw-theme-preview-mini' : 'nw-theme-preview';
    const preview = parent.createDiv({ cls });
    const swatches = preview.createDiv({ cls: 'nw-theme-preview-swatches' });
    swatches.createDiv({ cls: 'nw-theme-preview-swatch nw-theme-preview-swatch-app' }).createSpan({ text: t('settings.appearance.preview.base') });
    swatches.createDiv({ cls: 'nw-theme-preview-swatch nw-theme-preview-swatch-card' }).createSpan({ text: t('settings.appearance.preview.card') });
    swatches.createDiv({ cls: 'nw-theme-preview-swatch nw-theme-preview-swatch-accent' }).createSpan({ text: t('settings.appearance.preview.accent') });
    if (!compact) {
        const sample = preview.createDiv({ cls: 'nw-theme-preview-sample' });
        sample.createDiv({ cls: 'nw-theme-preview-cover' });
        const body = sample.createDiv({ cls: 'nw-theme-preview-body' });
        body.createEl('strong', { text: t('settings.appearance.preview.sampleTitle') });
        body.createSpan({ text: t('settings.appearance.preview.sampleText') });
    }
}

/**
 * renderAppearanceSettings 函数。
 * @param container - 容器元素
 * @param plugin - 插件实例
 * @param opts - 选项
 */
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
    // 取色是高频交互：只重注入 CSS 变量并防抖落盘。
    // 旧实现每次 onChange 都 await saveSettings() + rerender()，
    // 拖动取色器时会连续触发磁盘写入与整块 DOM 重建。
    let saveTimer: number | null = null;
    const scheduleSave = () => {
        if (saveTimer) window.clearTimeout(saveTimer);
        saveTimer = window.setTimeout(() => {
            saveTimer = null;
            void plugin.saveSettings();
        }, 300);
    };
    /** 颜色变化：立即改视觉，防抖落盘，不重建 DOM */
    const applyLive = () => {
        plugin.injectThemeVariables();
        scheduleSave();
    };
    /** 需要同步刷新控件状态（如重置）时使用 */
    const apply = async () => {
        if (saveTimer) {
            window.clearTimeout(saveTimer);
            saveTimer = null;
        }
        await plugin.saveSettings();
        plugin.injectThemeVariables();
    };

    const section = container.createDiv({ cls: compact ? 'novel-writer-mini-appearance' : 'novel-writer-appearance' });
    section.createEl(compact ? 'h4' : 'h3', { text: t('settings.appearance.title') });
    section.createEl('p', {
        text: t('settings.appearance.intro'),
        cls: 'setting-item-description',
    });

    if (!compact) renderThemePreview(section, false);

    // ── 第一层：基底 ──
    if (!compact) {
        new Setting(section)
            .setName(t('settings.appearance.themeMode.name'))
            .setDesc(t('settings.appearance.themeMode.desc'))
            .addDropdown(dropdown => {
                dropdown.addOption('auto', t('settings.appearance.themeMode.auto'));
                dropdown.addOption('light', t('settings.appearance.themeMode.light'));
                dropdown.addOption('dark', t('settings.appearance.themeMode.dark'));
                dropdown.setValue(plugin.settings.theme);
                dropdown.onChange(async (value) => {
                    plugin.settings.theme = value as 'light' | 'dark' | 'auto';
                    // 当前用的是内置主题：跟着模式换到同一主题的对应配色，不要停留在反色的底
                    const current = activeBuiltinTheme(plugin.settings.themeColors?.activePresetId);
                    const theme = current ? BUILTIN_THEMES.find(item => item.id === current.themeId) : undefined;
                    if (theme) {
                        const resolvedMode: ThemeMode = value === 'dark'
                            ? 'dark'
                            : value === 'light'
                                ? 'light'
                                : (document.body.classList.contains('theme-dark') ? 'dark' : 'light');
                        const { themeColors } = presetToSettings(galleryThemeToPreset(theme, resolvedMode));
                        plugin.settings.themeColors = themeColors;
                        await plugin.saveSettings();
                        plugin.injectThemeVariables();
                        rerender();
                        return;
                    }
                    await apply();
                    rerender();
                });
            });
    }

    new Setting(section)
        .setName(t('settings.appearance.atmosphere.name'))
        .setDesc(t('settings.appearance.atmosphere.desc'))
        .addDropdown(dropdown => dropdown
            .addOption('soft', t('settings.appearance.atmosphere.soft'))
            .addOption('clear', t('settings.appearance.atmosphere.clear'))
            .addOption('paper', t('settings.appearance.atmosphere.paper'))
            .setValue(normalizePreset(plugin.settings.themeColors?.appearancePreset))
            .onChange(async (value) => {
                ensureThemeColors().appearancePreset = normalizePreset(value);
                await apply();
                rerender();
            }));

    const baseSetting = new Setting(section)
        .setName(t('settings.appearance.baseColor.name'))
        .setDesc(t('settings.appearance.baseColor.desc'))
        .addColorPicker(picker => {
            if (plugin.settings.themeColors?.appBg) picker.setValue(plugin.settings.themeColors.appBg);
            picker.onChange((val) => {
                ensureThemeColors().appBg = val;
                ensureThemeColors().activePresetId = undefined;
                applyLive();
            });
        })
        .addExtraButton(btn => btn
            .setIcon('rotate-ccw')
            .setTooltip(t('settings.appearance.baseColor.reset'))
            .onClick(async () => {
                if (plugin.settings.themeColors) delete plugin.settings.themeColors.appBg;
                await apply();
                rerender();
            }));
    void baseSetting;

    // ── 第二层：卡片 ──
    new Setting(section)
        .setName(t('settings.appearance.cardColor.name'))
        .setDesc(t('settings.appearance.cardColor.desc'))
        .addColorPicker(picker => {
            if (plugin.settings.themeColors?.cardBg) picker.setValue(plugin.settings.themeColors.cardBg);
            picker.onChange((val) => {
                ensureThemeColors().cardBg = val;
                ensureThemeColors().activePresetId = undefined;
                applyLive();
            });
        })
        .addExtraButton(btn => btn
            .setIcon('rotate-ccw')
            .setTooltip(t('settings.appearance.cardColor.reset'))
            .onClick(async () => {
                if (plugin.settings.themeColors) delete plugin.settings.themeColors.cardBg;
                await apply();
                rerender();
            }));

    // ── 第三层：强调 ──
    new Setting(section)
        .setName(t('settings.appearance.accentColor.name'))
        .setDesc(t('settings.appearance.accentColor.desc'))
        .addColorPicker(picker => {
            if (plugin.settings.themeColors?.accent) picker.setValue(plugin.settings.themeColors.accent);
            picker.onChange((val) => {
                ensureThemeColors().accent = val;
                ensureThemeColors().activePresetId = undefined;
                applyLive();
            });
        })
        .addExtraButton(btn => btn
            .setIcon('rotate-ccw')
            .setTooltip(t('settings.appearance.accentColor.reset'))
            .onClick(async () => {
                if (plugin.settings.themeColors) delete plugin.settings.themeColors.accent;
                await apply();
                rerender();
            }));

    if (!compact) {
        renderThemeGallery(section, plugin, rerender);
        renderPresetManager(section, plugin, rerender);
    } else {
        renderThemeGalleryCompact(section, plugin, rerender);
    }

    new Setting(section)
        .addButton(btn => {
            btn.setButtonText(t('settings.appearance.resetDefaults')).onClick(async () => {
                plugin.settings.themeColors = {};
                await apply();
                rerender();
                showSuccessNotice(t('settings.appearance.resetDone'));
            });
            if (!compact) withWarningStyle(btn);
        });
}

/**
 * 主题模式的中文/英文显示名（浅色 / 深色）
 *
 * @param mode - 主题模式
 * @returns 本地化后的模式名
 * @example
 * modeLabel('dark'); // 深色
 */
function modeLabel(mode: ThemeMode): string {
    return mode === 'dark'
        ? t('settings.appearance.themeMode.dark')
        : t('settings.appearance.themeMode.light');
}

/**
 * 应用一套内置主题（浅/深），全量与紧凑入口共用
 *
 * @param plugin - 插件实例
 * @param theme - 主题
 * @param mode - 模式
 */
async function applyGalleryTheme(
    plugin: NovelWriterPlugin,
    theme: GalleryTheme,
    mode: ThemeMode,
): Promise<void> {
    const preset = galleryThemeToPreset(theme, mode);
    const { theme: nextTheme, themeColors } = presetToSettings(preset);
    plugin.settings.theme = nextTheme;
    // 整体替换：切了主题就用该主题的三层值，不残留上一套的单项覆盖
    plugin.settings.themeColors = themeColors;
    await plugin.saveSettings();
    plugin.injectThemeVariables();
    showSuccessNotice(t('settings.appearance.themeApplied', { theme: theme.name, mode: modeLabel(mode) }));
}

/**
 * 内置主题画廊：三层配色预设，点一下就切换（不占用户的「配色方案」配额）
 *
 * @param section - 分区
 * @param plugin - 插件实例
 * @param rerender - 是否重渲染
 */
function renderThemeGallery(
    section: HTMLElement,
    plugin: NovelWriterPlugin,
    rerender: () => void,
): void {
    const active = activeBuiltinTheme(plugin.settings.themeColors?.activePresetId);
    const activeId = active ? builtinPresetId(active.themeId, active.mode) : '';

    section.createEl('h4', { text: t('settings.appearance.gallery.title') });
    section.createEl('p', {
        text: t('settings.appearance.gallery.intro'),
        cls: 'setting-item-description',
    });

    const list = section.createDiv({ cls: 'nw-preset-list' });

    for (const theme of BUILTIN_THEMES) {
        if (!isGalleryThemeValid(theme)) continue;
        const lightId = builtinPresetId(theme.id, 'light');
        const darkId = builtinPresetId(theme.id, 'dark');
        const rowActive = activeId === lightId || activeId === darkId;

        const row = list.createDiv({
            cls: 'nw-preset-row' + (rowActive ? ' nw-preset-row-active' : ''),
        });

        // 三色色卡：浅色在前、深色在后，一眼能看出两种模式的分层
        // （复用 .nw-preset-swatch 的 flex 布局，两列各三个 chip，不新增 CSS）
        const swatch = row.createDiv({ cls: 'nw-preset-swatch' });
        for (const mode of ['light', 'dark'] as const) {
            const variant = mode === 'dark' ? theme.dark : theme.light;
            const group = swatch.createDiv();
            group.setAttribute('title', t('settings.appearance.gallery.swatchTitle', {
                theme: theme.name,
                mode: modeLabel(mode),
            }));
            group.createDiv({ cls: 'nw-preset-chip' }).style.background = variant.base;
            group.createDiv({ cls: 'nw-preset-chip' }).style.background = variant.card;
            group.createDiv({ cls: 'nw-preset-chip' }).style.background = variant.accent;
        }

        const nameEl = row.createDiv({ cls: 'nw-preset-name' });
        nameEl.createSpan({ text: theme.name });
        nameEl.createSpan({ cls: 'nw-preset-meta', text: theme.description });

        const actions = row.createDiv({ cls: 'nw-preset-actions' });
        for (const mode of ['light', 'dark'] as const) {
            const id = mode === 'dark' ? darkId : lightId;
            const btn = actions.createEl('button', {
                cls: 'nw-preset-apply',
                text: id === activeId
                    ? t('settings.appearance.gallery.active', { mode: modeLabel(mode) })
                    : modeLabel(mode),
                attr: { type: 'button' },
            });
            btn.addEventListener('click', () => {
                void applyGalleryTheme(plugin, theme, mode).then(rerender);
            });
        }
    }
}

/**
 * 紧凑模式（mini 设置）：一个下拉即可切换全部内置主题
 *
 * @param section - 分区
 * @param plugin - 插件实例
 * @param rerender - 是否重渲染
 */
function renderThemeGalleryCompact(
    section: HTMLElement,
    plugin: NovelWriterPlugin,
    rerender: () => void,
): void {
    const active = activeBuiltinTheme(plugin.settings.themeColors?.activePresetId);
    const activeId = active ? builtinPresetId(active.themeId, active.mode) : '';

    new Setting(section)
        .setName(t('settings.appearance.galleryCompact.name'))
        .setDesc(t('settings.appearance.galleryCompact.desc'))
        .addDropdown(dropdown => {
            dropdown.addOption('', t('settings.appearance.galleryCompact.custom'));
            for (const theme of BUILTIN_THEMES) {
                if (!isGalleryThemeValid(theme)) continue;
                dropdown.addOption(builtinPresetId(theme.id, 'light'), t('settings.appearance.galleryCompact.option', {
                    theme: theme.name,
                    mode: t('settings.appearance.themeMode.light'),
                }));
                dropdown.addOption(builtinPresetId(theme.id, 'dark'), t('settings.appearance.galleryCompact.option', {
                    theme: theme.name,
                    mode: t('settings.appearance.themeMode.dark'),
                }));
            }
            dropdown.setValue(activeId);
            dropdown.onChange(async (value) => {
                const parsed = activeBuiltinTheme(value);
                if (!parsed) return;
                const theme = BUILTIN_THEMES.find(item => item.id === parsed.themeId);
                if (!theme) return;
                await applyGalleryTheme(plugin, theme, parsed.mode);
                rerender();
            });
        });
}

/**
 * 配色方案管理：保存 / 一键切换 / 删除 / 导入导出
 *
 * @param section - 分区
 * @param plugin - 插件实例
 * @param rerender - 是否重渲染
 */
function renderPresetManager(
    section: HTMLElement,
    plugin: NovelWriterPlugin,
    rerender: () => void,
): void {
    const presets = plugin.settings.themePresets || [];
    const activeId = plugin.settings.themeColors?.activePresetId || '';

    section.createEl('h4', { text: t('settings.appearance.presets.title'), cls: 'nw-appearance-presets-title' });

    if (presets.length === 0) {
        section.createEl('p', {
            text: t('settings.appearance.presets.empty'),
            cls: 'setting-item-description',
        });
    }

    const list = section.createDiv({ cls: 'nw-preset-list' });
    for (const preset of presets) {
        const row = list.createDiv({
            cls: 'nw-preset-row' + (preset.id === activeId ? ' nw-preset-row-active' : ''),
        });

        const swatch = row.createDiv({ cls: 'nw-preset-swatch' });
        if (preset.base) swatch.createDiv({ cls: 'nw-preset-chip' }).style.background = preset.base;
        if (preset.card) swatch.createDiv({ cls: 'nw-preset-chip' }).style.background = preset.card;
        if (preset.accent) swatch.createDiv({ cls: 'nw-preset-chip' }).style.background = preset.accent;

        const nameEl = row.createDiv({ cls: 'nw-preset-name' });
        nameEl.createSpan({ text: preset.name });
        nameEl.createSpan({
            cls: 'nw-preset-meta',
            text: preset.theme === 'light'
                ? t('settings.appearance.themeMode.light')
                : preset.theme === 'dark'
                    ? t('settings.appearance.themeMode.dark')
                    : t('settings.appearance.themeMode.auto'),
        });

        const actions = row.createDiv({ cls: 'nw-preset-actions' });

        const applyBtn = actions.createEl('button', {
            cls: 'nw-preset-apply',
            text: preset.id === activeId ? t('settings.appearance.presets.inUse') : t('settings.appearance.presets.apply'),
            attr: { type: 'button' },
        });
        applyBtn.addEventListener('click', () => { void (async () => {
            const { theme, themeColors } = presetToSettings(preset);
            plugin.settings.theme = theme;
            // presetToSettings 已带 activePresetId，且不含 textPrimary/panelBg，
            // 整体替换即可保证「切了方案就用该方案的三层值」
            plugin.settings.themeColors = themeColors;
            await plugin.saveSettings();
            plugin.injectThemeVariables();
            showSuccessNotice(t('settings.appearance.presets.applied', { name: preset.name }));
            rerender();
        })(); });

        const delBtn = actions.createEl('button', {
            cls: 'nw-preset-delete',
            text: t('settings.appearance.presets.delete'),
            attr: { type: 'button', title: t('settings.appearance.presets.deleteTitle') },
        });
        delBtn.addEventListener('click', () => { void (async () => {
            plugin.settings.themePresets = (plugin.settings.themePresets || []).filter(item => item.id !== preset.id);
            if (plugin.settings.themeColors?.activePresetId === preset.id) {
                delete plugin.settings.themeColors.activePresetId;
            }
            await plugin.saveSettings();
            showSuccessNotice(t('settings.appearance.presets.deleted', { name: preset.name }));
            rerender();
        })(); });
    }

    const actionsRow = section.createDiv({ cls: 'nw-preset-toolbar' });

    const saveBtn = actionsRow.createEl('button', {
        cls: 'nw-btn nw-btn-primary',
        text: t('settings.appearance.presets.save'),
        attr: { type: 'button' },
    });
    saveBtn.addEventListener('click', () => {
        const modal = new (class extends Modal {
            onOpen(): void {
                this.modalEl.addClass('nw-scope');
                const { contentEl } = this;
                contentEl.createEl('h3', { text: t('settings.appearance.presets.saveTitle') });

                let nameValue = sanitizePresetName('', (plugin.settings.themePresets || []).length + 1);
                new Setting(contentEl)
                    .setName(t('settings.appearance.presets.nameLabel'))
                    .setDesc(t('settings.appearance.presets.nameDesc'))
                    .addText(text => text
                        .setValue(nameValue)
                        .setPlaceholder(t('settings.appearance.presets.namePlaceholder'))
                        .onChange(value => { nameValue = value; }));

                const footer = contentEl.createDiv({ cls: 'nw-api-modal-footer' });
                footer.createEl('button', { text: t('common.cancel'), attr: { type: 'button' } })
                    .onclick = () => this.close();
                const confirm = footer.createEl('button', {
                    cls: 'nw-btn nw-btn-primary',
                    text: t('settings.appearance.presets.saveConfirm'),
                    attr: { type: 'button' },
                });
                confirm.onclick = async () => {
                    const next = capturePreset(
                        plugin.settings.themeColors,
                        plugin.settings.theme,
                        nameValue,
                        plugin.settings.themePresets || [],
                    );
                    plugin.settings.themePresets = upsertPreset(plugin.settings.themePresets || [], next);
                    if (!plugin.settings.themeColors) plugin.settings.themeColors = {};
                    plugin.settings.themeColors.activePresetId = next.id;
                    await plugin.saveSettings();
                    showSuccessNotice(t('settings.appearance.presets.saved', { name: next.name }));
                    this.close();
                    rerender();
                };
            }
            onClose(): void { this.contentEl.empty(); }
        })(plugin.app);
        modal.open();
    });

    const exportBtn = actionsRow.createEl('button', {
        cls: 'nw-btn nw-btn-secondary',
        text: t('settings.appearance.presets.export'),
        attr: { type: 'button', title: t('settings.appearance.presets.exportTitle') },
    });
    exportBtn.addEventListener('click', () => { void (async () => {
        const data: ThemePreset[] = plugin.settings.themePresets || [];
        if (data.length === 0) {
            new Notice(t('settings.appearance.presets.exportEmpty'));
            return;
        }
        const modal = new (class extends Modal {
            onOpen(): void {
                this.modalEl.addClass('nw-scope');
                const { contentEl } = this;
                contentEl.createEl('h3', { text: t('settings.appearance.presets.exportDialogTitle') });
                contentEl.createEl('p', {
                    text: t('settings.appearance.presets.exportHint'),
                    cls: 'setting-item-description',
                });
                const area = contentEl.createEl('textarea', {
                    cls: 'nw-preset-io',
                    attr: { rows: '12', readonly: 'true', spellcheck: 'false' },
                });
                area.value = JSON.stringify(data, null, 2);
                area.select();
            }
            onClose(): void { this.contentEl.empty(); }
        })(plugin.app);
        modal.open();
    })(); });

    const importBtn = actionsRow.createEl('button', {
        cls: 'nw-btn nw-btn-secondary',
        text: t('settings.appearance.presets.import'),
        attr: { type: 'button', title: t('settings.appearance.presets.importTitle') },
    });
    importBtn.addEventListener('click', () => {
        const modal = new (class extends Modal {
            onOpen(): void {
                this.modalEl.addClass('nw-scope');
                const { contentEl } = this;
                contentEl.createEl('h3', { text: t('settings.appearance.presets.importDialogTitle') });
                contentEl.createEl('p', {
                    text: t('settings.appearance.presets.importHint'),
                    cls: 'setting-item-description',
                });
                const area = contentEl.createEl('textarea', {
                    cls: 'nw-preset-io',
                    attr: { rows: '12', placeholder: t('settings.appearance.presets.importPlaceholder'), spellcheck: 'false' },
                });

                const footer = contentEl.createDiv({ cls: 'nw-api-modal-footer' });
                footer.createEl('button', { text: t('common.cancel'), attr: { type: 'button' } })
                    .onclick = () => this.close();
                const confirm = footer.createEl('button', {
                    cls: 'nw-btn nw-btn-primary',
                    text: t('settings.appearance.presets.importConfirm'),
                    attr: { type: 'button' },
                });
                confirm.onclick = async () => {
                    const imported = parsePresetImport(area.value, plugin.settings.themePresets || []);
                    if (imported.length === 0) {
                        showErrorNotice(t('settings.appearance.presets.importFailed'), { title: t('settings.appearance.presets.importFailedTitle') });
                        return;
                    }
                    let merged = plugin.settings.themePresets || [];
                    for (const preset of imported) merged = upsertPreset(merged, preset);
                    plugin.settings.themePresets = merged;
                    await plugin.saveSettings();
                    showSuccessNotice(t('settings.appearance.presets.imported', { count: imported.length }));
                    this.close();
                    rerender();
                };
            }
            onClose(): void { this.contentEl.empty(); }
        })(plugin.app);
        modal.open();
    });
}
