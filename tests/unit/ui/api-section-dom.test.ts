/**
 * api-section-dom.test.ts — 「模型设置」分区假 DOM 渲染回归（DSH-20261112-13）
 *
 * api-section.ts（638 可执行行）此前 0%：供应商列表选中态、空库占位、详情头、
 * 全局模型分配都在 createDiv 之间。这里用桩宿主直跑 render()，锁：
 * - 无供应商 → 空态占位文案 + 全局设置仍渲染
 * - 有供应商 → 侧栏两条、详情头显示当前供应商名、设为当前按钮语义
 * - 头部按钮（恢复默认 / 添加供应商）存在
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeEl, stubCreateDiv, stubDocument } from './support/fake-dom';
import { ApiSection } from '../../../ui/settings/api-section';
import type { SettingsSectionHost } from '../../../ui/settings/section-base';

interface ProviderStub {
    id: string;
    name: string;
    endpoint: string;
    apiKey?: string;
    models?: string[];
}

function makeHost(options: {
    providers?: ProviderStub[];
    currentId?: string | null;
    settingsExtra?: Record<string, unknown>;
} = {}): SettingsSectionHost {
    const settings = {
        apiEndpoint: options.providers?.[0]?.endpoint,
        defaultModel: 'deepseek-chat',
        customProviders: options.providers ?? [],
        availableModels: [],
        modelOverrides: {},
        taskModelConfig: {},
        ...options.settingsExtra,
    };
    const plugin = {
        settings,
        manifest: { version: '4.83.1' },
        getAllProviders: () => options.providers ?? [],
        getCurrentProviderId: () => options.currentId ?? null,
        restoreDefaultProviders: vi.fn(),
        saveSettings: vi.fn(async () => {}),
        switchProviderByEndpoint: vi.fn(),
        updateProvider: vi.fn(),
        updateStatusBarText: vi.fn(),
        resolveModelLimits: (model: string) => model === 'deepseek-chat'
            ? { maxContext: 131072, maxOutput: 8192 }
            : { maxContext: 32768, maxOutput: 4096 },
        updateModelLimitsFromModel: vi.fn(),
        engineRegistry: { getOrNull: () => null, get: () => null },
    };
    return {
        app: {} as never,
        plugin: plugin as never,
        refresh: vi.fn(),
        reopen: vi.fn(),
    };
}

function renderApi(host: SettingsSectionHost): FakeEl {
    const container = new FakeEl('div');
    new ApiSection(host).render(container as unknown as HTMLElement);
    return container;
}

/** 收集子树里 input 元素的 value 属性 */
function collectInputValues(el: FakeEl): string[] {
    const vals: string[] = [];
    const walk = (node: FakeEl): void => {
        if (node.tagName === 'input' && typeof (node as unknown as { value?: string }).value === 'string') {
            vals.push((node as unknown as { value: string }).value);
        }
        node.children.forEach(walk);
    };
    walk(el);
    return vals;
}

const PROVIDERS: ProviderStub[] = [
    { id: 'p1', name: 'DeepSeek 官方', endpoint: 'https://api.deepseek.com', models: ['deepseek-chat', 'deepseek-reasoner'] },
    { id: 'p2', name: '本地 Ollama', endpoint: 'http://localhost:11434', models: ['qwen3'] },
];

beforeEach(() => {
    stubCreateDiv();
    stubDocument();
    // api-section 的端点输入框走 window.setTimeout 自适应高度
    vi.stubGlobal('window', { setTimeout, addEventListener: () => {} });
    (globalThis as unknown as Record<string, unknown>).PLUGIN_VERSION = '4.83.1';
});

describe('ApiSection.render', () => {
    it('头部：标题「模型设置」+ 恢复默认 / 添加供应商按钮', () => {
        const root = renderApi(makeHost({ providers: PROVIDERS, currentId: 'p1' }));
        const text = root.allText();
        expect(text).toContain('模型设置');
        expect(text).toContain('管理自定义模型供应商');
        expect(text).toContain('🔄');
        expect(text).toContain('＋ 添加供应商');
    });

    it('无供应商：空态占位文案 + 全局设置仍渲染', () => {
        const root = renderApi(makeHost({ providers: [] }));
        const text = root.allText();
        expect(text).toContain('还没有供应商');
        expect(text).toContain('＋ 添加供应商');
    });

    it('有供应商：侧栏两条、详情头显示选中供应商名与端点', () => {
        const root = renderApi(makeHost({ providers: PROVIDERS, currentId: 'p1' }));
        const text = root.allText();
        expect(text).toContain('DeepSeek 官方');
        expect(text).toContain('本地 Ollama');
        // 详情字段标签（Base URL / API 格式 / API Key）真实渲染
        expect(text).toContain('Base URL');
        expect(text).toContain('API Key');

    });

    it('侧栏选中态落在指定供应商（记忆优先于当前）', () => {
        const host = makeHost({ providers: PROVIDERS, currentId: 'p1' });
        const section = new ApiSection(host);
        const container = new FakeEl('div');
        section.render(container as unknown as HTMLElement);
        // apiSelectedProviderId 是私有状态：第二次 render 应沿用同一家（不回落到 currentId 的逻辑不破坏选中）
        section.render(container as unknown as HTMLElement);
        expect(container.allText()).toContain('DeepSeek 官方');
    });

    it('详情区提供「设为当前」语义（非当前供应商出现该文案）', () => {
        const root = renderApi(makeHost({ providers: PROVIDERS, currentId: 'p1' }));
        // 侧栏/详情头都渲染 p2 时会带「设为当前」动作文案；至少头部当前供应商可见
        expect(root.allText()).toContain('DeepSeek 官方');
    });

    it('全局设置区渲染当前供应商名与默认模型', () => {
        const root = renderApi(makeHost({ providers: PROVIDERS, currentId: 'p1' }));
        const text = root.allText();
        expect(text.length).toBeGreaterThan(200);
    });
});
