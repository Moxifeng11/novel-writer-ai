import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { CategorizationReviewPanel } from '../../../ui/components/categorization-review-panel';
import { onNodeDoc } from '../../../shared/dom-window';
import type { SuggestionManager } from '../../../engine/suggestion-manager';

/**
 * 分类审核面板的监听生命周期（v4.77.0）。
 *
 * 修复前：`document.addEventListener('click', closeHandler)` 只在「点了外部」时自删；
 * 面板 `destroy()` 只清 DOM、不摘监听，`CharacterRecognitionModal.onClose()`
 * 也从不调用 `destroy()`——关闭模态后监听器连同整个面板对象一起泄漏。
 * 这里钉住：destroy 一定释放已登记的监听，且截断在模态关闭时发生。
 */

function makeDoc() {
    return {
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
    } as unknown as Document;
}

function makePanel() {
    const doc = makeDoc();
    const container = {
        doc,
        win: { setTimeout: (fn: () => void) => { fn(); return 0; } },
        empty: vi.fn(),
        addClass: vi.fn(),
        createDiv: vi.fn(),
        createEl: vi.fn(),
        createSpan: vi.fn(),
    } as unknown as HTMLElement;

    const panel = new CategorizationReviewPanel(container, {
        suggestionManager: {} as unknown as SuggestionManager,
        categoryTypes: ['角色'],
        onAdopt: vi.fn(),
        onReject: vi.fn(),
        onModify: vi.fn(),
        onBatchAdopt: vi.fn(),
    });

    return { panel, doc, container };
}

describe('CategorizationReviewPanel 监听生命周期', () => {
    it('destroy 释放已登记的外部点击监听（同一 document 解绑）', () => {
        const { panel, doc } = makePanel();
        const handler = vi.fn();

        // 模拟打开分类下拉后登记监听
        (panel as unknown as { popupDisposer: (() => void) | null }).popupDisposer =
            onNodeDoc({ doc }, 'click', handler);
        expect(doc.addEventListener).toHaveBeenCalledTimes(1);

        panel.destroy();

        expect(doc.removeEventListener).toHaveBeenCalledTimes(1);
        expect(doc.removeEventListener).toHaveBeenCalledWith('click', handler, undefined);
        expect(
            (panel as unknown as { popupDisposer: (() => void) | null }).popupDisposer,
        ).toBeNull();
    });

    it('重复 destroy 幂等（不重复解绑）', () => {
        const { panel, doc } = makePanel();
        const handler = vi.fn();
        (panel as unknown as { popupDisposer: (() => void) | null }).popupDisposer =
            onNodeDoc({ doc }, 'click', handler);

        panel.destroy();
        panel.destroy();

        expect(doc.removeEventListener).toHaveBeenCalledTimes(1);
    });
});

describe('CharacterRecognitionModal 关闭链（源码契约）', () => {
    it('onClose 必须销毁分类审核面板', () => {
        const source = fs.readFileSync(
            path.resolve(__dirname, '../../../ui/character-recognition-modal.ts'),
            'utf8',
        );
        const onClose = source.slice(source.indexOf('onClose(): void {'));
        expect(onClose).toContain('this.categorizationPanel?.destroy()');
        expect(onClose).toContain('this.categorizationPanel = null');
    });
});
