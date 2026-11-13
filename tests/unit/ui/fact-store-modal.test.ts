/**
 * 事实库视图行为测试
 *
 * 纯逻辑（编辑/格式化）已分别在 fact-store-edit 与 fact-store-format 里测过；
 * 这里只锁「视图外壳」的契约：
 *  - 没有活动项目时给出引导，而不是渲染空壳
 *  - 事实库为空时给出空态文案与文件路径
 *  - onClose 清空 DOM
 *
 * 环境说明：单测跑在 node（无 jsdom），obsidian 替身的 `Modal` 初始化会碰 DOM。
 * 因此用模块级 Modal 替身 + 极简元素桩，只验证「渲染了哪些文案/容器」。
 */

import { describe, expect, it, vi } from 'vitest';

/** 极简元素桩 */
interface FakeEl {
    tag: string;
    children: FakeEl[];
    classes: string[];
    text: string;
    value: string;
    createEl: (tag: string, opts?: { text?: string; cls?: string; type?: string }) => FakeEl;
    createDiv: (opts?: { text?: string; cls?: string }) => FakeEl;
    empty: () => void;
    addClass: (cls: string) => void;
    setText: (text: string) => void;
    setAttribute: (name: string, value: string) => void;
    addEventListener: (event: string, handler: () => void) => void;
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
    const el: FakeEl = {
        tag,
        children: [],
        classes: [],
        text: '',
        value: '',
        createEl(childTag: string, opts?: { text?: string; cls?: string; type?: string }) {
            const child = makeEl(childTag);
            if (opts?.text) child.text = opts.text;
            if (opts?.cls) child.classes.push(opts.cls);
            el.children.push(child);
            return child;
        },
        createDiv(opts?: { text?: string; cls?: string }) {
            return el.createEl('div', opts);
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
        setAttribute() {
            // 桩：属性不参与断言
        },
        addEventListener() {
            // 桩：事件不参与断言
        },
        get textContent() {
            return el.children.map(child => child.textContent).join(' ');
        },
        get childElementCount() {
            return el.children.length;
        },
    } as unknown as FakeEl;
    return el;
}

/** 收集元素树里的全部文案 */
function collectText(el: FakeEl): string {
    const own = el.text ? [el.text] : [];
    return [...own, ...el.children.flatMap(child => collectText(child).split('\n').filter(Boolean))].join('\n');
}

/** 模块级 obsidian 替身 */
vi.mock('obsidian', () => {
    class ModalStub {
        app: unknown;
        contentEl = makeEl('div');
        constructor(app: unknown) {
            this.app = app;
        }
        open(): void {
            // 测试里手动调 onOpen
        }
        close(): void {
            // 测试里手动调 onClose
        }
    }
    class NoticeStub {
        constructor(public message: string) {}
    }
    return { Modal: ModalStub, Notice: NoticeStub };
});

import { FactStoreModal } from '@/ui/fact-store-modal';

/** 造一个插件替身（无活动项目） */
function makePlugin(project = ''): never {
    return {
        getActiveProject: () => project,
        contextManager: { listProjectIds: () => [] },
    } as never;
}

describe('FactStoreModal · 无项目', () => {
    it('给出引导而非渲染空壳', async () => {
        const modal = new FactStoreModal({ vault: {} } as never, makePlugin());
        (modal as unknown as { onOpen: () => void }).onOpen();
        await new Promise(resolve => setTimeout(resolve, 10));
        const text = collectText((modal as unknown as { contentEl: FakeEl }).contentEl);
        expect(text).toContain('请先打开一个项目');
    });
});

describe('FactStoreModal · 有项目但事实库为空', () => {
    it('给出空态提示与文件位置', async () => {
        const modal = new FactStoreModal(
            { vault: { adapter: { exists: async () => false } } } as never,
            makePlugin('项目A'),
        );
        (modal as unknown as { onOpen: () => void }).onOpen();
        await new Promise(resolve => setTimeout(resolve, 20));
        const text = collectText((modal as unknown as { contentEl: FakeEl }).contentEl);
        expect(text).toContain('事实库为空');
        expect(text).toContain('事实库.json');
    });
});

describe('FactStoreModal · onClose', () => {
    it('关闭时清空 DOM', () => {
        const modal = new FactStoreModal({ vault: {} } as never, makePlugin());
        const contentEl = (modal as unknown as { contentEl: FakeEl }).contentEl;
        contentEl.createDiv({ text: '内容' });
        (modal as unknown as { onClose: () => void }).onClose();
        expect(contentEl.childElementCount).toBe(0);
    });
});
