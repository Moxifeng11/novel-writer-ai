/**
 * project-index-model.ts — 项目索引模型（纯函数）
 *
 * 借鉴催更姬「索引与全文分离」：列目录/查候选时只读索引摘要，
 * 需要正文时再按路径单读，避免每次遍历 + 解析整棵项目目录。
 *
 * v2（M1）：索引开始携带 frontmatter 派生字段（id/type/tags/aliases/summary/status），
 * 并提供**精准查询**与**名称→ID 解析**（禁止模糊自动解析，防上下文过度注入）。
 *
 * 纯函数：不碰 Obsidian API，方便单测。
 */

/** 索引条目类别（路径推断） */
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

/** 派生视图文件名（由插件生成，不作为要素条目） */
const DERIVED_VIEW_NAMES = ['时间线看板', '伏笔库', '承诺账本', '叙事总览', '信息债看板', '关系状态', '角色弧线', '世界观总览', '设定库'];

/** 要素类型（来自 frontmatter.type，缺失时由路径推断） */
export type EntityType =
    | 'character'
    | 'location'
    | 'faction'
    | 'item'
    | 'worldview'
    | 'setting'
    | 'timeline'
    | 'foreshadow'
    | 'relation'
    | 'chapter'
    | 'outline'
    | 'other';

/** 索引条目（只放摘要，不含正文） */
export interface ProjectIndexEntry {
    /** vault 相对路径 */
    path: string;
    /** 文件名（不含 .md） */
    name: string;
    /** 类别（路径推断，兼容旧逻辑） */
    kind: IndexKind;
    /** 要素类型（frontmatter.type 优先，否则由路径推断） */
    type?: EntityType;
    /** 稳定唯一 ID（如 CHR-0001；旧项目可能没有） */
    id?: string;
    /** 标签（frontmatter.tags + 内联标签） */
    tags?: string[];
    /** 别名（frontmatter.aliases ?? 别称/别名/曾用名） */
    aliases?: string[];
    /** 摘要（frontmatter.简介 ?? 首段） */
    summary?: string;
    /** 状态（frontmatter.status / entity_status / 当前状态） */
    status?: string;
    /** 故事时间（frontmatter.时间 / storyTime / 首次出场） */
    storyTime?: string;
    /** 正文双链目标（metadataCache.resolvedLinks 键） */
    links?: string[];
    /** 字节数（用于粗粒度变化判断，不读正文） */
    size: number;
    /** 最后修改时间（毫秒） */
    mtime: number;
}

/** 项目索引 */
export interface ProjectIndex {
    /** 索引格式版本（结构变化时递增） */
    version: 2;
    /** 项目路径 */
    project: string;
    /** 生成时间（毫秒） */
    updatedAt: number;
    /** 条目 */
    entries: ProjectIndexEntry[];
}

/** 索引格式版本 */
export const PROJECT_INDEX_VERSION = 2 as const;

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

/** 要素类型中文名 */
export const ENTITY_TYPE_LABELS: Record<EntityType, string> = {
    character: '人物',
    location: '地点',
    faction: '势力',
    item: '物品',
    worldview: '世界观',
    setting: '设定',
    timeline: '时间线事件',
    foreshadow: '伏笔',
    relation: '关系',
    chapter: '章节',
    outline: '大纲',
    other: '其他',
};

/** frontmatter 中表示别名的键（按优先级） */
const ALIAS_KEYS = ['aliases', 'alias', '别称', '别名', '曾用名'];
/** frontmatter 中表示摘要的键 */
const SUMMARY_KEYS = ['简介', 'summary', '一句话', '一句话简介'];
/** frontmatter 中表示状态的键 */
const STATUS_KEYS = ['status', 'entity_status', '当前状态'];
/** frontmatter 中表示故事时间的键 */
const STORY_TIME_KEYS = ['storyTime', '时间', '首次出场', 'story_time'];

/**
 * 从 frontmatter 中提取索引字段（纯函数，容忍各种写法）。
 *
 * @param frontmatter - metadataCache 的 frontmatter 对象（可能为空）
 * @param path - 文件路径（用于 type 兜底）
 * @returns 索引字段
 */
export function extractIndexFields(
    frontmatter: Record<string, unknown> | undefined,
    path: string,
): Pick<ProjectIndexEntry, 'type' | 'id' | 'tags' | 'aliases' | 'summary' | 'status' | 'storyTime'> {
    const fm = frontmatter ?? {};
    const pick = (keys: string[]): string => {
        for (const key of keys) {
            const value = fm[key];
            if (typeof value === 'string' && value.trim()) return value.trim();
            if (Array.isArray(value) && value.length > 0) return String(value[0]).trim();
        }
        return '';
    };
    const toArray = (value: unknown): string[] => {
        if (Array.isArray(value)) return value.map(item => String(item).trim()).filter(Boolean);
        if (typeof value === 'string') return value.split(/[,，;；\s]+/).map(item => item.trim()).filter(Boolean);
        return [];
    };
    const tags = new Set<string>();
    for (const tag of toArray(fm.tags)) tags.add(tag.startsWith('#') ? tag.slice(1) : tag);
    for (const tag of toArray(fm.tag)) tags.add(tag.startsWith('#') ? tag.slice(1) : tag);

    const declaredType = typeof fm.type === 'string' ? fm.type.trim() : '';
    const aliases: string[] = [];
    for (const key of ALIAS_KEYS) {
        for (const alias of toArray(fm[key])) if (!aliases.includes(alias)) aliases.push(alias);
    }

    return {
        type: typeFromDeclared(declaredType) ?? typeFromPath(path, [...tags]),
        id: typeof fm.id === 'string' && fm.id.trim() ? fm.id.trim() : undefined,
        tags: [...tags],
        aliases,
        summary: pick(SUMMARY_KEYS) || undefined,
        status: pick(STATUS_KEYS) || undefined,
        storyTime: pick(STORY_TIME_KEYS) || undefined,
    };
}

/**
 * 把 frontmatter.type 映射到 EntityType。
 *
 * @param declared - 声明的类型字符串
 * @returns 类型或 null（未识别）
 */
export function typeFromDeclared(declared: string): EntityType | null {
    const value = String(declared || '').trim().toLowerCase();
    if (!value) return null;
    const aliases: Record<string, EntityType> = {
        character: 'character', 人物: 'character', role: 'character',
        location: 'location', 地点: 'location', place: 'location',
        faction: 'faction', 势力: 'faction', 组织: 'faction', organization: 'faction',
        item: 'item', 物品: 'item', 道具: 'item', artifact: 'item',
        worldview: 'worldview', 世界观: 'worldview',
        setting: 'setting', 设定: 'setting',
        timeline: 'timeline', 时间线: 'timeline', event: 'timeline',
        foreshadow: 'foreshadow', 伏笔: 'foreshadow',
        relation: 'relation', 关系: 'relation',
        chapter: 'chapter', 正文: 'chapter',
        outline: 'outline', 大纲: 'outline',
    };
    return aliases[value] ?? null;
}

/**
 * 按路径 + 标签推断要素类型（frontmatter.type 缺失时兜底）。
 *
 * @param path - vault 相对路径
 * @param tags - 标签
 * @returns 类型
 */
export function typeFromPath(path: string, tags: readonly string[] = []): EntityType {
    const basename = String(path || '').replace(/\\/g, '/').split('/').pop()?.replace(/\.md$/, '') ?? '';
    if (DERIVED_VIEW_NAMES.includes(basename)) return 'other';
    for (const tag of tags) {
        if (tag.startsWith('nw/实体/人物')) return 'character';
        if (tag.startsWith('nw/实体/地点')) return 'location';
        if (tag.startsWith('nw/实体/势力')) return 'faction';
        if (tag.startsWith('nw/实体/物品')) return 'item';
        if (tag.startsWith('nw/实体/事件')) return 'timeline';
        if (tag.startsWith('nw/实体/伏笔')) return 'foreshadow';
        if (tag.startsWith('nw/实体/关系')) return 'relation';
        if (tag.startsWith('nw/设定/世界观')) return 'worldview';
        if (tag.startsWith('nw/设定/设定库')) return 'setting';
        if (tag.startsWith('nw/设定/时间线')) return 'timeline';
        if (tag.startsWith('nw/设定/伏笔')) return 'foreshadow';
        if (tag.startsWith('nw/正文')) return 'chapter';
        if (tag.startsWith('nw/大纲')) return 'outline';
    }
    const kind = inferIndexKind(path);
    if (kind === 'character' || kind === 'location' || kind === 'faction' || kind === 'item') return kind;
    if (kind === 'timeline') return 'timeline';
    if (kind === 'chapter') return 'chapter';
    if (kind === 'outline') return 'outline';
    if (kind === 'setting') return 'setting';
    return 'other';
}

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
    if (dirs.includes('正文') || (dirs.includes('剧本') && !dirs.includes('大纲'))) return 'chapter';
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
 * 由文件清单构建索引（v2：可带 frontmatter 派生字段）。
 *
 * @param project - 项目路径
 * @param files - 文件摘要（path/name/size/mtime + 可选 frontmatter 字段）
 * @param now - 生成时间
 * @returns 项目索引
 */
export function buildProjectIndex(
    project: string,
    files: ReadonlyArray<{
        path: string;
        name: string;
        size: number;
        mtime: number;
        fields?: Pick<ProjectIndexEntry, 'type' | 'id' | 'tags' | 'aliases' | 'summary' | 'status' | 'storyTime' | 'links'>;
    }>,
    now: number = Date.now(),
): ProjectIndex {
    const entries: ProjectIndexEntry[] = files.map(file => {
        const kind = inferIndexKind(file.path);
        const fields = file.fields ?? {};
        return {
            path: file.path,
            name: file.name,
            kind,
            type: fields.type ?? typeFromPath(file.path, fields.tags ?? []),
            ...(fields.id ? { id: fields.id } : {}),
            tags: fields.tags ?? [],
            aliases: fields.aliases ?? [],
            ...(fields.summary ? { summary: fields.summary } : {}),
            ...(fields.status ? { status: fields.status } : {}),
            ...(fields.storyTime ? { storyTime: fields.storyTime } : {}),
            ...(fields.links && fields.links.length > 0 ? { links: fields.links } : {}),
            size: file.size,
            mtime: file.mtime,
        };
    });
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

/** 精准查询条件 */
export interface IndexQuery {
    /** 精确 ID */
    id?: string;
    /** 批量精确 ID */
    ids?: string[];
    /** 精确要素类型 */
    type?: EntityType;
    /** 精确标签 */
    tag?: string;
    /** 精确别名（去空白后全等，忽略大小写） */
    alias?: string;
    /** 精确标题（文件名，忽略大小写） */
    title?: string;
    /** 路径前缀 */
    folder?: string;
    /** 精确类别（路径推断） */
    kind?: IndexKind;
    /** 全文片段（仅 UI 搜索用，禁止用于上下文注入） */
    text?: string;
    /** 最多返回条数（默认 50） */
    limit?: number;
}

/**
 * 精准查询：只做**精确匹配**（ID/别名/标题/标签/类型/前缀）。
 *
 * `text` 为模糊匹配，仅用于 UI 搜索，调用方禁止用于上下文注入。
 *
 * @param index - 项目索引
 * @param query - 查询条件
 * @returns 匹配条目
 */
export function queryEntries(index: ProjectIndex, query: IndexQuery): ProjectIndexEntry[] {
    const limit = Math.max(1, Math.floor(query.limit ?? 50));
    const ids = query.ids && query.ids.length > 0 ? new Set(query.ids) : null;
    const aliasNeedle = normalizeLookup(query.alias);
    const titleNeedle = normalizeLookup(query.title);
    const textNeedle = String(query.text ?? '').trim().toLowerCase();
    const folder = String(query.folder ?? '').replace(/\\/g, '/').trim();

    return index.entries.filter(entry => {
        if (query.id && entry.id !== query.id) return false;
        if (ids && (!entry.id || !ids.has(entry.id))) return false;
        if (query.type && entry.type !== query.type) return false;
        if (query.kind && entry.kind !== query.kind) return false;
        if (query.tag && !(entry.tags ?? []).includes(query.tag)) return false;
        if (aliasNeedle && !(entry.aliases ?? []).some(alias => normalizeLookup(alias) === aliasNeedle)) return false;
        if (titleNeedle && normalizeLookup(entry.name) !== titleNeedle) return false;
        if (folder && !entry.path.startsWith(folder.endsWith('/') ? folder : `${folder}/`)) return false;
        if (textNeedle) {
            const haystack = `${entry.name}\n${entry.path}\n${entry.summary ?? ''}\n${(entry.aliases ?? []).join(' ')}`;
            if (!haystack.toLowerCase().includes(textNeedle)) return false;
        }
        return true;
    }).slice(0, limit);
}

/** 名称解析结果 */
export interface ResolveEntityResult {
    /** 唯一命中 */
    match?: ProjectIndexEntry;
    /** 多义候选（需用户/模型选择，不自动选） */
    candidates?: ProjectIndexEntry[];
    /** 未命中 */
    found: boolean;
}

/**
 * 名称 → 实体解析（精确，不猜）。
 *
 * 顺序：精确 ID → 精确标题 → 精确别名；命中多个返回候选。
 *
 * @param index - 项目索引
 * @param name - 用户/大纲中的名称
 * @returns 解析结果
 */
export function resolveEntity(index: ProjectIndex, name: string): ResolveEntityResult {
    const needle = normalizeLookup(name);
    if (!needle) return { found: false };
    const byId = index.entries.filter(entry => normalizeLookup(entry.id) === needle);
    if (byId.length === 1) return { match: byId[0], found: true };
    if (byId.length > 1) return { candidates: byId, found: true };
    const byTitle = index.entries.filter(entry => normalizeLookup(entry.name) === needle);
    if (byTitle.length === 1) return { match: byTitle[0], found: true };
    if (byTitle.length > 1) return { candidates: byTitle, found: true };
    const byAlias = index.entries.filter(entry => (entry.aliases ?? []).some(alias => normalizeLookup(alias) === needle));
    if (byAlias.length === 1) return { match: byAlias[0], found: true };
    if (byAlias.length > 1) return { candidates: byAlias, found: true };
    return { found: false };
}

/**
 * 名称归一化（去空白、全角转半角、去双链括号、小写）。
 *
 * @param value - 原始名称
 * @returns 归一化结果
 */
export function normalizeLookup(value: unknown): string {
    if (typeof value !== 'string') return '';
    return value
        .replace(/\[\[(.+?)\]\]/g, '$1')
        .replace(/[［【[](.+?)[］】\]]/g, '$1')
        .replace(/[|｜].*$/, '')
        .replace(/[\s\u3000]+/g, '')
        .replace(/[！-～]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
        .trim()
        .toLowerCase();
}

/**
 * 按关键字匹配条目（名称/路径子串，忽略大小写）。
 *
 * 仅用于 UI 搜索；上下文注入请用 `queryEntries` 的精确条件。
 *
 * @param index - 项目索引
 * @param query - 关键字
 * @param limit - 最多返回条数（默认 20）
 * @returns 匹配条目
 */
export function matchIndexEntries(index: ProjectIndex, query: string, limit = 20): ProjectIndexEntry[] {
    const needle = String(query || '').trim().toLowerCase();
    const source = needle.length === 0 ? index.entries : index.entries.filter(entry =>
        entry.name.toLowerCase().includes(needle)
        || entry.path.toLowerCase().includes(needle)
        || (entry.aliases ?? []).some(alias => alias.toLowerCase().includes(needle)));
    return source.slice(0, Math.max(1, limit));
}

/**
 * 判断索引是否过期：版本、文件数量或最新 mtime 与索引记录不一致。
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
