/**
 * obsidian-query.ts — 基于 metadataCache 的笔记查询
 *
 * Bases（`.base`）只能作为 Obsidian UI 的展示层，插件运行时读不回来；
 * 因此「按类型/标签/属性找笔记」需要一个只读查询层。这里只读
 * `metadataCache.getFileCache`，不读文件正文、不写任何内容。
 */
import type { App, TFile } from 'obsidian';
import { readTagList, resolveFileKind, type NotebookFileKind } from './frontmatter-schema';

/** 查询条件（全部为 AND） */
export interface NoteQuery {
    /** 文件类型（resolveFileKind 口径） */
    kind?: NotebookFileKind;
    /** 必须包含的标签（支持 `nw/*` 与旧标签） */
    tag?: string;
    /** 必须位于该项目目录下（默认由调用方传 project） */
    folder?: string;
    /** 自定义 frontmatter 断言 */
    where?: (frontmatter: Record<string, unknown>) => boolean;
    /** 排除的目录前缀（如 `.看板`、`00-系统模板`） */
    excludeFolders?: string[];
}

/**
 * 项目内全部 Markdown 文件（按路径升序）
 *
 * @param app - Obsidian 应用
 * @param project - 项目路径
 * @param excludeFolders - 排除目录
 * @returns 文件列表
 */
function projectMarkdownFiles(app: App, project: string, excludeFolders: string[] = []): TFile[] {
    const prefix = project.endsWith('/') ? project : `${project}/`;
    const excluded = excludeFolders.map((folder) => {
        const clean = folder.replace(/^\/+|\/+$/g, '');
        return clean ? `${prefix}${clean}/` : '';
    }).filter(Boolean);
    return app.vault.getMarkdownFiles()
        .filter((file) => file.path.startsWith(prefix))
        .filter((file) => !excluded.some((folder) => file.path.startsWith(folder)))
        .sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * 读取 frontmatter（缺失时返回空对象）
 *
 * @param app - Obsidian 应用
 * @param file - 文件
 * @returns frontmatter
 */
function frontmatterOf(app: App, file: TFile): Record<string, unknown> {
    return (app.metadataCache.getFileCache(file)?.frontmatter ?? {}) as Record<string, unknown>;
}

/**
 * 按条件查询项目笔记。
 *
 * @param app - Obsidian 应用
 * @param project - 项目路径
 * @param query - 查询条件
 * @returns 命中的文件
 */
export function queryProjectNotes(app: App, project: string, query: NoteQuery = {}): TFile[] {
    const files = projectMarkdownFiles(app, project, query.excludeFolders);
    return files.filter((file) => {
        const frontmatter = frontmatterOf(app, file);
        if (query.kind && resolveFileKind(frontmatter, file.path) !== query.kind) return false;
        if (query.tag) {
            const tags = readTagList(frontmatter['tags']);
            if (!tags.includes(query.tag)) return false;
        }
        if (query.where && !query.where(frontmatter)) return false;
        return true;
    });
}

/**
 * 查找 frontmatter 中存在某属性且满足断言的笔记。
 *
 * @param app - Obsidian 应用
 * @param project - 项目路径
 * @param key - 属性名
 * @param predicate - 值断言（默认“存在即可”）
 * @returns 命中的文件
 */
export function findNotesWithProperty(
    app: App,
    project: string,
    key: string,
    predicate: (value: unknown) => boolean = (value) => value !== undefined && value !== null,
): TFile[] {
    return queryProjectNotes(app, project, {
        where: (frontmatter) => predicate(frontmatter[key]),
    });
}
