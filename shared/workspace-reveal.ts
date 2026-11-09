/**
 * workspace-reveal.ts — 兼容 Obsidian 1.4.4 的 leaf 前台化
 *
 * `Workspace.revealLeaf` 的 Promise/侧栏 uncollapse 语义在 1.7.2 才定型，
 * 而本插件声明 minAppVersion 1.4.4。这里用 0.16.3 起可用的
 * `setActiveLeaf(leaf, { focus })` + 显式展开侧栏替代，避免使用越界 API。
 *
 * 只做结构类型，不 import 运行时 obsidian，便于单测。
 */

/** 侧栏（左右 split / 移动端 drawer）的最小能力 */
export interface RevealSideDock {
    expand?: () => void;
}

/** WorkspaceLeaf 的最小能力 */
export interface RevealLeaf {
    getRoot?: () => unknown;
}

/** Workspace 的最小能力 */
export interface RevealWorkspace {
    setActiveLeaf(leaf: RevealLeaf, params?: { focus?: boolean }): void;
    leftSplit?: RevealSideDock;
    rightSplit?: RevealSideDock;
}

/** 前台化选项 */
export interface RevealLeafOptions {
    /** 是否抢键盘焦点，默认 true（入口均为用户动作） */
    focus?: boolean;
    /** 侧栏位置；auto 时用 leaf.getRoot() 与左右 split 比对 */
    side?: 'left' | 'right' | 'auto';
}

/**
 * 兼容 1.4.4 的 leaf 前台化：先按需展开侧栏，再 setActiveLeaf。
 *
 * @param workspace - Obsidian Workspace（或最小结构替身）
 * @param leaf - 目标 WorkspaceLeaf
 * @param options - 焦点与侧栏选项
 * @returns 无
 */
export function revealLeafCompat(
    workspace: RevealWorkspace,
    leaf: RevealLeaf,
    options: RevealLeafOptions = {},
): void {
    const side = options.side ?? 'auto';
    try {
        if (side === 'right') {
            workspace.rightSplit?.expand?.();
        } else if (side === 'left') {
            workspace.leftSplit?.expand?.();
        } else if (typeof leaf.getRoot === 'function') {
            const root = leaf.getRoot();
            if (root && root === workspace.rightSplit) workspace.rightSplit?.expand?.();
            else if (root && root === workspace.leftSplit) workspace.leftSplit?.expand?.();
        }
    } catch {
        // 侧栏探测失败不应阻止 leaf 激活
    }
    workspace.setActiveLeaf(leaf, { focus: options.focus ?? true });
}
