/**
 * story-settings-modal.ts — 已有长篇项目的「故事结构」编辑入口
 *
 * 向导第一步与项目创建向导共用 StorySettingsEditor；保存后写回 .project，
 * 并同步 00-系统模板/故事结构指南.md 与创作模式指南，使后续提示词立即生效。
 */
import { App, Modal, Notice } from 'obsidian';
import NovelWriterPlugin from '@/main';
import { readProjectMeta } from '@/shared/paths';
import {
    buildStoryStructureGuide,
    parseStorySettingsFromProjectMeta,
    upsertStorySettingsInProjectMeta,
    type LongStorySettings,
} from '@/shared/story-structure';
import { buildCreationModeGuide, parseCreationModeMeta } from '@/shared/creation-mode';
import { StorySettingsEditor } from './story-settings-form';
import { createLogger } from '@/shared/logger';
import { writeVaultText } from '@/shared/file-system-port';

const log = createLogger('StorySettingsModal');

/**
 * 故事设置列表弹窗。
 */
export class StorySettingsModal extends Modal {
    private editor: StorySettingsEditor | null = null;
    private genre = '';

    constructor(
        app: App,
        private readonly plugin: NovelWriterPlugin,
        private readonly project: string,
        private readonly onSaved?: (settings: LongStorySettings) => void,
    ) {
        super(app);
    }

    /**
     * onOpen 方法。
     */
    onOpen(): void {
        this.modalEl.addClass('nw-scope', 'nw-modal', 'nw-story-settings-modal');
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('nw-story-settings-modal-content');
        contentEl.createEl('h2', { text: '🧬 故事结构设置', cls: 'nw-modal-title' });
        contentEl.createEl('p', {
            text: `项目：${this.project}。保存后会写入 .project 与系统模板，后续写作提示词立即使用该结构。`,
            cls: 'nw-text-12-muted',
        });

        const body = contentEl.createDiv({ cls: 'nw-story-settings-modal-body' });
        this.editor = new StorySettingsEditor(body, null, { getGenre: () => this.genre });

        const footer = contentEl.createDiv({ cls: 'nw-modal-footer' });
        const cancel = footer.createEl('button', {
            text: '取消',
            cls: 'nw-btn nw-btn-secondary',
            attr: { type: 'button' },
        });
        cancel.onclick = () => this.close();
        const save = footer.createEl('button', {
            text: '保存并应用',
            cls: 'nw-btn nw-btn-primary',
            attr: { type: 'button' },
        });
        save.onclick = () => void this.save();
        void this.loadInitial();
    }

    private async loadInitial(): Promise<void> {
        try {
            const meta = await readProjectMeta(this.app, this.project) || '';
            const genreMatch = meta.match(/^##\s*题材\s*\r?\n\s*(.+)$/m);
            if (genreMatch) this.genre = genreMatch[1].trim();
            const settings = parseStorySettingsFromProjectMeta(meta);
            if (settings && this.editor) {
                this.editor.setSettings(settings);
            }
        } catch (e) {
            log.warn('[StorySettingsModal] 读取项目故事结构失败:', e);
        }
    }

    private async save(): Promise<void> {
        if (!this.editor) return;
        const settings = this.editor.getValue();
        try {
            const meta = await readProjectMeta(this.app, this.project) || '';
            const nextMeta = upsertStorySettingsInProjectMeta(meta, settings);
            await this.app.vault.adapter.write(`${this.project}/.project`, nextMeta);

            const guideDir = `${this.project}/00-系统模板`;
            await writeVaultText(this.app, `${guideDir}/故事结构指南.md`, buildStoryStructureGuide(settings));

            const modeMeta = parseCreationModeMeta(nextMeta);
            await writeVaultText(this.app, `${guideDir}/创作模式指南.md`, buildCreationModeGuide(modeMeta));

            new Notice(`✅ 故事结构已保存：${settings.structureId}`, 4000);
            this.onSaved?.(settings);
            this.close();
        } catch (e) {
            log.error('[StorySettingsModal] 保存故事结构失败:', e);
            new Notice(`保存故事结构失败：${e instanceof Error ? e.message : String(e)}`, 8000);
        }
    }
}
