/**
 * onboarding-modal.ts — 首启向导
 *
 * 目标：新用户 3 分钟内完成「选提供商 → 填 Key → 连通性测试 → 示例项目 → 第一章」。
 * 所有配置写入现有 settings/providerKeys，不新增存储；引导完成写 firstRunComplete。
 */
import { App, Modal, Notice, Setting } from 'obsidian';
import type NovelWriterPlugin from '@/main';
import { testProviderConnectivity, type ApiConnectivityResult } from '@/services/api-connectivity-service';
import { importExampleProject, EXAMPLE_PROJECT_NAME } from '@/core/example-project-service';

interface OnboardingProvider {
    id: string;
    name: string;
    endpoint: string;
    models: string[];
    sourceType?: 'cloud' | 'local';
    apiFormat?: 'openai-chat' | 'anthropic-messages' | 'openai-responses';
}

const STEP_TITLES = ['选择提供商', '填写 API Key', '连通性测试', '示例项目', '开始写作'];

/**
 * 首启向导弹窗。
 */
export class OnboardingModal extends Modal {
    private readonly plugin: NovelWriterPlugin;
    private step = 0;
    private providers: OnboardingProvider[] = [];
    private providerId = '';
    private apiKey = '';
    private testResult: ApiConnectivityResult | null = null;
    private testing = false;
    private exampleReady = false;
    private bodyEl: HTMLElement | null = null;

    /**
     * @param app - Obsidian 应用实例
     * @param plugin - 插件实例
     */
    constructor(app: App, plugin: NovelWriterPlugin) {
        super(app);
        this.plugin = plugin;
    }

    /** 打开向导。 */
    onOpen(): void {
        this.modalEl.addClass('nw-scope', 'nw-modal');
        this.titleEl.setText('🚀 3 分钟开始写作');
        this.providers = this.resolveProviders();
        this.providerId = this.plugin.getCurrentProviderId()
            || this.providers.find(provider => provider.sourceType !== 'local')?.id
            || this.providers[0]?.id
            || '';
        this.contentEl.empty();
        this.contentEl.addClass('nw-onboarding');
        this.bodyEl = this.contentEl.createDiv({ cls: 'nw-onboarding-body' });
        this.render();
    }

    /** 关闭时清空。 */
    onClose(): void {
        this.contentEl.empty();
    }

    private resolveProviders(): OnboardingProvider[] {
        const all = (this.plugin.getAllProviders?.() ?? []) as OnboardingProvider[];
        return all.filter(provider => Array.isArray(provider.models) && provider.models.length > 0);
    }

    private currentProvider(): OnboardingProvider | null {
        return this.providers.find(provider => provider.id === this.providerId) ?? null;
    }

    private render(): void {
        if (!this.bodyEl) return;
        this.bodyEl.empty();
        this.renderProgress();

        if (this.step === 0) this.renderProviderStep();
        else if (this.step === 1) this.renderKeyStep();
        else if (this.step === 2) this.renderTestStep();
        else if (this.step === 3) this.renderExampleStep();
        else this.renderDoneStep();

        const footer = this.bodyEl.createDiv({ cls: 'nw-onboarding-footer' });
        const skip = footer.createEl('button', { cls: 'nw-btn nw-btn-secondary', text: '跳过引导' });
        skip.addEventListener('click', () => this.finish(false));
    }

    private renderProgress(): void {
        if (!this.bodyEl) return;
        const bar = this.bodyEl.createDiv({ cls: 'nw-onboarding-progress' });
        STEP_TITLES.forEach((title, index) => {
            const item = bar.createDiv({
                cls: `nw-onboarding-step${index === this.step ? ' nw-is-active' : ''}${index < this.step ? ' nw-is-done' : ''}`,
            });
            item.createSpan({ cls: 'nw-onboarding-step-index', text: String(index + 1) });
            item.createSpan({ text: title });
        });
    }

    private renderProviderStep(): void {
        if (!this.bodyEl) return;
        this.bodyEl.createEl('h3', { text: '选择 AI 提供商' });
        this.bodyEl.createEl('p', {
            cls: 'setting-item-description',
            text: '先用一个已配置的提供商；之后可在「设置 → API 配置」里增加自定义端点或切换协议。',
        });
        new Setting(this.bodyEl)
            .setName('提供商')
            .setDesc('只列出已有模型列表的提供商')
            .addDropdown(dropdown => {
                for (const provider of this.providers) dropdown.addOption(provider.id, provider.name);
                dropdown.setValue(this.providerId);
                dropdown.onChange(value => { this.providerId = value; this.render(); });
            });
        const provider = this.currentProvider();
        if (!provider) {
            this.bodyEl.createEl('p', { cls: 'nw-flow-error-detail', text: '没有可用提供商，请先在设置里添加一个端点。' });
            return;
        }
        const info = this.bodyEl.createDiv({ cls: 'nw-onboarding-card' });
        info.createDiv({ text: `端点：${provider.endpoint}` });
        info.createDiv({ text: `默认模型：${provider.models[0]}` });
        info.createDiv({ text: provider.sourceType === 'local' ? '本地模型，可跳过 Key' : '云端模型，需要 API Key' });
        this.nextButton('下一步', () => { this.step = 1; this.render(); });
    }

    private renderKeyStep(): void {
        if (!this.bodyEl) return;
        const provider = this.currentProvider();
        if (!provider) { this.step = 0; this.render(); return; }
        this.bodyEl.createEl('h3', { text: `填写 ${provider.name} 的 API Key` });
        this.bodyEl.createEl('p', {
            cls: 'setting-item-description',
            text: 'Key 只保存在本 vault 的插件数据中；已启用口令加密时按现有加密策略落盘。',
        });
        let inputEl: HTMLInputElement | null = null;
        new Setting(this.bodyEl)
            .setName('API key')
            .setDesc(provider.sourceType === 'local' ? '本地端点可留空' : '从提供商控制台复制')
            .addText(text => {
                inputEl = text.inputEl;
                text.inputEl.type = 'password';
                text.setPlaceholder(provider.sourceType === 'local' ? '本地模型可留空' : 'sk-...')
                    .setValue(this.apiKey)
                    .onChange(value => { this.apiKey = value.trim(); });
            });
        const actions = this.bodyEl.createDiv({ cls: 'nw-onboarding-actions' });
        const test = actions.createEl('button', { cls: 'nw-btn nw-btn-primary', text: this.testing ? '测试中…' : '保存并测试' });
        test.disabled = this.testing;
        test.addEventListener('click', () => {
            this.apiKey = inputEl?.value.trim() ?? this.apiKey;
            void this.saveAndTest();
        });
        const skip = actions.createEl('button', { cls: 'nw-btn nw-btn-secondary', text: '跳过测试' });
        skip.addEventListener('click', () => {
            this.apiKey = inputEl?.value.trim() ?? this.apiKey;
            void this.persistKey().then(() => { this.step = 3; this.render(); });
        });
        const back = actions.createEl('button', { cls: 'nw-btn nw-btn-secondary', text: '上一步' });
        back.addEventListener('click', () => { this.step = 0; this.render(); });
    }

    private renderTestStep(): void {
        if (!this.bodyEl) return;
        this.bodyEl.createEl('h3', { text: '连通性测试' });
        const result = this.testResult;
        if (!result) {
            this.bodyEl.createEl('p', { text: '尚未测试。' });
        } else {
            const card = this.bodyEl.createDiv({ cls: `nw-onboarding-result nw-is-${result.level}` });
            card.createDiv({ text: `${result.level === 'ok' ? '✅' : result.level === 'warn' ? '⚠️' : '❌'} ${result.message}` });
            card.createDiv({ cls: 'nw-onboarding-result-meta', text: `${result.model} · ${result.latencyMs}ms` });
        }
        const actions = this.bodyEl.createDiv({ cls: 'nw-onboarding-actions' });
        if (result && result.level !== 'error') {
            const next = actions.createEl('button', { cls: 'nw-btn nw-btn-primary', text: '下一步' });
            next.addEventListener('click', () => { this.step = 3; this.render(); });
        }
        const back = actions.createEl('button', { cls: 'nw-btn nw-btn-secondary', text: '返回修改' });
        back.addEventListener('click', () => { this.step = 1; this.render(); });
        if (result && result.level === 'error') {
            const retry = actions.createEl('button', { cls: 'nw-btn nw-btn-primary', text: '重新测试' });
            retry.addEventListener('click', () => { void this.saveAndTest(); });
        }
    }

    private renderExampleStep(): void {
        if (!this.bodyEl) return;
        this.bodyEl.createEl('h3', { text: '创建一个示例项目' });
        this.bodyEl.createEl('p', {
            cls: 'setting-item-description',
            text: '示例项目包含 1 卷 3 章、1 个人物和 1 条伏笔，用来熟悉流程；随时可删除。',
        });
        const actions = this.bodyEl.createDiv({ cls: 'nw-onboarding-actions' });
        if (this.exampleReady) {
            this.bodyEl.createEl('p', { text: `✅ 已准备：${EXAMPLE_PROJECT_NAME}` });
            const next = actions.createEl('button', { cls: 'nw-btn nw-btn-primary', text: '下一步' });
            next.addEventListener('click', () => { this.step = 4; this.render(); });
        } else {
            const create = actions.createEl('button', { cls: 'nw-btn nw-btn-primary', text: '导入示例项目' });
            create.addEventListener('click', () => {
                void importExampleProject(this.app).then(result => {
                    this.exampleReady = true;
                    new Notice(result.created ? '✅ 示例项目已创建' : '示例项目已存在，直接使用');
                    this.render();
                }).catch(error => {
                    new Notice(`导入示例失败：${error instanceof Error ? error.message : String(error)}`, 8000);
                });
            });
        }
        const skip = actions.createEl('button', { cls: 'nw-btn nw-btn-secondary', text: '跳过示例' });
        skip.addEventListener('click', () => { this.step = 4; this.render(); });
        const back = actions.createEl('button', { cls: 'nw-btn nw-btn-secondary', text: '上一步' });
        back.addEventListener('click', () => { this.step = 2; this.render(); });
    }

    private renderDoneStep(): void {
        if (!this.bodyEl) return;
        this.bodyEl.createEl('h3', { text: '可以开始了' });
        this.bodyEl.createEl('p', {
            cls: 'setting-item-description',
            text: '创作主页会显示三个模式、最近项目和下一步建议；长任务都在任务中心里。',
        });
        const actions = this.bodyEl.createDiv({ cls: 'nw-onboarding-actions' });
        const home = actions.createEl('button', { cls: 'nw-btn nw-btn-primary', text: '进入创作主页' });
        home.addEventListener('click', () => { this.finish(true, 'home'); });
        const flow = actions.createEl('button', { cls: 'nw-btn nw-btn-secondary', text: '打开示例项目' });
        flow.disabled = !this.exampleReady;
        flow.addEventListener('click', () => { this.finish(true, 'flow'); });
        const writer = actions.createEl('button', { cls: 'nw-btn nw-btn-secondary', text: '完整写作工作台' });
        writer.addEventListener('click', () => { this.finish(true, 'writer'); });
    }

    private nextButton(label: string, onClick: () => void): void {
        if (!this.bodyEl) return;
        const actions = this.bodyEl.createDiv({ cls: 'nw-onboarding-actions' });
        const button = actions.createEl('button', { cls: 'nw-btn nw-btn-primary', text: label });
        button.addEventListener('click', onClick);
    }

    private async persistKey(): Promise<void> {
        const provider = this.currentProvider();
        if (!provider) return;
        if (!this.apiKey && provider.sourceType !== 'local') {
            new Notice('请先填写 API key');
            throw new Error('missing key');
        }
        this.plugin.settings.providerKeys = this.plugin.settings.providerKeys || {};
        if (this.apiKey) this.plugin.settings.providerKeys[provider.id] = this.apiKey;
        this.plugin.switchProviderByEndpoint(provider.endpoint);
        await this.plugin.saveSettings();
    }

    private async saveAndTest(): Promise<void> {
        if (this.testing) return;
        const provider = this.currentProvider();
        if (!provider) return;
        this.testing = true;
        this.render();
        try {
            await this.persistKey();
            const result = await testProviderConnectivity({
                providerName: provider.name,
                endpoint: provider.endpoint,
                apiKey: this.apiKey || undefined,
                model: provider.models[0],
                sourceType: provider.sourceType,
                apiFormat: provider.apiFormat,
            });
            this.testResult = result;
            this.step = 2;
            this.render();
        } catch (error) {
            if (error instanceof Error && error.message === 'missing key') {
                // persistKey 已经给出提示
            } else {
                new Notice(`保存 Key 失败：${error instanceof Error ? error.message : String(error)}`, 8000);
            }
            this.testing = false;
            this.render();
        } finally {
            this.testing = false;
        }
    }

    private finish(markComplete: boolean, target?: 'home' | 'flow' | 'writer'): void {
        if (markComplete) {
            this.plugin.settings.firstRunComplete = true;
            void this.plugin.saveSettings();
        }
        this.close();
        if (target === 'home') void this.plugin.openHomeView();
        else if (target === 'flow') void this.plugin.openCreationFlow(this.exampleReady ? EXAMPLE_PROJECT_NAME : undefined);
        else if (target === 'writer') void this.plugin.openFullWriterHome();
    }
}
