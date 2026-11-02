/**
 * model-picker-popover.ts — 输入框模型选择弹层（参考 dsh ModelSelect 两级钻取）
 *
 * 根面板：当前供应商头（名称 + 来源标签 + › 钻取）→「模型」分组（当前供应商模型，
 * 当前项勾选）→「思考强度」四档滑杆。
 * 供应商面板：全部供应商（☁️API / 💻本地 标签，当前项勾选）+「管理模型」入口。
 *
 * 纯 DOM 弹层（原生 Menu 不支持滑杆与分组头），锚定在触发按钮上方，Escape /
 * 点击外部关闭。选模型复用 model-quick-switcher 的 applyModelChoice。
 */
import { Notice } from 'obsidian';
import type NovelWriterPlugin from '../main';
import { ManageProvidersModal } from './manage-providers-modal';
import { applyModelChoice, formatModelSwitcherLabel, resolveProviderDisplayName, type ModelSwitcherPluginLike } from './model-quick-switcher';
import { nearestThinkingLevel, THINKING_LEVELS, clampThinkingIntensity, thinkingLevelSpec } from '../shared/task-model';

export interface ModelPickerHandle {
    close: () => void;
}

interface PickerProvider {
    id: string;
    name: string;
    endpoint: string;
    models: string[];
    sourceType: string;
    isPreset: boolean;
}

/** 弹层根容器 class；外部点击检测用 */
const POPOVER_CLASS = 'nw-model-picker';

export function openModelPickerPopover(
    anchor: HTMLElement,
    plugin: NovelWriterPlugin,
    onApplied?: () => void,
): ModelPickerHandle {
    closeExistingPopovers();

    const root = document.body.createDiv({ cls: POPOVER_CLASS });
    let pane: 'root' | 'providers' = 'root';
    let closed = false;

    const close = (): void => {
        if (closed) return;
        closed = true;
        root.remove();
        activeClosers.delete(close);
        document.removeEventListener('mousedown', onOutside, true);
        document.removeEventListener('keydown', onKeydown, true);
    };
    activeClosers.add(close);

    const onOutside = (event: MouseEvent): void => {
        const target = event.target as Node;
        if (root.contains(target) || anchor.contains(target)) return;
        close();
    };

    const onKeydown = (event: KeyboardEvent): void => {
        if (event.key === 'Escape') {
            event.stopPropagation();
            close();
        }
    };

    // 定位：锚点上方右对齐（输入框在底部，弹层向上展开）
    const position = (): void => {
        const rect = anchor.getBoundingClientRect();
        root.style.visibility = 'hidden';
        root.classList.remove('nw-model-picker-hidden');
        requestAnimationFrame(() => {
            const height = root.offsetHeight;
            const width = root.offsetWidth;
            let top = rect.top - height - 8;
            if (top < 8) top = Math.min(rect.bottom + 8, window.innerHeight - height - 8);
            let left = rect.right - width;
            if (left < 8) left = 8;
            if (left + width > window.innerWidth - 8) left = window.innerWidth - width - 8;
            root.style.top = `${top}px`;
            root.style.left = `${left}px`;
            root.style.visibility = '';
        });
    };

    const render = (): void => {
        root.empty();
        const settings = plugin.settings;
        const currentProviderId = plugin.getCurrentProviderId();
        const providers: PickerProvider[] = plugin.getAllProviders().map(p => ({
            id: p.id,
            name: p.name,
            endpoint: p.endpoint,
            models: Array.isArray(p.models) ? [...p.models] : [],
            sourceType: String(p.sourceType || 'cloud'),
            isPreset: !!p.isPreset,
        }));
        const current = providers.find(p => p.endpoint === settings.apiEndpoint)
            || providers.find(p => p.id === currentProviderId)
            || providers[0];

        if (pane === 'providers') {
            renderProviderPane(root, plugin, providers, current, {
                onBack: () => { pane = 'root'; render(); },
                onPick: async (provider) => {
                    if (provider.endpoint === settings.apiEndpoint) {
                        pane = 'root';
                        render();
                        return;
                    }
                    const model = provider.models[0];
                    if (!model) {
                        new Notice(`「${provider.name}」没有配置模型`, 4000);
                        return;
                    }
                    await applyModelChoice(plugin as unknown as ModelSwitcherPluginLike, provider, model);
                    onApplied?.();
                    pane = 'root';
                    render();
                },
                onManage: () => {
                    close();
                    const manageModal = new ManageProvidersModal(plugin.app, plugin as never, () => onApplied?.());
                    manageModal.open();
                },
            });
        } else {
            renderRootPane(root, plugin, current, providers, {
                onDrillProviders: () => { pane = 'providers'; render(); },
                onPickModel: async (model) => {
                    if (!current || model === settings.defaultModel) {
                        close();
                        return;
                    }
                    await applyModelChoice(plugin as unknown as ModelSwitcherPluginLike, current, model);
                    onApplied?.();
                    close();
                },
                onIntensity: (value) => {
                    settings.thinkingIntensity = clampThinkingIntensity(value);
                    settings.thinkingLevel = nearestThinkingIntensityLevel(settings.thinkingIntensity);
                    void plugin.saveSettings();
                },
            });
        }
        position();
    };

    document.addEventListener('mousedown', onOutside, true);
    document.addEventListener('keydown', onKeydown, true);
    render();

    return { close };
}

/** 已打开弹层的关闭句柄：必须走 close() 才能解绑两个 document 监听 */
const activeClosers = new Set<() => void>();

/** 关闭页面上所有已打开的模型选择弹层 */
export function closeExistingPopovers(): void {
    for (const close of Array.from(activeClosers)) {
        close();
    }
    activeClosers.clear();
    // 兜底：父容器被外部移除等异常路径下残留的 DOM 节点
    document.querySelectorAll(`.${POPOVER_CLASS}`).forEach(el => el.remove());
}

function nearestThinkingIntensityLevel(intensity: number) {
    return nearestThinkingLevel(clampThinkingIntensity(intensity));
}

// ─── 根面板 ────────────────────────────────────────────────

function renderRootPane(
    root: HTMLElement,
    plugin: NovelWriterPlugin,
    current: PickerProvider | undefined,
    providers: PickerProvider[],
    actions: {
        onDrillProviders: () => void;
        onPickModel: (model: string) => void | Promise<void>;
        onIntensity: (value: number) => void;
    },
): void {
    const settings = plugin.settings;
    const providerName = current ? current.name : resolveProviderDisplayName(plugin as unknown as ModelSwitcherPluginLike, plugin.getCurrentProviderId());
    const sourceTag = current?.sourceType === 'local' ? '本地' : 'API';

    // 供应商头（钻取）
    const header = root.createDiv({ cls: 'nw-model-picker-provider' });
    header.createSpan({ cls: 'nw-model-picker-provider-name', text: providerName });
    header.createSpan({ cls: 'nw-model-picker-tag', text: sourceTag });
    header.createSpan({ cls: 'nw-model-picker-chevron', text: '›' });
    header.setAttr('title', '点击切换 API 供应商');
    header.addEventListener('click', () => actions.onDrillProviders());

    // 模型分组
    root.createDiv({ cls: 'nw-model-picker-section', text: '模型' });
    const models = current?.models || [];
    if (models.length === 0) {
        root.createDiv({ cls: 'nw-model-picker-empty', text: '当前供应商没有配置模型' });
    }
    for (const model of models) {
        const row = root.createDiv({ cls: 'nw-model-picker-row' + (model === settings.defaultModel ? ' is-active' : '') });
        row.createSpan({ cls: 'nw-model-picker-row-label', text: model });
        if (model === settings.defaultModel) row.createSpan({ cls: 'nw-model-picker-check', text: '✓' });
        row.addEventListener('click', () => { void actions.onPickModel(model); });
    }

    // 思考强度分组
    root.createDiv({ cls: 'nw-model-picker-section', text: '思考强度' });
    const intensity = clampThinkingIntensity(settings.thinkingIntensity ?? 35);
    const spec = thinkingLevelSpec(nearestThinkingIntensityLevel(intensity));
    const intensityRow = root.createDiv({ cls: 'nw-model-picker-intensity' });
    intensityRow.createSpan({ cls: 'nw-model-picker-intensity-label', text: spec.label });
    const slider = intensityRow.createEl('input', {
        type: 'range',
        cls: 'nw-model-picker-slider',
        attr: { min: '0', max: '100', step: '5', title: THINKING_LEVELS.map(level => `${level.label} ${level.percent}%`).join(' / ') },
    });
    slider.value = String(intensity);
    const labelEl = intensityRow.querySelector('.nw-model-picker-intensity-label') as HTMLElement;
    slider.addEventListener('input', () => {
        const value = clampThinkingIntensity(Number(slider.value));
        actions.onIntensity(value);
        labelEl.setText(thinkingLevelSpec(nearestThinkingIntensityLevel(value)).label);
    });

    void providers;
}

// ─── 供应商面板 ────────────────────────────────────────────

function renderProviderPane(
    root: HTMLElement,
    plugin: NovelWriterPlugin,
    providers: PickerProvider[],
    current: PickerProvider | undefined,
    actions: {
        onBack: () => void;
        onPick: (provider: PickerProvider) => void | Promise<void>;
        onManage: () => void;
    },
): void {
    const back = root.createDiv({ cls: 'nw-model-picker-back' });
    back.createSpan({ cls: 'nw-model-picker-back-arrow', text: '‹' });
    back.createSpan({ text: 'API 供应商' });
    back.addEventListener('click', () => actions.onBack());

    for (const provider of providers) {
        const isActive = provider.endpoint === plugin.settings.apiEndpoint;
        const row = root.createDiv({ cls: 'nw-model-picker-row' + (isActive ? ' is-active' : '') });
        row.createSpan({
            cls: 'nw-model-picker-row-label',
            text: `${provider.sourceType === 'local' ? '💻' : '☁️'} ${provider.name}`,
        });
        row.createSpan({ cls: 'nw-model-picker-tag', text: provider.sourceType === 'local' ? '本地' : 'API' });
        if (isActive) row.createSpan({ cls: 'nw-model-picker-check', text: '✓' });
        row.setAttr('title', `${provider.name} · ${provider.models.length} 个模型`);
        row.addEventListener('click', () => { void actions.onPick(provider); });
    }

    const manage = root.createDiv({ cls: 'nw-model-picker-manage' });
    manage.createSpan({ text: '⚙️ 管理模型' });
    manage.addEventListener('click', () => actions.onManage());
}

/**
 * 触发按钮文案（工作台输入框徽章用）
 *
 * @param plugin - 插件实例
 * @returns 文本结果
 */
export function formatWorkbenchModelBadge(plugin: NovelWriterPlugin): string {
    const settings = plugin.settings;
    const providerName = resolveProviderDisplayName(plugin as unknown as ModelSwitcherPluginLike, plugin.getCurrentProviderId());
    const spec = thinkingLevelSpec(nearestThinkingIntensityLevel(clampThinkingIntensity(settings.thinkingIntensity ?? 35)));
    return `${providerName} · ${settings.defaultModel || '未配置'} · ${spec.label}`;
}
