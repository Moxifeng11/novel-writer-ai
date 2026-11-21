/**
 * 测试环境初始化 — Vitest setup
 * 在所有测试文件之前执行
 */

// Vitest 的 globals 已通过 vitest.config.ts 启用，无需显式 import
import { FakeEl } from './unit/ui/support/fake-dom';

// Obsidian 桌面端（Electron）里 window 始终存在；node 测试环境没有。
// 生产代码按 Obsidian 规范用 window.setTimeout / window.requestAnimationFrame 后，
// 这里补一个最小 window 指向 globalThis，让定时器相关代码在测试里可运行。
if (typeof (globalThis as unknown as { window?: unknown }).window === 'undefined') {
    (globalThis as unknown as { window: unknown }).window = globalThis;
}

/**
 * Obsidian 在运行时给全局注入 createEl / createDiv / createSpan / createFragment。
 * 生产代码里裸调它们时，node 测试环境并不存在。
 *
 * 最小等价实现：若测试已用 stubDocument() 注入 document.createElement（各测试的
 * 假元素工厂），就沿用那个工厂，保证元素类型与测试断言一致；否则退回 FakeEl。
 */
type ElOptions = { cls?: string | string[]; text?: string; attr?: Record<string, string> };

function resolveElement(tag: string): Record<string, unknown> {
    const doc = (globalThis as unknown as { document?: { createElement?: (tag: string) => unknown } }).document;
    if (doc && typeof doc.createElement === 'function') {
        return doc.createElement(tag) as Record<string, unknown>;
    }
    return new FakeEl(tag) as unknown as Record<string, unknown>;
}

function applyOptions(el: Record<string, unknown>, options?: ElOptions): unknown {
    const addClass = el.addClass as ((cls: string) => void) | undefined;
    const setText = el.setText as ((text: string) => void) | undefined;
    if (options?.cls) {
        const cls = Array.isArray(options.cls) ? options.cls.join(' ') : options.cls;
        if (typeof addClass === 'function') addClass.call(el, cls);
        else el.className = cls;
    }
    if (options?.text !== undefined) {
        if (typeof setText === 'function') setText.call(el, options.text);
        else el.textContent = options.text;
    }
    if (options?.attr) {
        const setAttribute = el.setAttribute as ((name: string, value: string) => void) | undefined;
        for (const [key, value] of Object.entries(options.attr)) {
            if (typeof setAttribute === 'function') setAttribute.call(el, key, value);
            else el[key] = value;
        }
    }
    return el;
}

const globals = globalThis as unknown as Record<string, unknown>;
if (typeof globals.createEl !== 'function') {
    globals.createEl = (tag: string, options?: ElOptions) => applyOptions(resolveElement(tag), options);
    globals.createDiv = (options?: ElOptions) => applyOptions(resolveElement('div'), options);
    globals.createSpan = (options?: ElOptions) => applyOptions(resolveElement('span'), options);
    globals.createFragment = () => resolveElement('fragment');
}
