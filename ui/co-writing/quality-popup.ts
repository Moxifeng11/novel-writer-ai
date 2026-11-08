/**
 * quality-popup.ts — 质量控制问题的浮窗、右键菜单与编辑器定位
 *
 * 从 `ui/co-writing-view.ts` 抽出 DOM 部分；AI 修复动作通过回调注入。
 */
import { Menu } from 'obsidian';
import { showWarningNotice } from '@/ui/components/notice-helpers';
import { lineTopForIndex } from './quality-fix';
import type { QualityIssue } from './quality-report';

/** 右键菜单动作。 */
export interface QualityPopupActions {
    /** AI 修复 */
    onFix(): void;
    /** 定位到编辑器 */
    onLocate(): void;
}

/**
 * 计算浮窗位置（限制在视口内）。
 *
 * @param clientX - 鼠标 X
 * @param clientY - 鼠标 Y
 * @param viewportWidth - 视口宽
 * @param viewportHeight - 视口高
 * @returns 左上角坐标
 * @example
 * ```ts
 * computePopupPosition(100, 100, 800, 600);
 * ```
 */
export function computePopupPosition(
    clientX: number,
    clientY: number,
    viewportWidth: number,
    viewportHeight: number,
): { left: number; top: number } {
    return {
        left: Math.min(clientX + 10, viewportWidth - 320),
        top: Math.min(clientY - 10, viewportHeight - 200),
    };
}

/**
 * 显示问题详情浮窗。
 *
 * @param issue - 质量问题
 * @param event - 鼠标事件
 * @returns 浮窗元素
 * @example
 * ```ts
 * const popup = showQualityPopup(issue, event);
 * ```
 */
export function showQualityPopup(issue: QualityIssue, event: MouseEvent): HTMLElement {
    // v4.79.0：按鼠标事件所属窗口挂载与定位（popout 下不能写到主窗口 body）
    const win = event.view ?? window;
    const popup = win.document.body.createDiv({ cls: 'nw-quality-popup' });
    const position = computePopupPosition(event.clientX, event.clientY, win.innerWidth, win.innerHeight);
    popup.style.left = `${position.left}px`;
    popup.style.top = `${position.top}px`;
    const header = popup.createDiv({ cls: 'nw-quality-popup-header' });
    header.createSpan({ text: `${issue.severity} ${issue.category}` });
    const body = popup.createDiv({ cls: 'nw-quality-popup-body' });
    body.createDiv({ cls: 'nw-quality-popup-label', text: '问题' });
    body.createDiv({ cls: 'nw-quality-popup-text', text: issue.problem });
    body.createDiv({ cls: 'nw-quality-popup-label', text: '建议' });
    body.createDiv({ cls: 'nw-quality-popup-text', text: issue.suggestion });
    if (issue.locationText) {
        body.createDiv({ cls: 'nw-quality-popup-label', text: '定位' });
        body.createDiv({ cls: 'nw-quality-popup-location', text: `附近文字：${issue.locationText}` });
    }
    return popup;
}

/**
 * 移除浮窗。
 *
 * @param popup - 浮窗元素
 * @example
 * ```ts
 * hideQualityPopup(popup);
 * ```
 */
export function hideQualityPopup(popup: HTMLElement | null): void {
    if (popup) popup.remove();
}

/**
 * 显示右键菜单（AI 修复 / 定位）。
 *
 * @param event - 鼠标事件
 * @param issue - 质量问题
 * @param actions - 菜单动作
 * @example
 * ```ts
 * showQualityContextMenu(event, issue, { onFix, onLocate });
 * ```
 */
export function showQualityContextMenu(
    event: MouseEvent,
    issue: QualityIssue,
    actions: QualityPopupActions,
): void {
    const menu = new Menu();
    menu.addItem((item) => {
        item.setTitle('🔧 AI 修复此问题');
        item.setIcon('wand');
        item.onClick(() => actions.onFix());
    });
    menu.addItem((item) => {
        item.setTitle('📍 定位到编辑器');
        item.setIcon('go-to-file');
        item.onClick(() => actions.onLocate());
    });
    menu.showAtMouseEvent(event);
}

/**
 * 在编辑器中定位到包含指定文字的段落（精确 → 前 6 字模糊）。
 *
 * @param editor - 编辑器
 * @param text - 目标文字
 * @example
 * ```ts
 * scrollToTextInEditor(editor, issue.locationText);
 * ```
 */
export function scrollToTextInEditor(editor: HTMLTextAreaElement | null, text: string): void {
    if (!editor || !text) return;
    const value = editor.value;
    const idx = value.indexOf(text);
    if (idx >= 0) {
        editor.focus();
        editor.setSelectionRange(idx, idx + text.length);
        editor.scrollTop = Math.max(0, lineTopForIndex(value, idx) - 60);
        return;
    }
    const words = text.slice(0, 6);
    const fuzzyIdx = value.indexOf(words);
    if (fuzzyIdx >= 0) {
        editor.focus();
        editor.setSelectionRange(fuzzyIdx, fuzzyIdx + words.length);
        editor.scrollTop = Math.max(0, lineTopForIndex(value, fuzzyIdx) - 60);
        return;
    }
    showWarningNotice(`正文中未找到 "${text.slice(0, 10)}..."`, { timeout: 2000 });
}
