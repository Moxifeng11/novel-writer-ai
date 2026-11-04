/**
 * batch-novels-modal.ts — 正式「批量 N 章」入口
 *
 * 与章节工作台共用同一套步骤、模板与落盘入口，不再走已废弃的
 * auto-writer / batch-chapters / continue-chapters 三条简化链路。
 */
import { App, Modal, Notice, Setting } from 'obsidian';
import NovelWriterPlugin from '@/main';
import {
    BatchPipelineRunner,
    buildBatchTargets,
    type BatchChapterResult,
} from './full-writer/batch-pipeline-runner';

/**
 * BatchNovelsModal 类。
 */
export class BatchNovelsModal extends Modal {
    private project = '';
    private volumeNum = 1;
    private startChapter = 1;
    private count = 3;
    private resume = true;
    private runSettlement = true;

    private running = false;
    private progressEl: HTMLElement | null = null;
    private currentJobId = '';
    private jobUnsubscribe: (() => void) | null = null;

    constructor(
        app: App,
        private plugin: NovelWriterPlugin,
        defaults?: { project?: string; volumeNum?: number; startChapter?: number },
    ) {
        super(app);
        this.project = defaults?.project || this.detectProject();
        this.volumeNum = defaults?.volumeNum || this.detectVolume();
        this.startChapter = defaults?.startChapter || this.detectNextChapter();
    }

    /**
     * onOpen 方法。
     */
    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h2', { text: '📚 批量生成章节（正式流程）' });
        contentEl.createEl('p', {
            text: '逐章执行 7 个步骤：信息规划 → 情节蒸馏 → 大纲摘要 → 情绪规划 → Scene展开 → 正文 → 分析报告；每章结束自动结算。已完成的步骤会自动跳过。',
            cls: 'setting-item-description',
        });

        new Setting(contentEl)
            .setName('项目')
            .setDesc(this.project || '未检测到项目，请先打开项目内任意章节')
            .addText(text => text
                .setPlaceholder('项目文件夹名')
                .setValue(this.project)
                .onChange(value => { this.project = value.trim(); }));

        new Setting(contentEl)
            .setName('卷号')
            .addText(text => text
                .setValue(String(this.volumeNum))
                .onChange(value => { this.volumeNum = Math.max(1, parseInt(value, 10) || 1); }));

        new Setting(contentEl)
            .setName('起始章')
            .addText(text => text
                .setValue(String(this.startChapter))
                .onChange(value => { this.startChapter = Math.max(1, parseInt(value, 10) || 1); }));

        new Setting(contentEl)
            .setName('生成章数')
            .addText(text => text
                .setValue(String(this.count))
                .onChange(value => { this.count = Math.max(1, parseInt(value, 10) || 1); }));

        new Setting(contentEl)
            .setName('断点续跑')
            .setDesc('已完成的步骤直接跳过，只补缺失部分')
            .addToggle(toggle => toggle
                .setValue(this.resume)
                .onChange(value => { this.resume = value; }));

        new Setting(contentEl)
            .setName('执行章节结算')
            .setDesc('与工作台步骤 10 一致：更新实体、伏笔、时间线与正文 frontmatter')
            .addToggle(toggle => toggle
                .setValue(this.runSettlement)
                .onChange(value => { this.runSettlement = value; }));

        const btnRow = contentEl.createDiv({ cls: 'modal-button-container' });
        const startBtn = btnRow.createEl('button', { text: '开始批量生成', cls: 'mod-cta' });
        const cancelBtn = btnRow.createEl('button', { text: '取消' });
        cancelBtn.style.display = 'none';

        this.progressEl = contentEl.createDiv();

        startBtn.addEventListener('click', () => {
            if (this.running) return;
            if (!this.project) {
                new Notice('⚠️ 未检测到项目，请先填写项目文件夹名');
                return;
            }
            const targets = buildBatchTargets(
                `第${this.volumeNum}卷`,
                this.volumeNum,
                this.startChapter,
                this.count,
            );
            this.running = true;
            startBtn.disabled = true;
            cancelBtn.style.display = '';
            this.renderProgress(`准备生成 ${targets.length} 章...`);

            const jobs = this.plugin.getJobService();
            const job = jobs.start({
                kind: 'batch',
                title: `批量生成 ${targets.length} 章`,
                project: this.project,
                run: async (ctx) => {
                    ctx.update({ current: 0, total: targets.length, label: '准备中' });
                    const runner = new BatchPipelineRunner(this.app, this.plugin);
                    const results = await runner.run(this.project, targets, {
                        resume: this.resume,
                        runSettlement: this.runSettlement,
                        signal: ctx.signal,
                        onChapterStart: (target, index, total) => {
                            ctx.update({ current: index, total, label: `${target.chapterName} · 准备中` });
                            this.renderProgress(`第 ${index + 1}/${total} 章 · ${target.chapterName} · 准备中`);
                        },
                        onStepStart: (target, stepKey) => {
                            ctx.update({ label: `${target.chapterName} → ${stepKey}` });
                            this.appendProgress(`${target.chapterName} → ${stepKey}`);
                        },
                    });
                    this.renderSummary(results);
                    return results;
                },
            });
            this.currentJobId = job.id;
            const onCancel = () => jobs.cancel(job.id);
            cancelBtn.addEventListener('click', onCancel);
            this.jobUnsubscribe = jobs.subscribe(event => {
                if (event.job.id !== job.id) return;
                if (event.job.status === 'failed') {
                    this.renderProgress(`❌ 批量生成异常：${event.job.error || '未知错误'}`);
                }
                if (event.type === 'finished' || event.type === 'cancelled') {
                    this.running = false;
                    startBtn.disabled = false;
                    cancelBtn.style.display = 'none';
                    cancelBtn.removeEventListener('click', onCancel);
                    this.jobUnsubscribe?.();
                    this.jobUnsubscribe = null;
                }
            });
        });
    }

    /**
     * onClose 方法。
     */
    onClose(): void {
        // 关闭弹窗视为放弃本次批量：任务中心仍保留取消记录
        if (this.currentJobId) this.plugin.getJobService().cancel(this.currentJobId);
        this.jobUnsubscribe?.();
        this.jobUnsubscribe = null;
        this.contentEl.empty();
    }

    private renderProgress(text: string): void {
        if (!this.progressEl) return;
        this.progressEl.empty();
        this.progressEl.createEl('p', { text });
    }

    private appendProgress(text: string): void {
        if (!this.progressEl) return;
        this.progressEl.createEl('div', { text: `· ${text}`, cls: 'setting-item-description' });
    }

    private renderSummary(results: BatchChapterResult[]): void {
        if (!this.progressEl) return;
        const done = results.filter(r => r.status === 'done').length;
        const skipped = results.filter(r => r.status === 'skipped').length;
        const failed = results.filter(r => r.status === 'failed');
        const summary = this.progressEl.createDiv();
        const skippedText = skipped > 0 ? `，跳过 ${skipped} 章（已结算）` : '';
        summary.createEl('h3', { text: `完成 ${done}/${results.length} 章${skippedText}` });
        for (const item of failed) {
            summary.createEl('div', {
                text: `❌ ${item.target.chapterName}${item.failedStep ? `（${item.failedStep}）` : ''}：${item.error || '未知错误'}`,
            });
        }
        const skippedNotice = skipped > 0 ? `，跳过 ${skipped} 章` : '';
        new Notice(`批量生成结束：成功 ${done} 章${skippedNotice}，失败 ${failed.length} 章`, 6000);
    }

    private detectProject(): string {
        // 工作台/项目页没有 activeFile：统一走命令层章节目标，避免默认落到空项目
        const target = this.plugin.getActiveChapterTarget();
        if (target?.project) return target.project;
        return this.plugin.getActiveProject() || '';
    }

    private detectVolume(): number {
        const target = this.plugin.getActiveChapterTarget();
        if (!target) return 1;
        const match = target.volume.match(/\d+/);
        return match ? parseInt(match[0], 10) : 1;
    }

    /** 扫描项目正文，返回现有最大章号 + 1 */
    private detectNextChapter(): number {
        const project = this.detectProject();
        if (!project) return 1;
        const prefix = `${project}/03-大纲与章节/正文/`;
        let max = 0;
        for (const file of this.app.vault.getFiles()) {
            if (!file.path.startsWith(prefix)) continue;
            const match = file.name.match(/第(\d+)章/);
            if (match) max = Math.max(max, parseInt(match[1], 10));
        }
        return max + 1;
    }
}
