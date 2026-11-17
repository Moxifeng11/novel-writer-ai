/**
 * locale-setting.ts — 设置页「界面语言」下拉
 *
 * 第一期只做语言切换这一处 UI：选完立即切换（`applyLocaleSetting`）并落盘，
 * 再让宿主机整页重开（`onChanged`），这样所有用 `t()` 取文案的地方都拿到新语言。
 */
import { Setting } from 'obsidian';
import type NovelWriterPlugin from '@/main';
import { LOCALE_OPTIONS, applyLocaleSetting, normalizeLocaleSetting, t, type LocaleSetting } from '@/i18n';

/**
 * 渲染「界面语言」设置项。
 *
 * @param container - 容器
 * @param plugin - 插件实例（读写 settings.language 并落盘）
 * @param onChanged - 语言变更后的回调（宿主用它重开设置页）
 * @example
 * renderLocaleSetting(section, this.plugin, () => this.reopen());
 */
export function renderLocaleSetting(
    container: HTMLElement,
    plugin: NovelWriterPlugin,
    onChanged: () => void,
): void {
    const current = normalizeLocaleSetting(plugin.settings.language);
    new Setting(container)
        .setName(t('settings.appearance.language.name'))
        .setDesc(t('settings.appearance.language.desc'))
        .addDropdown(dropdown => {
            for (const option of LOCALE_OPTIONS) {
                dropdown.addOption(option.value, t(option.labelKey));
            }
            dropdown.setValue(current);
            dropdown.onChange(async (value) => {
                const next = normalizeLocaleSetting(value);
                plugin.settings.language = next;
                applyLocaleSetting(next);
                await plugin.saveSettings();
                onChanged();
            });
        });
}

/**
 * 把设置值收敛成合法值（供测试与外部调用）。
 *
 * @param value - 任意值（可能来自旧版本 data.json 或外部写入）
 * @returns 合法设置值，未知值按 `auto` 处理
 * @example
 * coalesceLocaleSetting('fr-FR'); // 'auto'
 */
export function coalesceLocaleSetting(value: unknown): LocaleSetting {
    return normalizeLocaleSetting(value);
}
