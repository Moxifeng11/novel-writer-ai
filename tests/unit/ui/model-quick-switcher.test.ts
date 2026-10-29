import { describe, expect, it, vi } from 'vitest';
import { Menu } from '../../__mocks__/obsidian';
import {
    applyModelChoice,
    formatModelSwitcherLabel,
    openModelSwitcherMenu,
    refreshAllModelSwitchers,
    registerModelSwitcherRefresher,
    renderModelQuickSwitcher,
    resolveModelSwitcherSnapshot,
    sortProviderOptions,
    type ModelSwitcherPluginLike,
} from '../../../ui/model-quick-switcher';

function makePlugin(overrides: Partial<{
    apiEndpoint: string;
    defaultModel: string;
    flashModel: string;
    proModel: string;
}> = {}): ModelSwitcherPluginLike & { spies: Record<string, ReturnType<typeof vi.fn>> } {
    const settings = {
        apiEndpoint: overrides.apiEndpoint ?? 'https://api.deepseek.com/v1/chat/completions',
        defaultModel: overrides.defaultModel ?? 'deepseek-flash',
        flashModel: overrides.flashModel ?? 'deepseek-flash',
        proModel: overrides.proModel ?? 'deepseek-v4-pro',
        customProviderName: '自定义',
        availableModels: ['deepseek-flash', 'deepseek-v4-pro'],
        customProviders: [
            {
                id: 'deepseek',
                name: 'DeepSeek 官网',
                endpoint: 'https://api.deepseek.com/v1/chat/completions',
                models: ['deepseek-flash', 'deepseek-v4-pro'],
            },
            {
                id: 'ollama',
                name: '本地 Ollama',
                endpoint: 'http://localhost:11434/api/generate',
                models: ['qwen2.5:7b', 'deepseek-r1:7b'],
            },
        ],
        providerKeys: { deepseek: 'sk-test', ollama: 'ollama' } as Record<string, string>,
        apiKey: 'sk-test',
    };
    const spies = {
        switchProviderByEndpoint: vi.fn((endpoint: string) => {
            const provider = settings.customProviders.find(c => c.endpoint === endpoint);
            if (!provider) return false;
            settings.apiEndpoint = provider.endpoint;
            settings.availableModels = [...provider.models];
            settings.defaultModel = provider.models[0];
            settings.flashModel = provider.models[0];
            settings.proModel = provider.models[1] || provider.models[0];
            settings.apiKey = settings.providerKeys[provider.id] || '';
            return true;
        }),
        updateModelLimitsFromModel: vi.fn(),
        saveSettings: vi.fn(async () => {}),
        updateStatusBarText: vi.fn(),
        refreshFullWriterContextPanel: vi.fn(),
    };
    return {
        settings,
        getCurrentProviderId: () => settings.customProviders.find(c => c.endpoint === settings.apiEndpoint)?.id || null,
        getAllProviders: () => settings.customProviders.map(c => ({
            id: c.id,
            name: c.name,
            endpoint: c.endpoint,
            models: [...c.models],
            sourceType: c.id === 'ollama' ? 'local' : 'cloud',
            isPreset: c.id === 'deepseek',
        })),
        ...spies,
        spies,
    } as unknown as ModelSwitcherPluginLike & { spies: Record<string, ReturnType<typeof vi.fn>> };
}

describe('model-quick-switcher — 纯逻辑', () => {
    it('快照包含供应商名与当前默认模型', () => {
        const plugin = makePlugin();
        const snapshot = resolveModelSwitcherSnapshot(plugin);
        expect(snapshot.providerId).toBe('deepseek');
        expect(snapshot.providerName).toBe('DeepSeek 官网');
        expect(snapshot.defaultModel).toBe('deepseek-flash');
        expect(formatModelSwitcherLabel(snapshot)).toBe('🔌 DeepSeek 官网 · deepseek-flash');
    });

    it('供应商排序：当前在前，预设次之，其余按名称', () => {
        const providers = [
            { id: 'b', name: 'Zeta', isPreset: false },
            { id: 'a', name: 'Alpha', isPreset: true },
            { id: 'c', name: 'Beta', isPreset: false },
        ];
        const sorted = sortProviderOptions(providers, 'c');
        expect(sorted.map(p => p.id)).toEqual(['c', 'a', 'b']);
    });

    it('applyModelChoice：同供应商换模型只改模型与上限', async () => {
        const plugin = makePlugin();
        const provider = plugin.getAllProviders().find(p => p.id === 'deepseek')!;
        const ok = await applyModelChoice(plugin, provider, 'deepseek-v4-pro');

        expect(ok).toBe(true);
        expect(plugin.spies.switchProviderByEndpoint).not.toHaveBeenCalled();
        expect(plugin.settings.defaultModel).toBe('deepseek-v4-pro');
        expect(plugin.settings.flashModel).toBe('deepseek-v4-pro');
        expect(plugin.settings.proModel).toBe('deepseek-v4-pro');
        expect(plugin.spies.updateModelLimitsFromModel).toHaveBeenCalledWith('deepseek-v4-pro');
        expect(plugin.spies.saveSettings).toHaveBeenCalled();
        expect(plugin.spies.updateStatusBarText).toHaveBeenCalled();
        expect(plugin.spies.refreshFullWriterContextPanel).toHaveBeenCalled();
    });

    it('applyModelChoice：跨供应商先切换再应用模型', async () => {
        const plugin = makePlugin();
        const provider = plugin.getAllProviders().find(p => p.id === 'ollama')!;
        const ok = await applyModelChoice(plugin, provider, 'deepseek-r1:7b');

        expect(ok).toBe(true);
        expect(plugin.spies.switchProviderByEndpoint).toHaveBeenCalledWith('http://localhost:11434/api/generate');
        expect(plugin.settings.apiEndpoint).toBe('http://localhost:11434/api/generate');
        expect(plugin.settings.defaultModel).toBe('deepseek-r1:7b');
        expect(plugin.settings.flashModel).toBe('deepseek-r1:7b');
        expect(plugin.settings.proModel).toBe('deepseek-r1:7b');
    });

    it('applyModelChoice：切换失败时返回 false 且不改动模型', async () => {
        const plugin = makePlugin();
        plugin.spies.switchProviderByEndpoint.mockReturnValueOnce(false);
        const before = plugin.settings.defaultModel;
        const ok = await applyModelChoice(plugin, {
            id: 'ghost', name: '不存在', endpoint: 'https://ghost.invalid', models: ['m1'], sourceType: 'cloud', isPreset: false,
        }, 'm1');

        expect(ok).toBe(false);
        expect(plugin.settings.defaultModel).toBe(before);
    });
});

describe('model-quick-switcher — 两级菜单', () => {
    it('第一级列出全部供应商并勾选当前', () => {
        const plugin = makePlugin();
        openModelSwitcherMenu(plugin);
        const menu = Menu.lastInstance!;
        expect(menu.items).toHaveLength(2);
        expect(menu.items[0].title).toContain('DeepSeek 官网');
        expect(menu.items[0].checked).toBe(true);
        expect(menu.items[1].title).toContain('本地 Ollama');
        expect(menu.items[1].title).toContain('💻');
    });

    it('第二级列出所选供应商的模型，选中模型后全局生效', async () => {
        const plugin = makePlugin();
        openModelSwitcherMenu(plugin);
        const level1 = Menu.lastInstance!;
        const ollamaItem = level1.items.find(item => item.title.includes('本地 Ollama'))!;

        ollamaItem.onClick!();
        const level2 = Menu.lastInstance!;
        expect(level2).not.toBe(level1);
        expect(level2.items.map(item => item.title)).toEqual(['qwen2.5:7b', 'deepseek-r1:7b']);
        expect(level2.items[0].checked).toBe(false);

        await level2.items[1].onClick!();
        expect(plugin.settings.defaultModel).toBe('deepseek-r1:7b');
        expect(plugin.settings.proModel).toBe('deepseek-r1:7b');
    });

    it('没有可用供应商时不开菜单', () => {
        const plugin = makePlugin();
        plugin.getAllProviders = () => [];
        Menu.lastInstance = null;
        openModelSwitcherMenu(plugin);
        expect(Menu.lastInstance).toBeNull();
    });
});

describe('model-quick-switcher — 装配与刷新', () => {
    // 仓库测试环境为 node（无 jsdom），按既有约定注入最小 document 垫片
    function installDocumentShim(): void {
        const makeElement = (tag: string): any => {
            const el: any = {
                tagName: tag.toUpperCase(),
                children: [] as any[],
                className: '',
                attrs: {} as Record<string, string>,
                listeners: {} as Record<string, Array<(evt?: unknown) => void>>,
                parentElement: null as any,
                classList: {
                    _set: new Set<string>(),
                    toggle(cls: string, force?: boolean) {
                        const on = force ?? !this._set.has(cls);
                        if (on) this._set.add(cls); else this._set.delete(cls);
                    },
                    contains(cls: string) { return this._set.has(cls); },
                },
                setAttribute(name: string, value: string) { el.attrs[name] = value; },
                appendChild(child: any) { el.children.push(child); child.parentElement = el; return child; },
                addEventListener(type: string, fn: (evt?: unknown) => void) {
                    (el.listeners[type] ||= []).push(fn);
                },
                dispatchEventLike(type: string, evt?: unknown) {
                    for (const fn of el.listeners[type] || []) fn(evt);
                },
                click() { el.dispatchEventLike('click', {}); },
                remove() {
                    if (el.parentElement) {
                        const index = el.parentElement.children.indexOf(el);
                        if (index >= 0) el.parentElement.children.splice(index, 1);
                        el.parentElement = null;
                    }
                },
            };
            // textContent 语义对齐真实 DOM：自身文本 + 子节点文本
            let ownText = '';
            Object.defineProperty(el, 'textContent', {
                get() {
                    return ownText + el.children.map((child: any) => child.textContent).join('');
                },
                set(value: string) { ownText = value; },
            });
            return el;
        };
        (globalThis as any).document = {
            createElement: (tag: string) => makeElement(tag),
        };
    }

    it('按钮渲染当前快照，点击弹出菜单', () => {
        installDocumentShim();
        const plugin = makePlugin();
        const container: any = { children: [] as any[] };
        Object.assign(container, {
            appendChild(child: any) { container.children.push(child); child.parentElement = container; return child; },
        });
        const handle = renderModelQuickSwitcher(container as unknown as HTMLElement, plugin);

        expect(handle.button.className).toBe('nw-model-switch');
        expect((handle.button as unknown as { attrs: Record<string, string> }).attrs['title']).toContain('两级菜单');
        expect(handle.button.textContent).toContain('DeepSeek 官网');
        expect(handle.button.textContent).toContain('deepseek-flash');
        expect(handle.button.classList.contains('is-unconfigured')).toBe(false);

        handle.button.click();
        expect(Menu.lastInstance?.items.length).toBe(2);

        handle.destroy();
        expect(container.children).toHaveLength(0);
    });

    it('刷新广播会更新按钮文案与未配置态', () => {
        installDocumentShim();
        const plugin = makePlugin();
        const container: any = { children: [] as any[] };
        Object.assign(container, {
            appendChild(child: any) { container.children.push(child); child.parentElement = container; return child; },
        });
        const handle = renderModelQuickSwitcher(container as unknown as HTMLElement, plugin);

        plugin.settings.defaultModel = 'deepseek-v4-pro';
        refreshAllModelSwitchers();
        expect(handle.button.textContent).toContain('deepseek-v4-pro');

        plugin.settings.defaultModel = '';
        refreshAllModelSwitchers();
        expect(handle.button.classList.contains('is-unconfigured')).toBe(true);

        handle.destroy();
        const unregister = registerModelSwitcherRefresher(() => {});
        expect(typeof unregister).toBe('function');
        unregister();
    });
});
