/**
 * vault-tree.ts — 按目录读取文件，替代 engine/services 里的全库 getFiles()
 *
 * 为什么需要：vault.getFiles() 会遍历整库（上万篇笔记）并构造数组，
 * 而落盘、结算、字数统计这些热路径每次只需要「某个项目/某一章」下的几十个文件。
 * 200 章项目里每写一步都扫全库，是 O(全库) 的固定开销，
 * 且随用户 vault 里其它笔记增长而线性变慢。
 *
 * Obsidian 的 getAbstractFileByPath 是 O(1) 索引查询，TFolder.children 是已建好的树。
 * 这里只做结构遍历，不 import 'obsidian'（shared 层不得依赖宿主 API），
 * 调用方通过泛型拿到真实的 TFile 实例：
 *     listFolderFiles<TFile>(app.vault, pjBodyDir(project, 1))
 */

export interface VaultTreeNode {
    path: string;
    name: string;
    extension?: string;
    children?: VaultTreeNode[];
}

/**
 * VaultTreePort 类型定义。
 */
export interface VaultTreePort {
    getAbstractFileByPath(path: string): unknown;
}

/**
 * 列出文件夹选项列表结构定义。
 */
export interface ListFolderOptions {
    /** 是否递归子目录（默认 false：只取当前目录） */
    recursive?: boolean;
    /** 允许的扩展名（默认 ['md']；传 [] 表示不按扩展名过滤） */
    extensions?: string[];
    /** 递归最大深度（默认 8，防御异常深的目录树） */
    maxDepth?: number;
    /** 最多返回多少个文件（默认 5000，防御超大目录把内存打满） */
    maxFiles?: number;
}

/**
 * 归一化目录路径：去首尾斜杠、合并重复斜杠
 *
 * @param folderPath - 文件夹路径
 * @returns 文本结果
 */
export function normalizeFolderPath(folderPath: string): string {
    return String(folderPath ?? '').replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/^\/+|\/+$/g, '');
}

function isFolder(node: unknown): node is VaultTreeNode & { children: VaultTreeNode[] } {
    return !!node && typeof node === 'object' && Array.isArray((node as VaultTreeNode).children);
}

function extensionOf(node: VaultTreeNode): string {
    if (typeof node.extension === 'string') return node.extension;
    const name = String(node.name ?? '');
    const dot = name.lastIndexOf('.');
    return dot > 0 ? name.slice(dot + 1) : '';
}

/**
 * 列出目录下的文件（不包含目录本身）。
 * 目录不存在、路径指向文件、宿主没有 children 时一律返回空数组，不抛错。
 * @param vault - 仓库（Vault）
 * @param folderPath - 文件夹路径
 * @param options - 配置项
 * @returns 结果数组
 */
export function listFolderFiles<T = VaultTreeNode>(
    vault: VaultTreePort,
    folderPath: string,
    options: ListFolderOptions = {},
): T[] {
    const normalized = normalizeFolderPath(folderPath);
    if (!normalized) return [];

    let root: unknown;
    try {
        root = vault.getAbstractFileByPath(normalized);
    } catch {
        return [];
    }
    if (!isFolder(root)) return [];

    const extensions = (options.extensions ?? ['md']).map(ext => ext.replace(/^\./, '').toLowerCase());
    const recursive = options.recursive === true;
    const maxDepth = Math.max(0, options.maxDepth ?? 8);
    const maxFiles = Math.max(1, options.maxFiles ?? 5000);

    const files: T[] = [];
    const walk = (children: VaultTreeNode[], depth: number): boolean => {
        for (const child of children) {
            if (!child || typeof child !== 'object') continue;
            if (isFolder(child)) {
                // 不进入隐藏目录（.obsidian / .trash / .git），也不超过深度上限
                if (!recursive || depth >= maxDepth) continue;
                if (String(child.name || '').startsWith('.')) continue;
                if (walk(child.children, depth + 1)) return true;
                continue;
            }
            if (extensions.length > 0 && !extensions.includes(extensionOf(child).toLowerCase())) continue;
            files.push(child as unknown as T);
            if (files.length >= maxFiles) return true;
        }
        return false;
    };

    walk(root.children, 0);
    return files;
}

/**
 * 目录是否真实存在（用于区分「目录还没建」与「目录为空」）
 *
 * @param vault - 仓库（Vault）
 * @param folderPath - 文件夹路径
 * @returns 是否成功
 */
export function folderExists(vault: VaultTreePort, folderPath: string): boolean {
    const normalized = normalizeFolderPath(folderPath);
    if (!normalized) return false;
    try {
        return isFolder(vault.getAbstractFileByPath(normalized));
    } catch {
        return false;
    }
}
