import { App, Modal, Notice, TFile } from 'obsidian';
import NovelWriterPlugin from '../main';
import { AIEngine } from '../engine/ai-engine';
import { ensureWritingStyleFolder, findWritingStyleFile, getWritingStyleBackupPath, getWritingStyleWritePath } from './writing-style-paths';
import { OperationConfirmModal } from './components/progress/operation-confirm-modal';
import { LoadingOverlayComponent } from './components/progress/loading-overlay';
import { ProgressEmitter } from '../shared/progress-emitter';
import {
    analyzeStyleFromSource,
    StyleDistillInput,
    StyleSourceMode,
} from '../engine/style/style-distill-service';

const DISTILL_STEPS = [
    '读取样本与预处理',
    'AI 风格分析',
    '生成报告与保存结果',
];

export class StyleDistillerModal extends Modal {
    private plugin: NovelWriterPlugin;
    private aiEngine: AIEngine;

    private distillButton!: HTMLButtonElement;
    private loadingOverlay?: LoadingOverlayComponent;
    private progressEmitter?: ProgressEmitter;
    private isAnalyzing = false;
    private currentLabel = '';
    private analyzeInput: StyleDistillInput | null = null;
    private sourceMode: StyleSourceMode = 'name';
    private sampleText = '';
    private nameText = '';
    private selectedProjectPath = '';

    constructor(app: App, plugin: NovelWriterPlugin) {
        super(app);
        this.plugin = plugin;
        this.aiEngine = plugin.aiEngine;
    }

    onOpen(): void {
        this.modalEl.addClass('nw-scope');
        const { contentEl } = this;

        const wrapper = contentEl.parentElement as HTMLElement;
        if (wrapper) {
            wrapper.addClass('nw-modal');
            wrapper.style.setProperty('margin', 'auto', 'important');
        }
        contentEl.style.width = '100%';
        contentEl.style.setProperty('overflow-y', 'auto', 'important');
        contentEl.style.position = 'relative';

        contentEl.empty();
        contentEl.addClass('nw-form-stack');
        contentEl.createEl('h2', { text: '🎨 文笔风格蒸馏' });
        contentEl.createEl('p', {
            text: '优先用真实样本文本分析；只给书名时，结果会明确标注为“模型记忆推测”。',
            cls: 'setting-item-description',
        });

        const modeRow = contentEl.createDiv({ cls: 'nw-flex-row-sm' });
        modeRow.createSpan({ text: '分析来源：' });
        const modeSelect = modeRow.createEl('select', { cls: 'nw-select' });
        modeSelect.createEl('option', { value: 'name', text: '书名（模型记忆，可能不准确）' });
        modeSelect.createEl('option', { value: 'paste', text: '粘贴样本文本（推荐）' });
        modeSelect.createEl('option', { value: 'project', text: '当前项目章节' });
        modeSelect.createEl('option', { value: 'file', text: '当前打开的文件' });
        modeSelect.value = this.sourceMode;

        const nameRow = contentEl.createDiv({ cls: 'nw-flex-row-sm' });
        nameRow.createSpan({ text: '作品名：' });
        const nameInput = nameRow.createEl('input', {
            type: 'text',
            cls: 'nw-input',
            attr: { placeholder: '如「斩神·三九音域」' },
        });
        nameInput.value = this.nameText;
        nameInput.oninput = () => { this.nameText = nameInput.value; };

        const sampleArea = contentEl.createEl('textarea', { cls: 'nw-textarea nw-u-minh-150px' });
        sampleArea.rows = 10;
        sampleArea.placeholder = '粘贴 1000-5000 字真实原文。样本越完整，句式/对话/描写比例越可靠。';
        sampleArea.value = this.sampleText;
        sampleArea.oninput = () => { this.sampleText = sampleArea.value; };

        const projectRow = contentEl.createDiv({ cls: 'nw-flex-row-sm' });
        projectRow.createSpan({ text: '项目章节：' });
        const chapterSelect = projectRow.createEl('select', { cls: 'nw-select' });
        const fileInfo = contentEl.createEl('p', { cls: 'setting-item-description' });

        const refreshProjectChapters = () => {
            chapterSelect.empty();
            const project = this.plugin.getActiveProject();
            if (!project) {
                chapterSelect.createEl('option', { value: '', text: '未检测到当前项目' });
                return;
            }
            const prefix = `${project}/03-大纲与章节/正文`;
            const files = this.app.vault.getFiles()
                .filter(file => file.path.startsWith(prefix) && file.extension === 'md')
                .sort((a, b) => a.path.localeCompare(b.path, 'zh-Hans-CN'));
            if (files.length === 0) {
                chapterSelect.createEl('option', { value: '', text: '当前项目没有可用章节' });
                return;
            }
            for (const file of files) {
                chapterSelect.createEl('option', { value: file.path, text: file.basename });
            }
            this.selectedProjectPath = this.selectedProjectPath || files[0].path;
            chapterSelect.value = this.selectedProjectPath;
        };
        chapterSelect.onchange = () => { this.selectedProjectPath = chapterSelect.value; };

        const updateMode = () => {
            this.sourceMode = modeSelect.value as StyleSourceMode;
            nameRow.hidden = this.sourceMode !== 'name';
            sampleArea.hidden = this.sourceMode !== 'paste';
            projectRow.hidden = this.sourceMode !== 'project';
            fileInfo.hidden = this.sourceMode !== 'file';
            if (this.sourceMode === 'project') refreshProjectChapters();
            if (this.sourceMode === 'file') {
                const active = this.app.workspace.getActiveFile();
                fileInfo.setText(active ? `当前文件：${active.path}` : '当前没有打开的 Markdown 文件');
            }
        };
        modeSelect.onchange = updateMode;
        updateMode();

        this.distillButton = contentEl.createEl('button', { text: '开始分析', cls: 'nw-btn nw-btn-primary novel-writer-primary-button' });
        this.distillButton.onclick = async () => {
            const input = await this.resolveInput();
            if (!input) return;
            await this.handleStartDistill(input);
        };
        nameInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !this.isAnalyzing) this.distillButton.click();
        });
    }

    private async resolveInput(): Promise<StyleDistillInput | null> {
        if (this.sourceMode === 'name') {
            const label = this.nameText.trim();
            if (!label) {
                new Notice('❌ 请输入作品名', 5000);
                return null;
            }
            return { mode: 'name', label };
        }
        if (this.sourceMode === 'paste') {
            const text = this.sampleText.trim();
            if (text.length < 500) {
                new Notice('❌ 样本太短：至少粘贴 500 字，建议 1000-5000 字', 6000);
                return null;
            }
            return { mode: 'paste', label: '粘贴样本', sampleText: text };
        }
        if (this.sourceMode === 'project') {
            if (!this.selectedProjectPath) {
                new Notice('❌ 请选择项目章节', 5000);
                return null;
            }
            const file = this.app.vault.getAbstractFileByPath(this.selectedProjectPath);
            if (!(file instanceof TFile)) {
                new Notice('❌ 章节文件不存在', 5000);
                return null;
            }
            const text = await this.app.vault.read(file);
            if (text.trim().length < 500) {
                new Notice('❌ 该章节正文太短，无法分析', 5000);
                return null;
            }
            return { mode: 'project', label: file.basename, sampleText: text };
        }
        const active = this.app.workspace.getActiveFile();
        if (!active || active.extension !== 'md') {
            new Notice('❌ 请先打开一个 Markdown 文件', 5000);
            return null;
        }
        const text = await this.app.vault.read(active);
        if (text.trim().length < 500) {
            new Notice('❌ 当前文件内容太短，无法分析', 5000);
            return null;
        }
        return { mode: 'file', label: active.basename, sampleText: text };
    }

    private async handleStartDistill(input: StyleDistillInput): Promise<void> {
        const confirmed = await OperationConfirmModal.confirm(this.app, {
            title: '开始文笔风格分析',
            description: input.mode === 'name'
                ? `将基于模型记忆分析《${input.label}》，结果可能不准确；建议改用样本文本。`
                : `将分析「${input.label}」的 ${input.sampleText?.replace(/\s/g, '').length || 0} 字样本，生成风格报告。`,
            etaMin: 15000,
            etaMax: 45000,
            steps: DISTILL_STEPS,
            confirmText: '开始分析',
            cancelText: '取消',
            rememberKey: 'style-distiller-confirm',
        });
        if (!confirmed) return;
        await this.distillStyle(input);
    }

    private async distillStyle(input: StyleDistillInput): Promise<void> {
        if (!this.plugin.hasAiCredentials) {
            new Notice('❌ 请先配置 API 密钥或本地模型端点', 5000);
            return;
        }

        this.currentLabel = input.label;
        this.analyzeInput = input;
        this.setButtonLoading(true);
        this.isAnalyzing = true;

        this.progressEmitter = new ProgressEmitter('style-distill', `分析「${input.label}」文笔风格`);
        this.progressEmitter.registerSteps(DISTILL_STEPS);
        this.ensureLoadingOverlay();
        this.loadingOverlay!.bindEmitter(this.progressEmitter);
        this.loadingOverlay!.onCancel(() => this.handleOverlayAction());
        this.loadingOverlay!.show();
        this.progressEmitter.start();

        try {
            this.progressEmitter.nextStep('读取样本与预处理...');
            await this.delay(200);
            this.progressEmitter.setStepProgress(100, '预处理完成');

            this.progressEmitter.nextStep('AI 正在分析文笔风格...');
            const signal = this.progressEmitter.getSignal();
            const result = await analyzeStyleFromSource(
                this.aiEngine,
                input,
                {
                    settings: this.plugin.settings,
                    resolveLimits: (model, endpoint) => this.plugin.resolveModelLimits(model, endpoint),
                },
                signal,
            );
            if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
            if (result.error) throw new Error(result.error);
            if (!result.content.trim()) throw new Error('模型没有返回分析内容');

            this.progressEmitter.setStepProgress(100, '分析完成');
            this.progressEmitter.nextStep('生成分析报告...');

            const styleContent = this.buildStyleContent(input, result.content, result.model);
            this.progressEmitter.setStepProgress(50, '准备保存结果...');
            const activeProject = this.getActiveProject();

            if (activeProject) {
                this.progressEmitter.setStepProgress(100, '分析完成');
                this.progressEmitter.complete();
                this.hideLoadingOverlay();
                this.setButtonLoading(false);
                this.isAnalyzing = false;
                this.showSaveTargetModal(input.label, styleContent, activeProject);
            } else {
                this.progressEmitter.setStepProgress(70, '正在保存到文笔风格库...');
                await this.saveToStyleLib(input.label, styleContent);
                this.progressEmitter.setStepProgress(100, '保存完成');
                this.progressEmitter.complete();
                setTimeout(() => {
                    this.hideLoadingOverlay();
                    this.setButtonLoading(false);
                    this.isAnalyzing = false;
                    this.close();
                }, 800);
            }
        } catch (error) {
            const err = error as Error;
            if (err.name === 'AbortError' || err.message === 'Aborted' || this.progressEmitter?.getState().status === 'cancelled') {
                this.progressEmitter?.cancel();
                new Notice('⚠️ 已取消分析', 3000);
            } else {
                this.progressEmitter?.fail(err.message);
                this.showErrorNotification(err);
            }
            this.hideLoadingOverlay();
            this.setButtonLoading(false);
            this.isAnalyzing = false;
        }
    }

    private buildStyleContent(input: StyleDistillInput, analysis: string, model: string): string {
        const modeLabel = input.mode === 'name' ? '模型记忆（未提供样本）' : '用户提供样本';
        const chars = input.sampleText?.replace(/\s/g, '').length || 0;
        return `---
tags: [文笔风格]
source: ${input.mode === 'name' ? 'model-memory' : 'user-samples'}
来源: ${input.label}
来源类型: ${modeLabel}
样本字数: ${chars}
蒸馏时间: ${new Date().toLocaleString()}
模型: ${model}
---

# 文笔风格：${input.label}

> 来源：${modeLabel}${chars > 0 ? `（${chars} 字样本）` : ''}
> 蒸馏工具：小说工坊 AI 文笔风格蒸馏

---

${analysis}

---

> 💡 样本模式下的结论应附原文证据；书名模式为模型记忆推测，建议补充样章后重跑。
`;
    }

    private showErrorNotification(error: Error): void {
        const message = error.message || '未知错误';
        let errorType = 'API调用失败';
        if (message.includes('network') || message.includes('Network') || message.includes('fetch') || message.includes('连接')) {
            errorType = '网络错误';
        } else if (message.includes('401') || message.includes('403') || message.includes('密钥') || message.includes('api key') || message.includes('API key')) {
            errorType = 'API密钥错误';
        } else if (message.includes('rate') || message.includes('limit') || message.includes('限流') || message.includes('频率')) {
            errorType = '频率限制';
        } else if (message.includes('timeout') || message.includes('超时')) {
            errorType = '请求超时';
        }
        new Notice(`❌ ${errorType}: ${message}`, 8000);
    }

    private handleOverlayAction(): void {
        if (!this.progressEmitter) return;
        const state = this.progressEmitter.getState();
        if (state.status === 'failed') {
            if (this.analyzeInput) {
                this.loadingOverlay?.hide();
                this.progressEmitter = undefined;
                this.isAnalyzing = false;
                this.setButtonLoading(false);
                this.distillStyle(this.analyzeInput);
            }
        } else if (state.status === 'running') {
            this.progressEmitter.cancel();
        }
    }

    private setButtonLoading(loading: boolean): void {
        if (!this.distillButton) return;
        this.distillButton.disabled = loading;
        this.distillButton.setText(loading ? '分析中...' : '开始分析');
        this.distillButton.style.opacity = loading ? '0.7' : '1';
        this.distillButton.style.cursor = loading ? 'not-allowed' : 'pointer';
    }

    private ensureLoadingOverlay(): void {
        if (this.loadingOverlay) return;
        this.contentEl.style.position = 'relative';
        this.loadingOverlay = new LoadingOverlayComponent(this.contentEl, {
            title: '正在分析...',
            showCancel: true,
            showSteps: true,
        });
    }

    private hideLoadingOverlay(): void {
        if (this.loadingOverlay) {
            setTimeout(() => { this.loadingOverlay?.hide(); }, 500);
        }
    }

    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    private getActiveProject(): string | null {
        return this.plugin.getActiveProject();
    }

    private async showSaveTargetModal(novelName: string, styleContent: string, activeProject: string): Promise<void> {
        const modal = new Modal(this.app);
        modal.titleEl.setText('💾 保存文笔风格');
        const content = modal.contentEl.createDiv({ cls: 'nw-form-stack' });
        content.createEl('p', {
            text: `分析完成。可以先修改报告，再选择保存位置。当前项目：${activeProject}`,
            cls: 'setting-item-description',
        });
        const preview = content.createEl('textarea', { cls: 'nw-textarea nw-u-minh-150px' });
        preview.rows = 16;
        preview.value = styleContent;

        const btnRow = content.createDiv({ cls: 'nw-flex-row-sm' });
        const projectBtn = btnRow.createEl('button', {
            text: `📁 写入当前项目`,
            cls: 'nw-btn nw-btn-primary',
        });
        projectBtn.onclick = async () => {
            modal.close();
            await this.saveToProject(activeProject, preview.value);
            this.close();
        };
        const libBtn = btnRow.createEl('button', {
            text: '📚 存入文笔风格库',
            cls: 'nw-btn nw-btn-secondary',
        });
        libBtn.onclick = async () => {
            modal.close();
            await this.saveToStyleLib(novelName, preview.value);
            this.close();
        };
        modal.open();
    }

    /** 写入当前项目的文笔风格.md（自动备份旧文件） */
    private async saveToProject(projectName: string, styleContent: string): Promise<void> {
        const wsPath = getWritingStyleWritePath(projectName);
        try {
            await ensureWritingStyleFolder(this.app, projectName);
            const existingFile = await findWritingStyleFile(this.app, projectName, { allowPlaceholder: true });
            if (existingFile) {
                const dateStr = new Date().toISOString().slice(0, 10);
                const backupPath = getWritingStyleBackupPath(projectName, dateStr);
                const bakFile = this.app.vault.getAbstractFileByPath(backupPath);
                if (bakFile) await this.app.vault.delete(bakFile);
                const oldContent = await this.app.vault.read(existingFile as TFile);
                await this.app.vault.create(backupPath, oldContent);
                if (existingFile.path === wsPath) {
                    await this.app.vault.modify(existingFile as TFile, styleContent);
                } else {
                    await this.app.vault.create(wsPath, styleContent);
                    new Notice('✅ 已迁移文笔风格到标准路径', 3000);
                }
            } else {
                await this.app.vault.create(wsPath, styleContent);
            }
            new Notice(`✅ 文笔风格已写入「${projectName}」`, 5000);
            const wsFile = this.app.vault.getAbstractFileByPath(wsPath);
            if (wsFile) await this.plugin.safeOpenFile(wsFile as TFile);
        } catch (e) {
            new Notice(`❌ 写入项目失败: ${(e as Error).message}`, 5000);
        }
    }

    /** 存入文笔风格库 */
    private async saveToStyleLib(novelName: string, styleContent: string): Promise<void> {
        const safeName = novelName.replace(/[<>:"/\\|?*\s]/g, '_').slice(0, 60);
        const fileName = `${safeName}.md`;
        const styleDir = '文笔风格库';
        const filePath = `${styleDir}/${fileName}`;
        try {
            if (!this.app.vault.getAbstractFileByPath(styleDir)) {
                await this.app.vault.createFolder(styleDir);
            }
            const existingFile = this.app.vault.getAbstractFileByPath(filePath);
            if (existingFile instanceof TFile) {
                await this.app.vault.modify(existingFile, styleContent);
            } else {
                await this.app.vault.create(filePath, styleContent);
            }
        } catch (e) {
            new Notice(`❌ 保存失败: ${(e as Error).message}`, 5000);
            return;
        }
        const savedFile = this.app.vault.getAbstractFileByPath(filePath);
        if (savedFile instanceof TFile) await this.plugin.safeOpenFile(savedFile);
        new Notice(`✅ 文笔风格已存入文笔风格库 → ${fileName}`, 6000);
    }

    onClose(): void {
        if (this.progressEmitter && this.isAnalyzing) {
            this.progressEmitter.cancel();
        }
        if (this.loadingOverlay) {
            this.loadingOverlay.destroy();
            this.loadingOverlay = undefined;
        }
        this.progressEmitter = undefined;
        this.isAnalyzing = false;
        this.contentEl.empty();
    }
}