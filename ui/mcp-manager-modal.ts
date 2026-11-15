/**
 * mcp-manager-modal.ts — MCP 服务管理程序（管理中心）
 *
 * 一个面板管理全部 MCP 服务：状态、工具清单、测试连接、启用/停用、编辑、删除，
 * 以及「一键生成示例 MCP 程序」——没有现成程序时先用它验证链路。
 */

import { Modal, Notice, Setting } from 'obsidian';
import type NovelWriterPlugin from '@/main';
import { describeMcpServer, normalizeMcpServer, type McpServerConfig } from '@/shared/mcp-config';
import { describeMcpResult, probeMcpServer } from '@/engine/agent/harness/mcp-manager';
import { listMcpServerStats, resetMcpServerStats } from '@/engine/agent/harness/mcp-runtime-stats';
import { McpServerFormModal } from '@/ui/mcp-server-form-modal';
import { McpFilePickerModal } from '@/ui/mcp-file-picker-modal';
import { resolveMcpLaunchFromPath, buildMcpLaunchPreview } from '@/shared/mcp-launch';
import { buildMcpExampleServer, MCP_EXAMPLE_SERVER_PATH } from '@/shared/mcp-example-server';
import { showErrorNotice, showSuccessNotice } from '@/ui/components/notice-helpers';

/** 单个服务的探测状态 */
interface ProbeState {
    status: 'idle' | 'probing' | 'ok' | 'failed';
    tools: Array<{ name: string; description: string }>;
    error?: string;
    durationMs?: number;
}

/**
 * MCP 管理中心。
 */
export class McpManagerModal extends Modal {
    private probes = new Map<string, ProbeState>();
    private bodyEl: HTMLElement | null = null;
    private expandedTools = new Set<string>();

    /**
     * @param plugin - 插件实例
     */
    constructor(private readonly plugin: NovelWriterPlugin) {
        super(plugin.app);
    }

    /** 渲染 */
    onOpen(): void {
        this.modalEl.addClass('nw-mcp-manager');
        this.render();
    }

    /** 关闭清空 */
    onClose(): void {
        this.contentEl.empty();
    }

    /** 读取当前服务列表 */
    private servers(): McpServerConfig[] {
        const raw = this.plugin.settings.mcpServers;
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
     * 保存服务列表。
     *
     * @param list - 新列表
     */
    private async save(list: McpServerConfig[]): Promise<void> {
        this.plugin.settings.mcpServers = list;
        await this.plugin.saveSettings();
        this.render();
    }

    /** 渲染整个面板 */
    private render(): void {
        const { contentEl } = this;
        contentEl.empty();
        const list = this.servers();
        const enabled = list.filter(item => item.enabled !== false).length;
        const connected = this.probes.size > 0
            ? [...this.probes.values()].filter(state => state.status === 'ok').length
            : 0;

        contentEl.createEl('h3', { text: '🔌 MCP 服务管理中心' });
        contentEl.createEl('p', {
            text: `共 ${list.length} 个服务（启用 ${enabled} 个）${connected ? `，本次已连上 ${connected} 个` : ''}。`
                + 'MCP 工具会以 mcp__<服务ID>__<工具> 形式提供给 Agent；stdio 服务在桌面端以子进程运行。',
            cls: 'setting-item-description',
        });

        new Setting(contentEl)
            .setName('接入方式')
            .setDesc('没有现成程序时，可先生成示例服务验证链路')
            .addButton(button => button
                .setButtonText('➕ 新增服务')
                .setCta()
                .onClick(() => this.openForm()))
            .addButton(button => button
                .setButtonText('📂 从程序文件接入')
                .onClick(() => {
                    new McpFilePickerModal(this.app, absolutePath => {
                        const spec = resolveMcpLaunchFromPath(absolutePath);
                        if (!spec) {
                            showErrorNotice('无法识别该文件的启动方式');
                            return;
                        }
                        new McpServerFormModal(this.plugin, {
                            server: {
                                id: '',
                                name: '',
                                transport: 'stdio',
                                command: spec.command,
                                args: spec.args,
                                kind: 'admin',
                                enabled: true,
                            } as unknown as McpServerConfig,
                            onSaved: () => this.render(),
                        }).open();
                    }).open();
                }))
            .addButton(button => button
                .setButtonText('🧪 生成示例服务')
                .onClick(() => void this.createExample()))
            .addButton(button => button
                .setButtonText('清除调用统计')
                .onClick(() => {
                    resetMcpServerStats();
                    this.render();
                    new Notice('已清除 MCP 会话调用统计');
                }))
            .addButton(button => button
                .setButtonText('全部测试')
                .setDisabled(list.length === 0)
                .onClick(() => void this.probeAll()));

        this.bodyEl = contentEl.createDiv({ cls: 'nw-mcp-manager-body' });
        if (list.length === 0) {
            this.bodyEl.createEl('p', {
                text: '还没有配置 MCP 服务。点「生成示例服务」可立即得到一个能跑的程序，用来验证插件调用链路。',
                cls: 'setting-item-description',
            });
        }
        for (const server of list) {
            this.renderServerRow(this.bodyEl, server);
        }

        contentEl.createEl('p', {
            text: '提示：stdio 服务需要本机能启动对应运行时（node / python）；HTTP 服务填 http(s) 端点即可，无需子进程。',
            cls: 'setting-item-description',
        });
    }

    /**
     * 渲染单个服务行。
     *
     * @param parent - 容器
     * @param server - 服务配置
     */
    private renderServerRow(parent: HTMLElement, server: McpServerConfig): void {
        const state = this.probes.get(server.id) ?? { status: 'idle' as const, tools: [] };
        const card = parent.createDiv({ cls: 'nw-mcp-server-card' });
        const head = card.createDiv({ cls: 'nw-mcp-server-head' });
        const badge = head.createSpan({ cls: 'nw-mcp-status-badge' });
        badge.setText(
            state.status === 'ok' ? '✅ 已连接'
                : state.status === 'failed' ? '❌ 连接失败'
                    : state.status === 'probing' ? '⏳ 测试中'
                        : '⚪ 未测试',
        );
        head.createSpan({ text: ` ${server.name} `, cls: 'nw-mcp-server-name' });
        head.createSpan({ text: `(${server.id})`, cls: 'nw-u-c-text-muted-2' });

        card.createEl('p', {
            text: describeMcpServer(server) + (server.enabled === false ? ' · 已停用' : ''),
            cls: 'setting-item-description',
        });
        const runtime = listMcpServerStats()[server.id];
        if (runtime && runtime.calls > 0) {
            card.createEl('p', {
                text: `会话内调用 ${runtime.calls} 次 · 失败 ${runtime.failures} 次`
                    + (runtime.lastError ? ` · 最近错误：${runtime.lastError}` : '')
                    + (runtime.lastAt ? ` · 最近调用 ${new Date(runtime.lastAt).toLocaleTimeString()}` : ''),
                cls: 'setting-item-description',
            });
        }
        if (server.transport === 'stdio' && server.command) {
            card.createEl('p', {
                text: `启动命令：${buildMcpLaunchPreview(server.command, server.args ?? [])}`,
                cls: 'setting-item-description',
            });
        }
        if (state.status === 'ok') {
            const toolNames = state.tools.map(tool => tool.name);
            const summary = head.createSpan({
                text: ` ${state.tools.length} 个工具${state.durationMs ? `（${state.durationMs}ms）` : ''}`,
                cls: 'nw-u-c-text-muted-2',
            });
            void toolNames;
            const toggleLink = card.createEl('button', {
                text: this.expandedTools.has(server.id) ? '收起工具' : '查看工具',
                cls: 'nw-btn nw-btn-secondary',
            });
            toggleLink.addEventListener('click', () => {
                if (this.expandedTools.has(server.id)) this.expandedTools.delete(server.id);
                else this.expandedTools.add(server.id);
                this.render();
            });
            if (this.expandedTools.has(server.id)) {
                const tools = card.createEl('ul', { cls: 'nw-mcp-tool-list' });
                for (const tool of state.tools) {
                    tools.createEl('li', { text: `${tool.name}${tool.description ? ` — ${tool.description}` : ''}` });
                }
            }
            void summary;
        }
        if (state.status === 'failed' && state.error) {
            card.createEl('p', { text: `原因：${state.error}` });
        }

        const actions = card.createDiv({ cls: 'nw-mcp-server-actions' });
        const testBtn = actions.createEl('button', {
            text: '测试连接',
            cls: 'nw-btn',
        });
        testBtn.addEventListener('click', () => void this.probeOne(server));

        const toggleBtn = actions.createEl('button', {
            text: server.enabled === false ? '启用' : '停用',
            cls: 'nw-btn nw-btn-secondary',
        });
        toggleBtn.addEventListener('click', () => {
            void this.save(this.servers().map(item => (item.id === server.id
                ? { ...item, enabled: item.enabled === false }
                : item)));
        });

        const editBtn = actions.createEl('button', { text: '编辑', cls: 'nw-btn nw-btn-secondary' });
        editBtn.addEventListener('click', () => this.openForm(server));

        const delBtn = actions.createEl('button', { text: '删除', cls: 'nw-btn nw-btn-warning' });
        delBtn.addEventListener('click', () => {
            void this.save(this.servers().filter(item => item.id !== server.id)).then(() => {
                this.probes.delete(server.id);
            });
        });
    }

    /**
     * 打开表单（新建或编辑）。
     *
     * @param server - 编辑对象
     */
    private openForm(server?: McpServerConfig): void {
        new McpServerFormModal(this.plugin, {
            server,
            onSaved: () => this.render(),
        }).open();
    }

    /** 生成本地示例 MCP 程序并注册 */
    private async createExample(): Promise<void> {
        try {
            const existing = this.plugin.app.vault.getAbstractFileByPath(MCP_EXAMPLE_SERVER_PATH);
            if (!(existing instanceof Object) || !('path' in (existing as object))) {
                const dir = MCP_EXAMPLE_SERVER_PATH.split('/').slice(0, -1).join('/');
                if (dir && !this.plugin.app.vault.getAbstractFileByPath(dir)) {
                    await this.plugin.app.vault.createFolder(dir);
                }
                await this.plugin.app.vault.create(MCP_EXAMPLE_SERVER_PATH, buildMcpExampleServer());
            }
            const adapter = this.plugin.app.vault.adapter as unknown as { getBasePath?(): string; basePath?: string };
            const basePath = adapter.getBasePath?.() ?? adapter.basePath ?? '';
            const absolute = basePath
                ? `${basePath.replace(/\\/g, '/').replace(/\/+$/, '')}/${MCP_EXAMPLE_SERVER_PATH}`
                : MCP_EXAMPLE_SERVER_PATH;
            const config: McpServerConfig | null = normalizeMcpServer({
                id: 'nw-example',
                name: '小说工坊示例 MCP',
                transport: 'stdio',
                command: 'node',
                args: [absolute],
                kind: 'read',
                enabled: true,
            });
            if (!config) {
                showErrorNotice('示例服务配置生成失败');
                return;
            }
            const current = this.servers().filter(item => item.id !== config.id);
            await this.save([...current, config]);
            showSuccessNotice(`已生成示例服务：${MCP_EXAMPLE_SERVER_PATH}；点「测试连接」验证`, { timeout: 8000 });
            await this.probeOne(config);
        } catch (error) {
            showErrorNotice(`生成示例服务失败：${error instanceof Error ? error.message : String(error)}`, { timeout: 8000 });
        }
    }

    /**
     * 测试单个服务。
     *
     * @param server - 服务配置
     */
    private async probeOne(server: McpServerConfig): Promise<void> {
        this.probes.set(server.id, { status: 'probing', tools: [] });
        this.render();
        const result = await probeMcpServer(server);
        this.probes.set(server.id, {
            status: result.ok ? 'ok' : 'failed',
            tools: result.tools,
            error: result.error,
            durationMs: result.durationMs,
        });
        if (!result.ok) new Notice(`MCP「${server.name}」连接失败：${result.error ?? ''}`, 8000);
        this.render();
    }

    /** 全部测试 */
    private async probeAll(): Promise<void> {
        const list = this.servers().filter(item => item.enabled !== false);
        if (list.length === 0) return;
        for (const server of list) await this.probeOne(server);
        const ok = [...this.probes.values()].filter(state => state.status === 'ok').length;
        const failed = [...this.probes.values()].filter(state => state.status === 'failed').length;
        new Notice(describeMcpResult({ tools: new Array(ok).fill({}), failures: new Array(failed).fill({ id: 'x', reason: '' }) }), 6000);
    }
}
