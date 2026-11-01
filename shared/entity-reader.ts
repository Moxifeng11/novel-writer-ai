/**
 * entity-reader.ts — 实体文件读取唯一入口（批次 1 / P0-3）
 *
 * 背景：实体目录扫描曾分散在四处（实体管理器、context-manager、entity-audit、
 * entity-stats），排除规则与统计口径各不相同——统计把 `*模板.md` 也算成实体，
 * 管理器却排除，导致同一项目在不同界面显示的数量不一致。
 *
 * 统一规则：目录前缀匹配 + 仅 `.md` + 排除名称含「模板」+ 路径升序。
 * 新增消费方一律调这里，不得再各自 `vault.getFiles().filter(...)`。
 */
import { App, TFile } from 'obsidian';
import { pjWorldview, pjCharsDir, pjFactionsDir, pjLocsDir, pjItemsDir } from './paths';
import { listFolderFiles } from './vault-tree';

/** 四类实体（与 shared/entity-persistence.ts 的 EntityKind 保持一致） */
export type EntityKind = 'characters' | 'factions' | 'locations' | 'items';

export const ENTITY_KINDS: readonly EntityKind[] = ['characters', 'factions', 'locations', 'items'];

/** 面向日志/提示的中文类别名（上下文注入与调试信息共用，避免各处自造字符串） */
export const ENTITY_KIND_LABEL: Record<EntityKind, string> = {
    characters: '人物',
    factions: '势力',
    locations: '地点',
    items: '物品功法',
};

const ENTITY_DIRS: Record<EntityKind, (project: string) => string> = {
    characters: pjCharsDir,
    factions: pjFactionsDir,
    locations: pjLocsDir,
    items: pjItemsDir,
};

/** 实体目录（供需要写入/展示目录的场景复用，避免再拼字符串） */
export function entityDir(project: string, kind: EntityKind): string {
    return ENTITY_DIRS[kind](project);
}

/** 模板文件不是实体：带「模板」字样的 .md 一律不参与列表/统计/上下文注入 */
export function isEntityTemplateFile(name: string): boolean {
    return name.includes('模板');
}

/**
 * 列出项目某类实体的 .md 文件（排除模板，按路径升序保证跨入口顺序一致）。
 * 注意：全库扫描，调用方在同一渲染周期内多次调用时应自行复用结果（见批次 2 增量索引）。
 */
export function listEntityFiles(app: App, project: string, kind: EntityKind): TFile[] {
    // 只遍历本项目实体目录（递归）：不再对整库 getFiles() 再过滤前缀
    return listFolderFiles<TFile>(app.vault, entityDir(project, kind), { recursive: true })
        .filter(f => !isEntityTemplateFile(f.name))
        .sort((a, b) => a.path.localeCompare(b.path));
}

export interface ProjectEntityStats {
    worldview: number;
    characters: number;
    factions: number;
    locations: number;
    items: number;
}

/** 统计项目实体数量：世界观文件存在 = 1；人物/势力/地点/物品 = listEntityFiles 数量 */
export function countProjectEntities(app: App, project: string): ProjectEntityStats {
    return {
        worldview: app.vault.getAbstractFileByPath(pjWorldview(project)) ? 1 : 0,
        characters: listEntityFiles(app, project, 'characters').length,
        factions: listEntityFiles(app, project, 'factions').length,
        locations: listEntityFiles(app, project, 'locations').length,
        items: listEntityFiles(app, project, 'items').length,
    };
}
