/**
 * rename-project-modal.ts — 重命名当前项目
 *
 * 通过 fileManager.renameFile 重命名项目根目录，Obsidian 会自动更新
 * 子文件路径与内部链接；同时同步 .project 的标题，避免元数据与目录名不一致。
 */

import { App, Modal, Notice, Setting, TFolder } from 'obsidian';
import { createLogger } from '@/shared/logger';
import { validateProjectName } from '@/shared/project-name';
import { ProjectRenameService } from '@/services/project-rename-service';
import { MODE_LIBRARY_ROOT_LIST, projectDisplayName } from '@/domains/kernel/project-locator';
import { isImeComposing } from '@/shared/keyboard';

const log = createLogger('RenameProjectModal');

/**
 * RenameProjectModal 类。
 */
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

    /**
     * onOpen 方法。
     */
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
                    if (isImeComposing(event)) return;
                    if (event.key === 'Enter') void this.submit();
                });
                window.setTimeout(() => text.inputEl.focus(), 0);
            });

        new Setting(contentEl)
            .addButton((btn) => btn.setButtonText('取消').onClick(() => this.close()))
            .addButton((btn) => btn.setButtonText('重命名').setCta().onClick(() => void this.submit()));
    }

    /**
     * onClose 方法。
     */
    onClose(): void {
        this.contentEl.empty();
    }

    private async submit(): Promise<void> {
        if (this.submitting) return;
        const oldDisplayName = projectDisplayName(this.project);
        const existing = this.app.vault.getRoot().children
            .filter((child): child is TFolder => child instanceof TFolder)
            .flatMap(folder => {
                if (MODE_LIBRARY_ROOT_LIST.includes(folder.name)) {
                    return folder.children
                        .filter((child): child is TFolder => child instanceof TFolder)
                        .map(child => child.name);
                }
                return [folder.name];
            })
            .filter(name => name !== oldDisplayName);
        const validation = validateProjectName(this.value, existing);
        if (!validation.valid) {
            new Notice(`⚠️ ${validation.error}`, 6000);
            return;
        }
        const newName = validation.normalized;
        if (newName === oldDisplayName) {
            new Notice('项目名未变化');
            this.close();
            return;
        }

        this.submitting = true;
        try {
            const result = await new ProjectRenameService(this.app).rename(this.project, newName);
            if (result.warnings.length > 0) {
                new Notice(`✅ 目录已重命名；${result.warnings.join('；')}`, 12000);
            } else {
                new Notice(`✅ 项目已重命名为「${newName}」`);
            }
            this.close();
            this.onRenamed?.(newName);
        } catch (e) {
            log.error('[RenameProjectModal] 重命名失败:', e);
            new Notice(`⚠️ 重命名失败：${e instanceof Error ? e.message : String(e)}`, 8000);
        } finally {
            this.submitting = false;
        }
    }
}
