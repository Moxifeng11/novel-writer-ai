/**
 * agent-section.ts — Agent 对话后端设置（D）
 *
 * native：内置 Harness（默认，零外部依赖）。
 * dsh：外部 DeepSeek Harness（仅桌面端，需用户自行安装；默认只读，
 *      打开「允许写入」后整会话 workspace-write —— 协议没有逐次审批通道）。
 */
import { Notice, Platform, Setting } from 'obsidian';
import { SettingsSection } from './section-base';
import { buildDshLaunchPlan } from '@/engine/agent/dsh/dsh-launch';
import { probeDshVersion } from '@/engine/agent/dsh/dsh-process';

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
        section.createEl('h3', { text: '🤖 Agent 对话后端' });
        section.createEl('p', {
            text: '内置 Harness 支持工具调用与写入确认；dsh 后端由外部 DeepSeek Harness 运行，适合对比/研究。',
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
            .setName('Dsh 固定版本')
            .setDesc('插件用 npx 启动固定版本，不会自动拉取 latest；升级需手动改这里。')
            .addText(text => text
                .setPlaceholder('0.2.1-rc.5')
                .setValue(this.plugin.settings.dshVersion || '0.2.1-rc.5')
                .onChange(async (value) => {
                    this.plugin.settings.dshVersion = value.trim() || '0.2.1-rc.5';
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

        section.createEl('p', {
            text: 'dsh 需你自行安装（插件不自动安装/升级）。完整依赖树包含 bash/pwsh 等工具，接受安装即接受这些工具随包存在；'
                + '写入只能整会话放开，没有逐文件审批。',
            cls: 'nw-u-c-text-muted-2 nw-u-fs-12px',
        });

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
