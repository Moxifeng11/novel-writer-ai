import { App, Modal, Notice, FileSystemAdapter } from 'obsidian';
import NovelWriterPlugin from '../main';

export class ProtectYuanModal extends Modal {
    private plugin: NovelWriterPlugin;

    constructor(app: App, plugin: NovelWriterPlugin) {
        super(app);
        this.plugin = plugin;
    }

    onOpen(): void {
    this.modalEl.addClass('nw-scope');
        const { contentEl } = this;

        // ═══ v3.4.8: 两层CSS规则 — 见 docs/CSS变量注入与两层规则_全插件避坑指南.md ═══
        const wrapper = contentEl.parentElement as HTMLElement;
        if (wrapper) {
            wrapper.style.setProperty('max-width', 'min(650px, 90vw)', 'important');
            wrapper.style.setProperty('width', 'min(650px, 90vw)', 'important');
            wrapper.style.setProperty('margin', 'auto', 'important');
        }
        contentEl.style.maxWidth = 'min(650px, 90vw)';
        contentEl.style.width = '100%';
        contentEl.style.setProperty('overflow-y', 'auto', 'important');
        contentEl.empty();
        contentEl.createEl('h2', { text: '🔒 保护元文件' });

        contentEl.createEl('p', { text: '将元文件设为只读，防止误改误删。仅支持桌面版。' });

        const protectButton = contentEl.createEl('button', { text: '设置只读保护', cls: 'nw-btn nw-btn-primary novel-writer-primary-button' });
        protectButton.onclick = async () => {
            await this.protect();
        };
    }

    private async protect(): Promise<void> {
        const adapter = this.app.vault.adapter;
        const isFileSystem = adapter instanceof FileSystemAdapter;
        if (!isFileSystem) {
            new Notice('❌ 仅在桌面版 Obsidian 支持', 5000);
            return;
        }

        const vaultPath = (adapter as FileSystemAdapter).getBasePath();
        const yuanPath = vaultPath + '\\元文件';

        try {
            const { exec } = require('child_process');
            const cmd = `attrib +r "${yuanPath}" /s /d`;

            new Notice('⏳ 正在设置元文件保护...', 0);

            exec(cmd, (error: Error | null) => {
                if (error) {
                    console.error('attrib 失败:', error);
                    new Notice(
                        '❌ 自动设置失败，请手动操作：\n右键「元文件」→ 属性 → 勾选「只读」→ 应用到所有子文件',
                        10000
                    );
                    return;
                }
                new Notice('✅ 元文件已设为只读保护，无法误改误删', 6000);
            });

        } catch (err) {
            console.error('保护失败:', err);
            new Notice(
                '❌ 自动设置失败，请手动操作：\n在文件资源管理器中右键「元文件」→ 属性 → 只读',
                10000
            );
        }

        this.close();
    }

    onClose(): void {
        const { contentEl } = this;
        contentEl.empty();
    }
}