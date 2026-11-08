import { ProgressEmitter, type ProgressState } from '@/shared/progress-emitter';

/**
 * 进度条组件选项
 */
export interface ProgressBarOptions {
    height?: string;
    color?: string;
    showPercent?: boolean;
    showMessage?: boolean;
}

/**
 * 进度条组件
 *
 * 显示水平进度条 + 百分比数字 + 当前步骤消息
 * 支持自定义高度、颜色，可与 ProgressEmitter 绑定后自动更新
 *
 * @example
 * ```ts
 * const bar = new ProgressBarComponent(container, { height: '8px' });
 * bar.setProgress(50, '正在处理...');
 * const off = bar.bindEmitter(emitter);
 * ```
 */
export class ProgressBarComponent {
    private container: HTMLElement;
    private options: Required<ProgressBarOptions>;

    private wrapperEl!: HTMLElement;
    private barContainerEl!: HTMLElement;
    private barFillEl!: HTMLElement;
    private percentEl!: HTMLElement;
    private messageEl!: HTMLElement;

    private unbindEmitter?: () => void;
    private currentProgress: number = 0;
    private currentMessage: string = '';

    constructor(container: HTMLElement, options?: ProgressBarOptions) {
        this.container = container;
        this.options = {
            height: '6px',
            color: 'var(--interactive-accent)',
            showPercent: true,
            showMessage: true,
            ...options,
        };

        this.render();
    }

    /**
     * 设置进度
     * @param progress 进度值（0-100）
     * @param message 可选的进度消息
     */
    setProgress(progress: number, message?: string): void {
        const clampedProgress = Math.max(0, Math.min(100, progress));
        this.currentProgress = clampedProgress;

        this.barFillEl.style.width = `${clampedProgress}%`;

        if (this.options.showPercent) {
            this.percentEl.setText(`${clampedProgress.toFixed(0)}%`);
        }

        if (message !== undefined && this.options.showMessage) {
            this.currentMessage = message;
            this.messageEl.setText(message);
        }
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
        this.setProgress(state.progress, state.message);

        const off = emitter.on((state: ProgressState) => {
            this.setProgress(state.progress, state.message);
        });
        this.unbindEmitter = off;

        return off;
    }

    /**
     * 销毁组件，清理资源
     */
    destroy(): void {
        if (this.unbindEmitter) {
            this.unbindEmitter();
            this.unbindEmitter = undefined;
        }
        this.wrapperEl.remove();
    }

    private render(): void {
        this.wrapperEl = this.container.createDiv({ cls: 'nw-progress-bar-wrapper' });
        // 高度/颜色来自调用方选项，属于动态值：用自定义属性交给 CSS，不写内联样式
        this.wrapperEl.style.setProperty('--nw-progress-h', this.options.height);
        this.wrapperEl.style.setProperty('--nw-progress-color', this.options.color);

        const topRow = this.wrapperEl.createDiv({ cls: 'nw-progress-bar-top' });

        this.messageEl = topRow.createSpan({
            cls: this.options.showMessage
                ? 'nw-progress-bar-message'
                : 'nw-progress-bar-message nw-u-d-none',
        });

        this.percentEl = topRow.createSpan({
            cls: this.options.showPercent
                ? 'nw-progress-bar-percent'
                : 'nw-progress-bar-percent nw-u-d-none',
        });
        this.percentEl.setText('0%');

        this.barContainerEl = this.wrapperEl.createDiv({ cls: 'nw-progress-bar-container' });
        this.barFillEl = this.barContainerEl.createDiv({ cls: 'nw-progress-bar-fill' });
    }
}
