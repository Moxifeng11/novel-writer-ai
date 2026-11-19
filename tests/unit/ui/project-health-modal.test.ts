/**
 * 项目体检视图行为测试
 *
 * 视图外壳契约：无项目时给空态、有项目时渲染标题与「重新体检」、onClose 清空。
 * 环境：node 无 jsdom，用 obsidian 模块级替身 + 极简元素桩。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stubDocument } from './support/fake-dom';

/** 极简元素桩 */
interface FakeEl {
    tag: string;
    children: FakeEl[];
    classes: string[];
    text: string;
    createEl: (tag: string, opts?: { text?: string; cls?: string }) => FakeEl;
    createDiv: (opts?: { text?: string; cls?: string }) => FakeEl;
    createSpan: (opts?: { text?: string; cls?: string }) => FakeEl;
    empty: () => void;
    addClass: (cls: string) => void;
    setText: (text: string) => void;
    addEventListener: (event: string, handler: () => void) => void;
    appendChild: (child: unknown) => unknown;
    remove: () => void;
    textContent: string;
    childElementCount: number;
}

/**
 * 造元素桩。
 *
 * @param tag - 标签
 * @returns 元素桩
 */
function makeEl(tag = 'div'): FakeEl {
    const el = {
        tag,
        children: [] as FakeEl[],
        classes: [] as string[],
        text: '',
        createEl(childTag: string, opts?: { text?: string; cls?: string }) {
            const child = makeEl(childTag);
            if (opts?.text) child.text = opts.text;
            if (opts?.cls) child.classes.push(opts.cls);
            el.children.push(child);
            return child;
        },
        createDiv(opts?: { text?: string; cls?: string }) {
            return el.createEl('div', opts);
        },
        createSpan(opts?: { text?: string; cls?: string }) {
            return el.createEl('span', opts);
        },
        empty() {
            el.children = [];
        },
        addClass(cls: string) {
            el.classes.push(cls);
        },
        setText(text: string) {
            el.text = text;
        },
        addEventListener() {
            // 桩：事件不参与断言
        },
        appendChild(child: unknown) {
            // createEmptyState 建的是 fake-dom 的 FakeEl（或 safe-html 替身的 { html }）
            el.children.push(child as FakeEl);
            return child;
        },
        remove() {
            // 桩
        },
        get textContent() {
            // 递归收集：createEmptyState 挂进来的是 fake-dom 的 FakeEl（文本在它的 children 上，不聚合到父）
            const collect = (node: unknown): string[] => {
                const n = node as { text?: string; textContent?: string; children?: unknown[] };
                const own = typeof n.text === 'string' ? n.text : (typeof n.textContent === 'string' ? n.textContent : '');
                return [own, ...(n.children ?? []).flatMap(collect)];
            };
            return collect(el).filter(Boolean).join(' ');
        },
        get childElementCount() {
            return el.children.length;
        },
    } as unknown as FakeEl;
    return el;
}

vi.mock('obsidian', () => {
    class ModalStub {
        app: unknown;
        contentEl = makeEl('div');
        modalEl = makeEl('div');
        titleEl = makeEl('h2');
        constructor(app: unknown) {
            this.app = app;
        }
        open(): void { /* 测试手动调 onOpen */ }
        close(): void { /* 测试手动调 onClose */ }
    }
    class NoticeStub {
        constructor(public message: string) {}
    }
    return {
        Modal: ModalStub,
        Notice: NoticeStub,
        TFile: class {},
        // safe-html 的 sanitizeHTMLToDom 替身（空态图标是内联 SVG 字符串）
        sanitizeHTMLToDom: (html: string) => ({ html }),
    };
});

vi.mock('@/shared/project-catalog', () => ({ listProjectIds: () => [] }));
vi.mock('@/domains/kernel/project-locator', () => ({ projectDisplayName: (p: string) => p }));
vi.mock('@/services/project-health-service', () => ({
    analyzeProjectHealth: async () => ({
        project: '项目A', mode: 'long', checkedBodies: 0, issues: [], summary: {},
    }),
}));
vi.mock('@/services/project-standard-service', () => ({
    createStandardFs: () => ({}),
    validateProjectStandard: async () => ({
        project: '项目A', declaredVersion: 1, currentVersion: 1, checkedDirs: 12, checkedBodies: 0,
        issues: [], summary: {},
    }),
}));

import { ProjectHealthModal } from '@/ui/project-health-modal';

// createEmptyState 走 document.createElement，node 环境需要替身
beforeEach(() => { stubDocument(); });
afterEach(() => { delete (globalThis as { document?: unknown }).document; });

describe('ProjectHealthModal · 无项目', () => {
    it('给出空态引导而非渲染空壳', async () => {
        const modal = new ProjectHealthModal({ vault: {} } as never, { getActiveProject: () => '' } as never, '');
        (modal as unknown as { onOpen: () => void }).onOpen();
        await new Promise(resolve => setTimeout(resolve, 20));
        const text = (modal as unknown as { bodyEl: FakeEl }).bodyEl.textContent;
        expect(text).toContain('还没有可体检的项目');
    });
});

describe('ProjectHealthModal · 有项目', () => {
    it('渲染项目标题与「重新体检」按钮', async () => {
        const modal = new ProjectHealthModal({ vault: {} } as never, { getActiveProject: () => '项目A' } as never, '项目A');
        (modal as unknown as { onOpen: () => void }).onOpen();
        await new Promise(resolve => setTimeout(resolve, 30));
        const text = (modal as unknown as { bodyEl: FakeEl }).bodyEl.textContent;
        expect(text).toContain('项目A');
        expect(text).toContain('重新体检');
        expect(text).toContain('项目标准');
    });
});

describe('ProjectHealthModal · onClose', () => {
    it('关闭时清空内容', () => {
        const modal = new ProjectHealthModal({ vault: {} } as never, { getActiveProject: () => '' } as never, '');
        const contentEl = (modal as unknown as { contentEl: FakeEl }).contentEl;
        contentEl.createDiv({ text: '内容' });
        (modal as unknown as { onClose: () => void }).onClose();
        expect(contentEl.childElementCount).toBe(0);
    });
});
