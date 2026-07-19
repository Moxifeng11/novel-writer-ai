import { App, WorkspaceLeaf } from 'obsidian';
import { ProgressEmitter, type ProgressState } from '../../../shared/progress-emitter';
import { ProgressBarComponent } from './progress-bar';

/**
 * 悬浮进度球组件选项
 */
export interface FloatingProgressBallOptions {
    position?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
    size?: number;
}

/**
 * 任务项信息
 */
interface TaskItem {
    emitter: ProgressEmitter;
    state: ProgressState;
    unbind: () => void;
    element?: HTMLElement;
    progressBar?: ProgressBarComponent;
}

/**
 * 悬浮进度球组件
 *
 * 一个固定在角落的圆形悬浮球，显示当前进度百分比
 * 点击展开完整的进度面板，展示所有进行中的任务
 * 支持绑定单个或多个 ProgressEmitter
 *
 * @example
 * ```ts
 * const ball = new FloatingProgressBall(app, { position: 'bottom-right', size: 56 });
 * ball.bindEmitter(emitter);
 * ball.show();
 * ```
 */
export class FloatingProgressBall {
    private app: App;
    private options: Required<FloatingProgressBallOptions>;

    private containerEl!: HTMLElement;
    private ballEl!: HTMLElement;
    private ringProgressEl!: HTMLElement;
    private percentEl!: HTMLElement;
    private badgeEl!: HTMLElement;
    private panelEl!: HTMLElement;
    private panelHeaderEl!: HTMLElement;
    private panelTitleEl!: HTMLElement;
    private panelMinimizeBtn!: HTMLElement;
    private taskListEl!: HTMLElement;
    private panelFooterEl!: HTMLElement;
    private cancelAllBtn?: HTMLButtonElement;

    private tasks: Map<string, TaskItem> = new Map();
    private isExpanded: boolean = false;
    private isVisible: boolean = false;
    private notificationTimer?: ReturnType<typeof setTimeout>;

    private clickOutsideHandler?: (e: MouseEvent) => void;

    constructor(app: App, options?: FloatingProgressBallOptions) {
        this.app = app;
        this.options = {
            position: 'bottom-right',
            size: 56,
            ...options,
        };

        this.render();
    }

    /**
     * 显示悬浮球
     */
    show(): void {
        this.isVisible = true;
        this.containerEl.style.display = 'flex';
    }

    /**
     * 隐藏悬浮球
     */
    hide(): void {
        this.isVisible = false;
        this.containerEl.style.display = 'none';
        this.collapse();
    }

    /**
     * 绑定单个 ProgressEmitter
     * @param emitter 进度事件发射器
     * @returns 取消绑定函数
     */
    bindEmitter(emitter: ProgressEmitter): () => void {
        return this.addTask(emitter);
    }

    /**
     * 绑定多个 ProgressEmitter
     * @param emitters 进度事件发射器数组
     * @returns 取消所有绑定的函数
     */
    bindEmitters(emitters: ProgressEmitter[]): () => void {
        const unbinds: (() => void)[] = [];
        for (const emitter of emitters) {
            unbinds.push(this.addTask(emitter));
        }
        return () => {
            for (const unbind of unbinds) {
                unbind();
            }
        };
    }

    /**
     * 展开完整面板
     */
    expand(): void {
        if (this.isExpanded) return;
        this.isExpanded = true;
        this.panelEl.style.display = 'flex';
        requestAnimationFrame(() => {
            this.panelEl.style.opacity = '1';
            this.panelEl.style.transform = 'scale(1) translateY(0)';
        });
        this.attachClickOutside();
    }

    /**
     * 收起为小球
     */
    collapse(): void {
        if (!this.isExpanded) return;
        this.isExpanded = false;
        this.panelEl.style.opacity = '0';
        this.panelEl.style.transform = 'scale(0.9) translateY(10px)';
        setTimeout(() => {
            if (!this.isExpanded) {
                this.panelEl.style.display = 'none';
            }
        }, 200);
        this.detachClickOutside();
    }

    /**
     * 销毁组件，清理资源
     */
    destroy(): void {
        this.detachClickOutside();
        this.clearNotification();
        for (const task of this.tasks.values()) {
            task.unbind();
            if (task.progressBar) {
                task.progressBar.destroy();
            }
        }
        this.tasks.clear();
        this.containerEl.remove();
    }

    private addTask(emitter: ProgressEmitter): () => void {
        const state = emitter.getState();
        if (this.tasks.has(state.id)) {
            return this.tasks.get(state.id)!.unbind;
        }

        const off = emitter.on((newState: ProgressState) => {
            this.updateTaskState(state.id, newState);
        });

        const taskItem: TaskItem = {
            emitter,
            state,
            unbind: () => {
                off();
                this.removeTask(state.id);
            },
        };

        this.tasks.set(state.id, taskItem);
        this.renderTaskItem(taskItem);
        this.updateOverallProgress();
        this.updateBadge();

        return taskItem.unbind;
    }

    private removeTask(id: string): void {
        const task = this.tasks.get(id);
        if (!task) return;

        if (task.element) {
            task.element.remove();
        }
        if (task.progressBar) {
            task.progressBar.destroy();
        }
        this.tasks.delete(id);
        this.updateOverallProgress();
        this.updateBadge();

        if (this.tasks.size === 0) {
            this.hide();
        }
    }

    private updateTaskState(id: string, newState: ProgressState): void {
        const task = this.tasks.get(id);
        if (!task) return;

        const oldStatus = task.state.status;
        task.state = newState;

        if (task.element) {
            this.syncTaskElement(task);
        }

        this.updateOverallProgress();
        this.updateBadge();

        if (oldStatus === 'running' && (newState.status === 'completed' || newState.status === 'failed')) {
            this.showNotification(newState);
        }
    }

    private updateOverallProgress(): void {
        const tasks = Array.from(this.tasks.values());
        if (tasks.length === 0) {
            this.setRingProgress(0);
            return;
        }

        const totalProgress = tasks.reduce((sum, task) => sum + task.state.progress, 0);
        const avgProgress = totalProgress / tasks.length;
        this.setRingProgress(avgProgress);
    }

    private setRingProgress(progress: number): void {
        const clamped = Math.max(0, Math.min(100, progress));
        this.percentEl.setText(`${Math.round(clamped)}%`);

        const angle = (clamped / 100) * 360;
        this.ringProgressEl.style.background = `
            conic-gradient(
                var(--interactive-accent) 0deg,
                var(--interactive-accent) ${angle}deg,
                transparent ${angle}deg,
                transparent 360deg
            )
        `;
    }

    private updateBadge(): void {
        const runningTasks = Array.from(this.tasks.values()).filter(
            (t) => t.state.status === 'running' || t.state.status === 'pending'
        );

        if (runningTasks.length > 1) {
            this.badgeEl.style.display = 'flex';
            this.badgeEl.setText(String(runningTasks.length));
        } else {
            this.badgeEl.style.display = 'none';
        }

        const hasActiveTasks = runningTasks.length > 0;
        if (hasActiveTasks && !this.isVisible) {
            this.show();
        }
    }

    private renderTaskItem(task: TaskItem): void {
        const itemEl = this.taskListEl.createDiv({
            cls: 'nw-floating-task-item',
            attr: {
                style: 'padding:12px;border-bottom:1px solid var(--background-modifier-border);cursor:pointer;transition:background 0.15s;',
            },
        });

        itemEl.addEventListener('mouseenter', () => {
            itemEl.style.background = 'var(--background-secondary)';
        });
        itemEl.addEventListener('mouseleave', () => {
            itemEl.style.background = 'transparent';
        });

        itemEl.addEventListener('click', () => {
            this.handleTaskClick(task);
        });

        const headerRow = itemEl.createDiv({
            attr: { style: 'display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;' },
        });

        const nameEl = headerRow.createSpan({
            cls: 'nw-floating-task-name',
            attr: {
                style: 'font-size:13px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0;',
            },
        });

        const statusEl = headerRow.createSpan({
            cls: 'nw-floating-task-status',
            attr: { style: 'font-size:11px;padding:2px 8px;border-radius:10px;margin-left:8px;flex-shrink:0;' },
        });

        const progressContainer = itemEl.createDiv({
            attr: { style: 'width:100%;' },
        });

        const progressBar = new ProgressBarComponent(progressContainer, {
            height: '4px',
            showPercent: true,
            showMessage: false,
        });

        task.element = itemEl;
        task.progressBar = progressBar;

        progressBar.bindEmitter(task.emitter);
        this.syncTaskElement(task);
    }

    private syncTaskElement(task: TaskItem): void {
        if (!task.element) return;

        const nameEl = task.element.querySelector<HTMLElement>('.nw-floating-task-name');
        const statusEl = task.element.querySelector<HTMLElement>('.nw-floating-task-status');

        if (nameEl) {
            nameEl.setText(task.state.name);
        }

        if (statusEl) {
            const statusConfig = this.getStatusConfig(task.state.status);
            statusEl.setText(statusConfig.label);
            statusEl.style.cssText = `font-size:11px;padding:2px 8px;border-radius:10px;margin-left:8px;flex-shrink:0;${statusConfig.style}`;
        }
    }

    private getStatusConfig(status: string): { label: string; style: string } {
        const map: Record<string, { label: string; style: string }> = {
            pending: { label: '等待中', style: 'background:rgba(245,158,11,0.15);color:#f59e0b;' },
            running: { label: '运行中', style: 'background:rgba(59,130,246,0.15);color:#3b82f6;' },
            paused: { label: '已暂停', style: 'background:var(--background-secondary);color:var(--text-muted);' },
            completed: { label: '已完成', style: 'background:rgba(46,204,113,0.15);color:#2ecc71;' },
            failed: { label: '失败', style: 'background:rgba(231,76,60,0.15);color:#e74c3c;' },
            cancelled: { label: '已取消', style: 'background:var(--background-secondary);color:var(--text-muted);' },
        };
        return map[status] || map.pending;
    }

    private showNotification(state: ProgressState): void {
        this.clearNotification();

        const isSuccess = state.status === 'completed';
        const notificationEl = this.containerEl.createDiv({
            cls: 'nw-floating-notification',
            attr: {
                style: `
                    position:absolute;
                    bottom:calc(100% + 12px);
                    right:0;
                    padding:10px 16px;
                    background:var(--background-primary);
                    border:1px solid var(--background-modifier-border);
                    border-radius:8px;
                    box-shadow:0 4px 16px rgba(0,0,0,0.15);
                    font-size:13px;
                    white-space:nowrap;
                    opacity:0;
                    transform:translateY(10px);
                    transition:opacity 0.3s,transform 0.3s;
                    pointer-events:none;
                    z-index:1001;
                `,
            },
        });

        const icon = isSuccess ? '✓' : '✕';
        const color = isSuccess ? '#2ecc71' : '#e74c3c';
        notificationEl.innerHTML = `<span style="color:${color};font-weight:600;margin-right:6px;">${icon}</span>${state.name} ${isSuccess ? '完成' : '失败'}`;

        requestAnimationFrame(() => {
            notificationEl.style.opacity = '1';
            notificationEl.style.transform = 'translateY(0)';
        });

        this.notificationTimer = setTimeout(() => {
            notificationEl.style.opacity = '0';
            notificationEl.style.transform = 'translateY(10px)';
            setTimeout(() => {
                notificationEl.remove();
            }, 300);
        }, 3000);
    }

    private clearNotification(): void {
        if (this.notificationTimer) {
            clearTimeout(this.notificationTimer);
            this.notificationTimer = undefined;
        }
        const notif = this.containerEl.querySelector('.nw-floating-notification');
        if (notif) {
            notif.remove();
        }
    }

    private handleTaskClick(task: TaskItem): void {
        this.app.workspace.iterateAllLeaves((leaf) => {
            const view = leaf.view;
            if (view.getViewType() === 'knowledge-base') {
                this.app.workspace.setActiveLeaf(leaf);
            }
        });
    }

    private handleCancelAll(): void {
        for (const task of this.tasks.values()) {
            if (task.state.status === 'running' || task.state.status === 'pending') {
                task.emitter.cancel();
            }
        }
    }

    private attachClickOutside(): void {
        this.clickOutsideHandler = (e: MouseEvent) => {
            if (!this.containerEl.contains(e.target as Node)) {
                this.collapse();
            }
        };
        document.addEventListener('mousedown', this.clickOutsideHandler);
    }

    private detachClickOutside(): void {
        if (this.clickOutsideHandler) {
            document.removeEventListener('mousedown', this.clickOutsideHandler);
            this.clickOutsideHandler = undefined;
        }
    }

    private getPositionStyle(): string {
        const size = this.options.size;
        const offset = '20px';

        switch (this.options.position) {
            case 'bottom-left':
                return `bottom:${offset};left:${offset};`;
            case 'top-right':
                return `top:${offset};right:${offset};`;
            case 'top-left':
                return `top:${offset};left:${offset};`;
            case 'bottom-right':
            default:
                return `bottom:${offset};right:${offset};`;
        }
    }

    private render(): void {
        const size = this.options.size;

        this.containerEl = document.body.createDiv({
            cls: 'nw-floating-progress-ball-container',
            attr: {
                style: `
                    position:fixed;
                    ${this.getPositionStyle()}
                    z-index:1000;
                    display:none;
                    align-items:flex-end;
                    flex-direction:column;
                `,
            },
        });

        this.panelEl = this.containerEl.createDiv({
            cls: 'nw-floating-panel',
            attr: {
                style: `
                    position:absolute;
                    bottom:calc(100% + 12px);
                    right:0;
                    width:320px;
                    max-height:400px;
                    background:var(--background-primary);
                    border:1px solid var(--background-modifier-border);
                    border-radius:12px;
                    box-shadow:0 8px 32px rgba(0,0,0,0.2);
                    display:none;
                    flex-direction:column;
                    overflow:hidden;
                    opacity:0;
                    transform:scale(0.9) translateY(10px);
                    transition:opacity 0.2s ease,transform 0.2s ease;
                `,
            },
        });

        this.panelHeaderEl = this.panelEl.createDiv({
            cls: 'nw-floating-panel-header',
            attr: {
                style: 'display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid var(--background-modifier-border);',
            },
        });

        this.panelTitleEl = this.panelHeaderEl.createSpan({
            cls: 'nw-floating-panel-title',
            attr: { style: 'font-size:14px;font-weight:600;' },
        });
        this.panelTitleEl.setText('任务进度');

        this.panelMinimizeBtn = this.panelHeaderEl.createSpan({
            cls: 'nw-floating-panel-minimize',
            attr: {
                style: 'cursor:pointer;padding:4px 8px;border-radius:4px;color:var(--text-muted);font-size:16px;line-height:1;',
            },
        });
        this.panelMinimizeBtn.setText('−');
        this.panelMinimizeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.collapse();
        });
        this.panelMinimizeBtn.addEventListener('mouseenter', () => {
            this.panelMinimizeBtn.style.background = 'var(--background-secondary)';
        });
        this.panelMinimizeBtn.addEventListener('mouseleave', () => {
            this.panelMinimizeBtn.style.background = 'transparent';
        });

        this.taskListEl = this.panelEl.createDiv({
            cls: 'nw-floating-task-list',
            attr: { style: 'flex:1;overflow-y:auto;' },
        });

        this.panelFooterEl = this.panelEl.createDiv({
            cls: 'nw-floating-panel-footer',
            attr: {
                style: 'display:flex;justify-content:flex-end;padding:10px 16px;border-top:1px solid var(--background-modifier-border);gap:8px;',
            },
        });

        this.cancelAllBtn = this.panelFooterEl.createEl('button', {
            cls: 'nw-btn nw-btn-danger nw-btn-sm',
            text: '全部取消',
        });
        this.cancelAllBtn.addEventListener('click', () => {
            this.handleCancelAll();
        });

        this.ballEl = this.containerEl.createDiv({
            cls: 'nw-floating-ball',
            attr: {
                style: `
                    width:${size}px;
                    height:${size}px;
                    border-radius:50%;
                    background:var(--background-primary);
                    box-shadow:0 4px 16px rgba(0,0,0,0.15);
                    display:flex;
                    align-items:center;
                    justify-content:center;
                    cursor:pointer;
                    position:relative;
                    border:1px solid var(--background-modifier-border);
                    transition:transform 0.15s ease, box-shadow 0.15s ease;
                `,
            },
        });

        this.ballEl.addEventListener('click', () => {
            if (this.isExpanded) {
                this.collapse();
            } else {
                this.expand();
            }
        });

        this.ballEl.addEventListener('mouseenter', () => {
            this.ballEl.style.transform = 'scale(1.05)';
            this.ballEl.style.boxShadow = '0 6px 20px rgba(0,0,0,0.2)';
        });
        this.ballEl.addEventListener('mouseleave', () => {
            this.ballEl.style.transform = 'scale(1)';
            this.ballEl.style.boxShadow = '0 4px 16px rgba(0,0,0,0.15)';
        });

        const ringSize = size - 8;
        this.ringProgressEl = this.ballEl.createDiv({
            cls: 'nw-floating-ring-progress',
            attr: {
                style: `
                    width:${ringSize}px;
                    height:${ringSize}px;
                    border-radius:50%;
                    display:flex;
                    align-items:center;
                    justify-content:center;
                    background:conic-gradient(var(--interactive-accent) 0deg, transparent 0deg);
                `,
            },
        });

        const innerSize = ringSize - 6;
        const innerCircle = this.ringProgressEl.createDiv({
            attr: {
                style: `
                    width:${innerSize}px;
                    height:${innerSize}px;
                    border-radius:50%;
                    background:var(--background-primary);
                    display:flex;
                    align-items:center;
                    justify-content:center;
                `,
            },
        });

        this.percentEl = innerCircle.createSpan({
            cls: 'nw-floating-percent',
            attr: {
                style: 'font-size:12px;font-weight:600;color:var(--text-normal);',
            },
        });
        this.percentEl.setText('0%');

        this.badgeEl = this.ballEl.createDiv({
            cls: 'nw-floating-badge',
            attr: {
                style: `
                    position:absolute;
                    top:-2px;
                    right:-2px;
                    min-width:18px;
                    height:18px;
                    padding:0 5px;
                    border-radius:9px;
                    background:var(--interactive-accent);
                    color:white;
                    font-size:11px;
                    font-weight:600;
                    display:none;
                    align-items:center;
                    justify-content:center;
                    box-shadow:0 2px 4px rgba(0,0,0,0.2);
                `,
            },
        });
    }
}
