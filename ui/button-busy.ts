/**
 * button-busy.ts — 按钮忙碌态统一入口
 *
 * 背景：各面板手写 `disabled=true; text='...'; finally 恢复` 的模式不一致，
 * 连点会叠开多个 Modal 或重复发起 AI 请求。这里提供单按钮的最小守卫：
 * - 已在忙碌态时直接忽略第二次点击；
 * - 执行期间禁用并替换文案；
 * - 无论成功/异常都恢复原文案（异常向上抛，由调用方提示）。
 */

/**
 * 在按钮上执行一个动作并维持忙碌态。
 *
 * @param button - 目标按钮
 * @param busyText - 忙碌期间文案
 * @param action - 实际动作（可同步/异步）
 * @returns 动作结果
 */
export async function withButtonBusy<T>(
    button: HTMLButtonElement,
    busyText: string,
    action: () => T | Promise<T>,
): Promise<T | undefined> {
    if (button.disabled) return undefined;
    const originalText = button.textContent || '';
    button.disabled = true;
    button.textContent = busyText;
    button.classList.add('nw-btn-loading');
    try {
        return await action();
    } finally {
        button.disabled = false;
        button.textContent = originalText;
        button.classList.remove('nw-btn-loading');
    }
}
