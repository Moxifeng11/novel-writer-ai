/**
 * mode-document-modal.ts — 短篇/剧本专属文档编辑
 *
 * 用于故事核、分节大纲、场景圣经、分集大纲、分镜表等模式内文档。
 * 只读写 短篇创作/ 或 剧本创作/，不触碰长篇 03-大纲与章节。
 */
import { App, Modal } from 'obsidian';
import type NovelWriterPlugin from '@/main';
import { creationModeDisplayName, type CreationMode } from '@/shared/creation-mode';
import { modeDocPath, modeDocStarter } from '@/shared/mode-content';
import { resolveProjectMode } from '@/shared/project-mode';
import { writeVaultText } from '@/shared/file-system-port';
import { generateModeDocument } from '@/engine/mode-document-writer';
import { ENGINE_NAMES } from '@/shared/engine-names';
import { StyleFingerprintLibrary } from '@/engine/style-fingerprint-library';
import { pushUsageScope } from '@/services/usage-ledger';
import { t } from '@/i18n';
import { OperationConfirmModal } from './components/progress';
import { showErrorNotice, showSuccessNotice } from './components/notice-helpers';
import { ModalDirtyGuard } from './components/modal-dirty-guard';

/**
 * ModeDocumentKind 类型定义。
 */
export type ModeDocumentKind = 'storyCore' | 'outline' | 'bible' | 'storyboard';

/** 文档标题键：分集/分节大纲按模式分叉，其余按文档类型。 */
function docTitleKey(mode: CreationMode, kind: ModeDocumentKind): string {
    if (kind === 'storyCore') return 'modeDoc.titleStoryCore';
    if (kind === 'bible') return 'modeDoc.titleBible';
    if (kind === 'storyboard') return 'modeDoc.titleStoryboard';
    return mode === 'short' ? 'modeDoc.titleOutlineShort' : 'modeDoc.titleOutlineScript';
}

/** 文档说明键。 */
function docDescriptionKey(kind: ModeDocumentKind): string {
    switch (kind) {
        case 'storyCore': return 'modeDoc.descStoryCore';
        case 'bible': return 'modeDoc.descBible';
        case 'storyboard': return 'modeDoc.descStoryboard';
        default: return 'modeDoc.descOutline';
    }
}

/**
 * ModeDocumentModal 类。
 */
export class ModeDocumentModal extends Modal {
    /** 未保存修改的关闭确认（审计 A-5） */
    private dirtyGuard = new ModalDirtyGuard();

    constructor(
        app: App,
        private readonly plugin: NovelWriterPlugin,
        private readonly mode: CreationMode,
        private readonly kind: ModeDocumentKind,
        private readonly project?: string
    ) {
        super(app);
    }

    /**
     * onOpen 方法。
     */
    async onOpen(): Promise<void> {
        this.modalEl.addClass('nw-scope', 'nw-modal');
        this.titleEl.setText(this.mode === 'long' ? t('modeDoc.fallbackTitle') : t(docTitleKey(this.mode, this.kind)));
        const { contentEl } = this;
        contentEl.empty();
        this.dirtyGuard.attach(this, this.app);
        contentEl.addEventListener('input', () => this.dirtyGuard.markDirty());

        if (this.mode === 'long' || !this.project) {
            contentEl.createEl('p', { text: t('modeDoc.contentUnsupported') });
            return;
        }

        // 命令入口可能带着「短篇」参数落到剧本项目上；写入前必须核对项目真实模式
        const projectMode = await resolveProjectMode(this.app, this.project);
        if (projectMode !== this.mode) {
            contentEl.createEl('p', {
                text: t('modeDoc.modeMismatch', {
                    projectMode: creationModeDisplayName(projectMode),
                    saveMode: creationModeDisplayName(this.mode),
                }),
            });
            return;
        }

        contentEl.createEl('p', {
            cls: 'nw-text-12-muted',
            text: t(docDescriptionKey(this.kind)),
        });
        contentEl.createEl('p', {
            cls: 'nw-text-12-muted',
            text: t('modeDoc.savePath', { path: modeDocPath(this.project, this.mode, this.kind) }),
        });

        const textarea = contentEl.createEl('textarea', {
            cls: 'nw-textarea nw-form-textarea nw-mode-doc-editor',
            attr: { rows: '18', placeholder: t('modeDoc.placeholder') },
        });
        textarea.value = modeDocStarter(this.project, this.mode, this.kind);
        void this.load(textarea);

        const aiRow = contentEl.createDiv({ cls: 'nw-mode-doc-ai-row' });
        const instruction = aiRow.createEl('input', {
            cls: 'nw-input nw-mode-doc-instruction',
            attr: { type: 'text', placeholder: t('modeDoc.instructionPlaceholder') },
        });
        const aiBtn = aiRow.createEl('button', {
            text: t('modeDoc.generate'),
            cls: 'nw-btn nw-btn-secondary',
            attr: { type: 'button' },
        });
        aiBtn.onclick = () => {
            void this.generateWithAI(textarea, instruction.value, aiBtn);
        };

        const footer = contentEl.createDiv({ cls: 'nw-modal-footer' });
        const cancel = footer.createEl('button', {
            text: t('common.cancel'),
            cls: 'nw-btn nw-btn-secondary',
            attr: { type: 'button' },
        });
        cancel.onclick = () => {
            this.dirtyGuard.markClean();
            this.close();
        };
        const save = footer.createEl('button', {
            text: t('modeDoc.save'),
            cls: 'nw-btn nw-btn-primary',
            attr: { type: 'button' },
        });
        save.onclick = () => { void this.save(textarea.value); };
    }

    private async load(textarea: HTMLTextAreaElement): Promise<void> {
        if (!this.project) return;
        try {
            const path = modeDocPath(this.project, this.mode, this.kind);
            if (await this.app.vault.adapter.exists(path)) {
                textarea.value = await this.app.vault.adapter.read(path);
            }
        } catch (e) {
            showErrorNotice(e instanceof Error ? e.message : String(e), { title: t('modeDoc.readFailedTitle'), timeout: 5000 });
        }
    }

    private async generateWithAI(
        textarea: HTMLTextAreaElement,
        instruction: string,
        button: HTMLButtonElement,
    ): Promise<void> {
        if (!this.project || button.disabled) return;
        const existing = textarea.value.trim();
        if (existing.length > 80) {
            const confirmed = await OperationConfirmModal.confirm(this.app, {
                title: t('modeDoc.overwriteTitle'),
                description: t('modeDoc.overwriteDesc'),
                warning: t('modeDoc.overwriteWarning'),
                confirmText: t('modeDoc.overwriteConfirm'),
                cancelText: t('common.cancel'),
            });
            if (!confirmed) return;
        }
        button.disabled = true;
        button.setText(t('modeDoc.generating'));
        try {
            // 归因到用量账本：本次 AI 调用记在 document / doc:<kind> 名下
            const exitUsage = pushUsageScope({ source: 'document', project: this.project, stepKey: `doc:${this.kind}` });
            try {
                const text = await generateModeDocument(
                    this.app,
                    this.plugin.aiEngine,
                    this.project,
                    this.mode,
                    this.kind,
                    {
                        model: this.plugin.settings.proModel || this.plugin.settings.defaultModel || '',
                        maxTokens: this.plugin.settings.maxOutput || 4096,
                        instruction: instruction.trim(),
                        existingText: existing,
                        injectionDeps: {
                            vectorStore: this.plugin.engineRegistry.getOrNull(ENGINE_NAMES.KNOWLEDGE_VECTOR_STORE),
                            fingerprintLibrary: StyleFingerprintLibrary.get(this.app, this.project),
                            project: this.project,
                        },
                    },
                );
                textarea.value = text;
                showSuccessNotice(t('modeDoc.generatedNotice'), { timeout: 5000 });
            } finally {
                exitUsage();
            }
        } catch (e) {
            showErrorNotice(e instanceof Error ? e.message : String(e), { title: t('modeDoc.generateFailedTitle'), timeout: 8000 });
        } finally {
            button.disabled = false;
            button.setText(t('modeDoc.generate'));
        }
    }

    private async save(content: string): Promise<void> {
        if (!this.project) return;
        try {
            const path = modeDocPath(this.project, this.mode, this.kind);
            await writeVaultText(this.app, path, content);
            showSuccessNotice(t('modeDoc.savedNotice'), { timeout: 3000 });
            this.dirtyGuard.markClean();
            this.close();
        } catch (e) {
            showErrorNotice(e instanceof Error ? e.message : String(e), { title: t('modeDoc.saveFailedTitle'), timeout: 6000 });
        }
    }

    /**
     * onClose 方法。
     */
    onClose(): void {
        this.contentEl.empty();
    }
}
