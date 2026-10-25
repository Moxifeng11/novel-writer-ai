/**
 * shared/fanfic-binding.ts — 「绑定已有同人设定文件」的候选筛选（纯函数）
 *
 * 同人设定此前只能在向导里逐字段填写，或由 AI 生成；用户已有现成设定文件
 * （从别处拷入、手写、旧项目遗留）时没有入口，只能手改 `.project` 的路径。
 * 这里只负责从 vault 的 Markdown 路径里挑出「本项目同人设定库 / 全局同人设定库」
 * 下的候选，排序与展示名由视图使用。
 */

export interface FanficSettingCandidate {
    /** vault 相对路径（已统一为正斜杠） */
    path: string;
    /** 去掉目录与 `.md` 的展示名 */
    name: string;
}

function normalizePath(value: string): string {
    return (value || '').replace(/\\/g, '/').replace(/\/{2,}/g, '/').trim();
}

function normalizeDir(value: string): string {
    return normalizePath(value).replace(/\/+$/, '');
}

function basenameWithoutExt(path: string): string {
    const base = path.slice(path.lastIndexOf('/') + 1);
    return base.replace(/\.md$/i, '');
}

/**
 * 筛选可绑定的同人设定文件。
 * - 只保留 `dirs` 下的 `.md`（含子目录）；
 * - 排除当前已绑定的文件（避免「绑定到自己」）；
 * - 去重后按文件名排序。
 */
export function listFanficSettingCandidates(
    mdPaths: string[],
    dirs: string[],
    currentPath = '',
): FanficSettingCandidate[] {
    const prefixes = dirs.map(normalizeDir).filter(Boolean).map(dir => `${dir}/`);
    if (prefixes.length === 0) return [];
    const current = normalizePath(currentPath);
    const seen = new Set<string>();
    const candidates: FanficSettingCandidate[] = [];
    for (const raw of mdPaths) {
        const path = normalizePath(raw);
        if (!path || !path.toLowerCase().endsWith('.md') || path === current) continue;
        if (!prefixes.some(prefix => path.startsWith(prefix))) continue;
        if (seen.has(path)) continue;
        seen.add(path);
        candidates.push({ path, name: basenameWithoutExt(path) });
    }
    return candidates.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
}
