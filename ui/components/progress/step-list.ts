import { ProgressEmitter, type ProgressState, type ProgressStep } from '@/shared/progress-emitter';

/**
 * 步骤列表组件
 *
 * 显示所有步骤列表：
 * - 已完成步骤：✓ 绿色
 * - 进行中步骤：● 高亮 + 子进度条
 * - 待执行步骤：○ 灰色
 * 可与 ProgressEmitter 绑定后自动更新
 *
 * @example
 * ```ts
 * const stepList = new StepListComponent(container, [
 *     '情节构思',
 *     '场景展开',
 *     '正文生成',
 * ]);
 * stepList.setCurrentStep(1);
 * stepList.updateStep(1, 50, '正在处理...');
 * ```
 */
export class StepListComponent {
    private container: HTMLElement;
    private steps: string[];

    private wrapperEl!: HTMLElement;
    private stepItems: HTMLElement[] = [];
    private stepProgressBars: (HTMLElement | null)[] = [];
    private stepProgressFills: (HTMLElement | null)[] = [];
    private stepIcons: HTMLElement[] = [];
    private stepLabels: HTMLElement[] = [];

    private unbindEmitter?: () => void;
    private currentStepIndex: number = -1;

    constructor(container: HTMLElement, steps: string[]) {
        this.container = container;
        this.steps = [...steps];

        this.render();
    }

    /**
     * 更新指定步骤的进度
     * @param stepIndex 步骤索引
     * @param progress 进度值（0-100）
     * @param message 可选的进度消息
     */
    updateStep(stepIndex: number, progress: number, message?: string): void {
        if (stepIndex < 0 || stepIndex >= this.steps.length) return;

        const clampedProgress = Math.max(0, Math.min(100, progress));
        const fillEl = this.stepProgressFills[stepIndex];
        if (fillEl) {
            fillEl.style.width = `${clampedProgress}%`;
        }

        if (message !== undefined) {
            const labelEl = this.stepLabels[stepIndex];
            const msgSpan = labelEl.querySelector<HTMLElement>('.nw-step-message');
            if (msgSpan) {
                msgSpan.setText(message);
                msgSpan.style.display = 'block';
            }
        }
    }

    /**
     * 设置当前进行中的步骤
     * @param stepIndex 步骤索引
     */
    setCurrentStep(stepIndex: number): void {
        if (stepIndex < -1 || stepIndex >= this.steps.length) return;

        this.currentStepIndex = stepIndex;

        for (let i = 0; i < this.steps.length; i++) {
            const itemEl = this.stepItems[i];
            const iconEl = this.stepIcons[i];
            const progressBar = this.stepProgressBars[i];

            if (i < stepIndex) {
                itemEl.style.color = 'var(--nw-success, #0f7b6c)';
                itemEl.style.opacity = '1';
                iconEl.setText('✓');
                iconEl.style.background = 'var(--nw-success-bg, rgba(15, 123, 108, 0.08))';
                iconEl.style.color = 'var(--nw-success, #0f7b6c)';
                if (progressBar) {
                    progressBar.style.display = 'none';
                }
            } else if (i === stepIndex) {
                itemEl.style.color = 'var(--text-normal)';
                itemEl.style.opacity = '1';
                iconEl.setText('●');
                iconEl.style.background = 'var(--interactive-accent)';
                iconEl.style.color = 'var(--text-on-accent)';
                if (progressBar) {
                    progressBar.style.display = 'block';
                }
            } else {
                itemEl.style.color = 'var(--text-muted)';
                itemEl.style.opacity = '0.6';
                iconEl.setText('○');
                iconEl.style.background = 'transparent';
                iconEl.style.color = 'var(--text-muted)';
                if (progressBar) {
                    progressBar.style.display = 'none';
                }
            }
        }
    }

    /**
     * 标记指定步骤为已完成
     * @param stepIndex 步骤索引
     */
    markStepComplete(stepIndex: number): void {
        if (stepIndex < 0 || stepIndex >= this.steps.length) return;

        const itemEl = this.stepItems[stepIndex];
        const iconEl = this.stepIcons[stepIndex];
        const progressBar = this.stepProgressBars[stepIndex];

        itemEl.style.color = 'var(--nw-success, #0f7b6c)';
        itemEl.style.opacity = '1';
        iconEl.setText('✓');
        iconEl.style.background = 'var(--nw-success-bg, rgba(15, 123, 108, 0.08))';
        iconEl.style.color = 'var(--nw-success, #0f7b6c)';
        if (progressBar) {
            progressBar.style.display = 'none';
        }

        const fillEl = this.stepProgressFills[stepIndex];
        if (fillEl) {
            fillEl.style.width = '100%';
        }
    }

    /**
     * 绑定 ProgressEmitter，自动更新步骤状态
     * @param emitter 进度事件发射器
     * @returns 取消绑定函数
     */
    bindEmitter(emitter: ProgressEmitter): () => void {
        if (this.unbindEmitter) {
            this.unbindEmitter();
        }

        const state = emitter.getState();
        this.syncFromState(state);

        const off = emitter.on((state: ProgressState) => {
            this.syncFromState(state);
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

    private syncFromState(state: ProgressState): void {
        if (!state.steps || state.steps.length === 0) {
            if (state.currentStep) {
                const idx = this.steps.findIndex(s => s === state.currentStep);
                if (idx >= 0) {
                    this.setCurrentStep(idx);
                }
            }
            return;
        }

        if (state.steps.length !== this.steps.length) {
            this.steps = state.steps.map((s: ProgressStep) => s.name);
            this.render();
        }

        let foundCurrent = false;
        for (let i = 0; i < state.steps.length; i++) {
            const step = state.steps[i];
            if (step.status === 'running') {
                this.setCurrentStep(i);
                this.updateStep(i, step.progress, step.message);
                foundCurrent = true;
            } else if (step.status === 'completed') {
                this.markStepComplete(i);
            } else if (i < this.currentStepIndex) {
                this.markStepComplete(i);
            }
        }

        if (!foundCurrent && state.status === 'completed') {
            for (let i = 0; i < this.steps.length; i++) {
                this.markStepComplete(i);
            }
        }
    }

    private render(): void {
        if (this.wrapperEl) {
            this.wrapperEl.remove();
        }

        this.stepItems = [];
        this.stepProgressBars = [];
        this.stepProgressFills = [];
        this.stepIcons = [];
        this.stepLabels = [];

        this.wrapperEl = this.container.createDiv({
            cls: 'nw-step-list-wrapper',
            attr: { style: 'display:flex;flex-direction:column;gap:8px;' }
        });

        this.steps.forEach((stepName, index) => {
            const stepItem = this.wrapperEl.createDiv({
                cls: 'nw-step-item',
                attr: {
                    style: 'display:flex;gap:12px;align-items:flex-start;transition:all 0.2s ease;'
                }
            });
            this.stepItems.push(stepItem);

            const iconEl = stepItem.createDiv({
                cls: 'nw-step-icon',
                attr: {
                    style: 'width:24px;height:24px;flex-shrink:0;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:600;transition:all 0.2s ease;'
                }
            });
            iconEl.setText('○');
            iconEl.style.background = 'transparent';
            iconEl.style.color = 'var(--text-muted)';
            this.stepIcons.push(iconEl);

            const contentEl = stepItem.createDiv({
                cls: 'nw-step-content',
                attr: { style: 'flex:1;min-width:0;padding-top:2px;' }
            });

            const labelEl = contentEl.createDiv({
                cls: 'nw-step-label',
                attr: { style: 'display:flex;flex-direction:column;' }
            });
            this.stepLabels.push(labelEl);

            const nameSpan = labelEl.createSpan({
                cls: 'nw-step-name',
                attr: { style: 'font-size:13px;font-weight:500;' }
            });
            nameSpan.setText(stepName);

            const messageSpan = labelEl.createSpan({
                cls: 'nw-step-message',
                attr: { style: 'font-size:12px;color:var(--text-muted);margin-top:2px;display:none;' }
            });

            const progressBar = contentEl.createDiv({
                cls: 'nw-step-progress-bar',
                attr: {
                    style: 'height:4px;background:var(--background-secondary);border-radius:2px;margin-top:6px;overflow:hidden;display:none;'
                }
            });
            this.stepProgressBars.push(progressBar);

            const progressFill = progressBar.createDiv({
                cls: 'nw-step-progress-fill',
                attr: {
                    style: 'height:100%;width:0%;background:var(--interactive-accent);border-radius:2px;transition:width 0.3s ease;'
                }
            });
            this.stepProgressFills.push(progressFill);
        });
    }
}
