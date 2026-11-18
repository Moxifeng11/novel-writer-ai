/**
 * writing-stats-settings.ts — 设置页「写作统计与桌面宠物」
 *
 * 目标字数用 change（失焦/回车）落盘：onChange 是逐键触发，
 * 在口令加密会话下每次都会全量重加密 data.json（见 v4.29 M-12 的教训）。
 */

import { Setting } from 'obsidian';
import { t } from '@/i18n';
import type NovelWriterPlugin from '@/main';
import { renderPetImageSettings } from '@/ui/pet-image-settings';

/**
 * renderWritingStatsAndPetSettings 函数。
 * @param container - 容器元素
 * @param plugin - 插件实例
 * @param rerender - 是否重渲染
 */
export function renderWritingStatsAndPetSettings(
    container: HTMLElement,
    plugin: NovelWriterPlugin,
    rerender: () => void,
): void {
    container.createEl('h3', { text: t('fullwriter.pet.statsTitle') });
    container.createEl('p', {
        text: t('fullwriter.pet.statsDesc'),
        cls: 'setting-item-description',
    });

    new Setting(container)
        .setName(t('fullwriter.pet.petName'))
        .setDesc(t('fullwriter.pet.petDesc'))
        .addToggle(toggle => toggle
            .setValue(plugin.settings.petEnabled !== false)
            .onChange(async (value) => {
                plugin.setWritingPetEnabled(value);
                await plugin.saveSettings();
                rerender();
            }));

    renderPetImageSettings(container, plugin, rerender);

    new Setting(container)
        .setName(t('fullwriter.pet.dailyGoalName'))
        .setDesc(t('fullwriter.pet.dailyGoalDesc'))
        .addText(text => {
            text.setValue(String(plugin.settings.dailyWordTarget ?? 3000));
            text.inputEl.addEventListener('change', () => {
                const parsed = parseInt(text.inputEl.value.trim(), 10);
                plugin.settings.dailyWordTarget = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
                void plugin.saveSettings();
                plugin.refreshWritingSurfaces();
            });
        });

    new Setting(container)
        .setName(t('fullwriter.pet.statusBarName'))
        .setDesc(t('fullwriter.pet.statusBarDesc'))
        .addToggle(toggle => toggle
            .setValue(plugin.settings.showWordCountInStatusBar !== false)
            .onChange(async (value) => {
                plugin.settings.showWordCountInStatusBar = value;
                await plugin.saveSettings();
                plugin.refreshWritingSurfaces();
            }));

    new Setting(container)
        .setName(t('fullwriter.pet.detailName'))
        .setDesc(t('fullwriter.pet.detailDesc'))
        .addButton(button => button
            .setButtonText(t('fullwriter.pet.openStatsBtn'))
            .onClick(() => plugin.openWritingStats()));
}
