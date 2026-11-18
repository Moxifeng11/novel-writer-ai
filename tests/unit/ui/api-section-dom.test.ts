/**
 * api-section-dom.test.ts — 「模型设置」分区假 DOM 渲染回归（DSH-20261112-13）
 *
 * api-section.ts（638 可执行行）此前 0%：供应商列表选中态、空库占位、详情头、
 * 全局模型分配都在 createDiv 之间。这里用桩宿主直跑 render()，锁：
 * - 无供应商 → 空态占位文案 + 全局设置仍渲染
 * - 有供应商 → 侧栏两条、详情头显示当前供应商名、设为当前按钮语义
 * - 头部按钮（恢复默认 / 添加供应商）存在
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeEl, stubCreateDiv, stubDocument } from './support/fake-dom';
import { ApiSection } from '../../../ui/settings/api-section';
import { setLocale } from '../../../i18n';
import type { SettingsSectionHost } from '../../../ui/settings/section-base';

interface ProviderStub {
    id: string;
    name: string;
    endpoint: string;
    apiKey?: string;
    models?: string[];
    modelMeta?: Record<string, {
        contextWindow?: number;
        maxTokens?: number;
        vision?: boolean;
        inputPricePerM?: number;
        outputPricePerM?: number;
        priceCurrency?: 'USD' | 'CNY';
    }>;
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
        providerAssignments: {},
        providerThinking: {},
        enabledProviderIds: undefined,
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
        // v4.97 API 配置重构：启用语义 / 按渠道分配 / 思考强度
        getEnabledProviders: () => options.providers ?? [],
        isProviderEnabled: () => true,
        setProviderEnabled: vi.fn(),
        getProviderAssignment: () => ({ defaultModel: 'deepseek-chat', flashModel: 'deepseek-chat', proModel: 'deepseek-reasoner' }),
        setProviderAssignment: vi.fn(),
        getProviderThinking: () => ({}),
        setProviderThinking: vi.fn(),
        // 2026-11-16（M-42）：覆盖值读取改走 ProviderManager，mock 需要同源返回值
        getProviderModelOverride: () => undefined,
        setProviderModelOverride: vi.fn(),
        clearProviderModelOverride: vi.fn(),
        loadSettings: vi.fn(async () => {}),
        verifySettingsPassword: vi.fn(async () => true),
        getSettingsService: undefined,
        resetKeyPassword: vi.fn(async () => ({ reencrypted: 0, cleared: [] })),
        setSessionPassword: vi.fn(),
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

    it('API 配置重构：顶部密钥卡片 + 启用语义（其他模块显示）+ 行内新建入口', () => {
        const root = renderApi(makeHost({ providers: PROVIDERS, currentId: 'p1' }));
        const text = root.allText();
        // 密钥解锁卡片放到顶部（不再藏在折叠区）
        expect(root.findAll('nw-api-key-card').length).toBe(1);
        // 开关语义是「在其他模块显示」，不再冒充切换当前渠道
        expect(text).toContain('在其他模块显示');
        expect(text).toContain('使用中');
        // 添加供应商改为侧栏行内入口
        expect(text).toContain('＋ 新建供应商');
    });

    it('全局设置区渲染当前供应商名与默认模型', () => {
        const root = renderApi(makeHost({ providers: PROVIDERS, currentId: 'p1' }));
        const text = root.allText();
        expect(text.length).toBeGreaterThan(200);
    });

    // 2026-11-16（M-19/M-20/M-21）：识别结果要可见——单价、上限来源、弹窗编辑入口
    it('模型行显示识别到的单价，上限区显示来源', () => {
        const providers: ProviderStub[] = [{
            id: 'opencode',
            name: 'OpenCode Go',
            endpoint: 'https://opencode.ai/inference/go/openai/v1',
            models: ['deepseek-v4.1-flash'],
            modelMeta: {
                'deepseek-v4.1-flash': {
                    contextWindow: 1000000,
                    maxTokens: 384000,
                    vision: true,
                    inputPricePerM: 0.15,
                    outputPricePerM: 0.6,
                    priceCurrency: 'USD',
                },
            },
        }];
        const root = renderApi(makeHost({ providers, currentId: 'opencode' }));
        const text = root.allText();
        expect(text).toContain('$0.15/$0.6');
        expect(text).toContain('视觉');
        // 上限区不再只有手填框：明确告诉用户值来自哪里
        expect(text).toContain('来源：');
    });

    it('模型编辑入口改为弹窗（不再渲染行内编辑表单）', () => {
        const root = renderApi(makeHost({ providers: PROVIDERS, currentId: 'p1' }));
        // 行内编辑器只有点「编辑」才挂载；渲染阶段不应出现
        expect(root.findAll('nw-api-model-inline-editor').length).toBe(0);
        // 编辑按钮仍在
        const editBtns = root.findAll('nw-api-icon-btn');
        expect(editBtns.length).toBeGreaterThan(0);
    });

    // 2026-11-16 验收遗留：隐藏渠道必须有「恢复显示」入口（旧实现没有任何入口找回）
    it('侧栏列出已隐藏渠道并提供恢复按钮', () => {
        const providers = [
            ...PROVIDERS,
            { id: 'hidden-1', name: '被隐藏的渠道', endpoint: 'https://hidden.example.com', models: ['m1'], isHidden: true },
        ];
        const root = renderApi(makeHost({ providers, currentId: 'p1' }));
        const text = root.allText();
        expect(text).toContain('已隐藏（1）');
        expect(text).toContain('被隐藏的渠道');
        expect(text).toContain('恢复显示');
    });
});
/** 缺口⑦ 第二期第三片：分区文案全部走 i18n（settings.api.*），这里只锁「切到英文后不再出中文」 */
describe('ApiSection.render 双语', () => {
    afterEach(() => setLocale('zh-CN'));

    it('en-US：标题、副标题、侧栏分组与操作按钮走英文', () => {
        setLocale('en-US');
        // 预设 / 自定义两组都要出现，所以给第一条打上 isDefault
        const providers = [{ ...PROVIDERS[0], isDefault: true }, PROVIDERS[1]];
        const root = renderApi(makeHost({ providers, currentId: 'p1' }));
        const text = root.allText();
        expect(text).toContain('Model settings');
        expect(text).toContain('Preset providers');
        expect(text).toContain('Custom providers');
        expect(text).toContain('Base URL');
        expect(text).toContain('API Key');
        // 分区级中文标题不应再出现（键名回退时会打印 commands./settings.api. 字样）
        expect(text).not.toContain('模型设置');
        expect(text).not.toContain('settings.api.');
    });
});

