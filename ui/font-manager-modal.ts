/**
 * font-manager-modal.ts — 自定义字体管理弹窗
 *
 * 用法：把字体文件（ttf/otf/woff/woff2）放入 vault `元文件/字体/`，
 * 打开本弹窗点「扫描并载入」即可注册；载入后协同写作编辑器的字体下拉
 * 与本弹窗列表都会出现该字体（附带预览文字）。
 */
import { App, Modal, Notice, TFile } from 'obsidian';
import NovelWriterPlugin from '@/main';
import {
    FONT_DIR,
    fontFileFormat,
    registerFont,
    scanFontFolder,
    unregisterFont,
} from '@/services/font-manager';

/**
 * 字体管理器弹窗。
 */
export class FontManagerModal extends Modal {
    private readonly plugin: NovelWriterPlugin;
    private listEl: HTMLElement | null = null;

    constructor(app: App, plugin: NovelWriterPlugin) {
        super(app);
        this.plugin = plugin;
    }

    /**
     * onOpen 方法。
     */
    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('nw-font-modal');

        contentEl.createEl('h2', { text: '🔤 字体管理', cls: 'nw-font-title' });
        contentEl.createDiv({
            cls: 'nw-font-hint',
            text: `把字体文件放入 vault「${FONT_DIR}/」目录（支持 ttf / otf / woff / woff2；${'woff2'} 体积最小、推荐优先）。点「扫描并载入」注册后，协同写作编辑器的字体下拉即可选用。中文字体单文件较大（5–20MB 属正常），载入后立即生效、随插件启动自动恢复。`,
        });

        const actions = contentEl.createDiv({ cls: 'nw-font-actions' });
        const scanBtn = actions.createEl('button', { text: '📥 扫描并载入', cls: 'nw-font-btn nw-font-btn-primary' });
        scanBtn.addEventListener('click', () => void this.scanAndRegister());
        const closeBtn = actions.createEl('button', { text: '关闭', cls: 'nw-font-btn' });
        closeBtn.addEventListener('click', () => this.close());

        this.listEl = contentEl.createDiv({ cls: 'nw-font-list' });
        void this.renderList();
    }

    private async scanAndRegister(): Promise<void> {
        const candidates = await scanFontFolder(this.plugin);
        if (candidates.length === 0) {
            new Notice(`「${FONT_DIR}/」中没有新字体文件`, 4000);
            return;
        }
        let ok = 0;
        for (const file of candidates) {
            const family = await registerFont(this.plugin, file);
            if (family) ok++;
        }
        new Notice(`✅ 已载入 ${ok}/${candidates.length} 个字体`, 4000);
        await this.renderList();
    }

    private async renderList(): Promise<void> {
        if (!this.listEl) return;
        this.listEl.empty();
        const fonts = this.plugin.settings.customFonts || [];
        if (fonts.length === 0) {
            this.listEl.createDiv({ cls: 'nw-font-empty', text: '还没有载入自定义字体。把字体文件放进上面的目录后点「扫描并载入」。' });
            return;
        }
        for (const entry of fonts) {
            const card = this.listEl.createDiv({ cls: 'nw-font-card' });
            const head = card.createDiv({ cls: 'nw-font-card-head' });
            head.createSpan({ cls: 'nw-font-family', text: entry.family });
            head.createSpan({ cls: 'nw-font-path', text: entry.path.split('/').pop() || entry.path });

            const preview = card.createDiv({
                cls: 'nw-font-preview',
                text: '永和九年，岁在癸丑。The quick brown fox 0123456789',
            });
            preview.style.fontFamily = `"${entry.family}"`;

            const meta = card.createDiv({ cls: 'nw-font-meta' });
            const file = this.plugin.app.vault.getAbstractFileByPath(entry.path);
            meta.createSpan({
                text: file instanceof TFile
                    ? `${fontFileFormat(file.name)?.toUpperCase() || '?'} · ${(file.stat.size / 1024 / 1024).toFixed(2)} MB`
                    : '⚠️ 文件不存在',
            });

            const removeBtn = card.createEl('button', { text: '移除', cls: 'nw-font-remove' });
            removeBtn.addEventListener('click', () => {
                void this.removeFont(entry.family);
            });
        }
    }

    private async removeFont(family: string): Promise<void> {
        await unregisterFont(this.plugin, family);
        new Notice(`已移除字体「${family}」（目录中的文件不会被删除）`, 4000);
        await this.renderList();
    }

    /**
     * onClose 方法。
     */
    onClose(): void {
        this.contentEl.empty();
    }
}
