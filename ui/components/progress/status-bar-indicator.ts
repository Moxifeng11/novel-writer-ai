import { App } from 'obsidian';
import { ProgressEmitter, type ProgressState } from '../../../shared/progress-emitter';
import { FloatingProgressBall } from './floating-progress-ball';

/**
 * 状态栏进度指示器
 *
 * 在 Obsidian 状态栏右侧添加进度指示器
 * 显示图标 + 百分比（单任务）或图标 + 任务数量（多任务）
 * 点击打开完整进度面板
 *
 * @example
 * ```ts
 * const indicator = new StatusBarProgressIndicator(statusBarEl, app);
 * indicator.bindEmitter(emitter);
 * indicator.show();
 * ```
 */
export class StatusBarProgressIndicator {
    private statusBarEl: HTMLElement;
    private app: App;

    private containerEl!: HTMLElement;
    private iconEl!: HTMLElement;
    private textEl!: HTMLElement;

    private tasks: Map<string, { emitter: ProgressEmitter; state: ProgressState; unbind: () => void }> = new Map();
    private isVisible: boolean = false;
    private floatingBall?: FloatingProgressBall;

    constructor(statusBarEl: HTMLElement, app: App) {
        this.statusBarEl = statusBarEl;
        this.app = app;

        this.render();
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
     * 显示指示器
     */
    show(): void {
        this.isVisible = true;
        this.containerEl.style.display = 'flex';
    }

    /**
     * 隐藏指示器
     */
    hide(): void {
        this.isVisible = false;
        this.containerEl.style.display = 'none';
    }

    /**
     * 销毁组件，清理资源
     */
    destroy(): void {
        for (const task of this.tasks.values()) {
            task.unbind();
        }
        this.tasks.clear();
        if (this.floatingBall) {
            this.floatingBall.destroy();
            this.floatingBall = undefined;
        }
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

        const taskItem = {
            emitter,
            state,
            unbind: () => {
                off();
                this.removeTask(state.id);
            },
        };

        this.tasks.set(state.id, taskItem);
        this.updateDisplay();

        if (this.floatingBall) {
            this.floatingBall.bindEmitter(emitter);
        }

        return taskItem.unbind;
    }

    private removeTask(id: string): void {
        this.tasks.delete(id);
        this.updateDisplay();
    }

    private updateTaskState(id: string, newState: ProgressState): void {
        const task = this.tasks.get(id);
        if (!task) return;

        task.state = newState;
        this.updateDisplay();
    }

    private updateDisplay(): void {
        const activeTasks = Array.from(this.tasks.values()).filter(
            (t) => t.state.status === 'running' || t.state.status === 'pending'
        );

        if (activeTasks.length === 0) {
            this.hide();
            return;
        }

        this.show();

        if (activeTasks.length === 1) {
            const task = activeTasks[0];
            this.textEl.setText(`${Math.round(task.state.progress)}%`);
        } else {
            this.textEl.setText(`${activeTasks.length} 个任务`);
        }

        const hasRunning = activeTasks.some((t) => t.state.status === 'running');
        if (hasRunning) {
            this.iconEl.style.animation = 'nw-status-spin 2s linear infinite';
        } else {
            this.iconEl.style.animation = 'none';
        }
    }

    private handleClick(): void {
        if (!this.floatingBall) {
            this.floatingBall = new FloatingProgressBall(this.app, {
                position: 'bottom-right',
                size: 56,
            });
            for (const task of this.tasks.values()) {
                this.floatingBall.bindEmitter(task.emitter);
            }
        }
        this.floatingBall.show();
        this.floatingBall.expand();
    }

    private render(): void {
        this.containerEl = this.statusBarEl.createDiv({
            cls: 'nw-status-bar-progress',
            attr: {
                style: `
                    display:none;
                    align-items:center;
                    gap:6px;
                    padding:0 8px;
                    height:100%;
                    cursor:pointer;
                    color:var(--text-muted);
                    transition:color 0.15s;
                `,
            },
        });

        this.containerEl.addEventListener('mouseenter', () => {
            this.containerEl.style.color = 'var(--text-normal)';
        });
        this.containerEl.addEventListener('mouseleave', () => {
            this.containerEl.style.color = 'var(--text-muted)';
        });

        this.containerEl.addEventListener('click', () => {
            this.handleClick();
        });

        this.iconEl = this.containerEl.createSpan({
            cls: 'nw-status-bar-icon',
            attr: {
                style: `
                    display:inline-flex;
                    align-items:center;
                    justify-content:center;
                    font-size:14px;
                `,
            },
        });
        this.iconEl.setText('⏳');

        this.textEl = this.containerEl.createSpan({
            cls: 'nw-status-bar-text',
            attr: {
                style: 'font-size:12px;font-weight:500;',
            },
        });
        this.textEl.setText('0%');

        this.ensureSpinAnimation();
    }

    private ensureSpinAnimation(): void {
        const styleId = 'nw-status-bar-progress-style';
        if (document.getElementById(styleId)) return;

        const styleEl = document.createElement('style');
        styleEl.id = styleId;
        styleEl.textContent = `
            @keyframes nw-status-spin {
                from { transform: rotate(0deg); }
                to { transform: rotate(360deg); }
            }
        `;
        document.head.appendChild(styleEl);
    }
}
