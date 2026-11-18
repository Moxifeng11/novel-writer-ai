/**
 * setup-section.ts — 「首启与自检」设置分区
 *
 * 面向社区下载用户：把「能不能开始写」做成一张清单，
 * 每项给出状态与一键修复按钮，并提供「继续首启引导」「生成使用约定」入口。
 */

import { Notice, Setting } from 'obsidian';
import { t } from '@/i18n';
import { SettingsSection } from './section-base';
import type { ReadinessReport, ReadinessStatus } from '@/services/setup-readiness-service';
import { SettlementRecoveryModal } from '@/ui/settlement-recovery-modal';

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
            .setName(t('settings.setup.title'))
            .setDesc(t('settings.setup.desc'))
            .setHeading();

        const list = container.createDiv({ cls: 'nw-settings-section' });
        const reportEl = list.createDiv({ cls: 'setting-item-description', text: t('settings.setup.checking') });

        const renderReport = (report: ReadinessReport): void => {
            this.report = report;
            reportEl.empty();
            const summary = reportEl.createDiv({
                text: `${report.usable ? t('settings.setup.summaryUsable') : t('settings.setup.summaryBlocked')}${t('settings.setup.summaryCounts', { ok: report.counts.ok, warn: report.counts.warn, missing: report.counts.missing })}`,
            });
            summary.addClass('nw-readiness-summary');
            const table = reportEl.createEl('ul', { cls: 'nw-readiness-list' });
            for (const item of report.items) {
                const li = table.createEl('li', { cls: `nw-readiness-item is-${item.status}` });
                li.createSpan({ text: t('settings.setup.itemLine', { icon: STATUS_ICON[item.status], label: item.label }) });
                li.createSpan({ text: item.detail });
                if (item.fix) li.createEl('div', { cls: 'setting-item-description', text: t('settings.setup.fixLine', { fix: item.fix }) });
            }
        };

        const refreshReport = async (): Promise<void> => {
            try {
                renderReport(await this.plugin.runSetupReadiness());
            } catch (error) {
                reportEl.setText(t('settings.setup.checkFailed', { msg: error instanceof Error ? error.message : String(error) }));
            }
        };

        new Setting(list)
            .setName(t('settings.setup.recheck'))
            .setDesc(t('settings.setup.recheckDesc'))
            .addButton(button => button.setButtonText(t('settings.setup.recheckBtn')).onClick(() => { void refreshReport(); }));

        new Setting(list)
            .setName(t('settings.setup.autoScaffold'))
            .setDesc(t('settings.setup.autoScaffoldDesc'))
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.templateScaffoldOnStartup !== false)
                .onChange(async value => {
                    this.plugin.settings.templateScaffoldOnStartup = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(list)
            .setName(t('settings.setup.oneClickFix'))
            .setDesc(t('settings.setup.oneClickFixDesc'))
            .addButton(button => button.setButtonText(t('settings.setup.fixTemplatesBtn')).onClick(async () => {
                const result = await this.plugin.ensureTemplatesNow();
                new Notice(t('settings.setup.fixTemplatesNotice', { created: result.created, skipped: result.skipped, failed: result.failed }), 6000);
                await refreshReport();
            }))
            .addButton(button => button.setButtonText(t('settings.setup.createExampleBtn')).onClick(async () => {
                const result = await this.plugin.createExampleProjectNow();
                new Notice(
                    result.created
                        ? t('settings.setup.exampleCreated', { project: result.project })
                        : result.repaired > 0
                            ? t('settings.setup.exampleRepaired', { project: result.project, count: result.repaired })
                            : t('settings.setup.exampleComplete', { project: result.project }),
                    6000,
                );
                await refreshReport();
            }))
            .addButton(button => button.setButtonText(t('settings.setup.usageGuideBtn')).onClick(async () => {
                const result = await this.plugin.writeUsageGuideNow();
                new Notice(t('settings.setup.usageGuideDone', { path: result.path }), 6000);
                await refreshReport();
            }));

        new Setting(list)
            .setName(t('settings.setup.settlementRecovery'))
            .setDesc(t('settings.setup.settlementRecoveryDesc'))
            .addButton(button => button.setButtonText(t('settings.setup.settlementRecoveryBtn')).onClick(() => {
                const project = this.plugin.getWorkbenchContext()?.project ?? this.plugin.getActiveProject() ?? '';
                if (!project) {
                    new Notice(t('settings.setup.settlementNoProject'), 6000);
                    return;
                }
                new SettlementRecoveryModal(this.plugin, project).open();
            }));

        new Setting(list)
            .setName(t('settings.setup.onboarding'))
            .setDesc(t('settings.setup.onboardingDesc'))
            .addButton(button => button.setButtonText(t('settings.setup.onboardingBtn')).setCta().onClick(() => {
                this.plugin.openOnboarding();
            }));

        const notes = container.createDiv({ cls: 'nw-settings-section' });
        new Setting(notes)
            .setName(t('settings.setup.conventions'))
            .setDesc(t('settings.setup.conventionsDesc'))
            .addButton(button => button.setButtonText(t('settings.setup.conventionsBtn')).onClick(async () => {
                const result = await this.plugin.writeUsageGuideNow();
                await this.app.workspace.openLinkText(result.path, '', false);
            }));

        await refreshReport();
    }
}
