/**
 * storage-keys.ts — 插件 localStorage 键名的唯一来源
 *
 * 键值**不可随意修改**：这些键已在用户设备上产生数据，
 * 改值等于让既有收藏 / 折叠状态 / 向导结果 / 耗时历史静默失效。
 * 新增键请先在此登记并复用 `NOVEL_WRITER_KEY_PREFIX` 或既有前缀。
 *
 * 历史前缀有两套（`novel-writer-*` 与 `nw-op-confirm:`），保持原值以兼容既有数据；
 * 统一迁移需配套读取回填，暂不在本模块做。
 */

export const NOVEL_WRITER_KEY_PREFIX = 'novel-writer-';

/** 单值键（无动态维度） */
export const STORAGE_KEYS = {
    /** 脑洞工坊收藏（ui/ideation-modal） */
    ideationFavorites: `${NOVEL_WRITER_KEY_PREFIX}ideation-favorites`,
    /** 项目侧栏分区折叠状态（ui/project-side-panel-view） */
    sidePanelCollapsed: `${NOVEL_WRITER_KEY_PREFIX}side-panel-collapsed`,
    /** 耗时估算历史样本（shared/time-estimator 默认键） */
    timeEstimatorHistory: `${NOVEL_WRITER_KEY_PREFIX}time-estimator-history`,
} as const;

/** 前缀键（需拼接动态维度：项目名 / rememberKey） */
export const STORAGE_KEY_PREFIXES = {
    /** 操作确认弹窗「不再提示」记忆；拼接 `rememberKey` */
    operationConfirm: 'nw-op-confirm:',
    /** 流程导出完成标记；拼接项目名 */
    flowExport: `${NOVEL_WRITER_KEY_PREFIX}flow-export-`,
    /** 向导步骤结果分桶；配合 `projectScopedKey` 拼接项目名 */
    wizardResults: `${NOVEL_WRITER_KEY_PREFIX}wizard-`,
} as const;

/** 旧版本遗留键：仅在启动 / 卸载时清理，不再写入 */
export const LEGACY_STORAGE_KEYS = [
    `${NOVEL_WRITER_KEY_PREFIX}reload-state`,
    `${NOVEL_WRITER_KEY_PREFIX}user-reload`,
] as const;

/** 项目分桶键：项目名为空时落到 `global`（保证切换项目后能读回） */
export function projectScopedKey(prefix: string, project?: string | null): string {
    return `${prefix}${project || 'global'}`;
}
