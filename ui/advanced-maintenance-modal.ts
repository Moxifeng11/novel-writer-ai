/**
 * advanced-maintenance-modal.ts — 高级维护面板（脚本专用能力的界面入口）
 *
 * 背景：这四个能力此前只有 `plugin-api` 可调，普通用户在界面上摸不到
 * （同类问题此前已出现两次：MCP 设置页空白、质量闭环无入口）。本面板把
 * 它们收进一个可发现的入口：
 * - 关系图同步（关系状态.md → 设定图派生边，可预览）
 * - 重建断言索引（事实库/摘要/档案/台账可由断言.json 重建，可预览）
 * - 写作基线探测（旧策略 vs 场景精确注入的 token 对比，会调用 AI）
 * - 场景循环生成（逐场生成再合并，默认只预览，落盘需二次确认）
 */

import { Modal, Notice, Setting } from 'obsidian';
import type NovelWriterPlugin from '@/main';
import { getChaptersForProject } from '@/ui/project-utils';
import { listProjectIds } from '@/shared/project-catalog';
import { describeMissingChapter, summarizeMaintenanceResult } from '@/shared/maintenance-model';
import { OperationConfirmModal } from '@/ui/components/progress/operation-confirm-modal';

/** 当前运行中的动作 */
type BusyAction = '' | 'sync' | 'assertions' | 'probe' | 'scene';

/**
 * 高级维护面板。
 */
export class AdvancedMaintenanceModal extends Modal {
    private project = '';
    private projects: string[] = [];
    private chapters: string[] = [];
    private chapter = '';
    private busy: BusyAction = '';
    private outputEl: HTMLElement | null = null;
    private outputLines: string[] = [];

    /**
     * @param plugin - 插件实例
     * @param project - 目标项目（省略时取当前活动项目/第一个项目）
     */
    constructor(private readonly plugin: NovelWriterPlugin, project?: string) {
        super(plugin.app);
        this.project = String(project ?? plugin.getActiveProject() ?? '').trim();
    }

    /** 打开 */
    onOpen(): void {
        this.modalEl.addClass('nw-advanced-maintenance');
        this.projects = listProjectIds(this.app);
        if (!this.project) this.project = this.projects[0] ?? '';
        this.refreshChapters();
        this.render();
    }

    /** 关闭清空 */
    onClose(): void {
        this.contentEl.empty();
    }

    /** 重建章节列表 */
    private refreshChapters(): void {
        this.chapters = this.project
            ? getChaptersForProject(this.app, this.project).map(entry => entry.chapter)
            : [];
        const context = this.plugin.getWorkbenchContext();
        const preferred = context && context.project === this.project ? context.chapterName : '';
        this.chapter = this.chapters.includes(preferred) ? preferred : (this.chapters[0] ?? '');
    }

    /**
     * 执行一个动作并展示结果。
     *
     * @param action - 动作类型
     * @param run - 实际调用
     */
    private async run(action: Exclude<BusyAction, ''>, run: () => Promise<unknown>): Promise<void> {
        if (this.busy) return;
        this.busy = action;
        this.outputLines = ['⌛ 执行中…'];
        this.render();
        try {
            const result = await run();
            this.outputLines = summarizeMaintenanceResult(result);
        } catch (error) {
            this.outputLines = [`❌ 失败：${error instanceof Error ? error.message : String(error)}`];
            new Notice(`维护动作失败：${this.outputLines[0]}`, 8000);
        } finally {
            this.busy = '';
            this.render();
        }
    }

    /** 渲染 */
    private render(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h3', { text: '🧰 高级维护' });
        contentEl.createEl('p', {
            text: '这些是脚本级维护能力：先点「预览」确认会发生什么，再决定是否写入。'
                + '关系图同步/断言重建不调用 AI；基线探测与场景循环生成会调用模型。',
            cls: 'setting-item-description',
        });

        if (!this.project) {
            contentEl.createEl('p', {
                text: '没有找到作品项目：请先在「项目与章节」里打开一个作品。',
                cls: 'setting-item-description',
            });
            return;
        }

        if (this.projects.length > 1) {
            new Setting(contentEl)
                .setName('项目')
                .addDropdown(dropdown => {
                    for (const item of this.projects) dropdown.addOption(item, item);
                    dropdown.setValue(this.project);
                    dropdown.onChange(value => {
                        this.project = value;
                        this.outputLines = [];
                        this.refreshChapters();
                        this.render();
                    });
                });
        }

        new Setting(contentEl)
            .setName('章节')
            .setDesc(this.chapters.length > 0 ? `共 ${this.chapters.length} 章（基线探测/场景循环需要）` : '该项目还没有章节')
            .addDropdown(dropdown => {
                if (this.chapters.length === 0) dropdown.addOption('', '（无章节）');
                for (const name of this.chapters) dropdown.addOption(name, name);
                dropdown.setValue(this.chapter);
                dropdown.onChange(value => { this.chapter = value; });
            });

        const disabled = Boolean(this.busy);
        const label = (text: string, action: BusyAction): string => (this.busy === action ? `${text}中…` : text);

        new Setting(contentEl)
            .setName('关系图同步')
            .setDesc('由「关系状态.md」派生设定图边（保留手工边，移除过期派生边）')
            .addButton(button => button
                .setButtonText(label('预览', 'sync'))
                .setDisabled(disabled)
                .onClick(() => void this.run('sync', () => this.plugin.syncRelationGraph(this.project, true))))
            .addButton(button => button
                .setButtonText('同步')
                .setCta()
                .setDisabled(disabled)
                .onClick(() => void this.run('sync', () => this.plugin.syncRelationGraph(this.project, false))));

        new Setting(contentEl)
            .setName('重建断言索引')
            .setDesc('事实库/摘要/档案/台账以断言索引为单一真源重新生成（旧文件自动备份）')
            .addButton(button => button
                .setButtonText(label('预览', 'assertions'))
                .setDisabled(disabled)
                .onClick(() => void this.run('assertions', () => this.plugin.rebuildAssertions(this.project, true))))
            .addButton(button => button
                .setButtonText('重建')
                .setCta()
                .setDisabled(disabled)
                .onClick(() => void this.run('assertions', () => this.plugin.rebuildAssertions(this.project, false))));

        new Setting(contentEl)
            .setName('写作基线探测')
            .setDesc('对比「整份注入」与「场景精确注入」的 prompt token 消耗（会调用 AI，费用很小）')
            .addButton(button => button
                .setButtonText(label('运行探测', 'probe'))
                .setDisabled(disabled)
                .onClick(() => {
                    const missing = describeMissingChapter('写作基线探测', this.chapter);
                    if (missing) {
                        new Notice(missing, 5000);
                        return;
                    }
                    void this.run('probe', () => this.plugin.runBaselineProbe(this.project, this.chapter));
                }));

        new Setting(contentEl)
            .setName('场景循环生成正文')
            .setDesc('逐场生成再合并（失败场景不落盘）；默认预览，执行会覆盖本章正文并触发备份')
            .addButton(button => button
                .setButtonText(label('预览', 'scene'))
                .setDisabled(disabled)
                .onClick(() => {
                    const missing = describeMissingChapter('场景循环生成', this.chapter);
                    if (missing) {
                        new Notice(missing, 5000);
                        return;
                    }
                    void this.run('scene', () => this.plugin.generateChapterBySceneLoop(this.project, this.chapter, true));
                }))
            .addButton(button => button
                .setButtonText('执行并落盘')
                .setWarning()
                .setDisabled(disabled)
                .onClick(async () => {
                    const missing = describeMissingChapter('场景循环生成', this.chapter);
                    if (missing) {
                        new Notice(missing, 5000);
                        return;
                    }
                    const confirmed = await OperationConfirmModal.confirm(this.app, {
                        title: `用「场景循环」重新生成「${this.chapter}」？`,
                        description: '会调用 AI 逐场生成，然后合并写入正文；覆盖前会走备份，失败场景不会写入。',
                        warning: '建议先用「预览」确认场景数量与人物解析。',
                    });
                    if (!confirmed) return;
                    void this.run('scene', () => this.plugin.generateChapterBySceneLoop(this.project, this.chapter, false));
                }));

        contentEl.createEl('h4', { text: '输出' });
        this.outputEl = contentEl.createDiv();
        if (this.outputLines.length === 0) {
            this.outputEl.createEl('p', { text: '还没有执行动作。', cls: 'setting-item-description' });
        } else {
            const pre = this.outputEl.createEl('pre', { cls: 'setting-item-description' });
            pre.setText(this.outputLines.join('\n'));
        }
    }
}
