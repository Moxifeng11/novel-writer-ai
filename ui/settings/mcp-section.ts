/**
 * mcp-section.ts — 设置页「MCP 服务」
 *
 * 维护服务列表（id/名称/传输/命令或 URL/动作分类），会话启动时自动连接并桥接工具。
 * 新建服务 = 在下方表单填写并保存；也支持一键生成最小 MCP server 模板说明。
 */

import { Setting } from 'obsidian';
import { SettingsSection } from './section-base';
import { describeMcpServer, normalizeMcpServer, type McpServerConfig } from '@/shared/mcp-config';
import { showErrorNotice, showSuccessNotice } from '@/ui/components/notice-helpers';

/**
 * McpSection 类。
 */
export class McpSection extends SettingsSection {
    /**
     * 渲染。
     * @param container - 容器元素
     */
    render(container: HTMLElement): void {
        const section = container.createEl('section');
        section.createEl('h3', { text: '🔌 MCP 服务' });
        section.createEl('p', {
            text: '接入外部 MCP 服务：本地进程（stdio）或 HTTP 端点。会话启动时连接，工具以 mcp__<服务>__<工具> 形式提供给 Agent。',
            cls: 'nw-u-c-text-muted-2 nw-u-fs-13px-2 nw-u-marginbottom-16px-2',
        });

        const list = this.plugin.settings.mcpServers ?? [];
        if (list.length === 0) {
            section.createEl('p', { text: '还没有配置 MCP 服务。', cls: 'setting-item-description' });
        }
        for (const server of list) {
            new Setting(section)
                .setName(server.name || server.id)
                .setDesc(describeMcpServer(server))
                .addToggle(toggle => toggle
                    .setValue(server.enabled !== false)
                    .onChange(async (value) => {
                        const target = (this.plugin.settings.mcpServers ?? []).find(item => item.id === server.id);
                        if (target) target.enabled = value;
                        await this.plugin.saveSettings();
                    }))
                .addButton(button => button
                    .setButtonText('删除')
                    .setWarning()
                    .onClick(async () => {
                        this.plugin.settings.mcpServers = (this.plugin.settings.mcpServers ?? [])
                            .filter(item => item.id !== server.id);
                        await this.plugin.saveSettings();
                        this.refresh();
                    }));
        }

        section.createEl('h4', { text: '新增服务' });
        const form = { id: '', name: '', transport: 'stdio' as 'stdio' | 'http', command: '', args: '', url: '', kind: 'admin' as 'read' | 'write-setting' | 'write-prose' | 'admin' };

        new Setting(section)
            .setName('服务 ID')
            .setDesc('工具名前缀，仅字母/数字/下划线/短横线')
            .addText(text => text.setPlaceholder('my-mcp').onChange(value => { form.id = value.trim(); }));

        new Setting(section)
            .setName('显示名')
            .addText(text => text.setPlaceholder('我的 MCP').onChange(value => { form.name = value.trim(); }));

        new Setting(section)
            .setName('传输')
            .addDropdown(dropdown => dropdown
                .addOption('stdio', '本地进程（stdio）')
                .addOption('http', 'HTTP 端点')
                .setValue('stdio')
                .onChange(value => { form.transport = value === 'http' ? 'http' : 'stdio'; }));

        new Setting(section)
            .setName('命令（stdio）')
            .setDesc('如 node / npx / python')
            .addText(text => text.setPlaceholder('node').onChange(value => { form.command = value.trim(); }));

        new Setting(section)
            .setName('参数（stdio）')
            .setDesc('空格分隔，如 server.js --port 3000')
            .addText(text => text.setPlaceholder('server.js').onChange(value => { form.args = value; }));

        new Setting(section)
            .setName('URL（http）')
            .addText(text => text.setPlaceholder('http://localhost:3000/mcp').onChange(value => { form.url = value.trim(); }));

        new Setting(section)
            .setName('动作分类')
            .setDesc('该服务工具默认归为哪类；影响只读模式是否拦截')
            .addDropdown(dropdown => dropdown
                .addOption('admin', '管理（默认）')
                .addOption('read', '只读')
                .addOption('write-setting', '写设定')
                .addOption('write-prose', '写正文')
                .setValue('admin')
                .onChange(value => { form.kind = value as typeof form.kind; }));

        new Setting(section)
            .setName('保存服务')
            .addButton(button => button
                .setButtonText('添加')
                .setCta()
                .onClick(async () => {
                    const args = form.args.trim() ? form.args.trim().split(/\s+/) : [];
                    const config: McpServerConfig | null = normalizeMcpServer({
                        id: form.id,
                        name: form.name || form.id,
                        transport: form.transport,
                        command: form.command,
                        args,
                        url: form.url,
                        kind: form.kind,
                        enabled: true,
                    });
                    if (!config) {
                        showErrorNotice('配置不完整或 ID 非法（stdio 需要命令；http 需要 http(s) URL）', { timeout: 6000 });
                        return;
                    }
                    const current = this.plugin.settings.mcpServers ?? [];
                    if (current.some(item => item.id === config.id)) {
                        showErrorNotice(`服务 ID「${config.id}」已存在`, { timeout: 5000 });
                        return;
                    }
                    this.plugin.settings.mcpServers = [...current, config];
                    await this.plugin.saveSettings();
                    showSuccessNotice(`已添加 MCP 服务「${config.name}」；重新打开 Agent 工作台生效`, { timeout: 6000 });
                    this.refresh();
                }));
    }
}
