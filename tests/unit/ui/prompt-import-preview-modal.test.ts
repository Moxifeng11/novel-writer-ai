/**
 * prompt-import-preview-modal.test.ts — 导入预览弹窗（功能缺口 ④）
 *
 * 用假 DOM 桩掉 Obsidian Modal：只验「差异分组/空态/两种导入模式回调」这些
 * 真正决定用户看到什么的逻辑，不验 Obsidian 自己的弹窗外壳。
 */
import { describe, expect, it, vi } from 'vitest';
import { FakeEl } from './support/fake-dom';

vi.mock('obsidian', () => {
    class Modal {
        app: unknown;
        modalEl = new FakeEl('div');
        titleEl = new FakeEl('div');
        contentEl = new FakeEl('div');
        closed = false;
        constructor(app: unknown) {
            this.app = app;
        }
        open(): void {}
        close(): void { this.closed = true; }
    }
    return { Modal, App: class {}, Notice: class {}, Setting: class {} };
});

import { PromptImportPreviewModal } from '../../../ui/prompt-import-preview-modal';
import type { PromptImportDiff } from '../../../shared/prompt-manager-import';

function diff(overrides: Partial<PromptImportDiff> = {}): PromptImportDiff {
    return {
        addedTemplates: [],
        overwrittenTemplates: [],
        removedTemplates: [],
        addedTests: [],
        overwrittenTests: [],
        usageInFile: 0,
        ...overrides,
    };
}

function open(overrides: Partial<PromptImportDiff> = {}, onConfirm = vi.fn()) {
    const modal = new PromptImportPreviewModal({} as never, {
        fileName: 'prompt-config.json',
        diff: diff(overrides),
        onConfirm,
    });
    modal.onOpen();
    const view = modal as unknown as {
        contentEl: FakeEl;
        modalEl: FakeEl;
        titleEl: FakeEl;
        closed: boolean;
    };
    return { modal, view, onConfirm };
}

describe('导入预览弹窗', () => {
    it('标题、文件名与汇总计数渲染', () => {
        const { view } = open({
            addedTemplates: ['伏笔密度体检'],
            overwrittenTemplates: ['雨夜氛围扩写'],
            removedTemplates: ['只在本地'],
            addedTests: ['新旧开头对比'],
            usageInFile: 3,
        });
        expect(view.titleEl.textContent).toBe('📥 导入预览');
        const text = view.contentEl.allText();
        expect(text).toContain('文件：prompt-config.json');
        expect(text).toContain('模板 新增 1 · 覆盖 1 · 移除 1');
        expect(text).toContain('A/B 测试 新增 1 · 覆盖 0');
        expect(text).toContain('使用记录 3 条');
    });

    it('分组只渲染非空项，「将移除」带警示类', () => {
        const { view } = open({ overwrittenTemplates: ['雨夜氛围扩写'], removedTemplates: ['只在本地'] });
        const groups = view.contentEl.findAll('nw-pm-import-group-title').map(el => el.textContent);
        expect(groups).toEqual(['♻️ 覆盖模板（1）', '🗑 覆盖模式将移除的模板（1）']);
        expect(view.contentEl.findAll('nw-pm-import-item--warn').map(el => el.textContent)).toEqual(['只在本地']);
    });

    it('没有任何可导入内容时给空态文案', () => {
        const { view } = open();
        expect(view.contentEl.allText()).toContain('文件里没有可导入的模板或 A/B 测试。');
    });

    it('点「合并导入」回调 merge，点「覆盖导入」回调 replace', () => {
        const first = open({ addedTemplates: ['A'] });
        const mergeBtn = first.view.modalEl.findAll('nw-pm-import-merge-btn')[0];
        (mergeBtn as unknown as { onclick: () => void }).onclick();
        expect(first.onConfirm).toHaveBeenCalledWith('merge');
        expect(first.view.closed).toBe(true);

        const second = open({ addedTemplates: ['A'] });
        const replaceBtn = second.view.modalEl.findAll('nw-pm-import-replace-btn')[0];
        (replaceBtn as unknown as { onclick: () => void }).onclick();
        expect(second.onConfirm).toHaveBeenCalledWith('replace');
    });

    it('取消不触发导入回调', () => {
        const { view, onConfirm } = open({ addedTemplates: ['A'] });
        const cancelBtn = view.modalEl.findAll('nw-modal-footer')[0].children
            .find(el => el.textContent === '取消');
        expect(cancelBtn).toBeTruthy();
        (cancelBtn as unknown as { onclick: () => void }).onclick();
        expect(onConfirm).not.toHaveBeenCalled();
        expect(view.closed).toBe(true);
    });
});