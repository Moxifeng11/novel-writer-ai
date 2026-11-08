import { ProgressEmitter, type ProgressState } from '@/shared/progress-emitter';
import { ProgressBarComponent } from './progress-bar';
import { createLogger } from '@/shared/logger';


const log = createLogger('TaskCard');
/**
 * 任务卡片组件选项
 */
export interface TaskCardOptions {
    showCancel?: boolean;
}

/**
 * 任务卡片组件
 *
 * 显示单个任务的完整进度信息
 * 包含：任务名称、状态标签、进度条、当前步骤、已用时间、预估剩余时间、取消按钮
 * 可与 ProgressEmitter 绑定后自动更新
 *
 * @example
 * ```ts
 * const card = new TaskCardComponent(container, { showCancel: true });
 * card.bindEmitter(emitter);
 * card.onCancel(() => log.info('cancelled'));
 * ```
 */
export class TaskCardComponent {
    private container: HTMLElement;
    private options: Required<TaskCardOptions>;

    private cardEl!: HTMLElement;
    private titleEl!: HTMLElement;
    private statusBadgeEl!: HTMLElement;
    private progressBar!: ProgressBarComponent;
    private stepInfoEl!: HTMLElement;
    private timeInfoEl!: HTMLElement;
    private actionsEl!: HTMLElement;
    private cancelBtn?: HTMLButtonElement;
    private errorEl?: HTMLElement;

    private unbindEmitter?: () => void;
    private cancelCallback?: () => void;

    constructor(container: HTMLElement, options?: TaskCardOptions) {
        this.container = container;
        this.options = {
            showCancel: true,
            ...options,
        };

        this.render();
    }

    /**
     * 绑定 ProgressEmitter，自动更新任务状态
     * @param emitter 进度事件发射器
     * @returns 取消绑定函数
     */
    bindEmitter(emitter: ProgressEmitter): () => void {
        if (this.unbindEmitter) {
            this.unbindEmitter();
        }

        const state = emitter.getState();
        this.syncFromState(state);

        this.progressBar.bindEmitter(emitter);

        const off = emitter.on((state: ProgressState) => {
            this.syncFromState(state);
        });
        this.unbindEmitter = off;

        return off;
    }

    /**
     * 设置取消回调
     * @param callback 取消回调函数
     */
    onCancel(callback: () => void): void {
        this.cancelCallback = callback;
    }

    /**
     * 销毁组件，清理资源
     */
    destroy(): void {
        if (this.unbindEmitter) {
            this.unbindEmitter();
            this.unbindEmitter = undefined;
        }
        if (this.progressBar) {
            this.progressBar.destroy();
        }
        this.cardEl.remove();
    }

    private syncFromState(state: ProgressState): void {
        if (state.name && this.titleEl) {
            this.titleEl.setText(state.name);
        }

        this.updateStatusBadge(state.status);

        if (state.currentStep) {
            this.stepInfoEl.removeClass('nw-u-d-none');
            const stepNameEl = this.stepInfoEl.querySelector<HTMLElement>('.nw-task-step-name');
            if (stepNameEl) {
                stepNameEl.setText(state.currentStep);
            }
        } else {
            this.stepInfoEl.addClass('nw-u-d-none');
        }

        this.updateTimeInfo(state);

        if (state.error && this.errorEl) {
            this.errorEl.removeClass('nw-u-d-none');
            const errorMsgEl = this.errorEl.querySelector<HTMLElement>('.nw-task-error-message');
            if (errorMsgEl) {
                errorMsgEl.setText(state.error);
            }
        } else if (this.errorEl) {
            this.errorEl.addClass('nw-u-d-none');
        }

        this.updateCancelButton(state.status);
    }

    private updateStatusBadge(status: string): void {
        const labels: Record<string, string> = {
            pending: '等待中',
            running: '运行中',
            paused: '已暂停',
            completed: '已完成',
            failed: '失败',
            cancelled: '已取消',
        };
        const known = labels[status] ? status : 'pending';
        this.statusBadgeEl.setText(labels[known]);
        this.statusBadgeEl.removeClass(
            'nw-is-pending', 'nw-is-running', 'nw-is-paused',
            'nw-is-completed', 'nw-is-failed', 'nw-is-cancelled',
        );
        this.statusBadgeEl.addClass(`nw-is-${known}`);
    }

    private updateTimeInfo(state: ProgressState): void {
        const elapsedEl = this.timeInfoEl.querySelector<HTMLElement>('.nw-task-elapsed');
        const etaEl = this.timeInfoEl.querySelector<HTMLElement>('.nw-task-eta');

        if (elapsedEl) {
            elapsedEl.setText(this.formatDuration(state.elapsed));
        }

        if (etaEl) {
            if (state.eta !== undefined && state.status === 'running') {
                etaEl.setText(this.formatDuration(state.eta));
                const etaContainer = this.timeInfoEl.querySelector<HTMLElement>('.nw-task-eta-container');
                if (etaContainer) {
                    etaContainer.removeClass('nw-u-d-none');
                }
            } else {
                const etaContainer = this.timeInfoEl.querySelector<HTMLElement>('.nw-task-eta-container');
                if (etaContainer) {
                    etaContainer.addClass('nw-u-d-none');
                }
            }
        }
    }

    private updateCancelButton(status: string): void {
        if (!this.cancelBtn) return;

        if (status === 'running' || status === 'pending') {
            this.cancelBtn.removeClass('nw-u-d-none');
            this.cancelBtn.disabled = false;
            this.cancelBtn.setText('✕ 取消');
        } else if (status === 'failed') {
            this.cancelBtn.removeClass('nw-u-d-none');
            this.cancelBtn.disabled = false;
            this.cancelBtn.setText('🔄 重试');
        } else {
            this.cancelBtn.addClass('nw-u-d-none');
        }
    }

    private formatDuration(ms: number): string {
        if (ms <= 0) return '0秒';

        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);

        if (hours > 0) {
            const remainingMinutes = minutes % 60;
            return `${hours}小时${remainingMinutes}分`;
        } else if (minutes > 0) {
            const remainingSeconds = seconds % 60;
            return `${minutes}分${remainingSeconds}秒`;
        } else {
            return `${seconds}秒`;
        }
    }

    private handleCancel(): void {
        if (this.cancelCallback) {
            this.cancelCallback();
        }
    }

    private render(): void {
        this.cardEl = this.container.createDiv({ cls: 'nw-task-card' });

        const headerRow = this.cardEl.createDiv({ cls: 'nw-task-header' });

        const titleInfo = headerRow.createDiv({ cls: 'nw-task-title-info' });

        this.titleEl = titleInfo.createDiv({ cls: 'nw-task-title' });
        this.titleEl.setText('任务');

        this.statusBadgeEl = headerRow.createSpan({ cls: 'nw-task-status-badge' });
        this.statusBadgeEl.setText('等待中');

        const progressContainer = this.cardEl.createDiv({ cls: 'nw-task-progress' });

        this.progressBar = new ProgressBarComponent(progressContainer, {
            height: '8px',
            showPercent: true,
            showMessage: false,
        });

        this.stepInfoEl = this.cardEl.createDiv({ cls: 'nw-task-step-info nw-u-d-none' });
        this.stepInfoEl.createSpan({ text: '📍', cls: 'nw-task-step-icon' });
        const stepNameSpan = this.stepInfoEl.createSpan({ cls: 'nw-task-step-name' });
        void stepNameSpan;

        this.timeInfoEl = this.cardEl.createDiv({ cls: 'nw-task-time-info' });

        const elapsedContainer = this.timeInfoEl.createDiv({ cls: 'nw-task-time-item' });
        elapsedContainer.createSpan({ text: '⏱️', cls: 'nw-task-time-icon' });
        elapsedContainer.createSpan({ text: '已用：' });
        elapsedContainer.createSpan({ cls: 'nw-task-time-value nw-task-elapsed' }).setText('0秒');

        const etaContainer = this.timeInfoEl.createDiv({
            cls: 'nw-task-time-item nw-task-eta-container nw-u-d-none',
        });
        etaContainer.createSpan({ text: '⏳', cls: 'nw-task-time-icon' });
        etaContainer.createSpan({ text: '剩余：' });
        etaContainer.createSpan({ cls: 'nw-task-time-value nw-task-eta' }).setText('0秒');

        this.errorEl = this.cardEl.createDiv({ cls: 'nw-task-error nw-u-d-none' });
        this.errorEl.createSpan({ text: '错误：', cls: 'nw-task-error-label' });
        this.errorEl.createSpan({ cls: 'nw-task-error-message' });

        this.actionsEl = this.cardEl.createDiv({
            cls: this.options.showCancel ? 'nw-task-actions' : 'nw-task-actions nw-u-d-none',
        });

        if (this.options.showCancel) {
            this.cancelBtn = this.actionsEl.createEl('button', {
                cls: 'nw-btn nw-btn-danger nw-btn-sm nw-u-d-none',
                text: '✕ 取消',
            });
            this.cancelBtn.addEventListener('click', () => {
                    this.handleCancel();
                });
        }
    }
}
