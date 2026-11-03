import { App, Modal, Setting, Notice } from 'obsidian';
import { FingerprintExtractor, ExtractionProgress } from '@/engine/fingerprint-extractor';
import { StyleFingerprint } from '@/engine/style-fingerprint-library';
import { createLogger } from '@/shared/logger';


const log = createLogger('FingerprintLibraryModal');
interface AddFingerprintModalOptions {
    scope: 'template' | 'global' | 'project';
    extractor: FingerprintExtractor;
    onCompleted: (fingerprint: StyleFingerprint) => void;
}

const PHASE_LABELS: Record<string, string> = {
    'preprocessing': '文本预处理',
    'feature-extraction': '风格特征提取',
    'sample-selection': '示例筛选',
    'vectorization': '向量化建库',
    'complete': '完成',
};

/**
 * 添加指纹弹窗。
 */
export class AddFingerprintModal extends Modal {
    private options: AddFingerprintModalOptions;
    private nameValue = '';
    private sourceValue = '';
    public textValue = '';
    private inputMode: 'upload' | 'paste' = 'paste';
    private isExtracting = false;
    private abortController: AbortController | null = null;
    private progressEl!: HTMLElement;
    private progressBarEl!: HTMLElement;
    private progressTextEl!: HTMLElement;
    private phaseTextEl!: HTMLElement;

    constructor(app: App, options: AddFingerprintModalOptions) {
        super(app);
        this.options = options;
    }

    /**
     * onOpen 方法。
     */
    onOpen() {
        this.modalEl.addClass('nw-scope');
        this.render();
    }

    /**
     * onClose 方法。
     */
    onClose() {
        if (this.abortController) {
            this.abortController.abort();
            this.abortController = null;
        }
        this.contentEl.empty();
    }

    private render(): void {
        const { contentEl } = this;
        contentEl.empty();

        const scopeLabels: Record<string, string> = {
            'template': '模板指纹',
            'global': '全局指纹',
            'project': '项目指纹',
        };
        const scopeLabel = scopeLabels[this.options.scope] || '指纹';
        contentEl.createEl('h3', { text: `➕ 添加${scopeLabel}` });

        const formDiv = contentEl.createDiv({ attr: { style: 'margin-top:16px;' } });

        new Setting(formDiv)
            .setName('指纹名称')
            .setDesc('用于识别这个写作指纹')
            .addText(t => t
                .setPlaceholder('例如：金庸武侠风格')
                .setValue(this.nameValue)
                .onChange(v => this.nameValue = v));

        new Setting(formDiv)
            .setName('来源名称')
            .setDesc('文本的来源（作者/作品名）')
            .addText(t => t
                .setPlaceholder('例如：金庸《射雕英雄传》')
                .setValue(this.sourceValue)
                .onChange(v => this.sourceValue = v));

        const modeDiv = formDiv.createDiv({ attr: { style: 'margin:12px 0 8px;display:flex;gap:8px;' } });

        const pasteBtn = modeDiv.createEl('button', {
            text: '📝 粘贴文本',
            attr: {
                type: 'button',
                style: `padding:6px 14px;cursor:pointer;border:1px solid ${this.inputMode === 'paste' ? 'var(--interactive-accent)' : 'var(--background-modifier-border)'};border-radius:4px;font-size:12px;${this.inputMode === 'paste' ? 'background:var(--interactive-accent);color:var(--text-on-accent);' : ''}`
            }
        });
        pasteBtn.addEventListener('click', () => {
            this.inputMode = 'paste';
            this.render();
        });

        const uploadBtn = modeDiv.createEl('button', {
            text: '📁 上传文件',
            attr: {
                type: 'button',
                style: `padding:6px 14px;cursor:pointer;border:1px solid ${this.inputMode === 'upload' ? 'var(--interactive-accent)' : 'var(--background-modifier-border)'};border-radius:4px;font-size:12px;${this.inputMode === 'upload' ? 'background:var(--interactive-accent);color:var(--text-on-accent);' : ''}`
            }
        });
        uploadBtn.addEventListener('click', () => {
            this.inputMode = 'upload';
            this.render();
        });

        if (this.inputMode === 'paste') {
            const textareaWrap = formDiv.createDiv({ attr: { style: 'margin-top:8px;' } });
            textareaWrap.createEl('div', {
                text: '粘贴文本内容',
                attr: { style: 'font-size:12px;color:var(--text-muted);margin-bottom:4px;' }
            });
            const textarea = textareaWrap.createEl('textarea', {
                attr: {
                    style: 'width:100%;min-height:180px;padding:8px;border:1px solid var(--background-modifier-border);border-radius:4px;background:var(--background-primary);color:var(--text-normal);font-size:13px;resize:vertical;font-family:var(--font-interface);',
                    placeholder: '将小说文本粘贴到这里...'
                }
            });
            textarea.value = this.textValue;
            textarea.addEventListener('input', (e) => {
                this.textValue = (e.target as HTMLTextAreaElement).value;
            });
        } else {
            const uploadWrap = formDiv.createDiv({ attr: { style: 'margin-top:8px;' } });
            uploadWrap.createEl('div', {
                text: '上传 .md 或 .txt 文件',
                attr: { style: 'font-size:12px;color:var(--text-muted);margin-bottom:4px;' }
            });
            const dropArea = uploadWrap.createDiv({
                attr: {
                    style: 'padding:32px;border:2px dashed var(--background-modifier-border);border-radius:6px;text-align:center;cursor:pointer;background:var(--background-secondary);'
                }
            });
            dropArea.createEl('div', {
                text: this.textValue ? '已选择文件，点击重新选择' : '点击选择文件或拖拽到此处',
                attr: { style: 'font-size:13px;color:var(--text-muted);margin-bottom:8px;' }
            });
            if (this.textValue) {
                dropArea.createEl('div', {
                    text: `文本长度：${this.textValue.length} 字`,
                    attr: { style: 'font-size:12px;color:var(--text-accent);' }
                });
            }
            const fileInput = dropArea.createEl('input', {
                attr: { type: 'file', accept: '.md,.txt', style: 'display:none;' }
            });
            dropArea.addEventListener('click', () => fileInput.click());
            dropArea.addEventListener('dragover', (e) => {
                e.preventDefault();
                dropArea.style.borderColor = 'var(--interactive-accent)';
            });
            dropArea.addEventListener('dragleave', () => {
                dropArea.style.borderColor = 'var(--background-modifier-border)';
            });
            dropArea.addEventListener('drop', (e) => {
                e.preventDefault();
                dropArea.style.borderColor = 'var(--background-modifier-border)';
                const file = e.dataTransfer?.files[0];
                if (file) this.handleFile(file);
            });
            fileInput.addEventListener('change', (e) => {
                const file = (e.target as HTMLInputElement).files?.[0];
                if (file) this.handleFile(file);
            });
        }

        this.progressEl = formDiv.createDiv({
            attr: { style: `margin-top:16px;display:${this.isExtracting ? 'block' : 'none'};` }
        });
        this.renderProgress();

        const btnRow = contentEl.createDiv({ attr: { style: 'display:flex;gap:8px;margin-top:20px;justify-content:flex-end;' } });

        if (this.isExtracting) {
            btnRow.createEl('button', {
                text: '取消',
                attr: { style: 'padding:6px 16px;cursor:pointer;border:1px solid var(--background-modifier-error);border-radius:4px;color:var(--text-error);background:transparent;' }
            }).addEventListener('click', () => {
                if (this.abortController) {
                    this.abortController.abort();
                }
            });
        } else {
            btnRow.createEl('button', {
                text: '取消',
                attr: { style: 'padding:6px 16px;cursor:pointer;' }
            }).addEventListener('click', () => this.close());

            const extractBtn = btnRow.createEl('button', {
                text: '🔍 提取指纹',
                attr: { style: 'padding:6px 16px;background:var(--interactive-accent);color:var(--text-on-accent);border:none;border-radius:4px;cursor:pointer;' }
            });
            extractBtn.addEventListener('click', () => this.startExtraction());
        }
    }

    private handleFile(file: File): void {
        const reader = new FileReader();
        reader.onload = (e) => {
            this.textValue = e.target?.result as string || '';
            this.render();
        };
        reader.readAsText(file);
    }

    private renderProgress(): void {
        this.progressEl.empty();

        const progressHeader = this.progressEl.createDiv({
            attr: { style: 'display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;' }
        });
        this.phaseTextEl = progressHeader.createEl('span', {
            text: '准备中...',
            attr: { style: 'font-size:13px;font-weight:500;' }
        });
        this.progressTextEl = progressHeader.createEl('span', {
            text: '0%',
            attr: { style: 'font-size:12px;color:var(--text-muted);' }
        });

        const barBg = this.progressEl.createDiv({
            attr: { style: 'width:100%;height:8px;background:var(--background-modifier-border);border-radius:4px;overflow:hidden;' }
        });
        this.progressBarEl = barBg.createDiv({
            attr: {
                style: 'height:100%;width:0%;background:var(--interactive-accent);border-radius:4px;transition:width 0.3s ease;'
            }
        });
    }

    private async startExtraction(): Promise<void> {
        if (!this.nameValue.trim()) {
            new Notice('❌ 请输入指纹名称');
            return;
        }
        if (!this.sourceValue.trim()) {
            new Notice('❌ 请输入来源名称');
            return;
        }
        if (!this.textValue.trim()) {
            new Notice('❌ 请输入或上传文本内容');
            return;
        }

        this.isExtracting = true;
        this.abortController = new AbortController();
        this.render();

        try {
            const fingerprint = await this.options.extractor.extract(
                this.textValue,
                {
                    name: this.nameValue.trim(),
                    source: this.sourceValue.trim(),
                    scope: this.options.scope,
                    signal: this.abortController.signal,
                    onProgress: (progress: ExtractionProgress) => {
                        this.updateProgress(progress);
                    }
                }
            );

            try {
                this.options.onCompleted(fingerprint);
            } catch (callbackError) {
                log.error('[AddFingerprintModal] onCompleted callback failed:', callbackError);
            }
            new Notice('✅ 指纹提取完成');
            this.close();
        } catch (e: any) {
            if (e.name === 'AbortError' || e.message === '提取已取消') {
                new Notice('已取消提取');
            } else {
                log.error('[AddFingerprintModal] 提取失败:', e);
                new Notice(`❌ 提取失败：${e.message || '未知错误'}`);
            }
            this.isExtracting = false;
            this.abortController = null;
            this.render();
        }
    }

    private updateProgress(progress: ExtractionProgress): void {
        const phaseLabel = PHASE_LABELS[progress.phase] || progress.phase;
        if (this.phaseTextEl) {
            this.phaseTextEl.textContent = progress.message || phaseLabel;
        }
        if (this.progressTextEl) {
            this.progressTextEl.textContent = `${Math.round(progress.percent)}%`;
        }
        if (this.progressBarEl) {
            this.progressBarEl.style.width = `${progress.percent}%`;
        }
    }
}
