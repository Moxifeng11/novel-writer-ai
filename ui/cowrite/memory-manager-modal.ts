import { Modal, Setting, Notice, type App } from 'obsidian';
import { t } from '@/i18n';
import { ModalDirtyGuard } from '@/ui/components/modal-dirty-guard';

// E1/E3: 风格自学习 / 偏好记忆管理弹窗
// 以下只读视图由 engine 快照投影而来，只列本弹窗实际读取的字段，避免 UI 反向依赖 engine 内部类型
type PreferenceCategory = 'character' | 'plot' | 'style' | 'pacing' | 'dialogue' | 'description';

interface MemoryStylePatternView {
    type?: string;
    frequency?: number;
    userPreference?: number;
    pattern?: string;
}

interface MemoryPreferenceView {
    category?: string;
    key?: string;
    confidence?: number;
    value?: unknown;
}

interface MemorySnapshotView {
    styleGuide?: string;
    stylePatterns?: MemoryStylePatternView[];
    preferencePrompt?: string;
    preferences?: MemoryPreferenceView[];
}

type AddPreferenceHandler = (category: PreferenceCategory, key: string, value: string) => Promise<void>;

/**
 * 记忆管理器弹窗。
 */
export class MemoryManagerModal extends Modal {
    private snapshot: MemorySnapshotView;
    private onAddPreference: AddPreferenceHandler;
    /** 未保存修改的关闭确认（审计 A-5） */
    private dirtyGuard = new ModalDirtyGuard();

    constructor(app: App, snapshot: MemorySnapshotView, onAddPreference: AddPreferenceHandler) {
        super(app);
        this.snapshot = snapshot;
        this.onAddPreference = onAddPreference;
    }

    /**
     * onOpen 方法。
     */
    onOpen(): void {
    this.modalEl.addClass('nw-scope');
        this.titleEl.setText(t('cowrite.mem.title'));
        const { contentEl } = this;
        contentEl.empty();
        this.dirtyGuard.attach(this, this.app);
        contentEl.addEventListener('input', () => this.dirtyGuard.markDirty());
        contentEl.addEventListener('change', () => this.dirtyGuard.markDirty());
        contentEl.addClass('novel-writer-memory-modal');

        contentEl.createDiv({ cls: 'novel-writer-cowrite-modal-hint', text: t('cowrite.mem.hint') });

        const stats = contentEl.createDiv({ cls: 'novel-writer-memory-stats' });
        stats.createDiv({ cls: 'novel-writer-memory-stat', text: t('cowrite.mem.styleCount', { count: this.snapshot.stylePatterns?.length || 0 }) });
        stats.createDiv({ cls: 'novel-writer-memory-stat', text: t('cowrite.mem.prefCount', { count: this.snapshot.preferences?.length || 0 }) });

        this.renderStyleSection(contentEl);
        this.renderPreferenceSection(contentEl);
        this.renderAddPreferenceSection(contentEl);

        new Setting(contentEl).addButton(btn => btn.setButtonText(t('cowrite.edit.close')).setCta().onClick(() => this.close()));
    }

    private renderStyleSection(contentEl: HTMLElement): void {
        const section = contentEl.createDiv({ cls: 'novel-writer-memory-section' });
        section.createDiv({ cls: 'novel-writer-memory-section-title', text: t('cowrite.mem.sectionE1') });
        const styleGuide = (this.snapshot.styleGuide || '').trim();
        if (styleGuide) {
            section.createEl('pre', { cls: 'novel-writer-memory-pre', text: styleGuide });
        } else {
            section.createDiv({ cls: 'novel-writer-cowrite-empty', text: t('cowrite.mem.noPatterns') });
        }

        const patterns = (this.snapshot.stylePatterns || []).slice(0, 8);
        if (patterns.length) {
            const list = section.createDiv({ cls: 'novel-writer-memory-list' });
            for (const pattern of patterns) {
                const item = list.createDiv({ cls: 'novel-writer-memory-item' });
                item.createDiv({ cls: 'novel-writer-memory-item-title', text: t('cowrite.mem.patternItem', { type: pattern.type || 'style', pref: Number(pattern.userPreference || 0).toFixed(2), freq: pattern.frequency || 1 }) });
                item.createDiv({ cls: 'novel-writer-memory-item-body', text: pattern.pattern || t('cowrite.mem.emptyPattern') });
            }
        }
    }

    private renderPreferenceSection(contentEl: HTMLElement): void {
        const section = contentEl.createDiv({ cls: 'novel-writer-memory-section' });
        section.createDiv({ cls: 'novel-writer-memory-section-title', text: t('cowrite.mem.sectionE3') });
        const prompt = (this.snapshot.preferencePrompt || '').trim();
        if (prompt) {
            section.createEl('pre', { cls: 'novel-writer-memory-pre', text: prompt });
        }

        const preferences = (this.snapshot.preferences || []).slice(0, 12);
        if (!preferences.length) {
            section.createDiv({ cls: 'novel-writer-cowrite-empty', text: t('cowrite.mem.noPreferences') });
            return;
        }

        const list = section.createDiv({ cls: 'novel-writer-memory-list' });
        for (const preference of preferences) {
            const item = list.createDiv({ cls: 'novel-writer-memory-item' });
            item.createDiv({ cls: 'novel-writer-memory-item-title', text: t('cowrite.mem.prefItem', { category: preference.category || 'style', key: preference.key || '', conf: Number(preference.confidence || 0).toFixed(2) }) });
            const valueText = typeof preference.value === 'string' ? preference.value : JSON.stringify(preference.value);
            item.createDiv({ cls: 'novel-writer-memory-item-body', text: valueText || t('cowrite.mem.emptyPref') });
        }
    }

    private renderAddPreferenceSection(contentEl: HTMLElement): void {
        const section = contentEl.createDiv({ cls: 'novel-writer-memory-section novel-writer-memory-add' });
        section.createDiv({ cls: 'novel-writer-memory-section-title', text: t('cowrite.mem.addSection') });
        const categorySelect = section.createEl('select', { cls: 'nw-input novel-writer-memory-input' });
        const categories = [
            ['style', t('cowrite.mem.catStyle')],
            ['dialogue', t('cowrite.mem.catDialogue')],
            ['description', t('cowrite.mem.catDescription')],
            ['pacing', t('cowrite.mem.catPacing')],
            ['character', t('cowrite.mem.catCharacter')],
            ['plot', t('cowrite.mem.catPlot')]
        ];
        for (const [value, label] of categories) {
            categorySelect.createEl('option', { value, text: label });
        }
        const keyInput = section.createEl('input', { cls: 'nw-input novel-writer-memory-input', type: 'text', placeholder: t('cowrite.mem.keyPlaceholder') });
        const valueInput = section.createEl('textarea', { cls: 'novel-writer-memory-textarea', placeholder: t('cowrite.mem.valuePlaceholder') });
        const addBtn = section.createEl('button', { cls: 'novel-writer-cowrite-primary-btn', text: t('cowrite.mem.addBtn') });
        addBtn.addEventListener('click', () => { void (async () => {
            if (addBtn.disabled) return;
            const key = keyInput.value.trim();
            const value = valueInput.value.trim();
            if (!key || !value) {
                new Notice(t('cowrite.mem.needBothFields'), 2000);
                return;
            }
            addBtn.disabled = true;
            try {
                await this.onAddPreference(categorySelect.value as PreferenceCategory, key, value);
                this.dirtyGuard.markClean();
                this.close();
            } catch (e) {
                // 弹窗保持打开，方便用户改完重试；失败必须可见
                new Notice(t('cowrite.mem.writeFailed', { msg: e instanceof Error ? e.message : String(e) }), 6000);
                addBtn.disabled = false;
            }
        })(); });
    }

    /**
     * onClose 方法。
     */
    onClose(): void {
        this.contentEl.empty();
    }
}
