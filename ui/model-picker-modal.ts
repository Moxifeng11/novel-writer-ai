/**
 * model-picker-modal.ts — 「从 URL 获取模型」的候选勾选弹窗
 *
 * 参照 dsh `ModelListEditor` 的 fetch 交互：
 *   - 已配置的模型默认勾选，新候选默认勾选（空列表时全选）；
 *   - 支持搜索过滤、全选/全不选（只作用于可见项）；
 *   - 确认时「保留已配置但列表里没有的」+「加入新勾选的」，
 *     并移除用户主动取消勾选的已配置模型；
 *   - 不允许把列表清空（空列表会让上游回退到端点默认行为）。
 */
import { App, Modal, Setting } from 'obsidian';
import type { DiscoveredModel } from '@/services/model-discovery';

/**
 * ModelPickerResult 类型定义。
 */
export interface ModelPickerResult {
    /** 确认后的模型 id 列表（保持原有顺序，新项追加在后） */
    models: string[];
    /** 端点披露的能力，供调用方回填默认值（上下文/输出/视觉/单价） */
    capacities: Array<{
        id: string;
        contextWindow?: number;
        maxTokens?: number;
        vision?: boolean;
        inputPricePerM?: number;
        outputPricePerM?: number;
        priceCurrency?: 'USD' | 'CNY';
    }>;
}

/**
 * 候选默认勾选规则（纯函数，便于单测）。
 *
 * @param candidates - 端点返回的候选模型
 * @param configured - 当前已配置的模型
 * @param id - 候选模型 id
 * @returns 默认是否勾选
 * @example
 * isPickedByDefault([{ id: 'a' }], [], 'a');        // true（首次导入全选）
 * isPickedByDefault([{ id: 'a' }], ['b'], 'a');     // true（完全不重合→全选）
 * isPickedByDefault([{ id: 'a' }], ['a'], 'a');     // true（只勾已配置）
 */
export function isPickedByDefault(
    candidates: DiscoveredModel[],
    configured: string[],
    id: string,
): boolean {
    if (configured.length === 0) return true;
    const listed = new Set(candidates.map(model => model.id));
    const overlapping = configured.filter(configuredId => listed.has(configuredId));
    if (overlapping.length === 0) return true;
    return configured.includes(id);
}

/**
 * 计算「确认勾选」后的模型列表与能力回填数据。
 *
 * 规则：端点没列出的已配置模型原样保留；列出的按勾选状态增删；
 * 结果为空时不允许确认（空列表会让上游回退到端点默认行为）。
 *
 * @param candidates - 端点返回的候选模型
 * @param configured - 当前已配置的模型
 * @param isPicked - 勾选判定（由弹窗根据用户翻转状态提供）
 * @returns 确认结果（允许空列表：用户取消全部勾选时就是清空）
 * @example
 * buildPickerResult([{ id: 'a' }], [], () => true).models; // ['a']
 * buildPickerResult([{ id: 'a' }], [], () => false).models; // []
 */
export function buildPickerResult(
    candidates: DiscoveredModel[],
    configured: string[],
    isPicked: (id: string) => boolean,
): ModelPickerResult {
    const listed = new Set(candidates.map(model => model.id));
    const kept = configured.filter(id => !listed.has(id) || isPicked(id));
    const keptSet = new Set(kept);
    const added = candidates
        .filter(model => isPicked(model.id) && !keptSet.has(model.id))
        .map(model => model.id);
    // 允许清空：用户取消勾选哪些，列表里就不该再出现哪些（旧实现强制「至少保留一个」，
    // 于是「全部取消」后下方列表仍是全部模型，与勾选结果不一致）。
    const models = [...kept, ...added];

    const capacities = candidates
        .filter(model => keptSet.has(model.id) || added.includes(model.id))
        .filter(model => model.contextWindow !== undefined
            || model.maxTokens !== undefined
            || model.vision !== undefined
            || model.pricing !== undefined)
        .map(model => ({
            id: model.id,
            ...(model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow }),
            ...(model.maxTokens === undefined ? {} : { maxTokens: model.maxTokens }),
            ...(model.vision === undefined ? {} : { vision: model.vision }),
            ...(model.pricing?.inputPerM === undefined ? {} : { inputPricePerM: model.pricing.inputPerM }),
            ...(model.pricing?.outputPerM === undefined ? {} : { outputPricePerM: model.pricing.outputPerM }),
            ...(model.pricing === undefined ? {} : { priceCurrency: model.pricing.currency }),
        }));
    return { models, capacities };
}

/**
 * ModelPickerModal 类。
 */
export class ModelPickerModal extends Modal {
    private readonly candidates: DiscoveredModel[];
    private readonly configured: string[];
    private readonly onConfirm: (result: ModelPickerResult) => void;
    /** 用户相对默认状态翻转过的 id */
    private flipped = new Set<string>();
    private query = '';
    private listEl: HTMLElement | null = null;
    private searchInput: HTMLInputElement | null = null;
    private selectAllBtn: HTMLButtonElement | null = null;
    private confirmBtn: HTMLButtonElement | null = null;

    constructor(
        app: App,
        candidates: DiscoveredModel[],
        configured: string[],
        onConfirm: (result: ModelPickerResult) => void,
    ) {
        super(app);
        this.candidates = candidates;
        this.configured = configured;
        this.onConfirm = onConfirm;
    }

    /**
     * onOpen 方法。
     */
    onOpen(): void {
        this.modalEl.addClass('nw-scope');
        this.modalEl.addClass('nw-model-fetch-modal');
        this.render();
    }

    /**
     * 默认勾选规则。
     *
     * - 没有已配置模型 → 全选（首次导入）；
     * - 已配置模型**与本次候选完全不重合**（渠道换了 / 之前是空列表）→ 也全选，
     *   否则弹窗里一个都不勾，点「应用」等于什么都没导入，用户看到的是「获取成功但没效果」；
     * - 有重合 → 只勾已配置的，新候选留给用户手动勾。
     *
     * @param id - 候选模型 id
     * @returns 默认是否勾选
     */
    private pickedByDefault(id: string): boolean {
        return isPickedByDefault(this.candidates, this.configured, id);
    }

    private isPicked(id: string): boolean {
        return this.pickedByDefault(id) !== this.flipped.has(id);
    }

    private toggle(id: string): void {
        if (this.flipped.has(id)) this.flipped.delete(id);
        else this.flipped.add(id);
        this.refreshRows();
    }

    private visibleCandidates(): DiscoveredModel[] {
        const q = this.query.trim().toLowerCase();
        if (!q) return this.candidates;
        return this.candidates.filter(model =>
            model.id.toLowerCase().includes(q) || (model.name ?? '').toLowerCase().includes(q));
    }

    private toggleVisible(): void {
        const visible = this.visibleCandidates();
        if (visible.length === 0) return;
        const allPicked = visible.every(model => this.isPicked(model.id));
        for (const model of visible) {
            const want = !allPicked;
            const baseline = this.pickedByDefault(model.id);
            if (baseline === want) this.flipped.delete(model.id);
            else this.flipped.add(model.id);
        }
        this.refreshRows();
    }

    private confirm(): void {
        const result = buildPickerResult(this.candidates, this.configured, id => this.isPicked(id));
        // 空结果是合法选择（用户想清空该渠道模型列表），由调用方决定是否提示
        this.onConfirm(result);
        this.close();
    }

    private refreshRows(): void {
        if (!this.listEl) return;
        const visible = this.visibleCandidates();
        this.listEl.empty();
        if (visible.length === 0) {
            this.listEl.createDiv({ cls: 'nw-model-fetch-empty', text: '没有匹配的模型' });
        }
        for (const model of visible) {
            const row = this.listEl.createEl('label', { cls: 'nw-model-fetch-row' });
            const checkbox = row.createEl('input', { type: 'checkbox' });
            checkbox.checked = this.isPicked(model.id);
            checkbox.addEventListener('change', () => this.toggle(model.id));
            const nameEl = row.createDiv({ cls: 'nw-model-fetch-name' });
            nameEl.createSpan({ cls: 'nw-model-fetch-id', text: model.id });
            if (model.name && model.name !== model.id) {
                nameEl.createSpan({ cls: 'nw-model-fetch-alias', text: model.name });
            }
            if (model.contextWindow) {
                const k = Math.round(model.contextWindow / 1000);
                row.createSpan({ cls: 'nw-model-fetch-meta', text: `${k}K` });
            }
            if (model.vision) {
                row.createSpan({ cls: 'nw-model-fetch-meta', text: '视觉' });
            }
            if (model.pricing && model.pricing.inputPerM !== undefined) {
                const symbol = model.pricing.currency === 'USD' ? '$' : '¥';
                row.createSpan({
                    cls: 'nw-model-fetch-meta',
                    text: `${symbol}${model.pricing.inputPerM}/${symbol}${model.pricing.outputPerM ?? 0}`,
                });
            }
            if (this.configured.includes(model.id)) {
                row.createSpan({ cls: 'nw-model-fetch-tag', text: '已配置' });
            }
        }
        if (this.selectAllBtn) {
            const allPicked = visible.length > 0 && visible.every(model => this.isPicked(model.id));
            this.selectAllBtn.setText(allPicked ? '全部取消' : '全选');
        }
    }

    private render(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h3', { text: '从端点获取到的模型' });
        contentEl.createDiv({
            cls: 'nw-model-fetch-desc',
            text: `共 ${this.candidates.length} 个。勾选要启用的模型；已配置但本次未列出的会原样保留。`,
        });

        const toolbar = contentEl.createDiv({ cls: 'nw-model-fetch-toolbar' });
        this.searchInput = toolbar.createEl('input', {
            type: 'search',
            cls: 'nw-model-fetch-search',
            attr: { placeholder: '搜索模型名…' },
        });
        this.searchInput.addEventListener('input', () => {
            this.query = this.searchInput?.value ?? '';
            this.refreshRows();
        });
        this.selectAllBtn = toolbar.createEl('button', { text: '全选', attr: { type: 'button' } });
        this.selectAllBtn.addEventListener('click', () => this.toggleVisible());

        this.listEl = contentEl.createDiv({ cls: 'nw-model-fetch-list' });
        this.refreshRows();

        const footer = contentEl.createDiv({ cls: 'nw-model-fetch-footer' });
        const cancel = footer.createEl('button', { text: '取消', attr: { type: 'button' } });
        cancel.addEventListener('click', () => this.close());
        this.confirmBtn = footer.createEl('button', {
            text: '✅ 应用选择',
            cls: 'mod-cta',
            attr: { type: 'button' },
        });
        this.confirmBtn.addEventListener('click', () => this.confirm());
    }

    /**
     * onClose 方法。
     */
    onClose(): void {
        this.contentEl.empty();
    }
}

void Setting;
