/**
 * plugin-leaves.ts — 卸载时摘除插件自有视图 leaf（单一入口，便于单测）
 *
 * 背景（2026-11-08 交叉审计）：`onunload` 此前只关闭 4 类浮窗（workspaceManager.closeAll），
 * 7 个主视图 leaf 完全依赖宿主回收。插件禁用/热重载后它们会留下空白页签并写回工作区布局。
 * Obsidian 官方样例插件在 onunload 里对自有 view type 调 `detachLeavesOfType`，这里收敛成一个
 * 可测试的小函数，避免每个入口各写一遍循环。
 */

/** 只依赖 detachLeavesOfType 的 workspace 形状（测试可直接传桩）。 */
export interface LeafWorkspaceLike {
    detachLeavesOfType(type: string): void;
}

/**
 * detachPluginLeaves：逐类型摘除插件视图叶子；单个类型失败不影响其余。
 *
 * @param workspace - 具备 `detachLeavesOfType` 的 workspace（或测试桩）
 * @param types - 视图类型常量清单
 * @returns 成功处理的类型数量
 */
export function detachPluginLeaves(workspace: LeafWorkspaceLike, types: readonly string[]): number {
    let detached = 0;
    for (const type of types) {
        try {
            workspace.detachLeavesOfType(type);
            detached++;
        } catch {
            // 宿主未注册该 view type 时会抛错：卸载路径必须尽力而为，不阻断其余类型
        }
    }
    return detached;
}
