/**
 * cowrite-modals-i18n.test.ts — 协同写作弹窗双语（缺口⑦ 第二期第21片，ZC-20261119-11）
 *
 * 覆盖 ui/cowrite/ 两个有完整 onOpen 渲染的弹窗（记忆管理器 / 迭代指令）；
 * suggestion-edit-modal 与 history-modal 的静态文案由资源一致性（check:i18n）兜底。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLocale } from '../../../i18n';
import { MemoryManagerModal } from '../../../ui/cowrite/memory-manager-modal';
import { IterateInstructionModal } from '../../../ui/cowrite/iterate-instruction-modal';

// vi.mock 会被提升到所有 import 之上，所以这里可以静态 import
import { FakeEl, stubDocument } from './support/fake-dom';

const { modalInstances } = vi.hoisted(() => ({
    modalInstances: [] as Array<{ contentEl: FakeEl; titleEl: FakeEl; modalEl: FakeEl }>,
}));

vi.mock('obsidian', async (importOriginal) => {
    const actual = await importOriginal<typeof import('obsidian')>();
    class Modal {
        contentEl = new FakeEl('div');
        titleEl = new FakeEl('div');
        modalEl = new FakeEl('div');
        constructor() { modalInstances.push(this as unknown as { contentEl: FakeEl; titleEl: FakeEl; modalEl: FakeEl }); }
        open(): void { /* 桩 */ }
        close(): void { /* 桩 */ }
    }
    return { ...actual, Modal, Setting: actual.Setting };
});

import { Setting } from 'obsidian';

function collectText(el: FakeEl): string {
    return [el.textContent, ...el.children.map(collectText)].join('\n');
}

beforeEach(() => {
    setLocale('zh-CN');
    modalInstances.length = 0;
    stubDocument();
});

afterEach(() => {
    setLocale('zh-CN');
    vi.unstubAllGlobals();
});

describe('协同写作弹窗双语（缺口⑦ 第二期第21片）', () => {
    it('记忆管理器：zh 保持原文', () => {
        const modal = new MemoryManagerModal(
            {} as never,
            { stylePatterns: [{ type: 'style', userPreference: 0.9, frequency: 3, pattern: '短句为主' }], preferences: [] },
            async () => undefined,
        );
        modal.onOpen();
        const modalRec = modalInstances[modalInstances.length - 1];
        const text = collectText(modalRec.contentEl) + collectText(modalRec.titleEl);
        expect(text).toContain('🧠 风格 / 偏好记忆');
        expect(text).toContain('E1 风格自学习');
        expect(text).toContain('偏好 0.90 · 3 次');
        expect(text).toContain('E3 偏好记忆');
        expect(text).toContain('暂无偏好记忆');
        expect(text).toContain('手动添加偏好');
    });

    it('记忆管理器：en 全英文且不回退键名', () => {
        setLocale('en-US');
        const modal = new MemoryManagerModal({} as never, { stylePatterns: [], preferences: [] }, async () => undefined);
        modal.onOpen();
        const modalRec = modalInstances[modalInstances.length - 1];
        const text = collectText(modalRec.contentEl) + collectText(modalRec.titleEl);
        expect(text).toContain('🧠 Style / preference memory');
        expect(text).toContain('E1 style self-learning');
        expect(text).toContain('E3 preference memory');
        expect(text).not.toMatch(/[\u4e00-\u9fff]/);
        expect(text).not.toContain('cowrite.mem.');
    });

    it('迭代指令弹窗：zh 标题/提示、en 全英文', () => {
        setLocale('zh-CN');
        const modal = new IterateInstructionModal({} as never, () => undefined);
        modal.onOpen();
        const modalRec = modalInstances[modalInstances.length - 1];
        const text = collectText(modalRec.titleEl) + collectText(modalRec.contentEl);
        expect(text).toContain('↻ 迭代改写此候选');
        expect(text).toContain('输入一条定向指令');
        setLocale('en-US');
        modalInstances.length = 0;
        const modalEn = new IterateInstructionModal({} as never, () => undefined);
        modalEn.onOpen();
        const recEn = modalInstances[modalInstances.length - 1];
        const textEn = collectText(recEn.titleEl) + collectText(recEn.contentEl);
        expect(textEn).toContain('↻ Iterate this candidate');
        expect(textEn).not.toMatch(/[\u4e00-\u9fff]/);
    });
});

void Setting;
