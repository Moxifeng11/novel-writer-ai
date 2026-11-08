import { Modal, Setting, Notice, type App } from 'obsidian';

// B2: 迭代指令输入弹窗
/**
 * IterateInstructionModal 类。
 */
export class IterateInstructionModal extends Modal {
    private onResolve: (value: string | null) => void;
    private resolved = false;

    constructor(app: App, onResolve: (value: string | null) => void) {
        super(app);
        this.onResolve = onResolve;
    }

    /**
     * onOpen 方法。
     */
    onOpen(): void {
    this.modalEl.addClass('nw-scope');
        this.titleEl.setText('↻ 迭代改写此候选');
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createDiv({ cls: 'novel-writer-cowrite-modal-hint', text: '输入一条定向指令（如：更冷静、多一句动作、减少形容词），AI 会在原候选基础上迭代。' });
        const textarea = contentEl.createEl('textarea', { cls: 'novel-writer-cowrite-modal-textarea' });
        textarea.placeholder = '例：语气再冷一点，保留动作细节';
        textarea.focus();

        new Setting(contentEl)
            .addButton(btn => btn.setButtonText('取消').onClick(() => this.close()))
            .addButton(btn => btn
                .setButtonText('迭代')
                .setCta()
                .onClick(() => {
                    const value = textarea.value.trim();
                    if (!value) {
                        new Notice('请输入迭代指令', 2000);
                        return;
                    }
                    this.resolved = true;
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
