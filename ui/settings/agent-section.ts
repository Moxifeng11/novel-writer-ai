/**
 * agent-section.ts — Agent 对话设置（内置 Harness 单后端）
 *
 * 已移除外部 dsh 后端：插件只运行内置 Harness，零外部依赖。
 */

import { Setting } from 'obsidian';
import { t } from '@/i18n';
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
        section.createEl('h3', { text: t('settings.agent.title') });
        section.createEl('p', {
            text: t('settings.agent.intro'),
            cls: 'nw-u-c-text-muted nw-u-fs-13px nw-u-marginbottom-16px',
        });

        new Setting(section)
            .setName(t('settings.agent.writeApprovalName'))
            .setDesc(t('settings.agent.writeApprovalDesc'))
            .addDropdown(dropdown => dropdown
                .addOption('ask', t('settings.agent.optionAsk'))
                .addOption('allow', t('settings.agent.optionAllow'))
                .setValue(this.plugin.settings.agentWriteApproval === 'allow' ? 'allow' : 'ask')
                .onChange(async (value) => {
                    this.plugin.settings.agentWriteApproval = value === 'allow' ? 'allow' : 'ask';
                    await this.plugin.saveSettings();
                }));
    }
}
