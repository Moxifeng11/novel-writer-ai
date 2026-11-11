/**
 * fake-dom.ts — ui/views 纯 DOM 构建器的测试替身（DSH-20261112-07）
 *
 * `ui/views` 下的 `buildXxx` 构建器只用到 Obsidian 对 HTMLElement 的扩展
 * （createDiv / createSpan / createEl / addClass / addEventListener），
 * 不需要 jsdom。这里给出最小实现，测试即可断言「分支为真时 DOM 真的长出来」。
 *
 * 用法：
 * ```ts
 * import { FakeEl, stubCreateDiv } from './support/fake-dom';
 * beforeEach(() => stubCreateDiv());
 * afterEach(() => vi.unstubAllGlobals());
 * ```
 */

/** 通用假元素（Obsidian HTMLElement 扩展子集） */
export class FakeEl {
    tagName: string;
    className = '';
    textContent = '';
    attr: Record<string, string> = {};
    children: FakeEl[] = [];
    listeners = new Map<string, Array<(e: unknown) => void>>();

    constructor(tag = 'div') {
        this.tagName = tag;
    }

    setAttribute(name: string, value: string): void {
        if (name === 'class') this.className = value;
        else this.attr[name] = value;
    }

    getAttribute(name: string): string | null {
        if (name === 'class') return this.className;
        return this.attr[name] ?? null;
    }

    addClass(cls: string): this {
        const set = new Set(this.className.split(' ').filter(Boolean));
        set.add(cls);
        this.className = [...set].join(' ');
        return this;
    }

    addEventListener(type: string, fn: (e: unknown) => void): void {
        const list = this.listeners.get(type) ?? [];
        list.push(fn);
        this.listeners.set(type, list);
    }

    dispatch(type: string, event: Record<string, unknown> = {}): void {
        for (const fn of this.listeners.get(type) ?? []) fn({ preventDefault() {}, ...event });
    }

    empty(): this {
        this.children = [];
        this.textContent = '';
        return this;
    }

    createDiv(o?: { cls?: string; text?: string; attr?: Record<string, string> }): FakeEl {
        return this.child('div', o);
    }

    createSpan(o?: { cls?: string; text?: string; attr?: Record<string, string> }): FakeEl {
        return this.child('span', o);
    }

    createEl(tag: string, o?: { cls?: string; text?: string; attr?: Record<string, string> }): FakeEl {
        return this.child(tag, o);
    }

    /** 按类名查找（含自身与整棵子树） */
    findAll(cls: string): FakeEl[] {
        const hits: FakeEl[] = [];
        const walk = (el: FakeEl): void => {
            if (el.className.split(' ').includes(cls)) hits.push(el);
            el.children.forEach(walk);
        };
        walk(this);
        return hits;
    }

    /** 整棵子树的文本拼接（断言「有没有这段文案」用） */
    allText(): string {
        return this.textContent + this.children.map(c => ' ' + c.allText()).join('');
    }

    private child(tag: string, o?: { cls?: string; text?: string; attr?: Record<string, string> }): FakeEl {
        const el = new FakeEl(tag);
        if (o?.cls) el.className = o.cls;
        if (o?.text !== undefined) el.textContent = o.text;
        if (o?.attr) for (const [k, v] of Object.entries(o.attr)) el.setAttribute(k, v);
        this.children.push(el);
        return el;
    }
}

/**
 * 把 Obsidian 的全局 `createDiv` 补到 globalThis。
 *
 * 构建器里裸调用的 `createDiv(...)` 在真实运行时来自 Obsidian 的全局扩展，
 * 单测环境必须显式提供；`vi.unstubAllGlobals()` 可撤销。
 */
export function stubCreateDiv(): void {
    (globalThis as unknown as Record<string, unknown>).createDiv =
        (o?: { cls?: string; text?: string; attr?: Record<string, string> }) => new FakeEl('div').createDiv(o);
}

/** 把容器断言用的根节点（FakeEl 与 HTMLElement 互转） */
export function asFake(el: unknown): FakeEl {
    return el as FakeEl;
}
