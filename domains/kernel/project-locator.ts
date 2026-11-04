/**
 * project-locator.ts — 三域模式库与项目路径定位
 *
 * 项目 ID 使用 vault 内相对目录路径：
 * - legacy：`项目名`
 * - 模式库：`长篇小说/项目名`、`短篇小说/项目名`、`剧本/项目名`
 *
 * 所有路径仍可直接 `${projectId}/...` 拼接；display 名称取最后一段。
 *
 * `resolveProjectRoot` / `modeFromLibraryPath` 已迁至 shared/project-root.ts
 * （纯路径计算属于 shared 能力，修除 shared→domains 逆向依赖），此处保留
 * re-export 兼容既有 import 站点。
 */
import {
    MODE_LIBRARY_ROOTS as CREATION_MODE_LIBRARY_ROOTS,
    MODE_LIBRARY_ROOT_LIST as CREATION_MODE_LIBRARY_ROOT_LIST,
    type CreationMode,
} from '@/shared/creation-mode';
import { modeFromLibraryPath } from '@/shared/project-root';

// 兼容 re-export：resolveProjectRoot / modeFromLibraryPath 的实现与唯一来源在 shared/project-root.ts
export { resolveProjectRoot, modeFromLibraryPath } from '@/shared/project-root';

/**
 * 各创作模式的项目库根路径（唯一来源：shared/creation-mode）。
 */
export const MODE_LIBRARY_ROOTS = CREATION_MODE_LIBRARY_ROOTS;

/**
 * 项目库根路径列表（用于遍历）。
 */
/**
 * 项目库根路径列表（遍历用）。
 */
export const MODE_LIBRARY_ROOT_LIST = CREATION_MODE_LIBRARY_ROOT_LIST;

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
