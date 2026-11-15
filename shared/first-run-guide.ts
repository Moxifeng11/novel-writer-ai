/**
 * first-run-guide.ts — 首装是否自动打开引导页（纯判定）
 *
 * 目标：从社区市场下载插件后，用户打开 Obsidian 就应该直接进入「3 分钟引导」，
 * 而不是停在欢迎弹窗或空工作台上找入口；且只自动弹一次，避免每次启动都打扰。
 */

/** 判定输入 */
export interface FirstRunGuideState {
    /** 缓存里是否有上次运行版本（无 = 真正的首次安装） */
    hasLastRunVersion: boolean;
    /** 是否已完成过引导（设置 firstRunComplete） */
    firstRunComplete: boolean;
    /** 当前作品数量 */
    projectCount: number;
    /** 之前是否已自动弹过引导（cache.welcomed，弹过就不再自动弹） */
    guideShownBefore: boolean;
}

/**
 * 是否自动打开首启引导。
 *
 * 规则（按顺序）：
 * 1. 已完成引导 → 不弹；
 * 2. 已经自动弹过一次 → 不弹（用户可通过命令「🚀 首启引导」随时打开）；
 * 3. 首次安装（无上次运行版本）→ 弹；
 * 4. 还没完成引导且一个作品都没有 → 弹（例如清空作品后重装/迁移）。
 *
 * @param state - 判定状态
 * @returns 需要自动打开返回 true
 * @example
 * ```ts
 * shouldAutoOpenFirstRunGuide({ hasLastRunVersion: false, firstRunComplete: false, projectCount: 0, guideShownBefore: false });
 * // true（刚下载安装）
 * ```
 */
export function shouldAutoOpenFirstRunGuide(state: FirstRunGuideState): boolean {
    if (state.firstRunComplete) return false;
    if (state.guideShownBefore) return false;
    if (!state.hasLastRunVersion) return true;
    return state.projectCount === 0;
}
