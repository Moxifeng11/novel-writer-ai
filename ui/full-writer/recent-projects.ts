/**
 * recent-projects.ts — 「最近使用」项目排序（2026-11-16，B1）
 *
 * 背景（H-01）：工作台首页的项目网格与创作主页的「最近项目」此前按
 * 「activeProject 优先 + 显示名 localeCompare」排序，没有任何使用时间记录，
 * 用户每次都要在列表里找刚写过的那本。
 *
 * 这里把「记录打开时间」和「排序」收成一处：
 * - 写入：recordProjectOpened()，打开项目/章节/协同/流程时调用；
 * - 读取：sortProjectsByRecent()，纯函数，便于单测。
 *
 * 存储字段是 settings.projectLastOpened，写盘由调用方 saveSettings()。
 */

/** 最多保留的最近项目条数（防止设置无限膨胀） */
export const MAX_RECENT_PROJECTS = 30;

/** 最近打开的映射：项目 id → 毫秒时间戳 */
export type ProjectLastOpenedMap = Record<string, number>;

/**
 * 记录项目被打开（就地修改传入的映射）。
 *
 * 超出 MAX_RECENT_PROJECTS 时丢弃最旧的项；同一项目重复打开只更新时间。
 *
 * @param map - 现有映射（会被就地修改）
 * @param project - 项目 id
 * @param now - 当前时间戳（默认 Date.now；测试可注入）
 * @returns 新的映射（与入参同一引用，便于直接赋回 settings）
 * @example
 * const map = {};
 * recordProjectOpened(map, '长篇小说/斗破');
 * // map['长篇小说/斗破'] 是时间戳
 */
export function recordProjectOpened(
    map: ProjectLastOpenedMap,
    project: string,
    now: number = Date.now(),
): ProjectLastOpenedMap {
    const id = String(project || '').trim();
    if (!id) return map;
    map[id] = now;
    const entries = Object.entries(map);
    if (entries.length > MAX_RECENT_PROJECTS) {
        // 只保留最新的 MAX_RECENT_PROJECTS 项
        const kept = entries
            .sort((a, b) => b[1] - a[1])
            .slice(0, MAX_RECENT_PROJECTS);
        for (const key of Object.keys(map)) delete map[key];
        for (const [key, value] of kept) map[key] = value;
    }
    return map;
}

/**
 * 按「最近打开」排序项目列表。
 *
 * 没记录过时间的项目排在有记录之后，两者内部都保持传入顺序稳定
 * （不按名字重排，避免用户认知里的顺序被打乱）。
 *
 * @param projects - 项目 id 列表
 * @param lastOpened - 最近打开映射
 * @returns 新数组（不修改入参）
 * @example
 * sortProjectsByRecent(['a', 'b'], { b: 2, a: 1 }); // ['b', 'a']
 */
export function sortProjectsByRecent(
    projects: readonly string[],
    lastOpened: ProjectLastOpenedMap | undefined,
): string[] {
    const map = lastOpened ?? {};
    const indexed = projects.map((project, index) => ({
        project,
        index,
        at: typeof map[project] === 'number' ? map[project] : 0,
    }));
    indexed.sort((a, b) => {
        if (a.at !== b.at) return b.at - a.at;
        return a.index - b.index;
    });
    return indexed.map(item => item.project);
}

/**
 * 把时间戳格式化为「刚刚 / N 分钟前 / N 小时前 / N 天前 / 日期」。
 *
 * @param at - 时间戳（毫秒）
 * @param now - 参照时间（默认 Date.now）
 * @returns 人类可读的短文案；无有效时间戳返回空串
 * @example
 * formatRecentLabel(Date.now() - 3 * 60_000); // '3 分钟前'
 */
export function formatRecentLabel(at: number | undefined, now: number = Date.now()): string {
    if (typeof at !== 'number' || !Number.isFinite(at) || at <= 0) return '';
    const diff = Math.max(0, now - at);
    const minute = 60_000;
    if (diff < minute) return '刚刚';
    if (diff < 60 * minute) return `${Math.floor(diff / minute)} 分钟前`;
    if (diff < 24 * 60 * minute) return `${Math.floor(diff / (60 * minute))} 小时前`;
    if (diff < 7 * 24 * 60 * minute) return `${Math.floor(diff / (24 * 60 * minute))} 天前`;
    const date = new Date(at);
    return `${date.getMonth() + 1}月${date.getDate()}日`;
}

/**
 * 清理「已不存在的项目」记录。
 *
 * 项目被删除/改名后，projectLastOpened 里会留下幽灵键：
 * 虽然排序时会被忽略，但会占用 MAX_RECENT_PROJECTS 名额并把有效记录挤出去。
 *
 * @param map - 现有映射
 * @param existingProjects - 当前真实存在的项目 id
 * @returns 是否变化 + 清理后的映射（无变化时返回原引用）
 * @example
 * pruneMissingProjects({ gone: 1, kept: 2 }, ['kept']);
 * // { changed: true, map: { kept: 2 } }
 */
export function pruneMissingProjects(
    map: ProjectLastOpenedMap | undefined,
    existingProjects: readonly string[],
): { changed: boolean; map: ProjectLastOpenedMap } {
    const source = map ?? {};
    const allowed = new Set(existingProjects);
    const keys = Object.keys(source);
    const missing = keys.filter(key => !allowed.has(key));
    if (missing.length === 0) return { changed: false, map: source };
    const next: ProjectLastOpenedMap = {};
    for (const key of keys) {
        if (allowed.has(key)) next[key] = source[key];
    }
    return { changed: true, map: next };
}
