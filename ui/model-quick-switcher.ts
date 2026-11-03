/**
 * model-quick-switcher.ts — API 供应商 → 模型 两级快速切换
 *
 * 背景（2026-10-28）：旧版把「提供商 | Flash | Pro」塞在 Obsidian 全局状态栏（右下角浮窗），
 * 只能切提供商、不能选模型，且位置与工作区脱节。本模块把它改成：
 *   1. 一枚胶囊按钮：显示当前供应商 · 当前模型；
 *   2. 点击弹出两级菜单：第一级选 API 供应商，第二级选该供应商下的模型 ID；
 *   3. 选中模型后全局生效（defaultModel / flashModel / proModel 统一为该模型），
 *      需要分别配置 Flash/Pro 时使用设置页。
 *
 * 装配点：完整写作工作台 Tab 栏、协同写作顶栏、知识库侧栏、写作指纹库侧栏。
 * 命令面板「切换 AI 提供商」也复用同一份菜单逻辑。
 */
import { Menu, Notice } from 'obsidian';
import type NovelWriterPlugin from '@/main';

/**
 * ModelSwitcherProviderOption 类型定义。
 */
export interface ModelSwitcherProviderOption {
    id: string;
    name: string;
    endpoint: string;
    models: string[];
    sourceType: string;
    isPreset: boolean;
}

/**
 * ModelSwitcherSnapshot 类型定义。
 */
export interface ModelSwitcherSnapshot {
    providerId: string | null;
    providerName: string;
    endpoint: string;
    defaultModel: string;
}

/**
 * ModelQuickSwitcherHandle 类型定义。
 */
export interface ModelQuickSwitcherHandle {
    refresh: () => void;
    destroy: () => void;
    /** 装配出的按钮元素（测试与特殊定位用） */
    button: HTMLButtonElement;
}

/** 插件所需的最小接口（便于单测用桩对象） */
export interface ModelSwitcherPluginLike {
    settings: {
        apiEndpoint: string;
        defaultModel: string;
        flashModel: string;
        proModel: string;
        customProviderName: string;
        availableModels: string[];
    };
    getCurrentProviderId(): string | null;
    getAllProviders(): Array<ModelSwitcherProviderOption & { maxContext?: number; maxOutput?: number; isDefault?: boolean; isHidden?: boolean }>;
    switchProviderByEndpoint(endpoint: string): boolean;
    updateModelLimitsFromModel(modelName: string): void;
    saveSettings(): Promise<void>;
    updateStatusBarText(): void;
    refreshFullWriterContextPanel(): void;
}

const refreshers = new Set<() => void>();

/**
 * 供应商显示名：自定义供应商缺失名称时回落，避免按钮显示 "undefined"
 *
 * @param plugin - 插件实例
 * @param providerId - 提供方ID
 * @returns 文本结果
 */
export function resolveProviderDisplayName(
    plugin: Pick<ModelSwitcherPluginLike, 'settings'> & { getCurrentProviderId(): string | null },
    providerId: string | null,
): string {
    const custom = (plugin.settings as unknown as { customProviders?: Array<{ id: string; name: string }> }).customProviders
        ?.find(c => c.id === providerId);
    if (custom) return custom.name;
    return plugin.settings.customProviderName || '自定义';
}

/**
 * 当前选择快照：供应商名 + 当前默认模型
 *
 * @param plugin - 插件实例
  * @returns ModelSwitcherSnapshot 实例
 */
export function resolveModelSwitcherSnapshot(plugin: ModelSwitcherPluginLike): ModelSwitcherSnapshot {
    const providerId = plugin.getCurrentProviderId();
    return {
        providerId,
        providerName: resolveProviderDisplayName(plugin, providerId),
        endpoint: plugin.settings.apiEndpoint,
        defaultModel: plugin.settings.defaultModel,
    };
}

/**
 * 胶囊按钮文案：与旧状态栏信息量对齐，但只保留「在哪 · 用什么」
 *
 * @param snapshot - 快照
 * @returns 文本结果
 */
export function formatModelSwitcherLabel(snapshot: ModelSwitcherSnapshot): string {
    const model = snapshot.defaultModel || '未配置模型';
    const provider = snapshot.providerName || '未配置供应商';
    return `🔌 ${provider} · ${model}`;
}

/**
 * 供应商排序：当前在前 → 预设在前 → 名称升序
 *
 * @param providers - 提供方列表
 * @param currentId - 当前ID
 * @returns 结果数组
 */
export function sortProviderOptions<T extends { id: string; name: string; isPreset?: boolean }>(
    providers: T[],
    currentId: string | null,
): T[] {
    return [...providers].sort((a, b) => {
        if (currentId) {
            if (a.id === currentId && b.id !== currentId) return -1;
            if (b.id === currentId && a.id !== currentId) return 1;
        }
        if (a.isPreset !== b.isPreset) return a.isPreset ? -1 : 1;
        return a.name.localeCompare(b.name);
    });
}

/**
 * 应用一次「供应商 → 模型」选择。
 * - 跨供应商时先切换供应商（providerManager 会回填该供应商的默认模型与密钥）；
 * - 然后把选中的模型设为全局模型：defaultModel / flashModel / proModel 统一，
 *   避免界面显示的模型与正文实际使用的 proModel 不一致；
 * - 刷新模型窗口上限、持久化并通知所有已装配的切换器。
 * @param plugin - 插件实例
 * @param provider - 提供方
 * @param model - 模型标识
 * @returns 是否成功
 */
export async function applyModelChoice(
    plugin: ModelSwitcherPluginLike,
    provider: ModelSwitcherProviderOption,
    model: string,
): Promise<boolean> {
    if (!provider || !model) return false;
    if (provider.endpoint !== plugin.settings.apiEndpoint) {
        const switched = plugin.switchProviderByEndpoint(provider.endpoint);
        if (!switched) {
            new Notice(`⚠️ 切换到「${provider.name}」失败：提供商配置不存在`, 6000);
            return false;
        }
    }
    plugin.settings.defaultModel = model;
    plugin.settings.flashModel = model;
    plugin.settings.proModel = model;
    plugin.updateModelLimitsFromModel(model);
    await plugin.saveSettings();
    plugin.updateStatusBarText();
    plugin.refreshFullWriterContextPanel();
    new Notice(`✅ 已切换到 ${resolveProviderDisplayName(plugin, plugin.getCurrentProviderId())} · ${model}`, 3000);
    return true;
}

/**
 * 注册/注销切换器刷新回调（updateStatusBarText 会触发全部刷新）
 *
 * @param refresh - 是否刷新
 */
export function registerModelSwitcherRefresher(refresh: () => void): () => void {
    refreshers.add(refresh);
    return () => refreshers.delete(refresh);
}

/**
 * refreshAllModelSwitchers 函数。
 */
export function refreshAllModelSwitchers(): void {
    for (const refresh of refreshers) refresh();
}

interface MenuLike {
    addItem(build: (item: {
        setTitle(title: string): unknown;
        setIcon?(icon: string): unknown;
        setChecked?(checked: boolean): unknown;
        onClick(cb: (evt?: MouseEvent) => void): unknown;
    }) => void): MenuLike;
    addSeparator?(): MenuLike;
    showAtMouseEvent(evt: MouseEvent): unknown;
}

/**
 * 给菜单加一项；setChecked 在旧 API 上不存在时静默跳过
 *
 * @param menu - 菜单
 * @param title - 标题
 * @param opts - 选项
 */
function addMenuItem(
    menu: MenuLike,
    title: string,
    opts: { checked?: boolean; icon?: string; onClick: () => void },
): void {
    menu.addItem(item => {
        item.setTitle(title);
        if (opts.icon && item.setIcon) item.setIcon(opts.icon);
        if (opts.checked !== undefined && item.setChecked) item.setChecked(opts.checked);
        item.onClick(() => opts.onClick());
    });
}

/**
 * 弹出两级选择菜单。
 * 第一级：供应商列表（当前供应商置顶并勾选）；
 * 第二级：该供应商的模型列表（当前默认模型勾选）。
 * @param plugin - 插件实例
 * @param evt - 事件
 */
export function openModelSwitcherMenu(plugin: ModelSwitcherPluginLike, evt?: MouseEvent): void {
    const snapshot = resolveModelSwitcherSnapshot(plugin);
    const providers = sortProviderOptions(
        plugin.getAllProviders().map(p => ({
            id: p.id,
            name: p.name,
            endpoint: p.endpoint,
            models: Array.isArray(p.models) ? [...p.models] : [],
            sourceType: String(p.sourceType || 'cloud'),
            isPreset: !!p.isPreset,
        })),
        snapshot.providerId,
    );
    if (providers.length === 0) {
        new Notice('⚠️ 没有可用的 API 提供商，请在设置中配置', 6000);
        return;
    }

    const showModelMenu = (provider: ModelSwitcherProviderOption, anchor: MouseEvent | undefined) => {
        if (provider.models.length === 0) {
            new Notice(`⚠️「${provider.name}」没有配置模型`, 6000);
            return;
        }
        const modelMenu = new Menu() as unknown as MenuLike;
        const isCurrentProvider = provider.endpoint === snapshot.endpoint;
        for (const model of provider.models) {
            const checked = isCurrentProvider && model === snapshot.defaultModel;
            addMenuItem(modelMenu, model, {
                checked,
                icon: checked ? 'check' : undefined,
                onClick: () => { void applyModelChoice(plugin, provider, model); },
            });
        }
        if (anchor) modelMenu.showAtMouseEvent(anchor);
    };

    const providerMenu = new Menu() as unknown as MenuLike;
    for (const provider of providers) {
        const checked = provider.endpoint === snapshot.endpoint;
        const sourceIcon = provider.sourceType === 'local' ? '💻' : '☁️';
        addMenuItem(providerMenu, `${sourceIcon} ${provider.name}（${provider.models.length} 模型）`, {
            checked,
            icon: checked ? 'check' : undefined,
            onClick: () => showModelMenu(provider, evt),
        });
    }
    if (evt) providerMenu.showAtMouseEvent(evt);
}

/**
 * 在容器中装配一枚快速切换按钮。
 * 返回句柄：`refresh()` 同步文案；`destroy()` 注销刷新回调并移除按钮。
 * `button` 暴露给测试与需要二次定位的调用方。
 * @param container - 容器元素
 * @param plugin - 插件实例
  * @returns ModelQuickSwitcherHandle 实例
 */
export function renderModelQuickSwitcher(
    container: HTMLElement,
    plugin: ModelSwitcherPluginLike,
): ModelQuickSwitcherHandle {
    const button = document.createElement('button');
    button.className = 'nw-model-switch';
    button.setAttribute(
        'title',
        '切换 API 供应商与模型（两级菜单）：先选供应商，再选模型；选中的模型将用于规划与正文全部任务',
    );
    const label = document.createElement('span');
    label.className = 'nw-model-switch-label';
    button.appendChild(label);
    container.appendChild(button);

    const refresh = (): void => {
        const snapshot = resolveModelSwitcherSnapshot(plugin);
        label.textContent = formatModelSwitcherLabel(snapshot);
        button.classList.toggle('is-unconfigured', !snapshot.defaultModel);
    };
    refresh();

    button.addEventListener('click', (evt) => {
        openModelSwitcherMenu(plugin, evt);
    });

    const unregister = registerModelSwitcherRefresher(refresh);
    return {
        refresh,
        destroy: () => {
            unregister();
            button.remove();
        },
        button,
    };
}
