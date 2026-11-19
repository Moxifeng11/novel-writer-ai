/**
 * mcp-server-form-modal.ts — 新增/编辑 MCP 服务
 *
 * 支持两种接入方式：
 * 1) 选本机程序文件（.js/.py/.exe…）→ 自动推断「命令 + 参数」
 * 2) 手动填命令/参数 或 HTTP 端点
 * 保存前可点「测试连接」：真实启动进程/请求端点，列出工具名。
 */

import { Modal, Notice, Setting } from 'obsidian';
import type NovelWriterPlugin from '@/main';
import { normalizeMcpServer, type McpServerConfig } from '@/shared/mcp-config';
import {
    buildMcpLaunchPreview,
    parseMcpArgs,
    resolveMcpLaunchFromPath,
} from '@/shared/mcp-launch';
import { probeMcpServer } from '@/engine/agent/harness/mcp-manager';
import { McpFilePickerModal } from '@/ui/mcp-file-picker-modal';
import { showErrorNotice, showSuccessNotice } from '@/ui/components/notice-helpers';

/** 表单状态 */
interface FormState {
    id: string;
    name: string;
    transport: 'stdio' | 'http';
    command: string;
    args: string;
    url: string;
    kind: NonNullable<McpServerConfig['kind']>;
    enabled: boolean;
}

/**
 * MCP 服务表单。
 */
export class McpServerFormModal extends Modal {
    private state: FormState;
    private resultEl: HTMLElement | null = null;
    private testing = false;

    /**
     * @param plugin - 插件实例
     * @param options - 编辑对象与保存回调
     */
    constructor(
        private readonly plugin: NovelWriterPlugin,
        private readonly options: {
            server?: McpServerConfig;
            onSaved?: (config: McpServerConfig) => void | Promise<void>;
            onCloseRequest?: () => void;
        } = {},
    ) {
        super(plugin.app);
        const server = options.server;
        this.state = {
            id: server?.id ?? '',
            name: server?.name ?? '',
            transport: server?.transport === 'http' ? 'http' : 'stdio',
            command: server?.command ?? '',
            args: (server?.args ?? []).join(' '),
            url: server?.url ?? '',
            kind: server?.kind ?? 'admin',
            enabled: server?.enabled !== false,
        };
    }

    /** 渲染表单 */
    onOpen(): void {
        this.modalEl.addClass('nw-mcp-server-form');
        this.render();
    }

    /** 关闭时清空 */
    onClose(): void {
        this.contentEl.empty();
        this.options.onCloseRequest?.();
    }

    /** 渲染 */
    private render(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h3', { text: this.options.server ? '编辑 MCP 服务' : '新增 MCP 服务' });

        new Setting(contentEl)
            .setName('服务 ID')
            .setDesc('工具名前缀（mcp__<id>__<tool>），仅字母/数字/下划线/短横线')
            .addText(text => text
                .setPlaceholder('my-mcp')
                .setValue(this.state.id)
                .onChange(value => { this.state.id = value.trim(); }));

        new Setting(contentEl)
            .setName('显示名')
            .addText(text => text
                .setPlaceholder('我的 MCP')
                .setValue(this.state.name)
                .onChange(value => { this.state.name = value.trim(); }));

        new Setting(contentEl)
            .setName('传输方式')
            .addDropdown(dropdown => dropdown
                .addOption('stdio', '本地程序（stdio）')
                .addOption('http', 'HTTP 端点')
                .setValue(this.state.transport)
                .onChange(value => {
                    this.state.transport = value === 'http' ? 'http' : 'stdio';
                    this.render();
                }));

        if (this.state.transport === 'stdio') {
            new Setting(contentEl)
                .setName('程序路径 / 命令')
                .setDesc('选一个本机程序文件，或直接填 node / python 等命令')
                .addText(text => text
                    .setPlaceholder('C:\\tools\\server.mjs 或 node')
                    .setValue(this.state.command)
                    .onChange(value => { this.state.command = value.trim(); }))
                .addButton(button => button
                    .setButtonText('选择程序文件')
                    .setCta()
                    .onClick(() => {
                        new McpFilePickerModal(this.app, absolutePath => {
                            const spec = resolveMcpLaunchFromPath(absolutePath);
                            if (!spec) {
                                showErrorNotice('无法识别该文件的启动方式');
                                return;
                            }
                            this.state.command = spec.command;
                            this.state.args = spec.args.join(' ');
                            if (!this.state.id) {
                                this.state.id = defaultIdFromPath(absolutePath);
                            }
                            if (!this.state.name) {
                                this.state.name = defaultNameFromPath(absolutePath);
                            }
                            if (spec.warning) new Notice(`ℹ️ ${spec.warning}`, 8000);
                            this.render();
                        }).open();
                    }));

            new Setting(contentEl)
                .setName('启动参数')
                .setDesc('空格分隔；含空格的路径用引号包裹')
                .addText(text => text
                    .setPlaceholder('server.js --port 3000')
                    .setValue(this.state.args)
                    .onChange(value => { this.state.args = value; }));

            if (this.state.command) {
                contentEl.createEl('p', {
                    text: `实际启动：${buildMcpLaunchPreview(this.state.command, parseMcpArgs(this.state.args))}`,
                    cls: 'setting-item-description',
                });
            }
        } else {
            new Setting(contentEl)
                .setName('端点 URL')
                .setDesc('如 http://localhost:3000/mcp')
                .addText(text => text
                    .setPlaceholder('http://localhost:3000/mcp')
                    .setValue(this.state.url)
                    .onChange(value => { this.state.url = value.trim(); }));
        }

        new Setting(contentEl)
            .setName('动作分类')
            .setDesc('该服务工具默认归为哪类；只读模式下会拦截写类工具')
            .addDropdown(dropdown => dropdown
                .addOption('admin', '管理（默认）')
                .addOption('read', '只读')
                .addOption('write-setting', '写设定')
                .addOption('write-prose', '写正文')
                .setValue(this.state.kind)
                .onChange(value => { this.state.kind = value as FormState['kind']; }));

        new Setting(contentEl)
            .setName('启用')
            .addToggle(toggle => toggle
                .setValue(this.state.enabled)
                .onChange(value => { this.state.enabled = value; }));

        this.resultEl = contentEl.createDiv({ cls: 'nw-mcp-probe-result' });

        new Setting(contentEl)
            .addButton(button => button
                .setButtonText(this.testing ? '测试中…' : '测试连接')
                .setDisabled(this.testing)
                .onClick(() => void this.runProbe()))
            .addButton(button => button
                .setButtonText('💾 保存')
                .setCta()
                .onClick(() => void this.save()));
    }

    /**
     * 组装配置。
     *
     * @returns 规范化配置或 null
     */
    private buildConfig(): McpServerConfig | null {
        return normalizeMcpServer({
            id: this.state.id,
            name: this.state.name || this.state.id,
            transport: this.state.transport,
            command: this.state.command,
            args: parseMcpArgs(this.state.args),
            url: this.state.url,
            kind: this.state.kind,
            enabled: this.state.enabled,
        });
    }

    /** 测试连接（真实启动/请求） */
    private async runProbe(): Promise<void> {
        if (this.testing) return;
        const config = this.buildConfig();
        if (!config) {
            showErrorNotice('配置不完整或 ID 非法（stdio 需要命令；http 需要 http(s) URL）');
            return;
        }
        this.testing = true;
        this.render();
        try {
            const result = await probeMcpServer(config);
            this.testing = false;
            this.render();
            if (!this.resultEl) return;
            this.resultEl.empty();
            if (result.ok) {
                this.resultEl.createEl('p', {
                    text: `✅ 连接成功（${result.durationMs}ms），发现 ${result.tools.length} 个工具`,
                });
                const list = this.resultEl.createEl('ul');
                for (const tool of result.tools) {
                    list.createEl('li', { text: `${tool.name}${tool.description ? ` — ${tool.description}` : ''}` });
                }
            } else {
                this.resultEl.createEl('p', { text: `❌ 连接失败：${result.error ?? '未知原因'}` });
                this.resultEl.createEl('p', {
                    text: '排查：程序路径是否正确、是否已安装对应运行时（node/python）、程序是否为 stdio MCP 服务。',
                    cls: 'setting-item-description',
                });
            }
        } catch (error) {
            this.testing = false;
            this.render();
            showErrorNotice(`测试失败：${error instanceof Error ? error.message : String(error)}`, { timeout: 8000 });
        }
    }

    /** 保存 */
    private async save(): Promise<void> {
        const config = this.buildConfig();
        if (!config) {
            showErrorNotice('配置不完整或 ID 非法（stdio 需要命令；http 需要 http(s) URL）');
            return;
        }
        const current = normalizeServers(this.plugin.settings.mcpServers);
        const editingId = this.options.server?.id;
        if (!editingId && current.some(item => item.id === config.id)) {
            showErrorNotice(`服务 ID「${config.id}」已存在`);
            return;
        }
        const next = editingId
            ? current.map(item => (item.id === editingId ? config : item))
            : [...current, config];
        this.plugin.settings.mcpServers = next;
        await this.plugin.saveSettings();
        showSuccessNotice(editingId ? `已更新「${config.name}」` : `已添加「${config.name}」；打开 Agent 工作台后会连接`);
        await this.options.onSaved?.(config);
        this.close();
    }
}

/**
 * 规范化服务列表（去除非法项）。
 *
 * @param raw - 原始列表
 * @returns 列表
 */
function normalizeServers(raw: unknown): McpServerConfig[] {
    if (!Array.isArray(raw)) return [];
    const list: McpServerConfig[] = [];
    const seen = new Set<string>();
    for (const item of raw) {
        const config = normalizeMcpServer(item);
        if (!config || seen.has(config.id)) continue;
        seen.add(config.id);
        list.push(config);
    }
    return list;
}

/**
 * 由文件路径推断服务 ID。
 *
 * @param absolutePath - 绝对路径
 * @returns 合法 ID
 */
export function defaultIdFromPath(absolutePath: string): string {
    const base = String(absolutePath ?? '').replace(/\\/g, '/').split('/').pop() || 'mcp';
    const cleaned = base
        .replace(/\.[^.]+$/, '')
        .replace(/[^A-Za-z0-9_-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
    return (cleaned || 'mcp').slice(0, 32);
}

/**
 * 由文件路径推断显示名。
 *
 * @param absolutePath - 绝对路径
 * @returns 显示名
 */
export function defaultNameFromPath(absolutePath: string): string {
    const base = String(absolutePath ?? '').replace(/\\/g, '/').split('/').pop() || '';
    return base.replace(/\.[^.]+$/, '') || base || 'MCP 服务';
}
