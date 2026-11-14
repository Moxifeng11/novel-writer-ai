/**
 * action-contract.ts — 动作语义契约（借鉴催更姬 contracts/actions.js）
 *
 * 目的：把「这条命令/动作会做什么」从实现里抽出来，变成一份可判定的契约，
 * 让权限（只读会话）、审计、字数统计、结算触发都能基于同一份判定。
 *
 * 催更姬的做法是三张冻结表（TOOL_ACTIONS / HUMAN_ACTIONS / isReadAction / changesProse）。
 * 我们命令 id 数量多且以 `novel-writer-` 为前缀，因此采用：
 *   1. **显式例外表**（覆盖语义与命名不一致的命令）
 *   2. **命名规则兜底**（按动词/名词分类）
 *   3. 判定函数：isReadAction / changesProse / isWriteAction / actionKind
 */

/** 动作类别 */
export type ActionKind =
    /** 只读：查看、统计、导出、诊断 */
    | 'read'
    /** 改正文：写作、生成、修订、删除章节 */
    | 'write-prose'
    /** 改设定/规划/事实库：人物、世界观、时间线、伏笔 */
    | 'write-setting'
    /** 管理：项目创建/重命名、设置、插件维护 */
    | 'admin';

/**
 * 显式例外表：命名规则判不出来的命令。
 *
 * 键为去掉 `novel-writer-` 前缀后的命令 id 片段（也支持完整 id）。
 */
/** 判定为「只读」的命令片段（优先级最高：查看/统计/导出/诊断类） */
const READ_TOKENS: readonly string[] = [
    'overview', 'dashboard', 'viewer', '-view', 'stats', 'report', 'audit',
    'health', 'diagnose', 'export', 'inspect', 'search', 'history', 'rank',
    'ledger', 'registry', 'center', 'home', 'panel', 'library', 'store',
    'linkage', 'graph', 'knowledge-base', 'properties', 'session',
];

/** 判定为「管理」的命令片段 */
const ADMIN_TOKENS: readonly string[] = [
    'create', 'rename', 'import', 'backup', 'migrate', 'rebuild', 'protect',
    'settings', 'onboarding', 'prune', 'clear', 'cache', 'toggle', 'provider',
    'namespace', 'tags', 'complete-properties', 'refresh',
];

/** 判定为「改正文」的动词片段 */
const PROSE_WRITE_TOKENS: readonly string[] = [
    'write-chapter', 'batch-chapter', 'batch-novel', 'continue-chapter',
    'auto-writer', 'review-chapter', 'targeted-revision', 'expand-text',
    'rewrite-suggestion', 'golden-opening', 'save-version', 'expand',
    'ideation', 'settlement',
];

/** 判定为「写设定/规划」的动词片段 */
const SETTING_WRITE_TOKENS: readonly string[] = [
    'worldview', 'character', 'faction', 'location', 'item', 'entity', 'timeline', 'foreshadow',
    'setting-lib', 'extract-elements', 'deconstruct', 'generate-bases',
    'story-core', 'outline', 'scene-bible', 'storyboard', 'research',
    'plan-book', 'volume-intro', 'fingerprint', 'style-distiller',
    'context-injector', 'cross-volume', 'build',
];

/**
 * 显式例外表：分组/命名都判不出来的命令。
 *
 * 键为去掉 `novel-writer-` 前缀后的命令片段。
 */
export const ACTION_KIND_OVERRIDES: Readonly<Record<string, ActionKind>> = Object.freeze({
    'agent-guide': 'write-prose',
    'chapter-settlement': 'write-prose',
    'quality-dashboard': 'read',
    'story-linkage': 'read',
    'validate-story-graph': 'read',
    'tomato-rank': 'read',
    'context-injector': 'read',
    'fingerprint-library': 'read',
    'open-knowledge-base': 'read',
    'toggle-pet': 'admin',
    'open-settings': 'admin',
    'open-home': 'read',
    'job-center': 'read',
    'project-health': 'read',
    'asset-registry': 'read',
    'usage-ledger': 'read',
    'backup-center': 'read',
    'full-writer': 'write-prose',
    'open-flow': 'read',
    'project-side-panel': 'read',
    'version-history': 'read',
    'writing-stats': 'read',
    'complete-properties': 'admin',
    'refresh-info-debt': 'admin',
    'batch-create': 'admin',
    'batch-deconstruct': 'write-setting',
    'ideation': 'write-setting',
    'review-chapter': 'write-prose',
    'outline-expand': 'write-setting',
    'worldview': 'write-setting',
});

/**
 * 分组兜底：命名规则判不出时按命令分组归类。
 *
 * @param group - 命令分组
 * @returns 动作类别；未知分组返回 null
 */
export function kindForGroup(group: string): ActionKind | null {
    switch (group) {
        case 'project-management': return 'admin';
        case 'writing-assistant': return 'write-prose';
        case 'knowledge-base': return 'write-setting';
        case 'views': return 'read';
        case 'version': return 'write-prose';
        case 'tools': return 'admin';
        default: return null;
    }
}

/**
 * 去掉插件前缀，得到可比较的命令片段。
 *
 * @param action - 完整命令 id 或动作名
 * @returns 归一化片段（小写、去前缀）
 */
export function normalizeAction(action: string): string {
    return String(action || '')
        .trim()
        .toLowerCase()
        .replace(/^novel-writer-ai:/, '')
        .replace(/^novel-writer-/, '');
}

/**
 * 判定动作类别。
 *
 * 顺序：显式例外 → 只读片段 → 管理片段 → 写正文片段 → 写设定片段 → 默认只读。
 * 默认只读是安全侧：未识别的命令不应被当成写操作而触发结算/统计。
 *
 * @param action - 完整命令 id 或动作名
 * @param group - 可选命令分组（命名判不出时兜底）
 * @returns 动作类别
 */
export function actionKind(action: string, group?: string): ActionKind {
    const key = normalizeAction(action);
    const override = ACTION_KIND_OVERRIDES[key];
    if (override) return override;
    if (READ_TOKENS.some(token => key.includes(token))) return 'read';
    if (ADMIN_TOKENS.some(token => key.includes(token))) return 'admin';
    if (PROSE_WRITE_TOKENS.some(token => key.includes(token))) return 'write-prose';
    if (SETTING_WRITE_TOKENS.some(token => key.includes(token))) return 'write-setting';
    return (group ? kindForGroup(group) : null) ?? 'read';
}

/**
 * 是否只读动作。
 *
 * @param action - 命令 id 或动作名
 * @param group - 可选命令分组
 * @returns 只读返回 true
 */
export function isReadAction(action: string, group?: string): boolean {
    return actionKind(action, group) === 'read';
}

/**
 * 是否写动作（任何写类别）。
 *
 * @param action - 命令 id 或动作名
 * @param group - 可选命令分组
 * @returns 写动作返回 true
 */
export function isWriteAction(action: string, group?: string): boolean {
    return actionKind(action, group) !== 'read';
}

/**
 * 是否改动正文（决定是否触发字数统计 / 章节结算 / 版本保存）。
 *
 * @param action - 命令 id 或动作名
 * @param group - 可选命令分组
 * @returns 改正文返回 true
 */
export function changesProse(action: string, group?: string): boolean {
    return actionKind(action, group) === 'write-prose';
}

/**
 * 是否改动设定/规划（决定是否刷新设定索引、时间线、伏笔面板）。
 *
 * @param action - 命令 id 或动作名
 * @param group - 可选命令分组
 * @returns 改设定返回 true
 */
export function changesSetting(action: string, group?: string): boolean {
    return actionKind(action, group) === 'write-setting';
}
