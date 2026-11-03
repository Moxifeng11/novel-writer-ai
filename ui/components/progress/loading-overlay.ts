import { ProgressEmitter, type ProgressState, type ProgressStep } from '@/shared/progress-emitter';
import { ProgressBarComponent } from './progress-bar';
import { StepListComponent } from './step-list';
import { createLogger } from '@/shared/logger';


const log = createLogger('LoadingOverlay');
/**
 * 加载遮罩组件选项
 */
export interface LoadingOverlayOptions {
    title?: string;
    showCancel?: boolean;
    showSteps?: boolean;
}

/**
 * 加载遮罩组件
 *
 * 全屏/容器内的半透明遮罩
 * 居中显示：标题 + 进度条 + 步骤列表 + 取消按钮
 * 支持显示/隐藏，点击取消按钮触发 emitter.cancel()
 *
 * @example
 * ```ts
 * const overlay = new LoadingOverlayComponent(container, {
 *     title: '正在生成...',
 *     showCancel: true,
 *     showSteps: true,
 * });
 * overlay.show();
 * overlay.bindEmitter(emitter);
 * overlay.onCancel(() => log.info('cancelled'));
 * ```
 */
export class LoadingOverlayComponent {
    private container: HTMLElement;
    private options: Required<LoadingOverlayOptions>;

    private overlayEl!: HTMLElement;
    private modalEl!: HTMLElement;
    private titleEl!: HTMLElement;
    private progressBar!: ProgressBarComponent;
    private stepList?: StepListComponent;
    private cancelBtn?: HTMLButtonElement;

    private progressContainer!: HTMLElement;
    private stepsContainer!: HTMLElement;
    private actionsContainer!: HTMLElement;

    private unbindEmitter?: () => void;
    private cancelCallback?: () => void;

    private isVisible: boolean = false;

    constructor(container: HTMLElement, options?: LoadingOverlayOptions) {
        this.container = container;
        this.options = {
            title: '处理中...',
            showCancel: true,
            showSteps: true,
            ...options,
        };

        this.render();
    }

    /**
     * 显示遮罩
     */
    show(): void {
        this.isVisible = true;
        this.overlayEl.style.display = 'flex';
    }

    /**
     * 隐藏遮罩
     */
    hide(): void {
        this.isVisible = false;
        this.overlayEl.style.display = 'none';
    }

    /**
     * 绑定 ProgressEmitter，自动更新进度
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

        if (this.stepList && state.steps && state.steps.length > 0) {
            this.stepList.bindEmitter(emitter);
        }

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
        if (this.stepList) {
            this.stepList.destroy();
        }
        this.overlayEl.remove();
    }

    private syncFromState(state: ProgressState): void {
        if (state.name) {
            this.titleEl.setText(state.name);
        }

        if (this.options.showSteps && state.steps && state.steps.length > 0) {
            this.stepsContainer.style.display = 'block';
            if (!this.stepList) {
                this.stepList = new StepListComponent(
                    this.stepsContainer,
                    state.steps.map((s: ProgressStep) => s.name)
                );
            }
        } else if (this.options.showSteps) {
            this.stepsContainer.style.display = 'none';
        }

        if (state.status === 'completed' ||
            state.status === 'failed' ||
            state.status === 'cancelled') {
            if (this.cancelBtn) {
                this.cancelBtn.setText(state.status === 'completed' ? '✓ 完成' :
                    state.status === 'failed' ? '重试' : '已取消');
                this.cancelBtn.disabled = state.status === 'completed' || state.status === 'cancelled';
            }
        }
    }

    private handleCancel(): void {
        if (this.cancelCallback) {
            this.cancelCallback();
        }
    }

    private render(): void {
        this.overlayEl = this.container.createDiv({
            cls: 'nw-loading-overlay',
            attr: {
                style: 'position:absolute;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);display:none;align-items:center;justify-content:center;z-index:1000;backdrop-filter:blur(2px);'
            }
        });

        this.modalEl = this.overlayEl.createDiv({
            cls: 'nw-loading-modal',
            attr: {
                style: 'background:var(--background-primary);border-radius:12px;padding:24px;min-width:320px;max-width:480px;width:90%;box-shadow:0 8px 32px rgba(0,0,0,0.2);border:1px solid var(--background-modifier-border);'
            }
        });

        this.titleEl = this.modalEl.createDiv({
            cls: 'nw-loading-title',
            attr: {
                style: 'font-size:16px;font-weight:600;margin-bottom:16px;text-align:center;'
            }
        });
        this.titleEl.setText(this.options.title);

        this.progressContainer = this.modalEl.createDiv({
            cls: 'nw-loading-progress',
            attr: { style: 'margin-bottom:16px;' }
        });

        this.progressBar = new ProgressBarComponent(this.progressContainer, {
            height: '8px',
            showPercent: true,
            showMessage: true,
        });

        this.stepsContainer = this.modalEl.createDiv({
            cls: 'nw-loading-steps',
            attr: {
                style: `margin-bottom:16px;max-height:200px;overflow-y:auto;${this.options.showSteps ? '' : 'display:none;'}`
            }
        });

        this.actionsContainer = this.modalEl.createDiv({
            cls: 'nw-loading-actions',
            attr: {
                style: `display:flex;justify-content:center;gap:12px;${this.options.showCancel ? '' : 'display:none;'}`
            }
        });

        if (this.options.showCancel) {
            this.cancelBtn = this.actionsContainer.createEl('button', {
                cls: 'nw-btn nw-btn-secondary',
                text: '取消',
                attr: { style: 'padding:8px 24px;' }
            });
            this.cancelBtn.addEventListener('click', () => {
                this.handleCancel();
            });
        }
    }
}
