import { Setting, Notice, Modal } from 'obsidian';
import { showErrorNotice, showSuccessNotice } from './components/notice-helpers';
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
    swatches.createDiv({ cls: 'nw-theme-preview-swatch nw-theme-preview-swatch-app' }).createSpan({ text: '基底' });
    swatches.createDiv({ cls: 'nw-theme-preview-swatch nw-theme-preview-swatch-card' }).createSpan({ text: '卡片' });
    swatches.createDiv({ cls: 'nw-theme-preview-swatch nw-theme-preview-swatch-accent' }).createSpan({ text: '强调' });
    if (!compact) {
        const sample = preview.createDiv({ cls: 'nw-theme-preview-sample' });
        sample.createDiv({ cls: 'nw-theme-preview-cover' });
        const body = sample.createDiv({ cls: 'nw-theme-preview-body' });
        body.createEl('strong', { text: '示例项目卡片' });
        body.createEl('span', { text: '基底定调，卡片自动抬起一层，面板跟随基底。' });
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
    let saveTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleSave = () => {
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
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
            clearTimeout(saveTimer);
            saveTimer = null;
        }
        await plugin.saveSettings();
        plugin.injectThemeVariables();
    };

    const section = container.createDiv({ cls: compact ? 'novel-writer-mini-appearance' : 'novel-writer-appearance' });
    section.createEl(compact ? 'h4' : 'h3', { text: '🎨 外观设置' });
    section.createEl('p', {
        text: '三层配色：基底决定整体明度，卡片自动抬起一层，强调色用于按钮与选中态。文字色按基底自动取深浅，无需单独配置。',
        cls: 'setting-item-description',
    });

    if (!compact) renderThemePreview(section, false);

    // ── 第一层：基底 ──
    if (!compact) {
        new Setting(section)
            .setName('主题模式')
            .setDesc('跟随系统 / 浅色 / 深色。它决定基底与文字的默认取值')
            .addDropdown(dropdown => {
                dropdown.addOption('auto', '跟随系统');
                dropdown.addOption('light', '浅色');
                dropdown.addOption('dark', '深色');
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
        .setName('界面氛围')
        .setDesc('决定卡片相对基底抬起的幅度：柔和 < 纸质感 < 清晰')
        .addDropdown(dropdown => dropdown
            .addOption('soft', '柔和（推荐）')
            .addOption('clear', '清晰')
            .addOption('paper', '纸质感')
            .setValue(normalizePreset(plugin.settings.themeColors?.appearancePreset))
            .onChange(async (value) => {
                ensureThemeColors().appearancePreset = normalizePreset(value);
                await apply();
                rerender();
            }));

    const baseSetting = new Setting(section)
        .setName('基底色')
        .setDesc('页面最底层背景。留空则由主题模式决定；面板与卡片会从它自动派生')
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
            .setTooltip('恢复基底为主题默认')
            .onClick(async () => {
                if (plugin.settings.themeColors) delete plugin.settings.themeColors.appBg;
                await apply();
                rerender();
            }));
    void baseSetting;

    // ── 第二层：卡片 ──
    new Setting(section)
        .setName('卡片色')
        .setDesc('卡片/面板的底色。留空则按氛围预设从基底自动抬起一层')
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
            .setTooltip('恢复卡片色为自动派生值')
            .onClick(async () => {
                if (plugin.settings.themeColors) delete plugin.settings.themeColors.cardBg;
                await apply();
                rerender();
            }));

    // ── 第三层：强调 ──
    new Setting(section)
        .setName('强调色')
        .setDesc('按钮、进度条、选中态的颜色。悬停色按基底明暗自动加深或提亮')
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
            .setTooltip('恢复强调色为主题默认')
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
            btn.setButtonText('恢复默认配色').onClick(async () => {
                plugin.settings.themeColors = {};
                await apply();
                rerender();
                showSuccessNotice('已恢复默认配色');
            });
            if (!compact) btn.setWarning();
        });
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
    showSuccessNotice(`已切换到「${theme.name} · ${mode === 'dark' ? '深色' : '浅色'}」`);
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

    section.createEl('h4', { text: '🎨 内置主题' });
    section.createEl('p', {
        text: '每套主题都定义了三个 CSS 层：基底（L1）、卡片（L2）、强调（L3），面板与文字由基底自动派生。点「浅色」或「深色」立即切换，切换后仍可在下面继续微调。',
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
            group.setAttribute('title', `${theme.name}（${mode === 'dark' ? '深色' : '浅色'}）：基底 / 卡片 / 强调`);
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
                text: id === activeId ? `✓ ${mode === 'dark' ? '深色' : '浅色'}` : (mode === 'dark' ? '深色' : '浅色'),
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
        .setName('内置主题')
        .setDesc('三层配色预设，选一个立即生效')
        .addDropdown(dropdown => {
            dropdown.addOption('', '自定义（当前三层设置）');
            for (const theme of BUILTIN_THEMES) {
                if (!isGalleryThemeValid(theme)) continue;
                dropdown.addOption(builtinPresetId(theme.id, 'light'), `${theme.name} · 浅色`);
                dropdown.addOption(builtinPresetId(theme.id, 'dark'), `${theme.name} · 深色`);
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

    section.createEl('h4', { text: '💾 配色方案', cls: 'nw-appearance-presets-title' });

    if (presets.length === 0) {
        section.createEl('p', {
            text: '还没有保存的方案。调好三层颜色后点「保存当前配色」，之后可一键切换。',
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
            text: preset.theme === 'light' ? '浅色' : preset.theme === 'dark' ? '深色' : '跟随系统',
        });

        const actions = row.createDiv({ cls: 'nw-preset-actions' });

        const applyBtn = actions.createEl('button', {
            cls: 'nw-preset-apply',
            text: preset.id === activeId ? '✓ 使用中' : '应用',
            attr: { type: 'button' },
        });
        applyBtn.addEventListener('click', async () => {
            const { theme, themeColors } = presetToSettings(preset);
            plugin.settings.theme = theme;
            // presetToSettings 已带 activePresetId，且不含 textPrimary/panelBg，
            // 整体替换即可保证「切了方案就用该方案的三层值」
            plugin.settings.themeColors = themeColors;
            await plugin.saveSettings();
            plugin.injectThemeVariables();
            showSuccessNotice(`已切换到「${preset.name}」`);
            rerender();
        });

        const delBtn = actions.createEl('button', {
            cls: 'nw-preset-delete',
            text: '删除',
            attr: { type: 'button', title: '删除该方案' },
        });
        delBtn.addEventListener('click', async () => {
            plugin.settings.themePresets = (plugin.settings.themePresets || []).filter(item => item.id !== preset.id);
            if (plugin.settings.themeColors?.activePresetId === preset.id) {
                delete plugin.settings.themeColors.activePresetId;
            }
            await plugin.saveSettings();
            showSuccessNotice(`已删除「${preset.name}」`);
            rerender();
        });
    }

    const actionsRow = section.createDiv({ cls: 'nw-preset-toolbar' });

    const saveBtn = actionsRow.createEl('button', {
        cls: 'nw-btn nw-btn-primary',
        text: '💾 保存当前配色',
        attr: { type: 'button' },
    });
    saveBtn.addEventListener('click', () => {
        const modal = new (class extends Modal {
            onOpen(): void {
                this.modalEl.addClass('nw-scope');
                const { contentEl } = this;
                contentEl.createEl('h3', { text: '保存配色方案' });

                let nameValue = sanitizePresetName('', (plugin.settings.themePresets || []).length + 1);
                new Setting(contentEl)
                    .setName('方案名称')
                    .setDesc('同名方案会被覆盖')
                    .addText(text => text
                        .setValue(nameValue)
                        .setPlaceholder('例如：暖夜')
                        .onChange(value => { nameValue = value; }));

                const footer = contentEl.createDiv({ cls: 'nw-api-modal-footer' });
                footer.createEl('button', { text: '取消', attr: { type: 'button' } })
                    .onclick = () => this.close();
                const confirm = footer.createEl('button', {
                    cls: 'nw-btn nw-btn-primary',
                    text: '保存',
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
                    showSuccessNotice(`已保存方案「${next.name}」`);
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
        text: '📤 导出',
        attr: { type: 'button', title: '导出全部方案为 JSON' },
    });
    exportBtn.addEventListener('click', async () => {
        const data: ThemePreset[] = plugin.settings.themePresets || [];
        if (data.length === 0) {
            new Notice('还没有可导出的方案');
            return;
        }
        const modal = new (class extends Modal {
            onOpen(): void {
                this.modalEl.addClass('nw-scope');
                const { contentEl } = this;
                contentEl.createEl('h3', { text: '导出配色方案' });
                contentEl.createEl('p', {
                    text: '复制下面的 JSON 保存到任意位置，可在其他库导入。',
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
    });

    const importBtn = actionsRow.createEl('button', {
        cls: 'nw-btn nw-btn-secondary',
        text: '📥 导入',
        attr: { type: 'button', title: '粘贴 JSON 导入方案' },
    });
    importBtn.addEventListener('click', () => {
        const modal = new (class extends Modal {
            onOpen(): void {
                this.modalEl.addClass('nw-scope');
                const { contentEl } = this;
                contentEl.createEl('h3', { text: '导入配色方案' });
                contentEl.createEl('p', {
                    text: '粘贴导出的 JSON（单套或数组均可）。非法颜色值会被丢弃。',
                    cls: 'setting-item-description',
                });
                const area = contentEl.createEl('textarea', {
                    cls: 'nw-preset-io',
                    attr: { rows: '12', placeholder: '[{"name":"暖夜","base":"#1c1a1e",...}]', spellcheck: 'false' },
                });

                const footer = contentEl.createDiv({ cls: 'nw-api-modal-footer' });
                footer.createEl('button', { text: '取消', attr: { type: 'button' } })
                    .onclick = () => this.close();
                const confirm = footer.createEl('button', {
                    cls: 'nw-btn nw-btn-primary',
                    text: '导入',
                    attr: { type: 'button' },
                });
                confirm.onclick = async () => {
                    const imported = parsePresetImport(area.value, plugin.settings.themePresets || []);
                    if (imported.length === 0) {
                        showErrorNotice('没有解析到有效方案，请检查 JSON 格式与颜色值', { title: '导入失败' });
                        return;
                    }
                    let merged = plugin.settings.themePresets || [];
                    for (const preset of imported) merged = upsertPreset(merged, preset);
                    plugin.settings.themePresets = merged;
                    await plugin.saveSettings();
                    showSuccessNotice(`已导入 ${imported.length} 套方案`);
                    this.close();
                    rerender();
                };
            }
            onClose(): void { this.contentEl.empty(); }
        })(plugin.app);
        modal.open();
    });
}
