import { describe, it, expect, vi } from 'vitest';

// engine-registry 会反向引用 main.ts；先 mock 掉，避免加载构建产物 main.js。
vi.mock('../../../main', () => ({
    default: class NovelWriterPlugin {},
}));

import { StepRunner } from '../../../engine/step-runner';

/**
 * D3 — 重试按钮依赖 `_lastCtx`。
 * 修复前该字段只有声明与读取、没有赋值点，点击「🔄 重试」永远无反应。
 */

interface FakeEl {
    tag: string;
    cls: string;
    text: string;
    disabled: boolean;
    attrs: Record<string, string>;
    children: FakeEl[];
    parent: FakeEl | null;
    onclick: (() => void) | null;
    createDiv(opts?: { cls?: string } | string): FakeEl;
    createEl(tag: string, opts?: { cls?: string; text?: string }): FakeEl;
    querySelector(selector: string): FakeEl | null;
    remove(): void;
    setAttribute(key: string, value: string): void;
}

function el(tag = 'div'): FakeEl {
    const node: FakeEl = {
        tag,
        cls: '',
        text: '',
        disabled: false,
        attrs: {},
        children: [],
        parent: null,
        onclick: null,
        createDiv(opts) {
            const child = el('div');
            child.cls = typeof opts === 'string' ? opts : (opts?.cls ?? '');
            child.parent = node;
            node.children.push(child);
            return child;
        },
        createEl(childTag, opts) {
            const child = el(childTag);
            child.cls = opts?.cls ?? '';
            child.text = opts?.text ?? '';
            child.parent = node;
            node.children.push(child);
            return child;
        },
        querySelector(selector) {
            if (!selector.startsWith('.')) return null;
            const want = selector.slice(1);
            const stack = [...node.children];
            while (stack.length > 0) {
                const current = stack.shift()!;
                if (current.cls.split(/\s+/).includes(want)) return current;
                stack.push(...current.children);
            }
            return null;
        },
        remove() {
            if (!node.parent) return;
            const index = node.parent.children.indexOf(node);
            if (index >= 0) node.parent.children.splice(index, 1);
            node.parent = null;
        },
        setAttribute(key, value) {
            node.attrs[key] = value;
        },
    };
    return node;
}

function createRunner(): StepRunner {
    const plugin = {
        aiEngine: {},
        engineRegistry: { get: () => ({}) },
    };
    return new StepRunner({} as never, plugin as never, {});
}

function renderRetryButton(runner: StepRunner): { promptArea: FakeEl; button: FakeEl } {
    const tabContent = el();
    const promptArea = tabContent.createDiv({ cls: 'novel-writer-fw-prompt-area' });
    runner.renderErrorResult('boom', 'outline', tabContent as never);
    const card = promptArea.querySelector('.novel-writer-fw-error-card');
    const button = card?.children.find(child => child.tag === 'button');
    if (!button) throw new Error('未渲染出重试按钮');
    return { promptArea, button };
}

describe('D3 重试按钮 — 上下文记录与可用性', () => {
    it('executeCurrentStep 入口记录上下文（即使随后早退）', async () => {
        const runner = createRunner();
        const ctx = { isLoading: false, currentStepIndex: -1, tabContent: el() };

        await runner.executeCurrentStep(ctx as never);

        expect((runner as unknown as { _lastCtx: unknown })._lastCtx).toBe(ctx);
    });

    it('点击重试用最近一次上下文重新执行，并移除旧错误卡片', async () => {
        const runner = createRunner();
        const ctx = { isLoading: false, currentStepIndex: -1, tabContent: el() };
        await runner.executeCurrentStep(ctx as never);

        const execute = vi.spyOn(runner, 'executeCurrentStep').mockResolvedValue(undefined);
        const { promptArea, button } = renderRetryButton(runner);

        expect(button.disabled).toBe(false);
        button.onclick?.();

        expect(execute).toHaveBeenCalledTimes(1);
        expect(execute).toHaveBeenCalledWith(ctx);
        expect(promptArea.querySelector('.novel-writer-fw-result-section')).toBeNull();
    });

    it('没有上下文时禁用重试并给出原因', () => {
        const runner = createRunner();
        const { button } = renderRetryButton(runner);

        expect(button.disabled).toBe(true);
        expect(button.attrs.title).toContain('缺少步骤上下文');
    });
});
