/**
 * yield.ts — UI 让步工具
 *
 * 在长时间同步计算中调用 `await yieldToUI()` 可让出主线程控制权，
 * 让浏览器处理 UI 事件（滚动、点击等），防止界面卡死。
 *
 * 在「刚改完 DOM 就要测量 / 聚焦 / 滚动」的场景调用 `await nextFrame()`，
 * 等待样式变更被解析且布局绘制完成，替代散落的 `setTimeout(fn, 16)`。
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

/**
 * 等待一帧渲染完成
 *
 * 双重 requestAnimationFrame：首个回调保证本次 DOM 变更已被解析，第二个保证
 * 布局与绘制结束，比 `setTimeout(fn, 16)`（16ms 只是常见帧间隔近似值）更精确。
 *
 * 两处兜底：
 * - 后台窗口 / 最小化时 rAF 可能长时间不触发（历史 P0-2 事故：流程永久挂起），
 *   故与 50ms 超时竞速，先到者 resolve。
 * - 非浏览器环境（如 jsdom 单测）无 rAF 时退化为 setTimeout(16)。
 *
 * @returns Promise<void> 在下一帧绘制完成或 50ms 超时后 resolve
 */
export function nextFrame(): Promise<void> {
    if (typeof requestAnimationFrame === 'undefined') {
        return new Promise(resolve => setTimeout(resolve, 16));
    }
    return Promise.race([
        new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
        new Promise<void>(resolve => setTimeout(resolve, 50)),
    ]);
}
