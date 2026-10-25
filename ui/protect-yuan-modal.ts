import { App, Modal, Notice, FileSystemAdapter, Platform } from 'obsidian';
import NovelWriterPlugin from '../main';
import { createLogger } from '../shared/logger';


const log = createLogger('ProtectYuanModal');
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
            wrapper.addClass('nw-modal');
            wrapper.style.setProperty('margin', 'auto', 'important');
        }
        contentEl.style.width = '100%';
        contentEl.style.setProperty('overflow-y', 'auto', 'important');
        contentEl.empty();
        contentEl.createEl('h2', { text: '🔒 保护元文件' });

        contentEl.createEl('p', { text: '将元文件设为只读，防止误改误删。仅支持桌面版（Windows / macOS / Linux）。' });

        const protectButton = contentEl.createEl('button', { text: '设置只读保护', cls: 'nw-btn nw-btn-primary novel-writer-primary-button' });
        protectButton.onclick = async () => {
            await this.protect();
        };
    }

    private async protect(): Promise<void> {
        if (Platform.isMobile) {
            new Notice('❌ 移动端不支持只读保护，请在桌面版 Obsidian 中使用', 6000);
            return;
        }

        const adapter = this.app.vault.adapter;
        const isFileSystem = adapter instanceof FileSystemAdapter;
        if (!isFileSystem) {
            new Notice('❌ 仅在桌面版 Obsidian 支持', 5000);
            return;
        }

        const vaultPath = (adapter as FileSystemAdapter).getBasePath();
        const yuanPath = `${vaultPath}/元文件`;
        const isWindows = process.platform === 'win32';
        const cmd = isWindows
            ? `attrib +r "${yuanPath}" /s /d`
            : `chmod -R a-w "${yuanPath}"`;
        const manualHint = isWindows
            ? '右键「元文件」→ 属性 → 勾选「只读」→ 应用到所有子文件'
            : '在终端执行：chmod -R a-w "元文件"';

        try {
            const { exec } = require('child_process');

            // M4（技术审计）：持久进度通知持有引用，所有出口（成功/失败/异常）hide
            const progressNotice = new Notice('⏳ 正在设置元文件保护...', 0);

            exec(cmd, (error: Error | null) => {
                progressNotice.hide();
                if (error) {
                    log.error('设置只读失败:', error);
                    new Notice(`❌ 自动设置失败，请手动操作：\n${manualHint}`, 10000);
                    return;
                }
                new Notice('✅ 元文件已设为只读保护，无法误改误删', 6000);
            });

        } catch (err) {
            log.error('保护失败:', err);
            new Notice(`❌ 自动设置失败，请手动操作：\n${manualHint}`, 10000);
        }

        this.close();
    }

    onClose(): void {
        const { contentEl } = this;
        contentEl.empty();
    }
}