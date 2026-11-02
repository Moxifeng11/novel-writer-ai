/**
 * store/shallow.ts — 浅比较工具
 *
 * 用于选择器优化，只有当选择的状态切片发生浅变化时才触发 listener。
 */

/**
 * 浅比较两个值是否相等
 *
 * 比较规则：
 * - 原始类型：值比较
 * - 对象/数组：第一层属性值比较
 * - 引用相同：直接返回 true
 * @param objA - 对象 A
 * @param objB - 对象 B
 * @returns 是否成功
 */
export function shallow<T>(objA: T, objB: T): boolean {
    if (Object.is(objA, objB)) {
        return true;
    }

    if (
        typeof objA !== 'object' ||
        objA === null ||
        typeof objB !== 'object' ||
        objB === null
    ) {
        return false;
    }

    const keysA = Object.keys(objA);
    const keysB = Object.keys(objB);

    if (keysA.length !== keysB.length) {
        return false;
    }

    for (let i = 0; i < keysA.length; i++) {
        const key = keysA[i] as keyof T;
        if (
            !Object.prototype.hasOwnProperty.call(objB, key) ||
            !Object.is(objA[key], objB[key])
        ) {
            return false;
        }
    }

    return true;
}
