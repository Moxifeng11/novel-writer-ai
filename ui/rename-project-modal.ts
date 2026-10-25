/**
 * rename-project-modal.ts — 重命名当前项目
 *
 * 通过 fileManager.renameFile 重命名项目根目录，Obsidian 会自动更新
 * 子文件路径与内部链接；同时同步 .project 的标题，避免元数据与目录名不一致。
 */

import { App, Modal, Notice, Setting, TFolder } from 'obsidian';
import { pjProjectMeta, sanitizeName } from '../shared/paths';
import { createLogger } from '../shared/logger';

const log = createLogger('RenameProjectModal');

export class RenameProjectModal extends Modal {
    private value: string;
    private submitting = false;

    constructor(
        app: App,
        private project: string,
        private onRenamed?: (newProject: string) => void,
    ) {
        super(app);
        this.value = project;
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h2', { text: '重命名当前项目' });
        contentEl.createEl('p', {
            text: `当前项目：${this.project}。重命名会同步更新子文件路径与内部链接。`,
            cls: 'setting-item-description',
        });

        new Setting(contentEl)
            .setName('新项目名')
            .addText((text) => {
                text.setValue(this.value).onChange((value) => { this.value = value; });
                text.inputEl.addEventListener('keydown', (event) => {
                    if (event.key === 'Enter') void this.submit();
                });
                window.setTimeout(() => text.inputEl.focus(), 0);
            });

        new Setting(contentEl)
            .addButton((btn) => btn.setButtonText('取消').onClick(() => this.close()))
            .addButton((btn) => btn.setButtonText('重命名').setCta().onClick(() => void this.submit()));
    }

    onClose(): void {
        this.contentEl.empty();
    }

    private async submit(): Promise<void> {
        if (this.submitting) return;
        const newName = sanitizeName(this.value.trim());
        if (!newName || newName === this.project) {
            new Notice('项目名未变化');
            this.close();
            return;
        }

        const parent = this.project.replace(/\/[^/]+$/, '');
        const newPath = parent ? `${parent}/${newName}` : newName;
        if (this.app.vault.getAbstractFileByPath(newPath)) {
            new Notice(`⚠️ 文件夹「${newName}」已存在，请换一个名称`);
            return;
        }

        const folder = this.app.vault.getAbstractFileByPath(this.project);
        if (!(folder instanceof TFolder)) {
            new Notice('未找到当前项目文件夹，无法重命名');
            return;
        }

        this.submitting = true;
        try {
            await this.app.fileManager.renameFile(folder, newPath);
            await this.syncProjectMeta(newPath, newName);
            new Notice(`✅ 项目已重命名为「${newName}」`);
            this.close();
            this.onRenamed?.(newName);
        } catch (e) {
            log.error('[RenameProjectModal] 重命名失败:', e);
            new Notice(`⚠️ 重命名失败：${e instanceof Error ? e.message : String(e)}`);
        } finally {
            this.submitting = false;
        }
    }

    /** .project 是点文件，Obsidian 索引不到，需走 adapter */
    private async syncProjectMeta(newProject: string, newName: string): Promise<void> {
        const path = pjProjectMeta(newProject);
        try {
            const adapter = this.app.vault.adapter;
            if (!(await adapter.exists(path))) return;
            const content = await adapter.read(path);
            const updated = content.replace(/^#\s+.+$/m, `# ${newName}`);
            if (updated !== content) {
                await adapter.write(path, updated);
            }
        } catch (e) {
            log.warn('[RenameProjectModal] 同步 .project 失败:', e);
        }
    }
}
