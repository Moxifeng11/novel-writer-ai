/**
 * project-mode.ts — 项目创作模式的统一解析入口
 *
 * 模式解析散落在多处时最容易出现「短篇项目里能执行长篇命令」的问题。
 * 这里提供两条路径：
 *   - resolveProjectMode：异步，路径前缀 → .project → 默认 long
 *   - getProjectModeSync：同步，只吃路径前缀与内存缓存，供命令面板 checkCallback 使用
 *
 * 读不到模式时一律按 long 处理：宁可多显示几个长篇命令，也不能把长篇功能误藏。
 * 放在 shared/ 是因为 core/command-registry 也要用，而 core 不允许 import ui/。
 */
import type { App } from 'obsidian';
import { parseCreationModeMeta, type CreationMode } from './creation-mode';
import { readProjectMeta } from './paths';

const MODE_CACHE = new Map<string, CreationMode>();

/** 项目路径前缀 → 模式；返回 null 表示前缀无法判断（老项目在根目录） */
export function modeFromPathPrefix(project: string): CreationMode | null {
    const prefix = String(project || '').split('/')[0];
    if (prefix === '短篇创作' || prefix === '短篇小说') return 'short';
    if (prefix === '剧本创作' || prefix === '剧本') return 'script';
    if (prefix === '长篇小说' || prefix === '长篇小说创作') return 'long';
    return null;
}

export function rememberProjectMode(project: string, mode: CreationMode): void {
    if (project) MODE_CACHE.set(project, mode);
}

export function forgetProjectMode(project: string): void {
    MODE_CACHE.delete(project);
}

/** 同步读取模式：缓存 → 路径前缀 → long。用于命令面板与同步守卫。 */
export function getProjectModeSync(project: string | null | undefined): CreationMode {
    if (!project) return 'long';
    return MODE_CACHE.get(project) ?? modeFromPathPrefix(project) ?? 'long';
}

/** 异步读取模式：缓存 → 路径前缀 → `.project` → long */
export async function resolveProjectMode(app: App, project: string): Promise<CreationMode> {
    if (!project) return 'long';
    const cached = MODE_CACHE.get(project);
    if (cached) return cached;

    const byPrefix = modeFromPathPrefix(project);
    if (byPrefix) {
        MODE_CACHE.set(project, byPrefix);
        return byPrefix;
    }

    try {
        const meta = parseCreationModeMeta((await readProjectMeta(app, project)) || '');
        MODE_CACHE.set(project, meta.mode);
        return meta.mode;
    } catch {
        return 'long';
    }
}
