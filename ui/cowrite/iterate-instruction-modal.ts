import { Modal, Setting, Notice, type App } from 'obsidian';
import { t } from '@/i18n';
import { ModalDirtyGuard } from '@/ui/components/modal-dirty-guard';

// B2: 迭代指令输入弹窗
/**
 * IterateInstructionModal 类。
 */
export class IterateInstructionModal extends Modal {
    private onResolve: (value: string | null) => void;
    private resolved = false;
    /** 未保存修改的关闭确认（审计 A-5） */
    private dirtyGuard = new ModalDirtyGuard();

    constructor(app: App, onResolve: (value: string | null) => void) {
        super(app);
        this.onResolve = onResolve;
    }

    /**
     * onOpen 方法。
     */
    onOpen(): void {
    this.modalEl.addClass('nw-scope');
        this.titleEl.setText(t('cowrite.iterate.title'));
        const { contentEl } = this;
        contentEl.empty();
        this.dirtyGuard.attach(this, this.app);
        contentEl.addEventListener('input', () => this.dirtyGuard.markDirty());
        contentEl.createDiv({ cls: 'novel-writer-cowrite-modal-hint', text: t('cowrite.iterate.hint') });
        const textarea = contentEl.createEl('textarea', { cls: 'novel-writer-cowrite-modal-textarea' });
        textarea.placeholder = t('cowrite.iterate.placeholder');
        textarea.focus();

        new Setting(contentEl)
            .addButton(btn => btn.setButtonText(t('common.cancel')).onClick(() => {
                this.dirtyGuard.markClean();
                this.close();
            }))
            .addButton(btn => btn
                .setButtonText(t('cowrite.iterate.submitBtn'))
                .setCta()
                .onClick(() => {
                    const value = textarea.value.trim();
                    if (!value) {
                        new Notice(t('cowrite.iterate.needInstruction'), 2000);
                        return;
                    }
                    this.resolved = true;
                    this.dirtyGuard.markClean();
                    this.onResolve(value);
                    this.close();
                }));
    }

    /**
     * onClose 方法。
     */
    onClose(): void {
        this.contentEl.empty();
        if (!this.resolved) this.onResolve(null);
    }
}
