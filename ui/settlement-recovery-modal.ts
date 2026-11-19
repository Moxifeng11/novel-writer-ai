/**
 * settlement-recovery-modal.ts — 「恢复中断结算」面板
 *
 * 背景：结算中途崩溃/退出会留下 `04-项目总控/事务/结算回滚-<章>.json`，
 * 不恢复就是「实体已改、正文未结算」的半套状态。引擎已有
 * `recoverInterruptedSettlement(project, chapter?, dryRun)`，但此前没有界面入口，
 * 自检文案却让用户「点『恢复中断结算』」——本面板补上这个入口。
 *
 * 流程：dryRun 预览 → 逐章/全部确认 → 真实回滚 → 展示 回滚/失败/日志是否清理。
 */

import { Modal, Notice, Setting } from 'obsidian';
import type NovelWriterPlugin from '@/main';
import { listProjectIds } from '@/shared/project-catalog';
import { OperationConfirmModal } from '@/ui/components/progress/operation-confirm-modal';
import { t } from '@/i18n';
import {
    describeSettlementOutcome,
    describeSettlementPreview,
    describeSettlementRow,
    hasPendingSettlement,
    type SettlementRecoveryRow,
} from '@/shared/settlement-recovery-model';

/**
 * 恢复中断结算面板。
 */
export class SettlementRecoveryModal extends Modal {
    private readonly project: string;
    private rows: SettlementRecoveryRow[] = [];
    private bodyEl: HTMLElement | null = null;
    private busy = false;
    private loading = false;

    /**
     * @param plugin - 插件实例
     * @param project - 目标项目（绝对/库内相对路径）
     */
    constructor(
        private readonly plugin: NovelWriterPlugin,
        project?: string,
    ) {
        super(plugin.app);
        const projects = listProjectIds(plugin.app);
        this.project = String(project ?? '').trim() || projects[0] || '';
    }

    /** 打开面板并做一次预览 */
    onOpen(): void {
        this.modalEl.addClass('nw-settlement-recovery');
        this.render();
        void this.loadPreview();
    }

    /** 关闭清空 */
    onClose(): void {
        this.contentEl.empty();
    }

    /** 预览：dryRun 拿每章残留条目 */
    private async loadPreview(): Promise<void> {
        if (this.loading) return;
        this.loading = true;
        try {
            const result = await this.plugin.recoverInterruptedSettlement(this.project, undefined, true);
            this.rows = result.chapters;
        } catch (error) {
            new Notice(`读取残留结算日志失败：${error instanceof Error ? error.message : String(error)}`, 8000);
            this.rows = [];
        } finally {
            this.loading = false;
            this.render();
        }
    }

    /** 执行恢复（单个章节或全部） */
    private async runRecovery(chapterName?: string): Promise<void> {
        if (this.busy) return;
        const preview = this.rows.filter(row => row.entries > 0 && (!chapterName || row.chapterName === chapterName));
        if (preview.length === 0) {
            new Notice('没有可恢复的章节');
            return;
        }
        const summary = chapterName
            ? t('common.confirmTexts.recoverSettlement.descChapter', { chapter: chapterName })
            : t('common.confirmTexts.recoverSettlement.descAll', { count: preview.length });
        const confirmed = await OperationConfirmModal.confirm(this.app, {
            title: t('common.confirmTexts.recoverSettlement.title'),
            description: summary,
            confirmText: t('common.confirm'),
            cancelText: t('common.cancel'),
        });
        if (!confirmed) return;
        this.busy = true;
        this.render();
        try {
            const result = await this.plugin.recoverInterruptedSettlement(this.project, chapterName, false);
            new Notice(describeSettlementOutcome(result.chapters), 8000);
            this.rows = result.chapters;
        } catch (error) {
            new Notice(`恢复失败：${error instanceof Error ? error.message : String(error)}`, 8000);
        } finally {
            this.busy = false;
            this.render();
            await this.loadPreview();
        }
    }

    /** 渲染 */
    private render(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h3', { text: '🧯 恢复中断结算' });
        contentEl.createEl('p', {
            text: `项目：${this.project}`,
            cls: 'setting-item-description',
        });

        const pending = hasPendingSettlement(this.rows);
        for (const line of describeSettlementPreview(this.rows)) {
            contentEl.createEl('p', { text: line, cls: 'setting-item-description' });
        }

        this.bodyEl = contentEl.createDiv({ cls: 'nw-settlement-recovery-body' });
        for (const row of this.rows) {
            if (row.entries <= 0) continue;
            const setting = new Setting(this.bodyEl)
                .setName(describeSettlementRow(row, true))
                .setDesc('回滚结算写入的实体字段 / 整份文件 / 追加内容；成功后会删除该章日志')
                .addButton(button => button
                    .setButtonText(this.busy ? '处理中…' : '恢复本章')
                    .setDisabled(this.busy)
                    .onClick(() => void this.runRecovery(row.chapterName)));
            setting.settingEl.addClass('nw-settlement-recovery-row');
        }

        new Setting(contentEl)
            .addButton(button => button
                .setButtonText('重新检查')
                .setDisabled(this.busy)
                .onClick(() => void this.loadPreview()))
            .addButton(button => button
                .setButtonText(this.busy ? '处理中…' : '全部恢复')
                .setCta()
                .setDisabled(this.busy || !pending)
                .onClick(() => void this.runRecovery()));
    }
}
