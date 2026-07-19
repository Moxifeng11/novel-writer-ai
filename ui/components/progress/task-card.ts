import { ProgressEmitter, type ProgressState } from '../../../shared/progress-emitter';
import { ProgressBarComponent } from './progress-bar';
import { createLogger } from '../../../shared/logger';


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
            this.stepInfoEl.style.display = 'flex';
            const stepNameEl = this.stepInfoEl.querySelector<HTMLElement>('.nw-task-step-name');
            if (stepNameEl) {
                stepNameEl.setText(state.currentStep);
            }
        } else {
            this.stepInfoEl.style.display = 'none';
        }

        this.updateTimeInfo(state);

        if (state.error && this.errorEl) {
            this.errorEl.style.display = 'block';
            const errorMsgEl = this.errorEl.querySelector<HTMLElement>('.nw-task-error-message');
            if (errorMsgEl) {
                errorMsgEl.setText(state.error);
            }
        } else if (this.errorEl) {
            this.errorEl.style.display = 'none';
        }

        this.updateCancelButton(state.status);
    }

    private updateStatusBadge(status: string): void {
        const statusMap: Record<string, { label: string; style: string }> = {
            pending: {
                label: '等待中',
                style: 'background:rgba(245,158,11,0.15);color:#f59e0b;'
            },
            running: {
                label: '运行中',
                style: 'background:rgba(59,130,246,0.15);color:#3b82f6;'
            },
            paused: {
                label: '已暂停',
                style: 'background:var(--background-secondary);color:var(--text-muted);'
            },
            completed: {
                label: '已完成',
                style: 'background:rgba(46,204,113,0.15);color:#2ecc71;'
            },
            failed: {
                label: '失败',
                style: 'background:rgba(231,76,60,0.15);color:#e74c3c;'
            },
            cancelled: {
                label: '已取消',
                style: 'background:var(--background-secondary);color:var(--text-muted);'
            },
        };

        const config = statusMap[status] || statusMap.pending;
        this.statusBadgeEl.setText(config.label);
        this.statusBadgeEl.style.cssText = `padding:4px 12px;font-size:12px;border-radius:12px;${config.style}`;
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
                    etaContainer.style.display = 'flex';
                }
            } else {
                const etaContainer = this.timeInfoEl.querySelector<HTMLElement>('.nw-task-eta-container');
                if (etaContainer) {
                    etaContainer.style.display = 'none';
                }
            }
        }
    }

    private updateCancelButton(status: string): void {
        if (!this.cancelBtn) return;

        if (status === 'running' || status === 'pending') {
            this.cancelBtn.style.display = 'inline-flex';
            this.cancelBtn.disabled = false;
            this.cancelBtn.setText('✕ 取消');
        } else if (status === 'failed') {
            this.cancelBtn.style.display = 'inline-flex';
            this.cancelBtn.disabled = false;
            this.cancelBtn.setText('🔄 重试');
        } else {
            this.cancelBtn.style.display = 'none';
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
        this.cardEl = this.container.createDiv({
            cls: 'nw-task-card',
            attr: {
                style: 'border:1px solid var(--background-modifier-border);border-radius:8px;padding:16px;background:var(--background-primary);'
            }
        });

        const headerRow = this.cardEl.createDiv({
            cls: 'nw-task-header',
            attr: { style: 'display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;flex-wrap:wrap;gap:8px;' }
        });

        const titleInfo = headerRow.createDiv({
            cls: 'nw-task-title-info',
            attr: { style: 'display:flex;align-items:center;gap:10px;min-width:0;flex:1;' }
        });

        this.titleEl = titleInfo.createDiv({
            cls: 'nw-task-title',
            attr: { style: 'font-size:15px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;' }
        });
        this.titleEl.setText('任务');

        this.statusBadgeEl = headerRow.createSpan({
            cls: 'nw-task-status-badge',
            attr: {
                style: 'padding:4px 12px;font-size:12px;border-radius:12px;background:var(--background-secondary);color:var(--text-muted);'
            }
        });
        this.statusBadgeEl.setText('等待中');

        const progressContainer = this.cardEl.createDiv({
            cls: 'nw-task-progress',
            attr: { style: 'margin-bottom:12px;' }
        });

        this.progressBar = new ProgressBarComponent(progressContainer, {
            height: '8px',
            showPercent: true,
            showMessage: false,
        });

        this.stepInfoEl = this.cardEl.createDiv({
            cls: 'nw-task-step-info',
            attr: { style: 'display:none;align-items:center;gap:8px;margin-bottom:12px;font-size:13px;color:var(--text-muted);' }
        });
        this.stepInfoEl.createSpan({ text: '📍', attr: { style: 'font-size:14px;' } });
        const stepNameSpan = this.stepInfoEl.createSpan({
            cls: 'nw-task-step-name',
            attr: { style: 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;' }
        });
        void stepNameSpan;

        this.timeInfoEl = this.cardEl.createDiv({
            cls: 'nw-task-time-info',
            attr: { style: 'display:flex;gap:20px;margin-bottom:12px;font-size:12px;color:var(--text-muted);flex-wrap:wrap;' }
        });

        const elapsedContainer = this.timeInfoEl.createDiv({
            cls: 'nw-task-elapsed-container',
            attr: { style: 'display:flex;align-items:center;gap:4px;' }
        });
        elapsedContainer.createSpan({ text: '⏱️', attr: { style: 'font-size:12px;' } });
        elapsedContainer.createSpan({ text: '已用：' });
        elapsedContainer.createSpan({
            cls: 'nw-task-elapsed',
            attr: { style: 'font-weight:500;color:var(--text-normal);' }
        }).setText('0秒');

        const etaContainer = this.timeInfoEl.createDiv({
            cls: 'nw-task-eta-container',
            attr: { style: 'display:flex;align-items:center;gap:4px;display:none;' }
        });
        etaContainer.createSpan({ text: '⏳', attr: { style: 'font-size:12px;' } });
        etaContainer.createSpan({ text: '剩余：' });
        etaContainer.createSpan({
            cls: 'nw-task-eta',
            attr: { style: 'font-weight:500;color:var(--text-normal);' }
        }).setText('0秒');

        this.errorEl = this.cardEl.createDiv({
            cls: 'nw-task-error',
            attr: {
                style: 'display:none;padding:10px 12px;background:rgba(231,76,60,0.1);border-radius:6px;margin-bottom:12px;font-size:12px;color:#e74c3c;'
            }
        });
        this.errorEl.createSpan({ text: '错误：', attr: { style: 'font-weight:600;' } });
        this.errorEl.createSpan({ cls: 'nw-task-error-message' });

        this.actionsEl = this.cardEl.createDiv({
            cls: 'nw-task-actions',
            attr: {
                style: `display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;${this.options.showCancel ? '' : 'display:none;'}`
            }
        });

        if (this.options.showCancel) {
            this.cancelBtn = this.actionsEl.createEl('button', {
                cls: 'nw-btn nw-btn-danger nw-btn-sm',
                text: '✕ 取消',
                attr: { style: 'display:none;' }
            });
            this.cancelBtn.addEventListener('click', () => {
                    this.handleCancel();
                });
        }
    }
}
