/**
 * mcp-section.ts — 设置页「MCP 服务」
 *
 * 这里只做概览与入口（列表 + 状态 + 打开管理中心），具体增删改测都在
 * `ui/mcp-manager-modal.ts`：一个面板管理全部服务，避免设置页越堆越长。
 */

import { Platform, Setting } from 'obsidian';
import { SettingsSection } from './section-base';
import { describeMcpServer, normalizeMcpServers } from '@/shared/mcp-config';
import { McpManagerModal } from '@/ui/mcp-manager-modal';
import { showErrorNotice } from '@/ui/components/notice-helpers';

/**
 * MCP 服务设置分区。
 */
export class McpSection extends SettingsSection {
    /**
     * 渲染。
     *
     * @param container - 容器元素
     */
    render(container: HTMLElement): void {
        const section = container.createEl('section');
        section.createEl('h3', { text: '🔌 MCP 服务' });
        section.createEl('p', {
            text: '接入外部 MCP 服务：本地程序（stdio 子进程）或 HTTP 端点。连接后工具以 mcp__<服务ID>__<工具> 提供给 Agent 调用。'
                + '在管理面板里可以选本机程序文件、测试连接、查看工具清单，也可一键生成示例服务验证链路。',
            cls: 'nw-u-c-text-muted-2 nw-u-fs-13px-2 nw-u-marginbottom-16px-2',
        });

        const list = normalizeMcpServers(this.plugin.settings.mcpServers);
        if (list.length === 0) {
            section.createEl('p', {
                text: '还没有配置 MCP 服务。点下面「打开管理中心」→「生成示例服务」即可先跑通一个。',
                cls: 'setting-item-description',
            });
        }
        for (const server of list) {
            new Setting(section)
                .setName(server.name || server.id)
                .setDesc(`${describeMcpServer(server)}${server.enabled === false ? ' · 已停用' : ''}`)
                .addButton(button => button
                    .setButtonText('管理')
                    .onClick(() => this.openManager()));
        }

        new Setting(section)
            .setName('MCP 管理中心')
            .setDesc('新增 / 编辑 / 删除服务、选择本机程序、测试连接、查看工具清单、生成示例服务')
            .addButton(button => button
                .setButtonText('打开管理中心')
                .setCta()
                .onClick(() => this.openManager()));

        new Setting(section)
            .setName('移动端说明')
            .setDesc('stdio 服务依赖本地子进程，仅在桌面端可用；移动端请使用 HTTP 端点服务。')
            .addButton(button => button
                .setButtonText('检查当前环境')
                .onClick(() => {
                    // 用公开的 Platform.isMobile（不读 app 内部字段，避免依赖私有结构）
                    if (Platform.isMobile) {
                        showErrorNotice('当前是移动端：stdio 服务不可用，请改用 HTTP 端点', { timeout: 8000 });
                    } else {
                        showErrorNotice('当前是桌面端：可使用 stdio 本地程序服务');
                    }
                }));
    }

    /** 打开管理中心 */
    private openManager(): void {
        new McpManagerModal(this.plugin).open();
    }
}
