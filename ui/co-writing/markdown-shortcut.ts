/**
 * markdown-shortcut.ts — 协同写作编辑器 Markdown 快捷键
 *
 * 从 `ui/co-writing-view.ts` 抽出：只依赖编辑器、缩进配置与两个动作，
 * 不持有视图状态，便于单测与复用。
 */
import { INDENT_TWO_FULL_WIDTH } from '@/shared/body-format';
import {
    indentParagraphs,
    toggleFirstLineIndent,
    toggleLinePrefix,
    wrapSelection,
    type TextEdit,
} from '@/shared/novel-format';

/** 快捷键处理所需的宿主能力。 */
export interface MarkdownShortcutHost {
    /** 当前正文编辑器 */
    editor: HTMLTextAreaElement;
    /** 段落缩进（缺省两个全角空格） */
    indent: string;
    /** 应用一次文本编辑 */
    applyTextEdit(edit: TextEdit): void;
    /** 触发一键小说排版 */
    applyNovelFormat(): void;
}

/**
 * 处理协同写作编辑器的 Markdown 快捷键。
 *
 * 返回 true 表示事件已被消费，调用方应停止继续处理；false 表示不归本函数处理。
 *
 * @param event - 键盘事件
 * @param host - 编辑器与动作宿主
 * @returns 是否已处理
 * @example
 * ```ts
 * if (handleMarkdownShortcut(event, host)) return;
 * ```
 */
export function handleMarkdownShortcut(event: KeyboardEvent, host: MarkdownShortcutHost): boolean {
    const mod = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    const editor = host.editor;
    const indent = host.indent || INDENT_TWO_FULL_WIDTH;
    if (mod && event.altKey) {
        if (key === '1' || key === '2' || key === '3') {
            event.preventDefault();
            const prefix = `${'#'.repeat(Number(key))} `;
            host.applyTextEdit(toggleLinePrefix(editor.value, editor.selectionStart, editor.selectionEnd, prefix));
            return true;
        }
        if (key === 'q') {
            event.preventDefault();
            host.applyTextEdit(toggleLinePrefix(editor.value, editor.selectionStart, editor.selectionEnd, '> '));
            return true;
        }
        if (key === 'l') {
            event.preventDefault();
            host.applyTextEdit(toggleLinePrefix(editor.value, editor.selectionStart, editor.selectionEnd, '- '));
            return true;
        }
        if (key === 'i') {
            event.preventDefault();
            host.applyTextEdit(toggleFirstLineIndent(editor.value, editor.selectionStart, editor.selectionEnd, indent));
            return true;
        }
        if (key === 'f') {
            event.preventDefault();
            host.applyNovelFormat();
            return true;
        }
        return false;
    }
    if (!mod || event.shiftKey || event.altKey) return false;
    if (key === 'b' || key === 'i') {
        event.preventDefault();
        host.applyTextEdit(wrapSelection(editor.value, editor.selectionStart, editor.selectionEnd, key === 'b' ? '**' : '*'));
        return true;
    }
    if (event.key === '`') {
        event.preventDefault();
        host.applyTextEdit(wrapSelection(editor.value, editor.selectionStart, editor.selectionEnd, '`'));
        return true;
    }
    if (event.key === ']' || event.key === '[') {
        event.preventDefault();
        host.applyTextEdit(indentParagraphs(
            editor.value,
            editor.selectionStart,
            editor.selectionEnd,
            indent,
            event.key === ']' ? 1 : -1,
        ));
        return true;
    }
    return false;
}
