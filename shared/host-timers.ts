/**
 * host-timers.ts — 平台无关的定时器宿主
 *
 * 主线程走 window（弹窗与弹出窗口里语义正确，Obsidian 审核规则也要求）；
 * Web Worker（拆解/质检 worker）里没有 window，退回 self 自带的定时器。
 *
 * 直接用 window.* 会让被打包进 worker 的模块在 worker 里抛 ReferenceError；
 * 直接写裸 setTimeout 又会触发 obsidianmd/prefer-window-timers。集中在这里
 * 选择一次宿主，调用方只依赖本模块。
 *
 * 宿主在调用时解析而不是模块加载时绑定：测试环境可能先加载模块再补
 * requestAnimationFrame，加载时绑定会拿到 undefined。
 */

type TimerHost = Window;

/** 解析当前运行环境的定时器宿主：主线程用 window，Web Worker 用 self 全局。 */
function host(): TimerHost {
    // 主线程 self === window；Web Worker 里没有 window，但有 self，指向 worker 全局
    return typeof window !== 'undefined' ? window : self;
}

/**
 * 与 window.setTimeout 语义一致，worker 里退回 worker 全局的 setTimeout。
 *
 * @param handler 到时执行的回调
 * @param timeout 延迟毫秒数，省略时按事件循环尽快执行
 * @returns 定时器 id，可传给 hostClearTimeout 取消
 */
export function hostSetTimeout(handler: (value: never) => void, timeout?: number): number {
    return host().setTimeout(handler, timeout);
}

/**
 * 与 window.clearTimeout 语义一致。
 *
 * @param id hostSetTimeout 返回的定时器 id；省略时不执行任何操作
 */
export function hostClearTimeout(id?: number): void {
    host().clearTimeout(id);
}

/**
 * 与 window.requestAnimationFrame 语义一致，缺少 rAF 的宿主退化为 16ms 定时器。
 *
 * @param callback 下一帧绘制的回调
 * @returns 帧请求 id
 */
export function hostRequestAnimationFrame(callback: FrameRequestCallback): number {
    const h = host();
    if (typeof h.requestAnimationFrame === 'function') {
        return h.requestAnimationFrame(callback);
    }
    return h.setTimeout(() => callback(Date.now()), 16);
}
