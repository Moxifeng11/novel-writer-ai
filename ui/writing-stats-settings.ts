/**
 * writing-stats-settings.ts — 设置页「写作统计与桌面宠物」
 *
 * 目标字数用 change（失焦/回车）落盘：onChange 是逐键触发，
 * 在口令加密会话下每次都会全量重加密 data.json（见 v4.29 M-12 的教训）。
 */

import { Setting } from 'obsidian';
import type NovelWriterPlugin from '../main';

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
    container.createEl('h3', { text: '📊 写作统计与桌面宠物' });
    container.createEl('p', {
        text: '字数按正文净增长统计：每章保存后只把「新增的字」记到当天，改写/删章不扣减历史。数据存在插件目录（不写进 vault）。',
        cls: 'setting-item-description',
    });

    new Setting(container)
        .setName('桌面宠物')
        .setDesc('浮窗常驻显示今日字数；可拖动换位置，单击展开本周/本月，双击打开统计。移动端不显示。')
        .addToggle(toggle => toggle
            .setValue(plugin.settings.petEnabled !== false)
            .onChange(async (value) => {
                plugin.setWritingPetEnabled(value);
                await plugin.saveSettings();
                rerender();
            }));

    new Setting(container)
        .setName('每日目标字数')
        .setDesc('宠物与统计页的进度目标；填 0 表示不设目标')
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
        .setName('状态栏显示今日字数')
        .setDesc('关闭后状态栏不再显示「今日 X 字」；桌面宠物不受影响')
        .addToggle(toggle => toggle
            .setValue(plugin.settings.showWordCountInStatusBar !== false)
            .onChange(async (value) => {
                plugin.settings.showWordCountInStatusBar = value;
                await plugin.saveSettings();
                plugin.refreshWritingSurfaces();
            }));

    new Setting(container)
        .setName('统计明细')
        .setDesc('按日 / 按周 / 按月查看产出、连续写作天数与分项目统计')
        .addButton(button => button
            .setButtonText('📊 打开写作统计')
            .onClick(() => plugin.openWritingStats()));
}
