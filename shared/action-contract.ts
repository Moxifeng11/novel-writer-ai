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

/**
 * Agent 工具名的动作分类（显式表，覆盖 Harness 全部工具）。
 *
 * 与命令 id 的分类口径一致：读 = 不改作品；写正文/写设定 = 改内容；
 * 管理 = 项目级结构操作。未登记的工具按「管理」处理（安全侧）。
 */
export const AGENT_TOOL_KINDS: Record<string, ActionKind> = {
    // 只读
    read_file: 'read',
    search_vault: 'read',
    list_projects: 'read',
    list_chapters: 'read',
    list_commands: 'read',
    get_project_status: 'read',
    get_execution_status: 'read',
    open_wizard: 'read',
    open_flow: 'read',
    open_full_writer: 'read',
    open_story_settings: 'read',
    open_pre_research: 'read',
    open_co_writing: 'read',
    open_chapter: 'read',
    random_story_settings: 'read',
    // 写设定/内容（路径参数决定是正文还是设定，见 agentToolKind）
    write_file: 'write-setting',
    move_file: 'write-setting',
    delete_file: 'write-setting',
    update_memory: 'write-setting',
    // 管理
    create_long_project: 'admin',
    create_short_project: 'admin',
    create_script_project: 'admin',
    delete_project: 'admin',
    update_plan: 'admin',
    run_command: 'admin',
};

/**
 * 判断 Agent 工具本次调用属于哪类动作。
 *
 * 路径类工具按目标路径细分（正文 vs 设定）；run_command 按被调命令 id 细分。
 *
 * @param toolName - 工具名
 * @param args - 工具参数
 * @returns 动作类型
 */
export function agentToolKind(toolName: string, args?: Record<string, unknown>): ActionKind {
    const name = String(toolName || '').trim();
    if (!name) return 'admin';
    if (name === 'run_command') {
        const commandId = String(args?.commandId ?? args?.id ?? '').trim();
        return commandId ? actionKind(commandId) : 'admin';
    }
    if (name === 'write_file' || name === 'move_file' || name === 'delete_file') {
        const path = String(args?.path ?? args?.target ?? args?.file ?? '').trim();
        return path && looksLikeProsePath(path) ? 'write-prose' : 'write-setting';
    }
    return AGENT_TOOL_KINDS[name] ?? 'admin';
}

/**
 * 路径是否指向正文（章节/正文目录）。
 *
 * @param path - vault 相对路径
 * @returns 是正文返回 true
 */
export function looksLikeProsePath(path: string): boolean {
    const normalized = String(path || '').replace(/\\/g, '/');
    return /(^|\/)(\d+-)?(正文|章节|chapters?|drafts?)(\/|$)/i.test(normalized);
}

/**
 * Agent 工具在只读模式下是否允许。
 *
 * @param toolName - 工具名
 * @param args - 工具参数
 * @param readOnly - 是否只读模式
 * @returns 允许返回 null；否则返回拒绝原因
 */
export function agentToolDenyReason(
    toolName: string,
    args: Record<string, unknown> | undefined,
    readOnly: boolean,
): string | null {
    if (!readOnly) return null;
    const kind = agentToolKind(toolName, args);
    if (kind === 'read') return null;
    return `🔒 只读模式已开启：Agent 工具「${toolName}」会修改作品（${kind}），已阻止。可在设置中关闭只读模式。`;
}

/**
 * 解析工具的动作分类：工具自声明的 kind 优先，未声明时按名字/参数推断。
 *
 * @param tool - 带 name 与可选 kind 的工具对象
 * @param args - 工具参数（动态分类用）
 * @returns 动作类型
 */
export function resolveToolKind(
    tool: { name: string; kind?: ActionKind },
    args?: Record<string, unknown>,
): ActionKind {
    if (tool.kind) return tool.kind;
    return agentToolKind(tool.name, args);
}
