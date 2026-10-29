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

export function modeLibraryRoot(mode: CreationMode): string {
    return MODE_LIBRARY_ROOTS[mode];
}

export function modeFromLibraryPath(path: string): CreationMode | null {
    const normalized = String(path || '').replace(/\\/g, '/');
    for (const [mode, root] of Object.entries(MODE_LIBRARY_ROOTS) as Array<[CreationMode, string]>) {
        if (normalized === root) return null;
        if (normalized.startsWith(`${root}/`)) return mode;
    }
    return null;
}

/** 项目显示名：模式库项目取最后一段；legacy 项目取完整 ID */
export function projectDisplayName(projectId: string): string {
    const normalized = String(projectId || '').replace(/\\/g, '/');
    const mode = modeFromLibraryPath(normalized);
    return mode ? normalized.split('/').pop() || normalized : normalized;
}

/** 项目路径定位：模式项目必须在模式库中；legacy 项目允许根目录 */
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

/** 新建项目目标路径；同名冲突由调用方检查 */
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

export function projectDisplayNameComparator(a: string, b: string): number {
    return projectDisplayName(a).localeCompare(projectDisplayName(b), 'zh-Hans-CN');
}

/** 从任意项目内文件路径推断所属项目 ID（最长匹配模式库/根目录） */
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
