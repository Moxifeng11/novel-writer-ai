/**
 * yield.ts — UI 让步工具
 *
 * 在长时间同步计算中调用 `await yieldToUI()` 可让出主线程控制权，
 * 让浏览器处理 UI 事件（滚动、点击等），防止界面卡死。
 *
 * 原理：Promise + setTimeout(0) 将后续代码推到下一个事件循环 tick 执行。
 */

/**
 * 让出主线程控制权，允许浏览器处理 UI 事件
 * @returns Promise<void> 在下一个事件循环 tick 时 resolve
 */
export function yieldToUI(): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, 0));
}
