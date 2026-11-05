import { describe, expect, it } from 'vitest';
import { isImeComposingEvent, resolveEditorShortcut, type EditorShortcutState } from '@/ui/co-writing/editor-shortcuts';

const baseState: EditorShortcutState = {
    hasGhost: false,
    isSuggesting: false,
    suggestionCount: 0,
};

function key(init: Partial<KeyboardEvent>): KeyboardEvent {
    return {
        key: '',
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
        isComposing: false,
        keyCode: 0,
        ...init,
    } as KeyboardEvent;
}

describe('editor-shortcuts — 快捷键决策', () => {
    it('Tab：有幽灵建议且未生成时优先接受幽灵建议', () => {
        const action = resolveEditorShortcut(key({ key: 'Tab' }), { ...baseState, hasGhost: true });
        expect(action).toEqual({ kind: 'accept-ghost' });
    });

    it('Tab：生成中不接幽灵建议，退回生成主建议', () => {
        const action = resolveEditorShortcut(key({ key: 'Tab' }), { ...baseState, hasGhost: true, isSuggesting: true });
        expect(action).toEqual({ kind: 'suggest', force: false });
    });

    it('Tab：有候选时接受第一条', () => {
        const action = resolveEditorShortcut(key({ key: 'Tab' }), { ...baseState, suggestionCount: 2 });
        expect(action).toEqual({ kind: 'accept-index', index: 0 });
    });

    it('Tab：无候选时生成主建议', () => {
        expect(resolveEditorShortcut(key({ key: 'Tab' }), baseState)).toEqual({ kind: 'suggest', force: false });
    });

    it('Ctrl+1/2/3 按序号接受建议', () => {
        expect(resolveEditorShortcut(key({ key: '1', ctrlKey: true }), baseState)).toEqual({ kind: 'accept-index', index: 0 });
        expect(resolveEditorShortcut(key({ key: '2', ctrlKey: true }), baseState)).toEqual({ kind: 'accept-index', index: 1 });
        expect(resolveEditorShortcut(key({ key: '3', ctrlKey: true }), baseState)).toEqual({ kind: 'accept-index', index: 2 });
    });

    it('Ctrl+Space 触发联想', () => {
        expect(resolveEditorShortcut(key({ key: ' ', ctrlKey: true }), baseState)).toEqual({ kind: 'association' });
    });

    it('Ctrl+J 强制生成，Ctrl+K 联想', () => {
        expect(resolveEditorShortcut(key({ key: 'j', ctrlKey: true }), baseState)).toEqual({ kind: 'suggest', force: true });
        expect(resolveEditorShortcut(key({ key: 'k', ctrlKey: true }), baseState)).toEqual({ kind: 'association' });
    });

    it('Ctrl+Shift+R 改写优先于 Ctrl+R 生成', () => {
        expect(resolveEditorShortcut(key({ key: 'R', ctrlKey: true, shiftKey: true }), baseState)).toEqual({ kind: 'rewrite' });
        expect(resolveEditorShortcut(key({ key: 'r', ctrlKey: true }), baseState)).toEqual({ kind: 'suggest', force: true });
    });

    it('Ctrl+H / Ctrl+S / Ctrl+. 映射到历史、保存、聚焦指令', () => {
        expect(resolveEditorShortcut(key({ key: 'h', ctrlKey: true }), baseState)).toEqual({ kind: 'history' });
        expect(resolveEditorShortcut(key({ key: 's', ctrlKey: true }), baseState)).toEqual({ kind: 'save' });
        expect(resolveEditorShortcut(key({ key: '.', ctrlKey: true }), baseState)).toEqual({ kind: 'focus-hint' });
    });

    it('Escape 取消建议，普通按键不处理', () => {
        expect(resolveEditorShortcut(key({ key: 'Escape' }), baseState)).toEqual({ kind: 'escape' });
        expect(resolveEditorShortcut(key({ key: 'a' }), baseState)).toEqual({ kind: 'none' });
    });

    it('输入法组合期间一律不处理', () => {
        expect(isImeComposingEvent(key({ isComposing: true }))).toBe(true);
        expect(isImeComposingEvent(key({ keyCode: 229 }))).toBe(true);
        expect(isImeComposingEvent(key({}))).toBe(false);
        expect(resolveEditorShortcut(key({ key: 'Tab', isComposing: true }), baseState)).toEqual({ kind: 'none' });
    });
});
