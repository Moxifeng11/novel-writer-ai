/**
 * array-move.ts — 数组内重排的单一实现（章节/场景/卡片排序共用）。
 *
 * 为什么需要：拖拽放下时算出的插入下标是**移除前**的坐标，直接 splice 会在
 * 「向下拖、放在目标上半区」时差一位（场景拖拽的实际缺陷）；上下移动按钮则是
 * 明确的最终位置。两种语义混在一处手写 splice 里极易写错，这里拆成两个函数：
 *  - moveArrayItem：把 from 移到最终位置 to；
 *  - moveArrayItemToInsert：按移除前的插入下标插入（拖拽 drop 用）。
 */

/**
 * 把数组第 from 项移动到最终位置 to（就地修改）。
 *
 * @param items - 目标数组（就地修改）
 * @param from - 源下标
 * @param to - 移动后的最终下标
 * @returns 是否发生了移动；下标非法或原地不动返回 false
 */
export function moveArrayItem<T>(items: T[], from: number, to: number): boolean {
    if (!Number.isInteger(from) || !Number.isInteger(to)) return false;
    if (from < 0 || from >= items.length) return false;
    if (to < 0 || to >= items.length) return false;
    if (from === to) return false;
    const [item] = items.splice(from, 1);
    items.splice(to, 0, item);
    return true;
}

/**
 * 把第 from 项移动到「移除前下标 insertIndex 之前」。
 *
 * 拖拽 drop 用：`insertBefore ? targetIndex : targetIndex + 1` 就是移除前的插入下标。
 * 当 from 在插入点之前时，移除自身会让插入点左移一位，必须先减一——漏掉这一步
 * 就是「向下拖放到目标上半区时差一位」的根因。
 *
 * @param items - 目标数组（就地修改）
 * @param from - 源下标
 * @param insertIndex - 移除前的插入下标（0..items.length）
 * @returns 是否发生了移动
 */
export function moveArrayItemToInsert<T>(items: T[], from: number, insertIndex: number): boolean {
    if (!Number.isInteger(from) || !Number.isInteger(insertIndex)) return false;
    if (from < 0 || from >= items.length) return false;
    let to = Math.max(0, Math.min(items.length, insertIndex));
    if (from < to) to -= 1;
    return moveArrayItem(items, from, to);
}
