import { App, Modal, Notice, TFile, TFolder } from 'obsidian';
import NovelWriterPlugin from '../main';
import { AIEngine } from '../engine/ai-engine';
import { ensureWritingStyleFolder, findWritingStyleFile, getWritingStyleBackupPath, getWritingStyleWritePath } from './writing-style-paths';
import { OperationConfirmModal } from './components/progress/operation-confirm-modal';
import { LoadingOverlayComponent } from './components/progress/loading-overlay';
import { ProgressEmitter } from '../shared/progress-emitter';

const DISTILL_STEPS = [
    '初始化与文本预处理',
    'AI 风格分析',
    '生成报告与保存结果',
];

export class StyleDistillerModal extends Modal {
    private plugin: NovelWriterPlugin;
    private aiEngine: AIEngine;

    private distillButton!: HTMLButtonElement;
    private inputEl!: HTMLInputElement;
    private loadingOverlay?: LoadingOverlayComponent;
    private progressEmitter?: ProgressEmitter;
    private isAnalyzing: boolean = false;
    private currentNovelName: string = '';

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
        contentEl.createEl('h2', { text: '🎨 文笔风格蒸馏' });

        contentEl.createEl('p', { text: '输入小说名，AI自动分析其文笔风格特征' });

        this.inputEl = contentEl.createEl('input', {
            type: 'text',
            placeholder: '输入小说名（可加作者名，如「斩神·三九音域」）',
            cls: 'nw-input novel-writer-input'
        });

        this.distillButton = contentEl.createEl('button', { text: '开始分析', cls: 'nw-btn nw-btn-primary novel-writer-primary-button' });
        this.distillButton.style.marginTop = '12px';
        this.distillButton.onclick = async () => {
            const novelName = this.inputEl.value.trim();
            if (!novelName) {
                new Notice('❌ 请输入小说名', 5000);
                return;
            }
            await this.handleStartDistill(novelName);
        };

        this.inputEl.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !this.isAnalyzing) {
                this.distillButton.click();
            }
        });
    }

    private async handleStartDistill(novelName: string): Promise<void> {
        const confirmed = await OperationConfirmModal.confirm(this.app, {
            title: '开始文笔风格分析',
            description: `将对《${novelName}》进行文笔风格分析，生成详细的风格特征报告。`,
            etaMin: 15000,
            etaMax: 45000,
            steps: DISTILL_STEPS,
            confirmText: '开始分析',
            cancelText: '取消',
            rememberKey: 'style-distiller-confirm',
        });

        if (!confirmed) return;

        await this.distillStyle(novelName);
    }

    private async distillStyle(novelName: string): Promise<void> {
        if (!this.plugin.settings.apiKey) {
            new Notice('❌ 请先配置API密钥', 5000);
            return;
        }

        this.currentNovelName = novelName;
        this.setButtonLoading(true);
        this.isAnalyzing = true;

        this.progressEmitter = new ProgressEmitter('style-distill', `分析《${novelName}》文笔风格`);
        this.progressEmitter.registerSteps(DISTILL_STEPS);

        this.ensureLoadingOverlay();
        this.loadingOverlay!.bindEmitter(this.progressEmitter);
        this.loadingOverlay!.onCancel(() => {
            this.handleOverlayAction();
        });

        this.loadingOverlay!.show();
        this.progressEmitter.start();

        try {
            this.progressEmitter.nextStep('初始化分析环境...');
            await this.delay(300);
            this.progressEmitter.setStepProgress(100, '初始化完成');

            this.progressEmitter.nextStep('AI 正在分析文笔风格...');
            const signal = this.progressEmitter.getSignal();

            const result = await this.aiEngine.analyzeStyle(novelName, signal);

            if (signal.aborted) {
                throw new DOMException('Aborted', 'AbortError');
            }

            if (result.error) {
                throw new Error(result.error);
            }

            this.progressEmitter.setStepProgress(100, '分析完成');

            this.progressEmitter.nextStep('生成分析报告...');

            const styleContent = `---
tags: [文笔风格]
source: ai-generated
来源: ${novelName}
蒸馏时间: ${new Date().toLocaleString()}
---

# 文笔风格：${novelName}

> 从《${novelName}》蒸馏的文笔风格特征。
> 蒸馏工具：小说工坊 AI 文笔风格蒸馏

---

${result.content}

---

> 💡 此文件由 AI 文笔风格蒸馏生成。写作脚本会自动加载其中的风格要求到 AI System Prompt。
> 可根据需要修改、增删内容。
`;

            this.progressEmitter.setStepProgress(50, '准备保存结果...');

            const activeProject = this.getActiveProject();

            if (activeProject) {
                this.progressEmitter.setStepProgress(100, '分析完成');
                this.progressEmitter.complete();
                this.hideLoadingOverlay();
                this.setButtonLoading(false);
                this.isAnalyzing = false;
                await this.showSaveTargetModal(novelName, styleContent, activeProject);
            } else {
                this.progressEmitter.setStepProgress(70, '正在保存到文笔风格库...');
                await this.saveToStyleLib(novelName, styleContent);
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
            if (this.currentNovelName) {
                this.loadingOverlay?.hide();
                this.progressEmitter = undefined;
                this.isAnalyzing = false;
                this.setButtonLoading(false);
                this.distillStyle(this.currentNovelName);
            }
        } else if (state.status === 'running') {
            this.progressEmitter.cancel();
        }
    }

    private setButtonLoading(loading: boolean): void {
        if (!this.distillButton) return;

        if (loading) {
            this.distillButton.disabled = true;
            this.distillButton.setText('分析中...');
            this.distillButton.style.opacity = '0.7';
            this.distillButton.style.cursor = 'not-allowed';
        } else {
            this.distillButton.disabled = false;
            this.distillButton.setText('开始分析');
            this.distillButton.style.opacity = '1';
            this.distillButton.style.cursor = 'pointer';
        }
    }

    private ensureLoadingOverlay(): void {
        if (this.loadingOverlay) return;

        const container = this.contentEl;
        container.style.position = 'relative';

        this.loadingOverlay = new LoadingOverlayComponent(container, {
            title: '正在分析...',
            showCancel: true,
            showSteps: true,
        });
    }

    private hideLoadingOverlay(): void {
        if (this.loadingOverlay) {
            setTimeout(() => {
                this.loadingOverlay?.hide();
            }, 500);
        }
    }

    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /** 从当前活动文件检测项目名 */
    private getActiveProject(): string | null {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) return null;
        const project = activeFile.path.split('/')[0];
        if (project === '元文件' || project === '文笔风格库' || project.startsWith('.')) return null;
        const folder = this.app.vault.getAbstractFileByPath(project);
        return folder instanceof TFolder ? project : null;
    }

    /** 显示保存目标选择弹窗 */
    private async showSaveTargetModal(novelName: string, styleContent: string, activeProject: string): Promise<void> {
        const modal = new Modal(this.app);
        modal.titleEl.setText('💾 保存文笔风格');

        const content = modal.contentEl.createDiv({ attr: { style: 'padding: 20px;' } });
        content.createEl('p', {
            text: `文笔风格分析完成！当前项目：「${activeProject}」`,
            attr: { style: 'font-size: 1em; font-weight: 600; margin-bottom: 12px;' }
        });
        content.createEl('p', {
            text: '请选择保存位置：',
            attr: { style: 'margin-bottom: 16px;' }
        });

        const btnRow = content.createDiv({ attr: { style: 'display: flex; flex-direction: column; gap: 8px;' } });

        const projectBtn = btnRow.createEl('button', {
            text: `📁 写入当前项目（${getWritingStyleWritePath(activeProject)}）`,
            attr: { style: 'padding: 10px 16px; background: var(--nw-btn-primary-bg, #C2410C); color: white; border: none; border-radius: 8px; cursor: pointer; font-weight: 600; font-size: 0.9em;' }
        });
        projectBtn.onclick = async () => {
            modal.close();
            await this.saveToProject(activeProject, styleContent);
            this.close();
        };

        const libBtn = btnRow.createEl('button', {
            text: '📚 存入文笔风格库',
            attr: { style: 'padding: 10px 16px; background: transparent; border: 1px solid var(--background-modifier-border); border-radius: 8px; cursor: pointer; font-size: 0.9em;' }
        });
        libBtn.onclick = async () => {
            modal.close();
            await this.saveToStyleLib(novelName, styleContent);
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
                if (bakFile) {
                    await this.app.vault.delete(bakFile);
                }
                const oldContent = await this.app.vault.read(existingFile as TFile);
                await this.app.vault.create(backupPath, oldContent);

                if (existingFile.path === wsPath) {
                    await this.app.vault.modify(existingFile as TFile, styleContent);
                } else {
                    await this.app.vault.create(wsPath, styleContent);
                    new Notice(`✅ 已迁移文笔风格到标准路径`, 3000);
                }
            } else {
                await this.app.vault.create(wsPath, styleContent);
            }

            new Notice(`✅ 文笔风格已写入「${projectName}」`, 5000);

            const wsFile = this.app.vault.getAbstractFileByPath(wsPath);
            if (wsFile) {
                await this.plugin.safeOpenFile(wsFile as TFile);
            }
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
        if (savedFile instanceof TFile) {
            await this.plugin.safeOpenFile(savedFile);
        }

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

        const { contentEl } = this;
        contentEl.empty();
    }
}
