/**
 * error-state.ts — 统一错误态
 *
 * 目标：用户操作失败时至少给出「发生了什么 + 下一步能做什么」，
 * 不再只弹一个 Notice 或把异常吞掉。样式复用已有的 `.nw-flow-error`。
 */
/**
 * 错误态中的一个可执行动作。
 */
export interface ErrorStateAction {
    label: string;
    onClick: () => void;
    primary?: boolean;
}

/**
 * 错误态内容选项。
 */
export interface ErrorStateOptions {
    title: string;
    detail?: string;
    /** 可选修复动作（重试、打开设置、打开日志等） */
    actions?: ErrorStateAction[];
}

/**
 * 在容器里渲染错误态。
 *
 * @param host - 容器
 * @param options - 标题、详情与动作
 * @returns 错误态根元素
 * @example
 * ```ts
 * createErrorState(host, {
 *   title: '导出失败',
 *   detail: error.message,
 *   actions: [{ label: '重试', primary: true, onClick: retry }],
 * });
 * ```
 */
export function createErrorState(host: HTMLElement, options: ErrorStateOptions): HTMLElement {
    const box = host.createDiv({ cls: 'nw-flow-error' });
    box.createDiv({ cls: 'nw-flow-error-title', text: options.title });
    if (options.detail) box.createDiv({ cls: 'nw-flow-error-detail', text: options.detail });
    if (options.actions && options.actions.length > 0) {
        const row = box.createDiv({ cls: 'nw-flow-error-actions nw-u-flex nw-u-gap-8' });
        for (const action of options.actions) {
            const button = row.createEl('button', {
                cls: `nw-btn ${action.primary ? 'nw-btn-primary' : 'nw-btn-secondary'}`,
                text: action.label,
            });
            button.addEventListener('click', action.onClick);
        }
    }
    return box;
}
