/**
 * id-registry-model.ts — 唯一 ID 登记表模型（纯函数）
 *
 * 数据库式唯一编码：`<类型前缀>-<4 位序号>`，项目内唯一、**永不复用**。
 * 登记表是 ID ↔ 路径 的单一真源，改名保 ID，删除标 retired。
 */

import type { EntityType } from './project-index-model';

/** 前缀 → 要素类型 */
export const ID_PREFIX_TO_TYPE: Record<string, EntityType> = {
    CHR: 'character',
    LOC: 'location',
    FAC: 'faction',
    ITM: 'item',
    WLD: 'worldview',
    SET: 'setting',
    EVT: 'timeline',
    FSH: 'foreshadow',
    REL: 'relation',
    CHP: 'chapter',
    PLN: 'other',
};

/** 要素类型 → 前缀 */
export const TYPE_TO_ID_PREFIX: Partial<Record<EntityType, string>> = {
    character: 'CHR',
    location: 'LOC',
    faction: 'FAC',
    item: 'ITM',
    worldview: 'WLD',
    setting: 'SET',
    timeline: 'EVT',
    foreshadow: 'FSH',
    relation: 'REL',
    chapter: 'CHP',
};

/** 登记表条目 */
export interface IdRegistryEntry {
    /** 唯一 ID，如 CHR-0001 */
    id: string;
    /** 要素类型 */
    type: EntityType;
    /** vault 相对路径（改名时更新） */
    path: string;
    /** 创建时间 */
    createdAt: number;
    /** 是否已退休（删除后保留，ID 不复用） */
    retired?: boolean;
}

/** ID 登记表 */
export interface IdRegistry {
    /** 格式版本 */
    version: 1;
    /** 各前缀已分配到的序号 */
    counters: Record<string, number>;
    /** 条目 */
    entries: IdRegistryEntry[];
}

/** 登记表格式版本 */
export const ID_REGISTRY_VERSION = 1 as const;

/** 序号位数 */
export const ID_PAD = 4;

/**
 * 生成 ID 字符串。
 *
 * @param prefix - 前缀
 * @param seq - 序号（1 起）
 * @returns ID
 */
export function formatId(prefix: string, seq: number): string {
    return `${String(prefix || '').toUpperCase()}-${String(Math.max(1, Math.floor(seq))).padStart(ID_PAD, '0')}`;
}

/**
 * 解析 ID。
 *
 * @param id - ID 字符串
 * @returns 前缀与序号；非法返回 null
 */
export function parseId(id: string): { prefix: string; seq: number } | null {
    const match = String(id || '').trim().match(/^([A-Z]{2,4})-(\d{1,6})$/);
    if (!match) return null;
    return { prefix: match[1], seq: Number(match[2]) };
}

/**
 * 新建空登记表。
 *
 * @returns 登记表
 */
export function emptyRegistry(): IdRegistry {
    return { version: ID_REGISTRY_VERSION, counters: {}, entries: [] };
}

/**
 * 分配下一个 ID（只增计数器，不复用已退休 ID）。
 *
 * @param registry - 登记表
 * @param type - 要素类型
 * @returns 新 ID
 */
export function nextId(registry: IdRegistry, type: EntityType): string {
    const prefix = TYPE_TO_ID_PREFIX[type] ?? 'PLN';
    const used = registry.counters[prefix] ?? 0;
    return formatId(prefix, used + 1);
}

/**
 * 登记一个新条目（分配 ID + 写入条目）。
 *
 * @param registry - 登记表
 * @param type - 要素类型
 * @param path - 文件路径
 * @param now - 时间戳
 * @returns 新登记表与新 ID
 */
export function allocate(
    registry: IdRegistry,
    type: EntityType,
    path: string,
    now: number = Date.now(),
): { registry: IdRegistry; id: string } {
    const id = nextId(registry, type);
    const parsed = parseId(id);
    const prefix = parsed?.prefix ?? 'PLN';
    return {
        id,
        registry: {
            ...registry,
            counters: { ...registry.counters, [prefix]: parsed?.seq ?? 1 },
            entries: [...registry.entries, { id, type, path, createdAt: now }],
        },
    };
}

/**
 * 按路径查 ID。
 *
 * @param registry - 登记表
 * @param path - 文件路径
 * @returns 条目或 null
 */
export function findByPath(registry: IdRegistry, path: string): IdRegistryEntry | null {
    return registry.entries.find(entry => entry.path === path && !entry.retired) ?? null;
}

/**
 * 按 ID 查条目。
 *
 * @param registry - 登记表
 * @param id - ID
 * @returns 条目或 null
 */
export function findById(registry: IdRegistry, id: string): IdRegistryEntry | null {
    return registry.entries.find(entry => entry.id === id) ?? null;
}

/**
 * 改名：更新路径，ID 不变。
 *
 * @param registry - 登记表
 * @param id - ID
 * @param nextPath - 新路径
 * @returns 新登记表
 */
export function rename(registry: IdRegistry, id: string, nextPath: string): IdRegistry {
    return {
        ...registry,
        entries: registry.entries.map(entry => (entry.id === id ? { ...entry, path: nextPath } : entry)),
    };
}

/**
 * 退休（删除文件后调用）：保留条目，ID 不复用。
 *
 * @param registry - 登记表
 * @param id - ID
 * @returns 新登记表
 */
export function retire(registry: IdRegistry, id: string): IdRegistry {
    return {
        ...registry,
        entries: registry.entries.map(entry => (entry.id === id ? { ...entry, retired: true } : entry)),
    };
}

/**
 * 校验登记表：ID 唯一、路径不重复、计数器不小于已分配序号。
 *
 * @param registry - 登记表
 * @returns 问题列表（空表示通过）
 */
export function validateRegistry(registry: IdRegistry): string[] {
    const problems: string[] = [];
    const ids = new Set<string>();
    const paths = new Set<string>();
    for (const entry of registry.entries) {
        if (!parseId(entry.id)) problems.push(`非法 ID：${entry.id}`);
        if (ids.has(entry.id)) problems.push(`ID 重复：${entry.id}`);
        ids.add(entry.id);
        if (!entry.retired) {
            if (paths.has(entry.path)) problems.push(`路径重复：${entry.path}`);
            paths.add(entry.path);
        }
        const parsed = parseId(entry.id);
        if (parsed) {
            const counter = registry.counters[parsed.prefix] ?? 0;
            if (counter < parsed.seq) problems.push(`计数器落后：${parsed.prefix}=${counter} < ${parsed.seq}`);
        }
    }
    return problems;
}

/**
 * 规范化登记表（容忍旧/损坏数据）。
 *
 * @param raw - 原始对象
 * @returns 登记表
 */
export function normalizeRegistry(raw: unknown): IdRegistry {
    if (!raw || typeof raw !== 'object') return emptyRegistry();
    const input = raw as Partial<IdRegistry>;
    const entries = Array.isArray(input.entries)
        ? input.entries
            .filter((entry): entry is IdRegistryEntry => Boolean(entry && typeof entry === 'object' && typeof entry.id === 'string'))
            .map(entry => ({
                id: entry.id,
                type: (entry.type ?? 'other'),
                path: String(entry.path ?? ''),
                createdAt: Number(entry.createdAt) || 0,
                ...(entry.retired ? { retired: true } : {}),
            }))
        : [];
    const counters: Record<string, number> = {};
    for (const entry of entries) {
        const parsed = parseId(entry.id);
        if (parsed) counters[parsed.prefix] = Math.max(counters[parsed.prefix] ?? 0, parsed.seq);
    }
    if (input.counters && typeof input.counters === 'object') {
        for (const [prefix, value] of Object.entries(input.counters)) {
            if (typeof value === 'number' && Number.isFinite(value)) {
                counters[prefix] = Math.max(counters[prefix] ?? 0, Math.floor(value));
            }
        }
    }
    return { version: ID_REGISTRY_VERSION, counters, entries };
}
