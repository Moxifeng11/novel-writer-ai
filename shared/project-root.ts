/**
 * project-root.ts — 项目根路径定位（shared 能力）
 *
 * 原实现位于 domains/kernel/project-locator.ts：项目根路径归一化与模式库推断
 * 是纯路径计算，shared（mode-content / pre-research）也需要使用；放在 shared
 * 层消除「shared→domains」的逆向分层依赖（审计 P1-7）。
 *
 * domains/kernel/project-locator.ts 保留同名 re-export 以兼容既有 import 站点；
 * 模式库根目录的唯一来源仍是 shared/creation-mode 的 MODE_LIBRARY_ROOTS。
 */
import { MODE_LIBRARY_ROOTS, type CreationMode } from './creation-mode';

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
