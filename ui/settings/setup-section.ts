/**
 * setup-section.ts — 「首启与自检」设置分区
 *
 * 面向社区下载用户：把「能不能开始写」做成一张清单，
 * 每项给出状态与一键修复按钮，并提供「继续首启引导」「生成使用约定」入口。
 */

import { Notice, Setting } from 'obsidian';
import { SettingsSection } from './section-base';
import type { ReadinessReport, ReadinessStatus } from '@/services/setup-readiness-service';

/** 状态 → 图标 */
const STATUS_ICON: Record<ReadinessStatus, string> = { ok: '✅', warn: '⚠️', missing: '❌' };

/**
 * 首启与自检分区。
 */
export class SetupSection extends SettingsSection {
    /** 最近一次自检结果（避免重复计算） */
    private report: ReadinessReport | null = null;

    /**
     * 渲染分区。
     *
     * @param container - 容器
     * @returns 完成 Promise
     */
    async render(container: HTMLElement): Promise<void> {
        const intro = container.createDiv({ cls: 'nw-settings-section' });
        new Setting(intro)
            .setName('🚀 首启与自检')
            .setDesc('从社区市场装好后，按这里补齐环境即可开始写作；每项都可一键修复。')
            .setHeading();

        const list = container.createDiv({ cls: 'nw-settings-section' });
        const reportEl = list.createDiv({ cls: 'setting-item-description', text: '正在自检…' });

        const renderReport = (report: ReadinessReport): void => {
            this.report = report;
            reportEl.empty();
            const summary = reportEl.createDiv({
                text: `${report.usable ? '✅ 可以开始写作' : '❌ 还差必要配置'}（ok ${report.counts.ok} / warn ${report.counts.warn} / missing ${report.counts.missing}）`,
            });
            summary.addClass('nw-readiness-summary');
            const table = reportEl.createEl('ul', { cls: 'nw-readiness-list' });
            for (const item of report.items) {
                const li = table.createEl('li', { cls: `nw-readiness-item is-${item.status}` });
                li.createSpan({ text: `${STATUS_ICON[item.status]} ${item.label}：` });
                li.createSpan({ text: item.detail });
                if (item.fix) li.createEl('div', { cls: 'setting-item-description', text: `修复：${item.fix}` });
            }
        };

        const refreshReport = async (): Promise<void> => {
            try {
                renderReport(await this.plugin.runSetupReadiness());
            } catch (error) {
                reportEl.setText(`自检失败：${error instanceof Error ? error.message : String(error)}`);
            }
        };

        new Setting(list)
            .setName('重新自检')
            .setDesc('检查 API Key、模板树、作品、模式目录、索引与使用说明')
            .addButton(button => button.setButtonText('立即自检').onClick(() => { void refreshReport(); }));

        new Setting(list)
            .setName('启动时自动生成「元文件」模板')
            .setDesc('开启：首次启用插件会在库根写入 56 个模板文件（新建项目依赖它们）。关闭：不在启动时写库，改为新建作品时按需落盘。')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.templateScaffoldOnStartup !== false)
                .onChange(async value => {
                    this.plugin.settings.templateScaffoldOnStartup = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(list)
            .setName('一键修复')
            .setDesc('补齐模板文件 / 创建示例项目 / 生成使用说明（均不会覆盖已有内容）')
            .addButton(button => button.setButtonText('补齐模板').onClick(async () => {
                const result = await this.plugin.ensureTemplatesNow();
                new Notice(`模板：新建 ${result.created}，跳过 ${result.skipped}，失败 ${result.failed}`, 6000);
                await refreshReport();
            }))
            .addButton(button => button.setButtonText('创建示例项目').onClick(async () => {
                const result = await this.plugin.createExampleProjectNow();
                new Notice(result.created ? `已创建示例项目：${result.project}` : `示例项目已存在：${result.project}`, 6000);
                await refreshReport();
            }))
            .addButton(button => button.setButtonText('生成使用说明').onClick(async () => {
                const result = await this.plugin.writeUsageGuideNow();
                new Notice(`已生成：${result.path}`, 6000);
                await refreshReport();
            }));

        new Setting(list)
            .setName('首启引导')
            .setDesc('3 分钟走完「选供应商 → 填 Key → 连通性测试 → 示例项目 → 开始写作」')
            .addButton(button => button.setButtonText('打开引导').setCta().onClick(() => {
                this.plugin.openOnboarding();
            }));

        const notes = container.createDiv({ cls: 'nw-settings-section' });
        new Setting(notes)
            .setName('📌 目录 / 标签 / 属性约定')
            .setDesc('不确定某个文件夹、标签或笔记属性该不该手改时，点「生成使用说明」查看速查（写在 写作知识库/插件使用约定.md）')
            .addButton(button => button.setButtonText('查看约定').onClick(async () => {
                const result = await this.plugin.writeUsageGuideNow();
                await this.app.workspace.openLinkText(result.path, '', false);
            }));

        await refreshReport();
    }
}
