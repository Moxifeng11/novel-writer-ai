/**
 * job-center-modal.ts — 任务中心
 *
 * 消费 services/job-service 的统一任务列表：进行中可取消，失败/取消可重试，
 * 并显示阶段、进度与错误原因。任务状态只在内存中，关闭弹窗不会中止任务。
 */
import { App, Modal, Notice } from 'obsidian';
import type NovelWriterPlugin from '@/main';
import type { JobRecord, JobStatus } from '@/services/job-service';

const STATUS_LABEL: Record<JobStatus, string> = {
    queued: '排队中',
    running: '进行中',
    succeeded: '已完成',
    failed: '失败',
    cancelled: '已取消',
};

const STATUS_ICON: Record<JobStatus, string> = {
    queued: '⏳',
    running: '⏵',
    succeeded: '✅',
    failed: '❌',
    cancelled: '⏹',
};

/**
 * 任务中心弹窗。
 */
export class JobCenterModal extends Modal {
    private readonly plugin: NovelWriterPlugin;
    private unsubscribe: (() => void) | null = null;
    private listEl: HTMLElement | null = null;

    /**
     * @param app - Obsidian 应用实例
     * @param plugin - 插件实例
     */
    constructor(app: App, plugin: NovelWriterPlugin) {
        super(app);
        this.plugin = plugin;
    }

    /** 打开并订阅任务变更。 */
    onOpen(): void {
        this.modalEl.addClass('nw-scope', 'nw-modal');
        this.titleEl.setText('🧵 任务中心');
        this.contentEl.empty();
        this.contentEl.addClass('nw-job-center');
        this.listEl = this.contentEl.createDiv({ cls: 'nw-job-center-list' });
        this.unsubscribe = this.plugin.getJobService().subscribe(() => this.render());
        this.render();
    }

    /** 关闭时取消订阅，不取消任务。 */
    onClose(): void {
        this.unsubscribe?.();
        this.unsubscribe = null;
        this.contentEl.empty();
    }

    private render(): void {
        if (!this.listEl) return;
        this.listEl.empty();
        const jobs = this.plugin.getJobService().list();
        if (jobs.length === 0) {
            const empty = this.listEl.createDiv({ cls: 'nw-empty-state' });
            empty.createDiv({ cls: 'nw-empty-state-icon', text: '🧵' });
            empty.createDiv({ cls: 'nw-empty-state-title', text: '暂无任务' });
            empty.createDiv({
                cls: 'nw-empty-state-description',
                text: '批量生成、章节一键跑、导出等长任务会出现在这里。',
            });
            return;
        }

        const active = jobs.filter(job => job.status === 'running' || job.status === 'queued').length;
        this.listEl.createDiv({
            cls: 'nw-job-center-summary',
            text: active > 0 ? `${active} 个任务进行中` : '没有进行中的任务',
        });
        for (const job of jobs) this.renderJob(job);
    }

    private renderJob(job: JobRecord): void {
        if (!this.listEl) return;
        const row = this.listEl.createDiv({ cls: `nw-job-row nw-is-${job.status}` });
        const head = row.createDiv({ cls: 'nw-job-row-head' });
        head.createSpan({ cls: 'nw-job-status', text: `${STATUS_ICON[job.status]} ${STATUS_LABEL[job.status]}` });
        head.createSpan({ cls: 'nw-job-title', text: job.title });
        if (job.project) head.createSpan({ cls: 'nw-job-project', text: job.project });

        const progress = row.createDiv({ cls: 'nw-job-progress' });
        const total = job.progress.total;
        const current = job.progress.current;
        const percent = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;
        progress.createEl('progress', {
            cls: 'nw-job-progress-native',
            attr: { value: String(percent), max: '100' },
        });
        progress.createSpan({
            cls: 'nw-job-progress-label',
            text: job.progress.label || (total > 0 ? `${current}/${total}` : '准备中'),
        });

        if (job.error) row.createDiv({ cls: 'nw-job-error', text: `原因：${job.error}` });

        const actions = row.createDiv({ cls: 'nw-job-actions' });
        if (job.status === 'running' || job.status === 'queued') {
            const cancel = actions.createEl('button', { cls: 'nw-btn nw-btn-secondary', text: '取消' });
            cancel.addEventListener('click', () => {
                this.plugin.getJobService().cancel(job.id);
            });
        } else if ((job.status === 'failed' || job.status === 'cancelled') && job.retryable) {
            const retry = actions.createEl('button', { cls: 'nw-btn nw-btn-primary', text: '重试' });
            retry.addEventListener('click', () => {
                const next = this.plugin.getJobService().retry(job.id);
                if (!next) new Notice('该任务不可重试');
                this.render();
            });
        }
    }
}
