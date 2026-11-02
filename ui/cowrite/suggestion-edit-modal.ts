import { Notice } from 'obsidian';
import { SuggestionRecord } from '../../shared/types';

// 编辑并验证浮窗（非遮挡抽屉式，Task 3 重构）
// 保留类名 SuggestionEditModal 与 open() 方法以兼容调用方
/**
 * SuggestionEditModal 类。
 */
export class SuggestionEditModal {
    private suggestion: SuggestionRecord;
    private initialText: string;
    private onSubmit: (text: string) => Promise<void>;

    private modalEl: HTMLElement | null = null;
    private validationPanel: HTMLElement | null = null;
    private submitBtn: HTMLButtonElement | null = null;
    private cancelBtn: HTMLButtonElement | null = null;
    private isSubmitting = false;

    constructor(app: any, suggestion: SuggestionRecord, initialText: string, onSubmit: (text: string) => Promise<void>) {
        this.suggestion = suggestion;
        this.initialText = initialText;
        this.onSubmit = onSubmit;
    }

    /**
     * 打开。
     */
    open(): void {
        const drawer = document.body.createDiv({ cls: 'nw-suggestion-drawer' });
        this.modalEl = drawer;

        // ----- header -----
        const header = drawer.createDiv({ cls: 'nw-suggestion-drawer-header' });
        header.createDiv({ cls: 'nw-suggestion-drawer-title', text: '✏️ 编辑建议并验证' });
        const closeBtn = header.createEl('button', {
            cls: 'nw-suggestion-drawer-close',
            text: '✕',
            attr: { 'aria-label': '关闭编辑面板' }
        });
        closeBtn.addEventListener('click', () => this.close());

        // ----- body -----
        const body = drawer.createDiv({ cls: 'nw-suggestion-drawer-body' });
        body.createDiv({
            cls: 'novel-writer-cowrite-modal-hint',
            text: `原方向：${this.suggestion.direction}。修改后会传回 AI 做一致性 / 文风 / 剧情验证。`
        });
        const textarea = body.createEl('textarea', { cls: 'novel-writer-cowrite-modal-textarea' });
        textarea.value = this.initialText;
        textarea.focus();

        // 验证结果区（初始隐藏）
        const validationPanel = body.createDiv({ cls: 'nw-suggestion-drawer-validation' });
        validationPanel.style.display = 'none';
        this.validationPanel = validationPanel;

        // ----- footer -----
        const footer = drawer.createDiv({ cls: 'nw-suggestion-drawer-footer' });
        const cancelBtn = footer.createEl('button', {
            cls: 'nw-suggestion-drawer-btn',
            text: '取消'
        });
        cancelBtn.addEventListener('click', () => this.close());
        this.cancelBtn = cancelBtn;

        const submitBtn = footer.createEl('button', {
            cls: 'nw-suggestion-drawer-btn nw-suggestion-drawer-btn-primary',
            text: '提交验证'
        });
        submitBtn.addEventListener('click', () => this.handleSubmit(textarea));
        this.submitBtn = submitBtn;

        // 滑入动画：先挂载（translateX(100%) 由 CSS 默认值提供），下一帧添加 is-open
        requestAnimationFrame(() => {
            requestAnimationFrame(() => drawer.classList.add('is-open'));
        });
    }

    /**
     * 关闭。
     */
    close(): void {
        if (!this.modalEl) return;
        const el = this.modalEl;
        this.modalEl = null;
        el.classList.remove('is-open');
        // 等待滑出动画结束后移除 DOM
        window.setTimeout(() => {
            if (el.parentNode) el.parentNode.removeChild(el);
        }, 280);
    }

    private async handleSubmit(textarea: HTMLTextAreaElement): Promise<void> {
        if (this.isSubmitting) return;
        const text = textarea.value.trim();
        if (!text) {
            new Notice('修改内容不能为空', 2000);
            return;
        }
        this.isSubmitting = true;
        if (this.submitBtn) {
            this.submitBtn.disabled = true;
            this.submitBtn.textContent = '验证中…';
        }
        if (this.cancelBtn) {
            this.cancelBtn.disabled = true;
        }
        this.showValidationLoading();

        try {
            await this.onSubmit(text);
            this.showValidationDone(false);
        } catch (err) {
            this.showValidationDone(true, err);
        } finally {
            this.isSubmitting = false;
            // 完成后：footer 切换为"关闭"按钮
            this.swapFooterToClose();
        }
    }

    private showValidationLoading(): void {
        if (!this.validationPanel) return;
        this.validationPanel.style.display = 'block';
        this.validationPanel.empty();
        const loading = this.validationPanel.createDiv({ cls: 'nw-suggestion-drawer-validation-loading' });
        loading.createEl('span', { text: '⏳' });
        loading.createSpan({ text: '正在传回 AI 验证，请稍候…' });
    }

    private showValidationDone(isError: boolean, err?: any): void {
        if (!this.validationPanel) return;
        this.validationPanel.empty();
        const title = this.validationPanel.createDiv({ cls: 'nw-suggestion-drawer-validation-title' });
        if (isError) {
            title.setText(`❌ 验证失败：${err instanceof Error ? err.message : String(err)}`);
        } else {
            title.setText('✅ 验证完成，请查看主面板结果');
        }
    }

    private swapFooterToClose(): void {
        if (!this.modalEl) return;
        const footer = this.modalEl.querySelector('.nw-suggestion-drawer-footer');
        if (!footer) return;
        footer.empty();
        const closeBtn = (footer as HTMLElement).createEl('button', {
            cls: 'nw-suggestion-drawer-btn nw-suggestion-drawer-btn-primary',
            text: '关闭'
        });
        closeBtn.addEventListener('click', () => this.close());
    }
}
