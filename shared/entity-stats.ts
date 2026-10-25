/**
 * entity-stats.ts — 项目实体统计单一事实源（Rev 192）
 *
 * 「设定与实体」模块内允许多个入口（AI 世界元素生成器、实体管理、
 * 向导完成页），此前各自用不同方式数文件，口径容易不一致。
 * 这里统一为「世界观文件存在 = 1；人物/势力/地点/物品 = 目录下 .md 数量」。
 */
import type { App, TAbstractFile, TFolder } from 'obsidian';
import { pjWorldview, pjCharsDir, pjFactionsDir, pjLocsDir, pjItemsDir } from './paths';

export interface ProjectEntityStats {
    worldview: number;
    characters: number;
    factions: number;
    locations: number;
    items: number;
}

/** 统计项目实体数量（同步读 vault 索引，不做额外 IO） */
export function countProjectEntities(app: App, project: string): ProjectEntityStats {
    const stats: ProjectEntityStats = {
        worldview: 0,
        characters: 0,
        factions: 0,
        locations: 0,
        items: 0,
    };

    const countMarkdown = (folderPath: string): number => {
        const folder = app.vault.getAbstractFileByPath(folderPath);
        if (!folder || !('children' in folder)) return 0;
        return (folder as TFolder).children.filter((c: TAbstractFile) => c.name.endsWith('.md')).length;
    };

    try {
        stats.worldview = app.vault.getAbstractFileByPath(pjWorldview(project)) ? 1 : 0;
    } catch {
        /* vault 索引不可用时保持 0 */
    }
    try {
        stats.characters = countMarkdown(pjCharsDir(project));
        stats.factions = countMarkdown(pjFactionsDir(project));
        stats.locations = countMarkdown(pjLocsDir(project));
        stats.items = countMarkdown(pjItemsDir(project));
    } catch {
        /* 同上 */
    }
    return stats;
}
