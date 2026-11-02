/**
 * keyboard.ts — 键盘事件守卫
 *
 * 中文输入法（IME）组字期间按 Enter / Escape / Tab 只代表「确认候选 / 取消候选」，
 * 不应触发提交、关闭、切换等业务动作。`keyCode === 229` 是部分浏览器/输入法在
 * 组字阶段兜底上报的键码，两条件都要判。
 */

type KeyLike = {
    isComposing?: boolean;
    keyCode?: number;
    nativeEvent?: { isComposing?: boolean; keyCode?: number };
};

/**
 * 事件是否处于 IME 组字阶段（React/原生事件都能传）
 *
 * @param event - 事件
 * @returns 是否成功
 */
export function isImeComposing(event: KeyLike | null | undefined): boolean {
    if (!event) return false;
    if (event.isComposing === true) return true;
    if (event.keyCode === 229) return true;
    const native = event.nativeEvent;
    if (native && (native.isComposing === true || native.keyCode === 229)) return true;
    return false;
}
