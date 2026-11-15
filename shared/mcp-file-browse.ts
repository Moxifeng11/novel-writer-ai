/**
 * mcp-file-browse.ts — 本机目录读取（MCP 程序选择器用）
 *
 * 只在桌面端可用：动态 import `node:fs`，失败时返回结构化错误而不是抛错。
 * 纯逻辑（过滤/父目录/根目录候选）单独导出，便于单测覆盖。
 */

import { looksLikeMcpProgram } from './mcp-launch';

/** 目录项 */
export interface FsEntry {
    name: string;
    /** 绝对路径 */
    path: string;
    isDirectory: boolean;
    /** 字节数（目录为 0） */
    size: number;
}

/** 目录列举结果 */
export interface DirListing {
    ok: boolean;
    /** 实际读取的目录（规范化后） */
    path: string;
    entries: FsEntry[];
    /** 可快速跳转的根目录候选 */
    roots: string[];
    error?: string;
}

/** node:fs 的最小接口（避免把 Node 类型带进共享层） */
interface FsLike {
    readdirSync(dir: string, options: { withFileTypes: true }): Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>;
    statSync(path: string): { size: number };
    existsSync(path: string): boolean;
}

/**
 * 尝试加载 node:fs。
 *
 * @returns 模块或 null（移动端/受限环境）
 */
export async function loadNodeFs(): Promise<FsLike | null> {
    // 加载顺序很关键：
    // 1) 先 require —— CJS 产物里 await import('node:fs') 会保留成真正的动态 ESM 导入，
    //    Obsidian 渲染进程无法加载 node: 内建模块（实测浏览器里返回失败）；
    // 2) 再 await import —— vitest 等 ESM 环境没有 require，退回动态导入。
    try {
        const mod = require('node:fs') as FsLike;
        if (typeof (mod as unknown as { readdirSync?: unknown }).readdirSync === 'function') return mod;
    } catch { // silent-ok: ESM 环境（测试）没有 require，走下面的动态导入
    }
    try {
        const mod = await import('node:fs');
        const impl = mod as unknown as FsLike;
        return typeof (impl as unknown as { readdirSync?: unknown }).readdirSync === 'function' ? impl : null;
    } catch { // silent-ok: 移动端没有 node:fs，选择器改为手动输入路径
        return null;
    }
}

/**
 * 按扩展名过滤目录项（纯函数）。
 *
 * @param entries - 原始目录项
 * @param extensions - 允许的扩展名
 * @returns 目录在前、文件在后的有序列表
 * @example
 * ```ts
 * filterProgramEntries([
 *   { name: 'a.txt', path: '/x/a.txt', isDirectory: false, size: 10 },
 * ], ['.js']);
 * // []
 * ```
 */
export function filterProgramEntries(entries: readonly FsEntry[], extensions: readonly string[]): FsEntry[] {
    const allowed = extensions.map(ext => ext.toLowerCase());
    const dirs: FsEntry[] = [];
    const files: FsEntry[] = [];
    for (const entry of entries) {
        if (entry.isDirectory) {
            dirs.push(entry);
            continue;
        }
        const lower = entry.name.toLowerCase();
        if (allowed.some(ext => lower.endsWith(ext))) files.push(entry);
    }
    dirs.sort((a, b) => a.name.localeCompare(b.name, 'zh'));
    files.sort((a, b) => a.name.localeCompare(b.name, 'zh'));
    return [...dirs, ...files];
}

/**
 * 候选根目录（跨平台）。
 *
 * @param platform - 平台标识
 * @param exists - 存在性判断（测试可注入）
 * @param home - 用户主目录
 * @returns 根目录候选
 */
export function listRootCandidates(
    platform: string,
    exists: (path: string) => boolean,
    home: string,
): string[] {
    const roots: string[] = [];
    if (home) roots.push(home);
    if (platform === 'win32') {
        for (const drive of ['C', 'D', 'E', 'F', 'G']) {
            const root = `${drive}:/`;
            if (exists(root)) roots.push(root);
        }
    } else {
        for (const root of ['/', '/usr/local/bin', '/opt']) {
            if (exists(root)) roots.push(root);
        }
    }
    return roots;
}

/**
 * 读取目录内容（桌面端）。
 *
 * @param dirPath - 目录路径（可为空 → 用主目录）
 * @param extensions - 允许的扩展名
 * @returns 列举结果
 */
export async function pickDirectoryEntries(
    dirPath: string,
    extensions: readonly string[],
): Promise<DirListing> {
    const fs = await loadNodeFs();
    const home = typeof process !== 'undefined' ? (process.env.HOME || process.env.USERPROFILE || '') : '';
    const platform = typeof process !== 'undefined' ? process.platform : 'win32';
    const target = String(dirPath ?? '').trim() || home;
    if (!fs) {
        return { ok: false, path: target, entries: [], roots: [], error: '当前环境不支持浏览本机文件（请手动输入路径）' };
    }
    if (!target) {
        return { ok: false, path: '', entries: [], roots: [], error: '无法确定起始目录，请输入绝对路径' };
    }
    const roots = listRootCandidates(platform, p => fs.existsSync(p), home);
    try {
        const dirents = fs.readdirSync(target, { withFileTypes: true });
        const entries: FsEntry[] = [];
        for (const dirent of dirents) {
            if (dirent.name.startsWith('.')) continue;
            const full = `${target.replace(/\\/g, '/').replace(/\/+$/, '')}/${dirent.name}`;
            if (dirent.isDirectory()) {
                entries.push({ name: dirent.name, path: full, isDirectory: true, size: 0 });
                continue;
            }
            if (!dirent.isFile()) continue;
            let size = 0;
            try {
                size = Number(fs.statSync(full).size ?? 0);
            } catch { // silent-ok: 单文件 stat 失败不影响列举（体积仅用于展示）
                size = 0;
            }
            entries.push({ name: dirent.name, path: full, isDirectory: false, size });
        }
        return { ok: true, path: target, entries: filterProgramEntries(entries, extensions), roots };
    } catch (error) {
        return {
            ok: false,
            path: target,
            entries: [],
            roots,
            error: `无法读取目录：${error instanceof Error ? error.message : String(error)}`,
        };
    }
}

/**
 * 是否看起来像可接入的 MCP 程序（转调共享判定）。
 *
 * @param filePath - 路径
 * @returns 是否可接入
 */
export function isLikelyMcpProgramFile(filePath: string): boolean {
    return looksLikeMcpProgram(filePath);
}
