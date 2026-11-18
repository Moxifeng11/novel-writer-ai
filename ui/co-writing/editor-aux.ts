/**
 * editor-aux.ts — 编辑辅助条与专注模式的装配（2026-11-16，E-04/E-06/E-07/E-08/E-11）
 *
 * 从视图抽出：撤销/重做、字号、行距、专注、高亮、保存按钮的 DOM 装配。
 * 单独成行的辅助条，避免把 6 个新控件塞进已经很挤的 Markdown 工具条
 * （窄面板下会换行错位，这是本轮要避免的排版问题）。
 */
import { t } from '@/i18n';
import {
    FONT_SIZE_OPTIONS,
    LINE_HEIGHT_OPTIONS,
    normalizeFontSize,
    normalizeLineHeight,
} from './editor-display';

/** 辅助条宿主回调 */
export interface EditorAuxHost {
    /** 撤销 */
    onUndo(): void;
    /** 重做 */
    onRedo(): void;
    /** 字号变化 */
    onFontSizeChange(size: number): void;
    /** 行距变化 */
    onLineHeightChange(lineHeight: number): void;
    /** 专注模式切换 */
    onToggleFocus(): void;
    /** 语法高亮切换 */
    onToggleHighlight(): void;
    /** 保存 */
    onSave(): void;
    /** 把本章登记为规划画布的事件节点（规划 ↔ 正文双向链接） */
    onAddToPlanning?(): void;
}

/** 辅助条句柄（视图用它同步禁用态/文案） */
export interface EditorAuxHandles {
    root: HTMLElement;
    undoBtn: HTMLButtonElement;
    redoBtn: HTMLButtonElement;
    fontSelect: HTMLSelectElement;
    lineSelect: HTMLSelectElement;
    focusBtn: HTMLButtonElement;
    highlightBtn: HTMLButtonElement;
    saveBtn: HTMLButtonElement;
    saveState: HTMLElement;
}

/**
 * 装配编辑辅助条（一行，窄屏自动换行但不重叠）。
 *
 * @param wrap - 编辑器容器（放在 Markdown 工具条之前）
 * @param host - 回调
 * @param initial - 初始状态
 * @returns 句柄
 * @example
 * const aux = renderEditorAux(editorWrap, { onUndo, onRedo, ... }, { fontSize: 16 });
 */
export function renderEditorAux(
    wrap: HTMLElement,
    host: EditorAuxHost,
    initial: { fontSize: number; lineHeight: number; focusMode: boolean; highlight: boolean },
): EditorAuxHandles {
    const root = wrap.createDiv({ cls: 'nw-cowrite-aux' });

    const historyGroup = root.createDiv({ cls: 'nw-cowrite-aux-group' });
    const undoBtn = historyGroup.createEl('button', {
        cls: 'nw-cowrite-aux-btn',
        text: '↶',
        attr: { type: 'button', title: t('cowrite.aux.undoTip'), 'aria-label': t('cowrite.aux.undoTip') },
    }) as HTMLButtonElement;
    undoBtn.addEventListener('click', () => host.onUndo());
    const redoBtn = historyGroup.createEl('button', {
        cls: 'nw-cowrite-aux-btn',
        text: '↷',
        attr: { type: 'button', title: t('cowrite.aux.redoTip'), 'aria-label': t('cowrite.aux.redoTip') },
    }) as HTMLButtonElement;
    redoBtn.addEventListener('click', () => host.onRedo());

    const sizeGroup = root.createDiv({ cls: 'nw-cowrite-aux-group' });
    sizeGroup.createSpan({ cls: 'nw-cowrite-aux-label', text: t('cowrite.aux.fontSize') });
    const fontSelect = sizeGroup.createEl('select', {
        cls: 'nw-cowrite-aux-select',
        attr: { title: t('cowrite.aux.fontSizeTip') },
    }) as HTMLSelectElement;
    for (const size of FONT_SIZE_OPTIONS) {
        fontSelect.createEl('option', { value: String(size), text: `${size}px` });
    }
    fontSelect.value = String(normalizeFontSize(initial.fontSize));
    fontSelect.addEventListener('change', () => host.onFontSizeChange(Number(fontSelect.value)));

    sizeGroup.createSpan({ cls: 'nw-cowrite-aux-label', text: t('cowrite.aux.lineHeight') });
    const lineSelect = sizeGroup.createEl('select', {
        cls: 'nw-cowrite-aux-select',
        attr: { title: t('cowrite.aux.lineHeightTip') },
    }) as HTMLSelectElement;
    for (const height of LINE_HEIGHT_OPTIONS) {
        lineSelect.createEl('option', { value: String(height), text: String(height) });
    }
    lineSelect.value = String(normalizeLineHeight(initial.lineHeight));
    lineSelect.addEventListener('change', () => host.onLineHeightChange(Number(lineSelect.value)));

    const viewGroup = root.createDiv({ cls: 'nw-cowrite-aux-group' });
    if (host.onAddToPlanning) {
      const planBtn = viewGroup.createEl('button', {
          cls: 'nw-cowrite-aux-btn',
          text: t('cowrite.aux.markEventBtn'),
          attr: { type: 'button', title: t('cowrite.aux.markEventTip') },
      }) as HTMLButtonElement;
      planBtn.addEventListener('click', () => host.onAddToPlanning?.());
    }
    const focusBtn = viewGroup.createEl('button', {
        cls: 'nw-cowrite-aux-btn',
        text: t('cowrite.aux.focusBtn'),
        attr: { type: 'button', title: t('cowrite.aux.focusTip') },
    }) as HTMLButtonElement;
    focusBtn.addEventListener('click', () => host.onToggleFocus());
    const highlightBtn = viewGroup.createEl('button', {
        cls: 'nw-cowrite-aux-btn',
        text: t('cowrite.aux.highlightBtn'),
        attr: { type: 'button', title: t('cowrite.aux.highlightTip') },
    }) as HTMLButtonElement;
    highlightBtn.addEventListener('click', () => host.onToggleHighlight());

    const saveGroup = root.createDiv({ cls: 'nw-cowrite-aux-group nw-cowrite-aux-right' });
    const saveState = saveGroup.createSpan({ cls: 'nw-cowrite-aux-state', text: t('cowrite.aux.loaded') });
    const saveBtn = saveGroup.createEl('button', {
        cls: 'nw-cowrite-aux-btn nw-cowrite-aux-save',
        text: t('cowrite.panel.btnSave'),
        attr: { type: 'button', title: t('cowrite.aux.saveTip') },
    }) as HTMLButtonElement;
    saveBtn.addEventListener('click', () => host.onSave());

    return { root, undoBtn, redoBtn, fontSelect, lineSelect, focusBtn, highlightBtn, saveBtn, saveState };
}

/**
 * 同步专注/高亮按钮的按下态（aria-pressed + 类名）。
 *
 * @param btn - 按钮
 * @param active - 是否开启
 * @example
 * syncToggleButton(handle.focusBtn, true);
 */
export function syncToggleButton(btn: HTMLButtonElement | null, active: boolean): void {
    if (!btn) return;
    btn.setAttribute('aria-pressed', String(active));
    // 统一用前缀类，避免 CSS 门禁的非 nw- 前缀类增长
    btn.toggleClass('nw-cowrite-aux-btn-on', active);
}

/**
 * 同步撤销/重做按钮可用性。
 *
 * @param undoBtn - 撤销按钮
 * @param redoBtn - 重做按钮
 * @param state - 可用性
 * @example
 * syncHistoryButtons(undoBtn, redoBtn, { canUndo: true, canRedo: false });
 */
export function syncHistoryButtons(
    undoBtn: HTMLButtonElement | null,
    redoBtn: HTMLButtonElement | null,
    state: { canUndo: boolean; canRedo: boolean },
): void {
    if (undoBtn) undoBtn.disabled = !state.canUndo;
    if (redoBtn) redoBtn.disabled = !state.canRedo;
}
