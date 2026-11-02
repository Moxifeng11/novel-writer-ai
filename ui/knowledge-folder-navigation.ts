import type { App } from 'obsidian';

/**
 * 打开知识文件夹。
 * @param app - Obsidian 应用实例
 * @param folderPath - 文件夹路径
 * @returns 是否成功
 */
export async function openKnowledgeFolder(app: App, folderPath: string): Promise<boolean> {
    if (!app.vault.getAbstractFileByPath(folderPath)) return false;
    const leaf = app.workspace.getLeaf('tab');
    await leaf.setViewState({ type: 'file-explorer', active: true });
    return true;
}
