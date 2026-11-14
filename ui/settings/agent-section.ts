/**
 * agent-section.ts — Agent 对话设置（内置 Harness 单后端）
 *
 * 已移除外部 dsh 后端：插件只运行内置 Harness，零外部依赖。
 */

import { Setting } from 'obsidian';
import { SettingsSection } from './section-base';

/**
 * AgentBackendSection 类。
 */
export class AgentBackendSection extends SettingsSection {
    /**
     * 渲染。
     * @param container - 容器元素
     */
    render(container: HTMLElement): void {
        const section = container.createEl('section');
        section.createEl('h3', { text: '🤖 Agent 对话' });
        section.createEl('p', {
            text: 'Agent 工作台运行插件内置 Harness：支持工具调用、写入确认与只读模式，不依赖外部进程。',
            cls: 'nw-u-c-text-muted-2 nw-u-fs-13px-2 nw-u-marginbottom-16px-2',
        });

        new Setting(section)
            .setName('Agent 写入确认')
            .setDesc('默认开启：覆盖/追加已有笔记前确认，新建文件自动放行；关闭后写操作全部自动放行（危险操作仍会确认）')
            .addDropdown(dropdown => dropdown
                .addOption('ask', '每次确认（推荐）')
                .addOption('allow', '自动放行')
                .setValue(this.plugin.settings.agentWriteApproval === 'allow' ? 'allow' : 'ask')
                .onChange(async (value) => {
                    this.plugin.settings.agentWriteApproval = value === 'allow' ? 'allow' : 'ask';
                    await this.plugin.saveSettings();
                }));
    }
}
