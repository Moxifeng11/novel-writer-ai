/**
 * agent-section.ts — Agent 对话后端设置（D）
 *
 * native：内置 Harness（默认，零外部依赖）。
 * dsh：外部 DeepSeek Harness（仅桌面端，需用户自行安装；默认只读，
 *      打开「允许写入」后整会话 workspace-write —— 协议没有逐次审批通道）。
 */
import { Notice, Platform, Setting } from 'obsidian';
import { SettingsSection } from './section-base';
import { buildDshLaunchPlan } from '../../engine/agent/dsh/dsh-launch';
import { probeDshVersion } from '../../engine/agent/dsh/dsh-process';

export class AgentBackendSection extends SettingsSection {
    render(container: HTMLElement): void {
        const section = container.createEl('section');
        section.createEl('h3', { text: '🤖 Agent 对话后端' });
        section.createEl('p', {
            text: '内置 Harness 支持工具调用与写入确认；dsh 后端由外部 DeepSeek Harness 运行，适合对比/研究。',
            cls: 'nw-u-c-text-muted-2 nw-u-fs-13px-2 nw-u-marginbottom-16px-2',
        });

        new Setting(section)
            .setName('后端')
            .setDesc('切换后需重新打开 Agent 工作台生效')
            .addDropdown(dropdown => dropdown
                .addOption('native', '内置 Harness（默认）')
                .addOption('dsh', 'DeepSeek Harness（实验）')
                .setValue(this.plugin.settings.agentBackend || 'native')
                .onChange(async (value) => {
                    this.plugin.settings.agentBackend = value === 'dsh' ? 'dsh' : 'native';
                    await this.plugin.saveSettings();
                    this.refresh();
                }));

        const isDsh = (this.plugin.settings.agentBackend || 'native') === 'dsh';
        if (!isDsh) return;

        if (Platform.isMobile) {
            section.createEl('p', { text: '⚠️ dsh 后端仅支持桌面端；移动端会自动使用内置 Harness。' });
            return;
        }

        new Setting(section)
            .setName('Provider 路由')
            .setDesc('dsh initialize 的 provider；默认 deepseek-official')
            .addText(text => text
                .setPlaceholder('deepseek-official')
                .setValue(this.plugin.settings.dshProvider || '')
                .onChange(async (value) => {
                    this.plugin.settings.dshProvider = value.trim() || 'deepseek-official';
                    await this.plugin.saveSettings();
                }));

        new Setting(section)
            .setName('模型名')
            .setDesc('留空则使用当前默认模型')
            .addText(text => text
                .setPlaceholder(this.plugin.settings.defaultModel || 'deepseek-chat')
                .setValue(this.plugin.settings.dshModel || '')
                .onChange(async (value) => {
                    this.plugin.settings.dshModel = value.trim();
                    await this.plugin.saveSettings();
                }));

        new Setting(section)
            .setName('允许 dsh 写入 vault')
            .setDesc('SDK 协议没有逐次审批：开启 = 本次会话 workspace-write（启动前还会确认一次）；关闭 = 只读')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.dshAllowVaultWrite === true)
                .onChange(async (value) => {
                    this.plugin.settings.dshAllowVaultWrite = value;
                    await this.plugin.saveSettings();
                }));

        const probeRow = section.createEl('div', { cls: 'nw-u-mt-12' });
        const probeBtn = probeRow.createEl('button', { text: '🔌 检测 dsh 是否可用', cls: 'nw-btn' });
        probeBtn.addEventListener('click', async () => {
            probeBtn.disabled = true;
            probeBtn.setText('检测中…');
            try {
                const base = (this.app.vault.adapter as unknown as { getBasePath?: () => string }).getBasePath?.() || '';
                const home = `${base}/${this.app.vault.configDir}/plugins/novel-writer-ai/data/dsh`;
                const plan = buildDshLaunchPlan({
                    home,
                    workspace: base,
                    sandbox: 'read-only',
                });
                const result = await probeDshVersion(plan, {
                    cwd: base,
                    isDesktop: !Platform.isMobile,
                    passthroughEnv: {
                        PATH: (globalThis as unknown as { process?: { env?: Record<string, string> } }).process?.env?.PATH || '',
                        Path: (globalThis as unknown as { process?: { env?: Record<string, string> } }).process?.env?.Path || '',
                    },
                }, 120_000);
                new Notice(result.ok
                    ? `✅ dsh 可用${result.version ? `：${result.version}` : ''}`
                    : `❌ dsh 不可用：${result.error}`, 8000);
            } finally {
                probeBtn.disabled = false;
                probeBtn.setText('🔌 检测 dsh 是否可用');
            }
        });
        section.createEl('p', {
            text: '首次检测可能触发 npx 下载，耗时取决于网络；插件不会自动安装或升级 dsh。',
            cls: 'nw-u-c-text-muted-2 nw-u-fs-12px',
        });
    }
}
