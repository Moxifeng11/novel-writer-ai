import { Modal, Setting, type App } from 'obsidian';
import { SentenceEditRecord } from '@/shared/types';
import { t } from '@/i18n';

// B3: 历史建议回溯弹窗
/**
 * 历史弹窗。
 */
export class HistoryModal extends Modal {
    private records: SentenceEditRecord[];
    private onInsert: (text: string) => void;

    constructor(app: App, records: SentenceEditRecord[], onInsert: (text: string) => void) {
        super(app);
        this.records = records;
        this.onInsert = onInsert;
    }

    /**
     * onOpen 方法。
     */
    onOpen(): void {
    this.modalEl.addClass('nw-scope');
        this.titleEl.setText(t('cowrite.hist.title'));
        const { contentEl } = this;
        contentEl.empty();
        if (!this.records.length) {
            contentEl.createDiv({ cls: 'novel-writer-cowrite-modal-hint', text: t('cowrite.hist.emptyHint') });
            new Setting(contentEl).addButton(btn => btn.setButtonText(t('cowrite.edit.close')).setCta().onClick(() => this.close()));
            return;
        }
        contentEl.createDiv({ cls: 'novel-writer-cowrite-modal-hint', text: t('cowrite.hist.insertHint') });
        const list = contentEl.createDiv({ cls: 'novel-writer-cowrite-history-list' });
        this.records.forEach((rec, idx) => {
            const chosen = rec.suggestions?.find(sg => sg.id === rec.chosenSuggestionId);
            const text = (rec.humanModifiedText || chosen?.text || '').trim();
            if (!text) return;
            const item = list.createDiv({ cls: 'novel-writer-cowrite-history-item' });
            const time = new Date(rec.acceptedAt || rec.createdAt || Date.now());
            const stamp = `${time.getHours().toString().padStart(2, '0')}:${time.getMinutes().toString().padStart(2, '0')}`;
            item.createDiv({ cls: 'novel-writer-cowrite-history-meta', text: `#${idx + 1} \u00B7 ${stamp}${chosen ? ' \u00B7 ' + (chosen.direction || '') : ''}` });
            item.createDiv({ cls: 'novel-writer-cowrite-history-text', text });
            const actions = item.createDiv({ cls: 'novel-writer-cowrite-history-actions' });
            const insertBtn = actions.createEl('button', { text: t('cowrite.hist.reinsertBtn'), cls: 'novel-writer-cowrite-primary-btn' });
            insertBtn.addEventListener('click', () => { this.onInsert(text); this.close(); });
        });
        new Setting(contentEl).addButton(btn => btn.setButtonText(t('cowrite.edit.close')).onClick(() => this.close()));
    }

    /**
     * onClose 方法。
     */
    onClose(): void {
        this.contentEl.empty();
    }
}