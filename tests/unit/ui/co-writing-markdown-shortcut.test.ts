import { describe, it, expect, vi } from 'vitest';
import { handleMarkdownShortcut, type MarkdownShortcutHost } from '../../../ui/co-writing/markdown-shortcut';

/**
 * 快捷键行为从视图抽出后，锁定「命中即消费、未命中不拦截」，
 * 避免重构时把 Ctrl+B / Ctrl+Alt+1 等误改为全局拦截。
 */
function createHost(value = '正文', start = 0, end = 0): {
    host: MarkdownShortcutHost;
    applyTextEdit: ReturnType<typeof vi.fn>;
    applyNovelFormat: ReturnType<typeof vi.fn>;
} {
    const applyTextEdit = vi.fn();
    const applyNovelFormat = vi.fn();
    const editor = {
        value,
        selectionStart: start,
        selectionEnd: end,
    } as unknown as HTMLTextAreaElement;
    return {
        host: { editor, indent: '　　', applyTextEdit, applyNovelFormat },
        applyTextEdit,
        applyNovelFormat,
    };
}

function keyEvent(init: Partial<KeyboardEvent> & { key: string }): KeyboardEvent {
    return {
        ctrlKey: false,
        metaKey: false,
        altKey: false,
        shiftKey: false,
        preventDefault: vi.fn(),
        ...init,
    } as unknown as KeyboardEvent;
}

describe('co-writing markdown-shortcut', () => {
    it('Ctrl+B 包装选区并消费事件', () => {
        const { host, applyTextEdit } = createHost('正文内容', 0, 2);
        const event = keyEvent({ key: 'b', ctrlKey: true });
        expect(handleMarkdownShortcut(event, host)).toBe(true);
        expect(event.preventDefault).toHaveBeenCalled();
        expect(applyTextEdit).toHaveBeenCalledWith(
            expect.objectContaining({ text: expect.stringContaining('**正文**') }),
        );
    });

    it('Ctrl+Alt+1 切换一级标题前缀', () => {
        const { host, applyTextEdit } = createHost('标题行', 0, 3);
        const event = keyEvent({ key: '1', ctrlKey: true, altKey: true });
        expect(handleMarkdownShortcut(event, host)).toBe(true);
        expect(applyTextEdit).toHaveBeenCalledWith(
            expect.objectContaining({ text: expect.stringContaining('# 标题行') }),
        );
    });

    it('Ctrl+Alt+F 触发一键排版', () => {
        const { host, applyNovelFormat } = createHost();
        const event = keyEvent({ key: 'f', ctrlKey: true, altKey: true });
        expect(handleMarkdownShortcut(event, host)).toBe(true);
        expect(applyNovelFormat).toHaveBeenCalledTimes(1);
    });

    it('普通输入不拦截', () => {
        const { host } = createHost();
        const event = keyEvent({ key: 'a' });
        expect(handleMarkdownShortcut(event, host)).toBe(false);
        expect(event.preventDefault).not.toHaveBeenCalled();
    });

    it('Ctrl+Shift+B 不进入纯 Ctrl 分支', () => {
        const { host, applyTextEdit } = createHost('正文内容', 0, 2);
        const event = keyEvent({ key: 'b', ctrlKey: true, shiftKey: true });
        expect(handleMarkdownShortcut(event, host)).toBe(false);
        expect(applyTextEdit).not.toHaveBeenCalled();
    });
});
