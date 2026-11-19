/**
 * autosave-hint.ts — 设置页「自动保存」统一提示条
 *
 * 背景（审计 A-15）：设置页的 onChange 立即落盘（无保存按钮、无撤销），
 * 而弹窗表单必须点保存、Esc 丢；两套模型切换时没有任何 UI 提示，用户会把
 * 「改了就存」的心智带到弹窗（或反之）。
 *
 * 这里只负责一件事：在分区顶部渲染一条统一的「自动保存」徽标 + 一句解释。
 * 设置页宿主（ui/settings-tab.ts）与迷你设置弹窗（ui/mini-settings-modal.ts）
 * 共用它，避免两处文案与样式再次漂移。
 */
import { t } from '@/i18n';

/**
 * 在分区容器顶部渲染「自动保存」提示条。
 *
 * 幂等：同一个容器重复调用会先移除旧的提示条，避免设置刷新（rerender）后叠出两条。
 *
 * @param container - 分区容器（通常为 .nw-settings-panel）
 */
export function renderAutoSaveHint(container: HTMLElement): void {
    for (const child of Array.from(container.children)) {
        if (child.classList.contains('nw-settings-autosave')) child.remove();
    }
    const bar = container.createDiv({ cls: 'nw-settings-autosave' });
    bar.createSpan({ cls: 'nw-settings-autosave-badge', text: t('settings.autoSave.badge') });
    bar.createSpan({ cls: 'nw-settings-autosave-hint', text: t('settings.autoSave.hint') });
}
