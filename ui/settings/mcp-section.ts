/**
 * mcp-section.ts — 设置页「MCP 服务」
 *
 * 这里只做概览与入口（列表 + 状态 + 打开管理中心），具体增删改测都在
 * `ui/mcp-manager-modal.ts`：一个面板管理全部服务，避免设置页越堆越长。
 */

import { Platform, Setting } from 'obsidian';
import { t } from '@/i18n';
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
        section.createEl('h3', { text: t('settings.mcp.title') });
        section.createEl('p', {
            text: t('settings.mcp.intro'),
            cls: 'nw-u-c-text-muted nw-u-fs-13px nw-u-marginbottom-16px',
        });

        const list = normalizeMcpServers(this.plugin.settings.mcpServers);
        if (list.length === 0) {
            section.createEl('p', {
                text: t('settings.mcp.emptyHint'),
                cls: 'setting-item-description',
            });
        }
        for (const server of list) {
            new Setting(section)
                .setName(server.name || server.id)
                .setDesc(`${describeMcpServer(server)}${server.enabled === false ? t('settings.mcp.disabledSuffix') : ''}`)
                .addButton(button => button
                    .setButtonText(t('settings.mcp.manageBtn'))
                    .onClick(() => this.openManager()));
        }

        new Setting(section)
            .setName(t('settings.mcp.managerName'))
            .setDesc(t('settings.mcp.managerDesc'))
            .addButton(button => button
                .setButtonText(t('settings.mcp.managerBtn'))
                .setCta()
                .onClick(() => this.openManager()));

        new Setting(section)
            .setName(t('settings.mcp.mobileName'))
            .setDesc(t('settings.mcp.mobileDesc'))
            .addButton(button => button
                .setButtonText(t('settings.mcp.checkEnvBtn'))
                .onClick(() => {
                    // 用公开的 Platform.isMobile（不读 app 内部字段，避免依赖私有结构）
                    if (Platform.isMobile) {
                        showErrorNotice(t('settings.mcp.envMobileNotice'), { timeout: 8000 });
                    } else {
                        showErrorNotice(t('settings.mcp.envDesktopNotice'));
                    }
                }));
    }

    /** 打开管理中心 */
    private openManager(): void {
        new McpManagerModal(this.plugin).open();
    }
}
