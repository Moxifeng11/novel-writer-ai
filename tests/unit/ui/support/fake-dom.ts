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
    innerHTML = '';
    attr: Record<string, string> = {};
    children: FakeEl[] = [];
    listeners = new Map<string, Array<(e: unknown) => void>>();
    /** 内联样式（真实运行时是 CSSStyleDeclaration；测试只做赋值/读取） */
    style: Record<string, string> = {};

    constructor(tag = 'div') {
        this.tagName = tag;
    }

    get classList(): {
        add: (...cls: string[]) => void;
        remove: (...cls: string[]) => void;
        contains: (cls: string) => boolean;
        toggle: (cls: string, force?: boolean) => void;
    } {
        const self = this;
        return {
            add: (...cls: string[]) => {
                const set = new Set(self.className.split(' ').filter(Boolean));
                cls.forEach(c => set.add(c));
                self.className = [...set].join(' ');
            },
            remove: (...cls: string[]) => {
                const set = new Set(self.className.split(' ').filter(Boolean));
                cls.forEach(c => set.delete(c));
                self.className = [...set].join(' ');
            },
            contains: (cls: string) => self.className.split(' ').includes(cls),
            toggle: (cls: string, force?: boolean) => {
                const shouldAdd = force === undefined ? !self.classList.contains(cls) : force;
                if (shouldAdd) self.classList.add(cls);
                else self.classList.remove(cls);
            },
        };
    }

    /** 兼容 sanitizeHTMLToDom 替身返回的 { html } 片段：按字符串拼接 */
    appendChild<T>(child: T): T {
        const fragment = child as unknown as { html?: unknown };
        if (!(child instanceof FakeEl) && typeof fragment?.html === 'string') {
            this.innerHTML += fragment.html;
            return child;
        }
        this.children.push(child as unknown as FakeEl);
        return child;
    }

    /** Obsidian mock 的 Setting 走 settingEl.append(...)（DOM ParentNode.append 语义） */
    append(...nodes: Array<unknown>): void {
        for (const node of nodes) {
            if (typeof node === 'string') this.textContent += node;
            else this.appendChild(node);
        }
    }

    /** 链式文案/按钮/图标方法（Obsidian HTMLElement 扩展，mock 的 Setting 会调） */
    setText(text: string): this {
        this.textContent = text;
        return this;
    }

    setButtonText(text: string): this {
        this.textContent = text;
        return this;
    }

    setTooltip(_text: string): this {
        return this;
    }

    setIcon(_icon: string): this {
        return this;
    }

    /** 支持 `.class` / `tag` / 逗号分隔组合（attachChartInteractions 的选择器形态） */
    querySelectorAll<T = FakeEl>(selector: string): T[] {
        const hits: FakeEl[] = [];
        const parts = selector.split(',').map(s => s.trim()).filter(Boolean);
        const match = (el: FakeEl): boolean => parts.some(part => {
            if (part.startsWith('.')) return el.className.split(' ').includes(part.slice(1));
            if (part.startsWith('#')) return el.getAttribute('id') === part.slice(1);
            return el.tagName === part;
        });
        const walk = (el: FakeEl): void => {
            for (const c of el.children) {
                if (match(c)) hits.push(c);
                walk(c);
            }
        };
        walk(this);
        return hits as unknown as T[];
    }

    querySelector<T = FakeEl>(selector: string): T | null {
        return this.querySelectorAll<T>(selector)[0] ?? null;
    }

    getBoundingClientRect(): { left: number; top: number; width: number; height: number } {
        return { left: 0, top: 0, width: 400, height: 300 };
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

/**
 * 把最小 `document` 补到 globalThis（只需要 createElement）。
 *
 * 图表交互（svg-charts.createTooltip）等运行时路径会裸调 `document.createElement`；
 * 返回 FakeEl 使其落入假元素树，可被 querySelector 找到。
 */
export function stubDocument(): void {
    (globalThis as unknown as Record<string, unknown>).document = {
        createElement: (tag: string) => new FakeEl(tag),
    };
}

/** 把容器断言用的根节点（FakeEl 与 HTMLElement 互转） */
export function asFake(el: unknown): FakeEl {
    return el as FakeEl;
}
