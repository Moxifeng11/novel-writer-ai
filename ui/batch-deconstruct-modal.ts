/**
 * batch-deconstruct-modal.ts — 批量拆解任务管理 Modal
 *
 * 功能：管理多本书的批量拆解任务，支持增量结果预览、任务进度监控、暂停取消。
 *
 * 设计原则：
 * - 选择多文件后批量拆解
 * - 实时显示每本书的进度和结果
 * - 支持暂停/取消单个或全部任务
 * - 增量结果实时预览
 * - 断点续传提示
 */

import { App, Modal, Notice, TFile } from 'obsidian';
import NovelWriterPlugin from '@/main';
import { PartialResult } from '@/engine/incremental-result-aggregator';
import { SchedulerSegmentIntegration, SchedulerSegmentOptions } from '@/engine/scheduler-segment-integration';
import { CheckpointManager } from '@/services/checkpoint-manager';
import type { DeconstructDimension } from '@/engine/deconstruction-worker-manager';

interface BatchTask {
    id: string;
    file: TFile;
    status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
    progress: number;
    message: string;
    partialResult: PartialResult | null;
    error?: string;
}

/**
 * BatchDeconstructModal 类。
 */
export class BatchDeconstructModal extends Modal {
    private plugin: NovelWriterPlugin;
    private tasks: BatchTask[] = [];
    private selectedFiles: TFile[] = [];
    private isRunning = false;
    private abortControllers: Map<string, AbortController> = new Map();
    private taskContainer!: HTMLElement;

    constructor(app: App, plugin: NovelWriterPlugin) {
        super(app);
        this.plugin = plugin;
    }

    /**
     * onOpen 方法。
     */
    onOpen(): void {
        this.modalEl.addClass('nw-scope');
        const { contentEl } = this;

        const wrapper = contentEl.parentElement as HTMLElement;
        if (wrapper) {
            wrapper.addClass('nw-modal');
            wrapper.style.setProperty('margin', 'auto', 'important');
        }
        contentEl.style.width = '900px';
        contentEl.style.setProperty('max-height', '85vh', 'important');
        contentEl.style.setProperty('overflow-y', 'auto', 'important');
        contentEl.empty();

        contentEl.createEl('h2', { text: '📚 批量拆解' });

        this.renderFileSelector(contentEl);
        this.taskContainer = contentEl.createDiv({ attr: { style: 'margin-top:20px;' } });
        this.renderTaskList();
        this.renderGlobalActionButtons(contentEl);
    }

    private renderFileSelector(contentEl: HTMLElement): void {
        const selectorDiv = contentEl.createDiv({ attr: { style: 'display:flex;gap:12px;align-items:center;' } });

        const selectBtn = selectorDiv.createEl('button', {
            cls: 'nw-btn novel-writer-btn',
            text: '选择文件'
        });
        selectBtn.onclick = () => this.selectFiles();

        const fileList = selectorDiv.createDiv({
            attr: { style: 'flex:1;padding:8px;border:1px dashed var(--border-color);border-radius:4px;min-height:32px;' }
        });
        this.updateFileList(fileList);
    }

    private updateFileList(el: HTMLElement): void {
        el.empty();
        if (this.selectedFiles.length === 0) {
            el.textContent = '未选择文件';
            return;
        }
        el.textContent = `${this.selectedFiles.length} 个文件已选择`;
    }

    private async selectFiles(): Promise<void> {
        const files = await (this.app as any).vault.openFilePicker({
            multi: true,
            canChooseFiles: true,
            canChooseFolders: false,
            extensions: ['md', 'txt'],
        });

        if (files.length > 0) {
            this.selectedFiles = files;
            this.updateFileList(this.contentEl.querySelector('div[style*="flex:1"]') as HTMLElement);
            this.createTasksFromFiles();
            this.renderTaskList();
        }
    }

    private createTasksFromFiles(): void {
        this.tasks = this.selectedFiles.map((file, index) => ({
            id: `batch-task-${Date.now()}-${index}`,
            file,
            status: 'pending',
            progress: 0,
            message: '等待开始',
            partialResult: null,
        }));
    }

    private renderTaskList(): void {
        this.taskContainer.empty();

        if (this.tasks.length === 0) {
            this.taskContainer.createDiv({
                attr: { style: 'text-align:center;padding:40px;color:var(--text-muted);' },
                text: '请先选择要拆解的文件'
            });
            return;
        }

        for (const task of this.tasks) {
            const taskRow = this.taskContainer.createDiv({
                attr: {
                    style: 'display:flex;align-items:center;gap:12px;padding:12px;border:1px solid var(--border-color);border-radius:8px;margin-bottom:8px;'
                }
            });

            const statusIcon = taskRow.createEl('span', {
                attr: { style: 'width:24px;text-align:center;font-size:16px;' },
                text: this.getStatusIcon(task.status)
            });

            const infoDiv = taskRow.createDiv({ attr: { style: 'flex:1;min-width:0;' } });
            infoDiv.createEl('div', {
                attr: { style: 'font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;' },
                text: task.file.name
            });
            infoDiv.createEl('div', {
                attr: { style: 'font-size:12px;color:var(--text-muted);' },
                text: task.message
            });

            const progressDiv = taskRow.createDiv({ attr: { style: 'width:150px;' } });
            this.renderProgress(progressDiv, task);

            const actionDiv = taskRow.createDiv({ attr: { style: 'display:flex;gap:4px;' } });
            this.renderActionButtons(actionDiv, task);

            if (task.partialResult && task.status === 'processing') {
                this.renderPartialResult(taskRow, task);
            }

            if (task.error) {
                taskRow.createEl('div', {
                    attr: { style: 'color:var(--color-error);font-size:12px;margin-top:4px;' },
                    text: task.error
                });
            }
        }
    }

    private getStatusIcon(status: BatchTask['status']): string {
        switch (status) {
            case 'pending': return '⏳';
            case 'processing': return '🔄';
            case 'completed': return '✅';
            case 'failed': return '❌';
            case 'cancelled': return '🚫';
        }
    }

    private renderProgress(container: HTMLElement, task: BatchTask): void {
        container.empty();

        const bar = container.createEl('div', {
            attr: {
                style: 'height:6px;background:var(--background-secondary);border-radius:3px;overflow:hidden;'
            }
        });
        bar.createEl('div', {
            attr: {
                style: `height:100%;width:${task.progress}%;background:${this.getProgressColor(task)};transition:width 0.3s;`
            }
        });

        container.createEl('div', {
            attr: { style: 'font-size:11px;color:var(--text-muted);text-align:right;margin-top:2px;' },
            text: `${Math.round(task.progress)}%`
        });
    }

    private getProgressColor(task: BatchTask): string {
        if (task.status === 'completed') return 'var(--color-success)';
        if (task.status === 'failed') return 'var(--color-error)';
        if (task.status === 'cancelled') return 'var(--text-muted)';
        return 'var(--accent-color)';
    }

    private renderActionButtons(container: HTMLElement, task: BatchTask): void {
        container.empty();

        if (task.status === 'pending') {
            const startBtn = container.createEl('button', {
                cls: 'nw-btn novel-writer-btn',
                text: '开始',
                attr: { style: 'padding:4px 8px;font-size:12px;' }
            });
            startBtn.onclick = () => this.startTask(task.id);
        } else if (task.status === 'processing') {
            const cancelBtn = container.createEl('button', {
                cls: 'nw-btn novel-writer-btn',
                text: '取消',
                attr: { style: 'padding:4px 8px;font-size:12px;color:var(--color-error);' }
            });
            cancelBtn.onclick = () => this.cancelTask(task.id);
        } else if (task.status === 'completed') {
            const viewBtn = container.createEl('button', {
                cls: 'nw-btn novel-writer-btn',
                text: '查看',
                attr: { style: 'padding:4px 8px;font-size:12px;' }
            });
            viewBtn.onclick = () => this.viewResult(task);
        }
    }

    private renderPartialResult(container: HTMLElement, task: BatchTask): void {
        const partial = task.partialResult;
        if (!partial) return;

        const resultDiv = container.createDiv({
            attr: {
                style: 'margin-top:8px;padding:8px;background:var(--background-secondary);border-radius:4px;font-size:12px;width:100%;'
            }
        });

        const segmentPercent = Math.round((partial.progress ?? 0) * 100);

        resultDiv.createEl('div', {
            attr: { style: 'font-weight:500;margin-bottom:4px;' },
            text: `增量结果: ${partial.completedSegments}/${partial.totalSegments} 分段完成`
        });

        resultDiv.createEl('div', {
            text: `${partial.dimension}: ${partial.isComplete ? '✓' : '◐'} ${segmentPercent}%`
        });
    }

    private renderGlobalActionButtons(contentEl: HTMLElement): void {
        const btnRow = contentEl.createDiv({
            attr: { style: 'display:flex;gap:8px;margin-top:20px;justify-content:flex-end;' }
        });

        const startAllBtn = btnRow.createEl('button', {
            cls: 'nw-btn novel-writer-btn',
            text: '全部开始'
        });
        startAllBtn.onclick = () => this.startAllTasks();

        const cancelAllBtn = btnRow.createEl('button', {
            cls: 'nw-btn novel-writer-btn',
            text: '全部取消',
            attr: { style: 'color:var(--color-error);' }
        });
        cancelAllBtn.onclick = () => this.cancelAllTasks();

        const closeBtn = btnRow.createEl('button', {
            cls: 'nw-btn novel-writer-btn',
            text: '关闭'
        });
        closeBtn.onclick = () => this.close();
    }

    private async startTask(taskId: string): Promise<void> {
        const task = this.tasks.find(t => t.id === taskId);
        if (!task || task.status !== 'pending') return;

        task.status = 'processing';
        task.message = '开始拆解...';
        this.renderTaskList();

        const controller = new AbortController();
        this.abortControllers.set(taskId, controller);

        try {
            await this.processFile(task, controller.signal);
        } catch (error) {
            task.status = 'failed';
            task.message = '拆解失败';
            task.error = error instanceof Error ? error.message : '未知错误';
        } finally {
            this.abortControllers.delete(taskId);
            this.renderTaskList();
        }
    }

    private async startAllTasks(): Promise<void> {
        if (this.isRunning) return;
        this.isRunning = true;

        const pendingTasks = this.tasks.filter(t => t.status === 'pending');
        for (const task of pendingTasks) {
            await this.startTask(task.id);
            await new Promise(resolve => setTimeout(resolve, 500));
        }

        this.isRunning = false;
    }

    private cancelTask(taskId: string): void {
        const controller = this.abortControllers.get(taskId);
        if (controller) {
            controller.abort();
        }

        const task = this.tasks.find(t => t.id === taskId);
        if (task) {
            task.status = 'cancelled';
            task.message = '已取消';
            this.renderTaskList();
        }
    }

    private cancelAllTasks(): void {
        for (const controller of this.abortControllers.values()) {
            controller.abort();
        }
        this.abortControllers.clear();

        for (const task of this.tasks) {
            if (task.status === 'processing') {
                task.status = 'cancelled';
                task.message = '已取消';
            }
        }
        this.renderTaskList();
    }

    private async processFile(task: BatchTask, signal: AbortSignal): Promise<void> {
        const content = await this.app.vault.read(task.file);

        const options: SchedulerSegmentOptions = {
            useVector: true,
            onOverallProgress: (dimension, progress, message) => {
                task.progress = progress;
                task.message = `${dimension} ${message}`;
                this.renderTaskList();
            },
            onPartialResult: (result) => {
                task.partialResult = result;
                this.renderTaskList();
            },
        };

        const integration = new SchedulerSegmentIntegration((this.plugin as any).deconstructionWorkerManager);

        const dimensions: DeconstructDimension[] = ['style', 'rhythm', 'technique', 'structure', 'character', 'foreshadow'];

        for (const dimension of dimensions) {
            signal.throwIfAborted();
            task.message = `正在拆解 ${dimension}...`;
            this.renderTaskList();

            await integration.analyzeWithSegments(
                dimension,
                content,
                signal,
                options
            );

            signal.throwIfAborted();
        }

        task.status = 'completed';
        task.progress = 100;
        task.message = '拆解完成';
    }

    private viewResult(task: BatchTask): void {
        new Notice(`查看 ${task.file.name} 的拆解结果`);
    }
}
