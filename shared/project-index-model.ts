/**
 * project-index-model.ts — 项目索引模型（纯函数）
 *
 * 借鉴催更姬「索引与全文分离」：列目录/查候选时只读索引摘要，
 * 需要正文时再按路径单读，避免每次遍历 + 解析整棵项目目录。
 *
 * 纯函数：不碰 Obsidian API，方便单测。
 */

/** 索引条目类别 */
export type IndexKind =
    /** 正文 */
    | 'chapter'
    /** 分卷/分节大纲 */
    | 'outline'
    /** 人物 */
    | 'character'
    /** 地点 */
    | 'location'
    /** 势力/组织 */
    | 'faction'
    /** 物品 */
    | 'item'
    /** 世界观/设定库 */
    | 'setting'
    /** 时间线/伏笔 */
    | 'timeline'
    /** 事实库/一致性 */
    | 'fact'
    /** 步骤结果/中间产物 */
    | 'artifact'
    /** 其他 */
    | 'other';

/** 索引条目（只放摘要，不含正文） */
export interface ProjectIndexEntry {
    /** vault 相对路径 */
    path: string;
    /** 文件名（不含 .md） */
    name: string;
    /** 类别 */
    kind: IndexKind;
    /** 字节数（用于粗粒度变化判断，不读正文） */
    size: number;
    /** 最后修改时间（毫秒） */
    mtime: number;
}

/** 项目索引 */
export interface ProjectIndex {
    /** 索引格式版本（结构变化时递增） */
    version: 1;
    /** 项目路径 */
    project: string;
    /** 生成时间（毫秒） */
    updatedAt: number;
    /** 条目 */
    entries: ProjectIndexEntry[];
}

/** 索引格式版本 */
export const PROJECT_INDEX_VERSION = 1 as const;

/** 各类别中文名 */
export const INDEX_KIND_LABELS: Record<IndexKind, string> = {
    chapter: '正文',
    outline: '大纲',
    character: '人物',
    location: '地点',
    faction: '势力',
    item: '物品',
    setting: '设定',
    timeline: '时间线',
    fact: '事实库',
    artifact: '中间产物',
    other: '其他',
};

/**
 * 按路径推断条目类别（路径片段匹配，顺序即优先级）。
 *
 * @param path - vault 相对路径
 * @returns 类别
 */
export function inferIndexKind(path: string): IndexKind {
    const normalized = String(path || '').replace(/\\/g, '/');
    const segments = normalized.split('/');
    const file = segments[segments.length - 1] || '';
    const dirs = segments.slice(0, -1).join('/');

    if (dirs.includes('步骤结果')) return 'artifact';
    if (dirs.includes('正文')) return 'chapter';
    if (dirs.includes('大纲') || dirs.includes('分卷') || file.includes('大纲')) return 'outline';
    if (dirs.includes('人物') || dirs.includes('角色')) return 'character';
    if (dirs.includes('地点')) return 'location';
    if (dirs.includes('势力') || dirs.includes('组织')) return 'faction';
    if (dirs.includes('物品') || dirs.includes('道具')) return 'item';
    if (dirs.includes('时间线') || dirs.includes('伏笔')) return 'timeline';
    if (dirs.includes('一致性') || file.includes('事实库')) return 'fact';
    if (dirs.includes('设定') || dirs.includes('世界架构') || file.includes('世界观')) return 'setting';
    return 'other';
}

/**
 * 由文件清单构建索引（不读正文）。
 *
 * @param project - 项目路径
 * @param files - 文件摘要（path/name/size/mtime）
 * @param now - 生成时间
 * @returns 项目索引
 */
export function buildProjectIndex(
    project: string,
    files: ReadonlyArray<{ path: string; name: string; size: number; mtime: number }>,
    now: number = Date.now(),
): ProjectIndex {
    const entries: ProjectIndexEntry[] = files.map(file => ({
        path: file.path,
        name: file.name,
        kind: inferIndexKind(file.path),
        size: file.size,
        mtime: file.mtime,
    }));
    entries.sort((a, b) => a.path.localeCompare(b.path));
    return { version: PROJECT_INDEX_VERSION, project, updatedAt: now, entries };
}

/**
 * 统计各类别条目数。
 *
 * @param index - 项目索引
 * @returns 类别 → 数量
 */
export function indexCounts(index: ProjectIndex): Partial<Record<IndexKind, number>> {
    const counts: Partial<Record<IndexKind, number>> = {};
    for (const entry of index.entries) {
        counts[entry.kind] = (counts[entry.kind] ?? 0) + 1;
    }
    return counts;
}

/**
 * 按类别筛选条目。
 *
 * @param index - 项目索引
 * @param kind - 类别
 * @returns 条目
 */
export function entriesOfKind(index: ProjectIndex, kind: IndexKind): ProjectIndexEntry[] {
    return index.entries.filter(entry => entry.kind === kind);
}

/**
 * 按关键字匹配条目（名称/路径子串，忽略大小写）。
 *
 * @param index - 项目索引
 * @param query - 关键字
 * @param limit - 最多返回条数（默认 20）
 * @returns 匹配条目
 */
export function matchIndexEntries(index: ProjectIndex, query: string, limit = 20): ProjectIndexEntry[] {
    const needle = String(query || '').trim().toLowerCase();
    const source = needle.length === 0 ? index.entries : index.entries.filter(entry =>
        entry.name.toLowerCase().includes(needle) || entry.path.toLowerCase().includes(needle));
    return source.slice(0, Math.max(1, limit));
}

/**
 * 判断索引是否过期：文件数量或最新 mtime 与索引记录不一致。
 *
 * 只依赖索引自身 + 当前文件摘要，不需要重新读正文。
 *
 * @param index - 现有索引
 * @param files - 当前文件摘要
 * @returns 过期返回 true
 */
export function isIndexStale(
    index: ProjectIndex,
    files: ReadonlyArray<{ path: string; size: number; mtime: number }>,
): boolean {
    if (index.version !== PROJECT_INDEX_VERSION) return true;
    if (index.entries.length !== files.length) return true;
    const byPath = new Map(index.entries.map(entry => [entry.path, entry]));
    for (const file of files) {
        const entry = byPath.get(file.path);
        if (!entry) return true;
        if (entry.mtime !== file.mtime || entry.size !== file.size) return true;
    }
    return false;
}
