/**
 * model-editor-modal.ts — 模型编辑弹窗
 *
 * 背景（2026-11-16）：窄面板（设置区常 300–400px）里行内编辑模型会把
 * 模型 ID 挤成竖排单字，用户明确要求改为弹窗。这个弹窗承载：
 * 模型 ID / 上下文窗口 / 输出上限 / 单价与币种 / 是否支持图片输入。
 */
import { App, Modal, Notice, Setting } from 'obsidian';

/** 模型编辑结果（全部可选，空值不写入） */
export interface ModelEditorValue {
    /** 请求时使用的模型 ID */
    id: string;
    /** 上下文窗口（tokens） */
    contextWindow?: number;
    /** 输出上限（tokens） */
    maxTokens?: number;
    /** 输入单价（每百万 tokens） */
    inputPricePerM?: number;
    /** 输出单价（每百万 tokens） */
    outputPricePerM?: number;
    /** 单价币种：端点识别多为美元，手填默认人民币 */
    priceCurrency?: 'USD' | 'CNY';
    /** 是否支持图片输入 */
    vision?: boolean;
}

/**
 * 模型编辑弹窗。
 */
export class ModelEditorModal extends Modal {
    private draft: ModelEditorValue;

    constructor(
        app: App,
        private readonly title: string,
        initial: ModelEditorValue,
        private readonly onSave: (value: ModelEditorValue) => void,
    ) {
        super(app);
        this.draft = { ...initial };
    }

    /**
     * onOpen 方法。
     */
    onOpen(): void {
        this.modalEl.addClass('nw-scope');
        this.modalEl.addClass('nw-model-editor-modal');
        this.render();
    }

    private render(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h3', { text: this.title });
        contentEl.createDiv({
            cls: 'nw-text-12-muted',
            text: '留空的数值会回退到端点识别值或内置能力表；单价留空表示不参与费用估算。',
        });

        new Setting(contentEl)
            .setName('模型 ID')
            .setDesc('请求时使用的标识，保存后同步到模型列表')
            .addText(text => text
                .setValue(this.draft.id)
                .setPlaceholder('deepseek-v4.1-flash')
                .onChange(value => { this.draft.id = value.trim(); }));

        new Setting(contentEl)
            .setName('上下文窗口（tokens）')
            .setDesc('留空按端点识别 / 内置能力表推断')
            .addText(text => text
                .setValue(this.draft.contextWindow ? String(this.draft.contextWindow) : '')
                .setPlaceholder('1000000')
                .onChange(value => { this.draft.contextWindow = this.toPositiveInt(value); }));

        new Setting(contentEl)
            .setName('输出上限（tokens）')
            .setDesc('留空按端点识别 / 内置能力表推断')
            .addText(text => text
                .setValue(this.draft.maxTokens ? String(this.draft.maxTokens) : '')
                .setPlaceholder('384000')
                .onChange(value => { this.draft.maxTokens = this.toPositiveInt(value); }));

        new Setting(contentEl)
            .setName('输入单价（每百万 tokens）')
            .setDesc('用于 AI 用量账本估算')
            .addText(text => text
                .setValue(this.draft.inputPricePerM ? String(this.draft.inputPricePerM) : '')
                .setPlaceholder('0.15')
                .onChange(value => { this.draft.inputPricePerM = this.toPositiveNumber(value); }));

        new Setting(contentEl)
            .setName('输出单价（每百万 tokens）')
            .setDesc('用于 AI 用量账本估算')
            .addText(text => text
                .setValue(this.draft.outputPricePerM ? String(this.draft.outputPricePerM) : '')
                .setPlaceholder('0.6')
                .onChange(value => { this.draft.outputPricePerM = this.toPositiveNumber(value); }));

        new Setting(contentEl)
            .setName('单价币种')
            .setDesc('端点自动识别给的是美元；手填默认人民币（记账按汇率折算）')
            .addDropdown(dropdown => {
                dropdown.addOption('CNY', '人民币（元）');
                dropdown.addOption('USD', '美元（$）');
                dropdown.setValue(this.draft.priceCurrency === 'USD' ? 'USD' : 'CNY');
                dropdown.onChange(value => { this.draft.priceCurrency = value === 'USD' ? 'USD' : 'CNY'; });
            });

        new Setting(contentEl)
            .setName('支持图片输入')
            .setDesc('开启后模型列表显示「视觉」标记')
            .addToggle(toggle => toggle
                .setValue(this.draft.vision === true)
                .onChange(value => { this.draft.vision = value; }));

        const footer = contentEl.createDiv({ cls: 'nw-model-editor-footer' });
        const cancel = footer.createEl('button', { text: '取消', attr: { type: 'button' } });
        cancel.addEventListener('click', () => this.close());
        const save = footer.createEl('button', { text: '保存', cls: 'mod-cta', attr: { type: 'button' } });
        save.addEventListener('click', () => {
            if (!this.draft.id.trim()) {
                new Notice('请输入模型 ID');
                return;
            }
            this.onSave({ ...this.draft, id: this.draft.id.trim() });
            this.close();
        });
    }

    private toPositiveInt(value: string): number | undefined {
        const n = parseInt(value, 10);
        return Number.isFinite(n) && n > 0 ? n : undefined;
    }

    private toPositiveNumber(value: string): number | undefined {
        const n = parseFloat(value);
        return Number.isFinite(n) && n > 0 ? n : undefined;
    }

    /**
     * onClose 方法。
     */
    onClose(): void {
        this.contentEl.empty();
    }
}
