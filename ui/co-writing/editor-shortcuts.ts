/**
 * editor-shortcuts.ts — 协同写作编辑器快捷键决策
 *
 * 从 `ui/co-writing-view.ts` 抽出：把 KeyboardEvent + 当前建议状态解析成动作，
 * 视图只负责执行动作。保持原有优先级与 preventDefault 语义。
 */

/** 快捷键解析出的动作。 */
export type EditorShortcutAction =
    | { kind: 'accept-ghost' }
    | { kind: 'accept-index'; index: number }
    | { kind: 'suggest'; force: boolean }
    | { kind: 'association' }
    | { kind: 'history' }
    | { kind: 'rewrite' }
    | { kind: 'save' }
    | { kind: 'focus-hint' }
    | { kind: 'escape' }
    | { kind: 'none' };

/** 解析快捷键所需的建议状态。 */
export interface EditorShortcutState {
    /** 是否存在幽灵建议 */
    hasGhost: boolean;
    /** 是否正在生成建议 */
    isSuggesting: boolean;
    /** 当前候选数量 */
    suggestionCount: number;
}

/**
 * 判断是否为中文输入法组合期间的按键。
 *
 * @param event - 键盘事件
 * @returns 是否处于组合输入
 * @example
 * ```ts
 * isImeComposingEvent({ isComposing: true } as KeyboardEvent);
 * ```
 */
export function isImeComposingEvent(event: KeyboardEvent): boolean {
    return event.isComposing || (event as KeyboardEvent & { keyCode?: number }).keyCode === 229;
}

/**
 * 解析编辑器快捷键。
 *
 * @param event - 键盘事件
 * @param state - 当前建议状态
 * @returns 动作；`none` 表示不处理
 * @example
 * ```ts
 * resolveEditorShortcut({ key: 'Tab', ctrlKey: false, metaKey: false, shiftKey: false } as KeyboardEvent, {
 *     hasGhost: false,
 *     isSuggesting: false,
 *     suggestionCount: 0,
 * });
 * ```
 */
export function resolveEditorShortcut(event: KeyboardEvent, state: EditorShortcutState): EditorShortcutAction {
    if (isImeComposingEvent(event)) return { kind: 'none' };

    if (event.key === 'Tab') {
        if (state.hasGhost && !state.isSuggesting) return { kind: 'accept-ghost' };
        if (state.suggestionCount > 0) return { kind: 'accept-index', index: 0 };
        return { kind: 'suggest', force: false };
    }

    const mod = event.ctrlKey || event.metaKey;
    if (mod && event.key === '1') return { kind: 'accept-index', index: 0 };
    if (mod && event.key === '2') return { kind: 'accept-index', index: 1 };
    if (mod && event.key === '3') return { kind: 'accept-index', index: 2 };
    if (mod && event.key === ' ') return { kind: 'association' };

    const lowerKey = event.key.toLowerCase();
    if (mod && lowerKey === 'j') return { kind: 'suggest', force: true };
    if (mod && lowerKey === 'k') return { kind: 'association' };
    if (mod && lowerKey === 'h') return { kind: 'history' };
    if (mod && event.shiftKey && lowerKey === 'r') return { kind: 'rewrite' };
    if (mod && lowerKey === 'r') return { kind: 'suggest', force: true };
    if (mod && lowerKey === 's') return { kind: 'save' };
    if (mod && event.key === '.') return { kind: 'focus-hint' };
    if (event.key === 'Escape') return { kind: 'escape' };

    return { kind: 'none' };
}
