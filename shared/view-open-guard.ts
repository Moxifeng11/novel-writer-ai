/**
 * 视图生命周期代次守卫（L3-1）。
 *
 * 为什么需要：ItemView.onOpen 里常有多个 await（恢复状态、加载上下文、读配置）。
 * 用户在 await 期间关掉标签、或插件被禁用时，Async 续体会继续往已销毁的容器渲染，
 * 并在 Component 已经 unload 之后才 registerEvent —— 监听挂在已死组件上（Obsidian 会
 * 丢弃），或渲染进脱离 DOM 的节点。onClose 无法直接取消 Promise，只能作废「代次」，
 * 让 onOpen 在每个 await 后自行核对是否还有效。
 *
 * 用法：onOpen 开头 `const token = guard.begin()`；每个 await 之后
 * `if (!guard.isCurrent(token)) return;`；onClose 里 `guard.invalidate()`。
 */

/** onOpen/onClose 代次守卫句柄 */
export interface ViewOpenGuard {
    /** 开始一次 onOpen，返回本轮代次；此前未结束的 onOpen 全部作废 */
    begin(): number;
    /** 该代次是否仍是当前代次（onClose 或被新的 onOpen 取代后变 false） */
    isCurrent(token: number): boolean;
    /** 作废当前代次（onClose 调用；重复调用无副作用） */
    invalidate(): void;
}

/**
 * 创建一个视图生命周期代次守卫。
 *
 * @returns 代次守卫句柄
 */
export function createViewOpenGuard(): ViewOpenGuard {
    let current = 0;
    return {
        begin: () => ++current,
        isCurrent: (token: number) => token === current,
        invalidate: () => { current += 1; },
    };
}
