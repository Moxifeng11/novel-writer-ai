/**
 * mcp-file-picker-modal.ts — 本机程序文件选择器（桌面端）
 *
 * 背景：Obsidian 渲染进程拿不到系统文件对话框，也不可靠地拿到 `File.path`；
 * 但插件在桌面端有 Node 能力，因此这里用 `node:fs` 自建一个浏览器：
 * 输入框输路径 + 上级目录 + 常用根目录 + 目录/文件列表。
 *
 * 只用于「选一个 MCP 程序文件」这类低频操作；移动端直接提示手动输入。
 */

import { Modal, Notice, Setting } from 'obsidian';
import { isLikelyMcpProgramFile, pickDirectoryEntries, type FsEntry } from '@/shared/mcp-file-browse';
import { MCP_PROGRAM_EXTENSIONS } from '@/shared/mcp-launch';

/**
 * 本机文件选择器。
 */
export class McpFilePickerModal extends Modal {
    private pathInput: HTMLInputElement | null = null;
    private listEl: HTMLElement | null = null;
    private statusEl: HTMLElement | null = null;

    /**
     * @param app - Obsidian 应用
     * @param onPick - 选中文件回调（绝对路径）
     * @param options - 选项
     */
    constructor(
        app: Modal['app'],
        private readonly onPick: (absolutePath: string) => void,
        private readonly options: { startDir?: string; title?: string } = {},
    ) {
        super(app);
    }

    /** 打开并渲染 */
    onOpen(): void {
        this.modalEl.addClass('nw-mcp-file-picker');
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h3', { text: this.options.title ?? '选择 MCP 程序文件' });
        contentEl.createEl('p', {
            text: '支持 .js / .mjs / .cjs / .py / .sh / .ps1 / .exe；选好后会自动推断启动命令。',
            cls: 'setting-item-description',
        });

        new Setting(contentEl)
            .setName('路径')
            .addText(text => {
                this.pathInput = text.inputEl;
                this.pathInput.value = this.options.startDir ?? '';
                this.pathInput.addEventListener('keydown', event => {
                    if (event.key === 'Enter') {
                        event.preventDefault();
                        void this.renderDir(this.pathInput?.value.trim() ?? '');
                    }
                });
            })
            .addButton(button => button.setButtonText('转到').onClick(() => {
                void this.renderDir(this.pathInput?.value.trim() ?? '');
            }))
            .addButton(button => button.setButtonText('上一级').onClick(() => {
                void this.renderDir(parentOf(this.pathInput?.value.trim() ?? ''));
            }));

        this.listEl = contentEl.createDiv({ cls: 'nw-mcp-file-list' });
        this.statusEl = contentEl.createEl('p', { cls: 'setting-item-description' });
        void this.renderDir(this.pathInput?.value.trim() || defaultStartDir());
    }

    /** 关闭时清空 */
    onClose(): void {
        this.contentEl.empty();
    }

    /**
     * 渲染某目录内容。
     *
     * @param dirPath - 目录路径
     */
    private async renderDir(dirPath: string): Promise<void> {
        if (!this.listEl || !this.statusEl) return;
        const target = dirPath || defaultStartDir();
        this.listEl.empty();
        this.statusEl.setText('读取中…');
        const result = await pickDirectoryEntries(target, MCP_PROGRAM_EXTENSIONS);
        if (!result.ok) {
            this.statusEl.setText(`❌ ${result.error ?? '无法读取该目录'}`);
            return;
        }
        if (this.pathInput) this.pathInput.value = result.path;
        this.statusEl.setText(`共 ${result.entries.length} 项`);

        // 常用根目录
        const jumps = this.listEl.createDiv({ cls: 'nw-mcp-file-jumps' });
        for (const root of result.roots) {
            const chip = jumps.createEl('button', { text: root, cls: 'nw-btn nw-btn-secondary' });
            chip.addEventListener('click', () => { void this.renderDir(root); });
        }

        if (result.entries.length === 0) {
            this.listEl.createEl('p', { text: '这个目录下没有可用的程序文件。', cls: 'setting-item-description' });
            return;
        }
        const list = this.listEl.createDiv({ cls: 'nw-mcp-file-rows' });
        for (const entry of result.entries) {
            this.renderEntry(list, entry);
        }
    }

    /**
     * 渲染一行（目录 → 进入；文件 → 选中）。
     *
     * @param parent - 容器
     * @param entry - 目录项
     */
    private renderEntry(parent: HTMLElement, entry: FsEntry): void {
        const row = parent.createDiv({ cls: `nw-mcp-file-row${entry.isDirectory ? ' is-dir' : ''}` });
        const label = row.createEl('button', {
            text: `${entry.isDirectory ? '📁' : '📄'} ${entry.name}`,
            cls: 'nw-mcp-file-row-btn',
        });
        label.addEventListener('click', () => {
            if (entry.isDirectory) {
                void this.renderDir(entry.path);
                return;
            }
            if (!isLikelyMcpProgramFile(entry.path)) {
                new Notice('这个文件不是可接入的程序类型（支持 .js/.mjs/.cjs/.py/.sh/.ps1/.exe）');
                return;
            }
            this.onPick(entry.path);
            this.close();
        });
        if (!entry.isDirectory) row.createSpan({ text: ` ${formatSize(entry.size)}`, cls: 'nw-u-c-text-muted-2' });
    }
}

/**
 * 取父目录（Windows 盘根保留 `C:\`）。
 *
 * @param dirPath - 目录路径
 * @returns 父目录
 */
export function parentOf(dirPath: string): string {
    const normalized = String(dirPath ?? '').replace(/\\/g, '/').replace(/\/+$/, '');
    if (!normalized) return '';
    const index = normalized.lastIndexOf('/');
    if (index < 0) return normalized;
    if (index === 0) return '/';
    // Windows 盘根：C: → C:/
    if (/^[A-Za-z]:$/.test(normalized.slice(0, index))) return `${normalized.slice(0, index)}/`;
    return normalized.slice(0, index);
}

/** 默认起始目录（用户主目录） */
function defaultStartDir(): string {
    const home = typeof process !== 'undefined' ? (process.env.HOME || process.env.USERPROFILE || '') : '';
    return home || '';
}

/**
 * 格式化文件大小。
 *
 * @param size - 字节数
 * @returns 文本
 */
function formatSize(size: number): string {
    if (!Number.isFinite(size) || size <= 0) return '';
    if (size < 1024) return `${size}B`;
    if (size < 1024 * 1024) return `${Math.round(size / 1024)}KB`;
    return `${(size / 1024 / 1024).toFixed(1)}MB`;
}
