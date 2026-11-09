/**
 * entity-index.ts — 项目实体索引（名称/别名 → 实体 ID）
 *
 * 故事台账、人物一致性、关联查询、图谱校验都需要「按名字找实体」，
 * 但历史上各处直接扫目录、按名称子串匹配：同名角色会串、改名后断链、
 * 简写/别称无法识别。本模块只读 `metadataCache`，构建一次、多处复用。
 *
 * 约定：
 *  - 实体 ID 由「类型 + 规范名」派生，稳定且可跨表引用；
 *  - 一名多实体时返回全部候选并标记 ambiguous，调用方不得静默取第一个；
 *  - 只读，不写 vault。
 */
import type { App, TFile } from 'obsidian';
import { listEntityFiles, type EntityKind as EntityDirKind } from './entity-reader';
import { readTagList } from './frontmatter-schema';

/** 索引里的实体类型（单数，与 UI/结算口径一致） */
export type IndexedEntityKind = 'character' | 'location' | 'faction' | 'item';

/** 目录类型 → 索引类型 */
const DIR_TO_KIND: Record<EntityDirKind, IndexedEntityKind> = {
    characters: 'character',
    factions: 'faction',
    locations: 'location',
    items: 'item',
};

/** 索引类型中文名（报告/日志共用） */
export const INDEXED_ENTITY_LABEL: Record<IndexedEntityKind, string> = {
    character: '人物',
    faction: '势力',
    location: '地点',
    item: '物品功法',
};

/**
 * EntityRecord 接口定义。
 */
export interface EntityRecord {
    /** ENT-xxxxxxxx */
    id: string;
    kind: IndexedEntityKind;
    /** 规范名（优先 姓名/名称，其次文件名） */
    name: string;
    /** 全部可用于匹配的名称（规范名 + 别称 + 文件名） */
    aliases: string[];
    path: string;
    tags: string[];
    /** frontmatter 原样快照（只读） */
    properties: Record<string, unknown>;
    mtime: number;
}

/**
 * EntityResolution 接口定义。
 */
export interface EntityResolution {
    /** 命中的实体（按 id 去重） */
    matches: EntityRecord[];
    /** 同名多实体：调用方必须让用户/上层消歧 */
    ambiguous: boolean;
    /** 完全未命中 */
    unresolved: boolean;
}

/**
 * EntityIndexIssue 接口定义。
 */
export interface EntityIndexIssue {
    type: 'duplicate-name' | 'missing-name';
    message: string;
    path?: string;
}

/**
 * 规范化实体名：去空白/标点/书名号/双链括号，英文转小写。
 * 仅用于匹配，不用于写回。
 *
 * @param name - 原始名称
 * @returns 规范化名称
 */
export function normalizeEntityName(name: unknown): string {
    return String(name ?? '')
        .replace(/\[\[|\]\]/g, '')
        .replace(/[《》〈〉「」『』【】（）()\s·・,，。.:：;；、"'“”‘’!！?？]/g, '')
        .toLowerCase()
        .trim();
}

/**
 * FNV-1a 32 位哈希（稳定、无依赖；不用于安全场景）
 *
 * @param text - 输入
 * @returns 8 位十六进制
 */
function fnv1a(text: string): string {
    let hash = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
}

/**
 * 实体稳定 ID：类型 + 规范名
 *
 * @param kind - 实体类型
 * @param name - 名称
 * @returns `ENT-xxxxxxxx`
 */
export function entityIdOf(kind: IndexedEntityKind, name: unknown): string {
    return `ENT-${fnv1a(`${kind}|${normalizeEntityName(name)}`)}`;
}

/**
 * 从 frontmatter 收集别名（别称可能是数组或逗号串）
 *
 * @param properties - frontmatter
 * @param fileName - 文件 basename
 * @returns 去重后的名称列表
 */
function collectNames(properties: Record<string, unknown>, fileName: string): string[] {
    const names: string[] = [];
    const push = (value: unknown): void => {
        if (Array.isArray(value)) {
            for (const item of value) push(item);
            return;
        }
        if (typeof value === 'string' || typeof value === 'number') {
            const text = String(value).trim();
            if (text) names.push(text);
        }
    };
    push(properties['姓名']);
    push(properties['名称']);
    push(properties['name']);
    push(properties['别称']);
    push(properties['别名']);
    names.push(fileName);
    const unique: string[] = [];
    const seen = new Set<string>();
    for (const name of names) {
        const key = normalizeEntityName(name);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        unique.push(name);
    }
    return unique;
}

/**
 * EntityIndex 类。
 */
export class EntityIndex {
    private readonly byId = new Map<string, EntityRecord>();
    private readonly byName = new Map<string, EntityRecord[]>();
    private readonly records: EntityRecord[] = [];
    private readonly issues: EntityIndexIssue[] = [];

    private constructor(records: EntityRecord[]) {
        for (const record of records) {
            this.records.push(record);
            this.byId.set(record.id, record);
            for (const alias of record.aliases) {
                const key = normalizeEntityName(alias);
                if (!key) continue;
                const list = this.byName.get(key) ?? [];
                if (!list.some((item) => item.id === record.id)) list.push(record);
                this.byName.set(key, list);
            }
        }
        for (const [key, list] of this.byName) {
            const ids = [...new Set(list.map((item) => item.id))];
            if (ids.length > 1) {
                this.issues.push({
                    type: 'duplicate-name',
                    message: `名称「${key}」对应 ${ids.length} 个实体：${list.map((item) => item.path).join('、')}`,
                });
            }
        }
    }

    /**
     * 扫描项目四类实体目录，构建索引。
     *
     * @param app - Obsidian 应用
     * @param project - 项目路径
     * @returns EntityIndex
     */
    static build(app: App, project: string): EntityIndex {
        const records: EntityRecord[] = [];
        for (const dirKind of Object.keys(DIR_TO_KIND) as EntityDirKind[]) {
            const kind = DIR_TO_KIND[dirKind];
            let files: TFile[] = [];
            try {
                files = listEntityFiles(app, project, dirKind);
            } catch {
                files = [];
            }
            for (const file of files) {
                const properties = (app.metadataCache.getFileCache(file)?.frontmatter ?? {}) as Record<string, unknown>;
                const baseName = file.basename || file.name.replace(/\.md$/i, '');
                const name = String(properties['姓名'] ?? properties['名称'] ?? properties['name'] ?? baseName).trim() || baseName;
                const aliases = collectNames(properties, baseName);
                records.push({
                    id: entityIdOf(kind, name),
                    kind,
                    name,
                    aliases,
                    path: file.path,
                    tags: readTagList(properties['tags']),
                    properties,
                    mtime: file.stat?.mtime ?? 0,
                });
            }
        }
        const index = new EntityIndex(records);
        for (const record of records) {
            if (!record.name || record.name === record.path) {
                index.issues.push({ type: 'missing-name', message: `实体缺少名称：${record.path}`, path: record.path });
            }
        }
        return index;
    }

    /** 记录总数 */
    get size(): number {
        return this.records.length;
    }

    /** 索引构建期发现的问题 */
    get problems(): readonly EntityIndexIssue[] {
        return this.issues;
    }

    /** 按 ID 取实体 */
    get(id: string): EntityRecord | undefined {
        return this.byId.get(id);
    }

    /** 全部实体（可按类型过滤） */
    list(kind?: IndexedEntityKind): EntityRecord[] {
        return kind ? this.records.filter((item) => item.kind === kind) : [...this.records];
    }

    /**
     * 按名称/别名解析实体；可按类型收窄。
     *
     * @param name - 名称/别名
     * @param kind - 可选类型
     * @returns EntityResolution
     */
    resolve(name: unknown, kind?: IndexedEntityKind): EntityResolution {
        const key = normalizeEntityName(name);
        if (!key) return { matches: [], ambiguous: false, unresolved: true };
        const candidates = (this.byName.get(key) ?? []).filter((item) => !kind || item.kind === kind);
        const unique = [...new Map(candidates.map((item) => [item.id, item])).values()];
        return {
            matches: unique,
            ambiguous: unique.length > 1,
            unresolved: unique.length === 0,
        };
    }
}
