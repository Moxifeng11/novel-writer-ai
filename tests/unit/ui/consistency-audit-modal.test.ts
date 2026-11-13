/**
 * 审核视图行为测试（S4）
 *
 * 纯逻辑已在 consistency-audit-format 里测过；这里锁「视图外壳」的行为契约：
 *  - 没有活动项目时给出引导，而不是渲染空壳
 *  - 有项目时渲染工具栏 / 说明 / 列表容器
 *  - onClose 清空 DOM
 *
 * 环境说明：单测跑在 node（无 jsdom），而 obsidian 替身的 `Modal` 在字段初始化时
 * 会调用 `document.createElement`。因此这里用**模块级 Modal 替身** + 极简元素桩，
 * 只验证「渲染了哪些文案/容器」，不验证样式与真实布局。
 */

import { describe, expect, it, vi } from 'vitest';

/** 极简元素桩：只实现 Modal 用到的 DOM 能力 */
interface FakeEl {
    tag: string;
    children: FakeEl[];
    classes: string[];
    title: string;
    type: string;
    text: string;
    createEl: (tag: string, opts?: { text?: string; cls?: string; type?: string }) => FakeEl;
    createDiv: (opts?: { text?: string; cls?: string }) => FakeEl;
    empty: () => void;
    addClass: (cls: string) => void;
    setText: (text: string) => void;
    appendChild: (child: FakeEl) => void;
    addEventListener: (event: string, handler: () => void) => void;
    textContent: string;
    childElementCount: number;
}

/**
 * 造一个元素桩。
 *
 * @param tag - 标签名
 * @returns 元素桩
 */
function makeEl(tag = 'div'): FakeEl {
    const el: FakeEl = {
        tag,
        children: [],
        classes: [],
        title: '',
        type: '',
        text: '',
        createEl(childTag: string, opts?: { text?: string; cls?: string; type?: string }) {
            const child = makeEl(childTag);
            if (opts?.text) child.text = opts.text;
            if (opts?.cls) child.classes.push(...opts.cls.split(/\s+/));
            if (opts?.type) child.type = opts.type;
            el.children.push(child);
            return child;
        },
        createDiv(opts?: { text?: string; cls?: string }) {
            return el.createEl('div', opts);
        },
        empty() {
            el.children = [];
            el.text = '';
        },
        addClass(cls: string) {
            el.classes.push(cls);
        },
        setText(text: string) {
            el.text = text;
        },
        appendChild(child: FakeEl) {
            el.children.push(child);
        },
        addEventListener() {
            // 事件在单测里不触发
        },
        get textContent(): string {
            const own = el.text;
            const kids = el.children.map(c => c.textContent).join('');
            return `${own}${kids}`;
        },
        get childElementCount(): number {
            return el.children.length;
        },
    };
    return el;
}

// 模块级替身：只替换 Modal，其余导出保持原样
vi.mock('obsidian', async (importOriginal) => {
    const actual = await importOriginal<typeof import('obsidian')>();
    class MockModal {
        app: unknown;

        contentEl = makeEl();

        titleEl = makeEl();

        constructor(app: unknown) {
            this.app = app;
        }

        /**
         * 关闭（测试里无副作用）。
         */
        close(): void {
            // no-op
        }
    }
    return { ...actual, Modal: MockModal };
});

vi.mock('../../../main', () => ({ default: class {} }));

// vi.mock 会被提升到 import 之前，因此这里可以静态 import
import { ConsistencyAuditModal } from '../../../ui/consistency-audit-modal';

/** 造 plugin 桩：只用 getActiveProject */
function makePlugin(activeProject: string | null): never {
    return { getActiveProject: () => activeProject } as never;
}

/** 造最小 app */
function makeApp(): never {
    return {} as never;
}

/** 取渲染文本 */
function textOf(modal: InstanceType<typeof ConsistencyAuditModal>): string {
    return (modal.contentEl as unknown as FakeEl).textContent;
}

describe('ConsistencyAuditModal · 无活动项目', () => {
    it('给出打开项目的引导，且不渲染工具栏', () => {
        const modal = new ConsistencyAuditModal(makeApp(), makePlugin(null), { autoRun: false });
        modal.onOpen();
        const text = textOf(modal);
        expect(text).toContain('请先打开一个项目');
        expect(text).not.toContain('重新检查');
    });

    it('标题始终可见', () => {
        const modal = new ConsistencyAuditModal(makeApp(), makePlugin(null), { autoRun: false });
        modal.onOpen();
        expect(textOf(modal)).toContain('跨章一致性审核');
    });
});

describe('ConsistencyAuditModal · 有活动项目', () => {
    it('渲染工具栏（重新检查 + 模型复核开关）与项目名', () => {
        const modal = new ConsistencyAuditModal(makeApp(), makePlugin('测试项目'), { autoRun: false });
        modal.onOpen();
        const text = textOf(modal);
        expect(text).toContain('重新检查');
        expect(text).toContain('模型复核');
        expect(text).toContain('测试项目');
    });

    it('说明检查覆盖的类型（让用户知道能力边界）', () => {
        const modal = new ConsistencyAuditModal(makeApp(), makePlugin('测试项目'), { autoRun: false });
        modal.onOpen();
        const text = textOf(modal);
        expect(text).toContain('数量');
        expect(text).toContain('时间线');
        expect(text).toContain('命名混淆');
    });

    it('onClose 清空内容（不留悬挂 DOM）', () => {
        const modal = new ConsistencyAuditModal(makeApp(), makePlugin('测试项目'), { autoRun: false });
        modal.onOpen();
        modal.onClose();
        expect((modal.contentEl as unknown as FakeEl).childElementCount).toBe(0);
    });
});
