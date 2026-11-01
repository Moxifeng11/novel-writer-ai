import { Modal, Setting, Notice } from 'obsidian';

// E1/E3: 风格自学习 / 偏好记忆管理弹窗
export class MemoryManagerModal extends Modal {
    private snapshot: any;
    private onAddPreference: (category: any, key: string, value: string) => Promise<void>;

    constructor(app: any, snapshot: any, onAddPreference: (category: any, key: string, value: string) => Promise<void>) {
        super(app);
        this.snapshot = snapshot;
        this.onAddPreference = onAddPreference;
    }

    onOpen(): void {
    this.modalEl.addClass('nw-scope');
        this.titleEl.setText('🧠 风格 / 偏好记忆');
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('novel-writer-memory-modal');

        contentEl.createDiv({ cls: 'novel-writer-cowrite-modal-hint', text: '这里展示协同写作已学习到的 E1 风格模式与 E3 偏好记忆；新增偏好会立即影响后续联想、续写、改写与迭代建议。' });

        const stats = contentEl.createDiv({ cls: 'novel-writer-memory-stats' });
        stats.createDiv({ cls: 'novel-writer-memory-stat', text: `风格模式：${this.snapshot.stylePatterns?.length || 0}` });
        stats.createDiv({ cls: 'novel-writer-memory-stat', text: `偏好记忆：${this.snapshot.preferences?.length || 0}` });

        this.renderStyleSection(contentEl);
        this.renderPreferenceSection(contentEl);
        this.renderAddPreferenceSection(contentEl);

        new Setting(contentEl).addButton(btn => btn.setButtonText('关闭').setCta().onClick(() => this.close()));
    }

    private renderStyleSection(contentEl: HTMLElement): void {
        const section = contentEl.createDiv({ cls: 'novel-writer-memory-section' });
        section.createDiv({ cls: 'novel-writer-memory-section-title', text: 'E1 风格自学习' });
        const styleGuide = (this.snapshot.styleGuide || '').trim();
        if (styleGuide) {
            section.createEl('pre', { cls: 'novel-writer-memory-pre', text: styleGuide });
        } else {
            section.createDiv({ cls: 'novel-writer-cowrite-empty', text: '暂无高置信度风格指南；接受并编辑建议后会逐步形成。' });
        }

        const patterns = (this.snapshot.stylePatterns || []).slice(0, 8);
        if (patterns.length) {
            const list = section.createDiv({ cls: 'novel-writer-memory-list' });
            for (const pattern of patterns) {
                const item = list.createDiv({ cls: 'novel-writer-memory-item' });
                item.createDiv({ cls: 'novel-writer-memory-item-title', text: `${pattern.type || 'style'} · 偏好 ${Number(pattern.userPreference || 0).toFixed(2)} · ${pattern.frequency || 1} 次` });
                item.createDiv({ cls: 'novel-writer-memory-item-body', text: pattern.pattern || '(空模式)' });
            }
        }
    }

    private renderPreferenceSection(contentEl: HTMLElement): void {
        const section = contentEl.createDiv({ cls: 'novel-writer-memory-section' });
        section.createDiv({ cls: 'novel-writer-memory-section-title', text: 'E3 偏好记忆' });
        const prompt = (this.snapshot.preferencePrompt || '').trim();
        if (prompt) {
            section.createEl('pre', { cls: 'novel-writer-memory-pre', text: prompt });
        }

        const preferences = (this.snapshot.preferences || []).slice(0, 12);
        if (!preferences.length) {
            section.createDiv({ cls: 'novel-writer-cowrite-empty', text: '暂无偏好记忆；可在下方手动添加一条明确偏好。' });
            return;
        }

        const list = section.createDiv({ cls: 'novel-writer-memory-list' });
        for (const preference of preferences) {
            const item = list.createDiv({ cls: 'novel-writer-memory-item' });
            item.createDiv({ cls: 'novel-writer-memory-item-title', text: `${preference.category || 'style'} · ${preference.key || ''} · 置信 ${Number(preference.confidence || 0).toFixed(2)}` });
            const valueText = typeof preference.value === 'string' ? preference.value : JSON.stringify(preference.value);
            item.createDiv({ cls: 'novel-writer-memory-item-body', text: valueText || '(空偏好)' });
        }
    }

    private renderAddPreferenceSection(contentEl: HTMLElement): void {
        const section = contentEl.createDiv({ cls: 'novel-writer-memory-section novel-writer-memory-add' });
        section.createDiv({ cls: 'novel-writer-memory-section-title', text: '手动添加偏好' });
        const categorySelect = section.createEl('select', { cls: 'nw-input novel-writer-memory-input' });
        const categories = [
            ['style', '文风'],
            ['dialogue', '对话'],
            ['description', '描写'],
            ['pacing', '节奏'],
            ['character', '人物'],
            ['plot', '情节']
        ];
        for (const [value, label] of categories) {
            categorySelect.createEl('option', { value, text: label });
        }
        const keyInput = section.createEl('input', { cls: 'nw-input novel-writer-memory-input', type: 'text', placeholder: '偏好名，例如：少用形容词' });
        const valueInput = section.createEl('textarea', { cls: 'novel-writer-memory-textarea', placeholder: '偏好内容，例如：动作句优先，避免连续心理独白。' });
        const addBtn = section.createEl('button', { cls: 'novel-writer-cowrite-primary-btn', text: '写入偏好记忆' });
        addBtn.addEventListener('click', async () => {
            if (addBtn.disabled) return;
            const key = keyInput.value.trim();
            const value = valueInput.value.trim();
            if (!key || !value) {
                new Notice('请填写偏好名和偏好内容', 2000);
                return;
            }
            addBtn.disabled = true;
            try {
                await this.onAddPreference(categorySelect.value, key, value);
                this.close();
            } catch (e) {
                // 弹窗保持打开，方便用户改完重试；失败必须可见
                new Notice(`⚠️ 写入偏好记忆失败：${e instanceof Error ? e.message : String(e)}`, 6000);
                addBtn.disabled = false;
            }
        });
    }

    onClose(): void {
        this.contentEl.empty();
    }
}
