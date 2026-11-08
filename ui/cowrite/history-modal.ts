import { Modal, Setting, Notice, type App } from 'obsidian';
import { SentenceEditRecord } from '@/shared/types';

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
        this.titleEl.setText('\u{1F558} 历史建议回溯（最近 20 条）');
        const { contentEl } = this;
        contentEl.empty();
        if (!this.records.length) {
            contentEl.createDiv({ cls: 'novel-writer-cowrite-modal-hint', text: '还没有已接受的建议记录。接受或编辑建议后，这里会出现可回溯的历史。' });
            new Setting(contentEl).addButton(btn => btn.setButtonText('关闭').setCta().onClick(() => this.close()));
            return;
        }
        contentEl.createDiv({ cls: 'novel-writer-cowrite-modal-hint', text: '点「重新插入」可把历史文本插入当前光标处。' });
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
            const insertBtn = actions.createEl('button', { text: '\u21B5 重新插入', cls: 'novel-writer-cowrite-primary-btn' });
            insertBtn.addEventListener('click', () => { this.onInsert(text); this.close(); });
        });
        new Setting(contentEl).addButton(btn => btn.setButtonText('关闭').onClick(() => this.close()));
    }

    /**
     * onClose 方法。
     */
    onClose(): void {
        this.contentEl.empty();
    }
}