/**
 * project-locator.ts — 三域模式库与项目路径定位
 *
 * 项目 ID 使用 vault 内相对目录路径：
 * - legacy：`项目名`
 * - 模式库：`长篇小说/项目名`、`短篇小说/项目名`、`剧本/项目名`
 *
 * 所有路径仍可直接 `${projectId}/...` 拼接；display 名称取最后一段。
 */
import type { CreationMode } from '../../shared/creation-mode';

export const MODE_LIBRARY_ROOTS: Record<Exclude<CreationMode, never>, string> = {
    long: '长篇小说',
    short: '短篇小说',
    script: '剧本',
};

export const MODE_LIBRARY_ROOT_LIST = Object.values(MODE_LIBRARY_ROOTS);

/**
 * 模式对应的模式库根目录名。
 *
 * @param mode - long / short / script
 * @returns `长篇小说` / `短篇小说` / `剧本`
 */
export function modeLibraryRoot(mode: CreationMode): string {
    return MODE_LIBRARY_ROOTS[mode];
}

/**
 * 从路径推断所属模式库；路径恰好等于库根时返回 null（它不是一个项目）。
 *
 * @param path - vault 相对路径
 * @returns 模式或 null
 */
export function modeFromLibraryPath(path: string): CreationMode | null {
    const normalized = String(path || '').replace(/\\/g, '/');
    for (const [mode, root] of Object.entries(MODE_LIBRARY_ROOTS) as Array<[CreationMode, string]>) {
        if (normalized === root) return null;
        if (normalized.startsWith(`${root}/`)) return mode;
    }
    return null;
}

/**
 * 项目显示名：模式库项目取最后一段；legacy 项目取完整 ID。
 *
 * @param projectId - 项目 ID（vault 相对路径）
 * @returns 展示用名称
 */
export function projectDisplayName(projectId: string): string {
    const normalized = String(projectId || '').replace(/\\/g, '/');
    const mode = modeFromLibraryPath(normalized);
    return mode ? normalized.split('/').pop() || normalized : normalized;
}

/**
 * 项目路径定位：模式项目必须在模式库中；legacy 项目允许根目录。
 *
 * @param project - 项目 ID 或名称
 * @param mode - 目标模式；配合 requireLibrary 时用于补全库根
 * @param options.requireLibrary - 为 true 且未带库根时，强制补全到模式库
 * @returns 规范化后的项目路径；空输入返回空串
 */
export function resolveProjectRoot(
    project: string,
    mode?: CreationMode,
    options?: { requireLibrary?: boolean }
): string {
    const normalized = String(project || '').replace(/\\/g, '/').replace(/\/+$/, '');
    if (!normalized) return '';
    const inferred = modeFromLibraryPath(normalized);
    if (inferred) return normalized;
    if (mode && options?.requireLibrary) return `${MODE_LIBRARY_ROOTS[mode]}/${normalized}`;
    return normalized;
}

/**
 * 新建项目目标路径；同名冲突由调用方检查。
 *
 * @param name - 用户/模型给出的项目名（按不可信输入处理）
 * @param mode - 目标模式
 * @returns `<模式库>/<安全项目名>`
 * @throws 项目名为空或只由 `.` 组成时抛出
 */
export function newProjectPath(name: string, mode: CreationMode): string {
    // 只去掉斜杠是不够的：`..` 归一化后等于「模式库根目录」甚至 Vault 根，
    // Agent 传入 ".."/"." 时会删除整库/整个 Vault（项目名来自模型输出，必须按不可信输入处理）。
    const raw = String(name || '').trim();
    const safeName = raw.replace(/[\\/]+/g, '').trim();
    if (!safeName || safeName === '.' || /^\.+$/.test(safeName)) {
        throw new Error(`非法项目名：「${raw || '(空)'}」不能用作项目目录`);
    }
    return `${MODE_LIBRARY_ROOTS[mode]}/${safeName}`;
}

/**
 * 按显示名排序（中文拼音/本地化规则）。
 *
 * @param a - 项目 ID
 * @param b - 项目 ID
 * @returns localeCompare 结果
 */
export function projectDisplayNameComparator(a: string, b: string): number {
    return projectDisplayName(a).localeCompare(projectDisplayName(b), 'zh-Hans-CN');
}

/**
 * 从任意项目内文件路径推断所属项目 ID（最长匹配模式库/根目录）。
 *
 * @param filePath - 文件路径
 * @param candidates - 候选项目 ID 列表
 * @returns 命中的最长候选；无命中返回 null
 */
export function projectFromFilePath(
    filePath: string,
    candidates: string[]
): string | null {
    const normalized = String(filePath || '').replace(/\\/g, '/');
    const matches = candidates
        .filter(candidate => normalized === candidate || normalized.startsWith(`${candidate}/`))
        .sort((a, b) => b.length - a.length);
    return matches[0] || null;
}
