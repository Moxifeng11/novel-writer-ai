import type { App } from 'obsidian';

export async function openKnowledgeFolder(app: App, folderPath: string): Promise<boolean> {
    if (!app.vault.getAbstractFileByPath(folderPath)) return false;
    const leaf = app.workspace.getLeaf('tab');
    await leaf.setViewState({ type: 'file-explorer', active: true });
    return true;
}
