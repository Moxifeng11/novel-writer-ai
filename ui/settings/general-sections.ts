/**
 * general-sections.ts — 设置页「通用」分区集合
 *
 * 承载六个分区：性能监控（L4047-L4390）、提示词（L4391-L4400）、
 * 规则版本（L4401-L4518）、关于（L4519-L4739 + L5098-L5112）、
 * 角色识别（L4740-L5019）、建议设置（L5020-L5097）。
 * 来源：原 settings-tab.ts，方法体逐行搬移，无逻辑改动。
 */
import { copyText } from '@/shared/clipboard';
import { Setting, Notice, Modal, TFile } from 'obsidian';
import type { App } from 'obsidian';
import type { UpdateCheckResult } from '@/services/update-checker';
import { showErrorNotice, showSuccessNotice, showWarningNotice } from '@/ui/components/notice-helpers';
import { performanceMonitor } from '@/services/performance-monitor';
import { ENGINE_NAMES } from '@/shared/engine-names';
import { ChangelogModal } from '@/ui/changelog-modal';
import { SupportAuthorModal } from '@/ui/support-author-modal';
import {
    aggregateOperationStats,
    formatByteSize,
    formatHitRate,
    formatPerfDuration,
} from '@/ui/metrics-format';
import { RulesService } from '@/services/rules-service';
import { GITHUB_BRANCH, GITHUB_REPO_SLUG } from '@/shared/github-repo';
import { isStoredCiphertext } from '@/shared/secret-value';
import { exportTextFile } from '@/shared/export-file';
import { OperationConfirmModal } from '@/ui/components/progress';
import { SettingsSection } from './section-base';
import { savePendingReloadState } from '@/shared/reload-state';
import { t } from '@/i18n';

/**
 * 性能监控设置分区。
 */
export class PerformanceSection extends SettingsSection {
    /**
     * 渲染该设置分区。
     *
     * @param container - 容器元素
     */
    render(container: HTMLElement): void {
        const section = container.createEl('section');

        section.createEl('h3', { text: t('settings.general.readOnlyTitle') });
        section.createEl('p', { text: t('settings.general.readOnlyLead'), cls: 'nw-st-lead' });
        new Setting(section)
            .setName(t('settings.general.readOnlyEnable'))
            .setDesc(t('settings.general.readOnlyEnableDesc'))
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.readOnlyMode === true)
                .onChange(async (value) => {
                    this.plugin.settings.readOnlyMode = value;
                    await this.plugin.saveSettings();
                    this.refresh();
                })
            );

        section.createEl('h3', { text: t('settings.general.perfTitle') });
        section.createEl('p', { text: t('settings.general.perfLead'), cls: 'nw-st-lead' });

        const perfEnabled = performanceMonitor.isEnabled();
        new Setting(section)
            .setName(t('settings.general.perfEnable'))
            .setDesc(t('settings.general.perfEnableDesc'))
            .addToggle(toggle => toggle
                .setValue(perfEnabled)
                .onChange(value => {
                    performanceMonitor.setEnabled(value);
                    this.refresh();
                })
            );

        // v4.34.0：会话保留清理的用户入口（开关 + 手动命令「🧹 清理旧会话」）
        new Setting(section)
            .setName(t('settings.general.perfRetention'))
            .setDesc(t('settings.general.perfRetentionDesc'))
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.sessionRetentionEnabled !== false)
                .onChange(async (value) => {
                    this.plugin.settings.sessionRetentionEnabled = value;
                    await this.plugin.saveSettings();
                })
            );

        if (!performanceMonitor.isEnabled()) {
            section.createDiv({
                text: t('settings.general.perfDisabled'),
                cls: 'nw-empty-info-card nw-st-card-spaced'
            });
            return;
        }

        const log = performanceMonitor.getLog(50);
        const categoryStats = performanceMonitor.getCategoryStats();
        const slowOps = performanceMonitor.getSlowOperations();
        const memoryInfo = performanceMonitor.getMemoryInfo();

        let cacheStats: { hitRate: number; totalEntries: number; totalSize: number } | undefined;
        try {
            const cacheService = this.plugin.engineRegistry.getOrNull(ENGINE_NAMES.WORLDVIEW_CACHE_SERVICE);
            if (cacheService) {
                const s = cacheService.getStats();
                cacheStats = {
                    hitRate: s.hitRate,
                    totalEntries: s.totalEntries,
                    totalSize: s.totalSize,
                };
            }
        } catch { // silent-ok: 缓存统计（装饰性：读失败就不显示缓存行）
        }

        section.createEl('h4', { text: t('settings.general.perfOverview'), cls: 'nw-h4-section' });

        const statsGrid = section.createDiv({
            cls: 'nw-st-stat-grid'
        });

        const totals = aggregateOperationStats(categoryStats);

        this.addStatCard(statsGrid, t('settings.general.statTotalOps'), totals.totalOps.toString());
        this.addStatCard(statsGrid, t('settings.general.statTotalDuration'), this.formatDuration(totals.totalDuration));
        this.addStatCard(statsGrid, t('settings.general.statAvgDuration'), totals.totalOps > 0 ? this.formatDuration(totals.avgDuration) : 'N/A');
        this.addStatCard(statsGrid, t('settings.general.statSlowOps'), slowOps.length.toString());

        if (memoryInfo.current || memoryInfo.peak) {
            this.addStatCard(statsGrid, t('settings.general.statCurrentMemory'), memoryInfo.current ? this.formatBytes(memoryInfo.current) : 'N/A');
            this.addStatCard(statsGrid, t('settings.general.statPeakMemory'), memoryInfo.peak ? this.formatBytes(memoryInfo.peak) : 'N/A');
        }

        if (cacheStats) {
            this.addStatCard(statsGrid, t('settings.general.statCacheHit'), formatHitRate(cacheStats.hitRate));
            this.addStatCard(statsGrid, t('settings.general.statCacheEntries'), cacheStats.totalEntries.toString());
        }

        section.createEl('h4', { text: t('settings.general.perfByCategory'), cls: 'nw-h4-section' });

        const catTable = section.createEl('table', {
            cls: 'nw-st-table'
        });
        const thead = catTable.createEl('thead');
        const headRow = thead.createEl('tr');
        [t('settings.general.colCategory'), t('settings.general.colCount'), t('settings.general.colTotalDuration'), t('settings.general.colAvgDuration'), t('settings.general.colPercent')].forEach(h => {
            const th = headRow.createEl('th');
            th.textContent = h;
            th.addClass('nw-settings-table-th');
        });
        const tbody = catTable.createEl('tbody');
        for (const [cat, stats] of Object.entries(categoryStats)) {
            if (stats.count === 0) continue;
            const row = tbody.createEl('tr');
            const percent = totals.totalDuration > 0 ? ((stats.totalDuration / totals.totalDuration) * 100).toFixed(1) + '%' : '0%';
            [cat, stats.count.toString(), this.formatDuration(stats.totalDuration), this.formatDuration(stats.avgDuration), percent].forEach((v, i) => {
                const td = row.createEl('td');
                td.textContent = v;
                td.addClass('nw-settings-table-td');
                if (i === 0) td.addClass('nw-settings-table-first');
            });
        }

        section.createEl('h4', { text: t('settings.general.perfSlowTitle'), cls: 'nw-h4-section' });

        if (slowOps.length === 0) {
            section.createDiv({
                text: t('settings.general.perfNoSlow'),
                cls: 'nw-empty-info-card'
            });
        } else {
            const slowList = section.createDiv({
                cls: 'nw-st-scroll-box'
            });
            for (const op of slowOps.slice(0, 20)) {
                const item = slowList.createDiv({
                    cls: 'nw-st-scroll-item'
                });
                const top = item.createDiv({ cls: 'nw-st-row' });
                top.createSpan({ text: op.name, cls: 'nw-st-strong' });
                top.createSpan({
                    text: this.formatDuration(op.duration),
                    cls: 'nw-st-duration'
                });
                const bottom = item.createDiv({
                    text: t('settings.general.perfSlowMeta', {
                        category: op.category,
                        time: new Date(op.timestamp).toLocaleString(),
                        threshold: this.formatDuration(op.threshold),
                    }),
                    cls: 'nw-st-meta'
                });
            }
        }

        section.createEl('h4', { text: t('settings.general.perfLogTitle'), cls: 'nw-h4-section' });

        if (log.length === 0) {
            section.createDiv({
                text: t('settings.general.perfNoData'),
                cls: 'nw-empty-info-card'
            });
        } else {
            const logContainer = section.createDiv({
                cls: 'nw-st-scroll-box nw-st-scroll-box--tall nw-st-scroll-box--mono'
            });
            for (const entry of log.slice(0, 50)) {
                const item = logContainer.createDiv({
                    cls: 'nw-st-log-item'
                });
                const left = item.createSpan();
                left.textContent = `[${entry.category}] ${entry.name}`;
                const right = item.createSpan({
                    cls: 'nw-st-muted-nowrap'
                });
                right.textContent = this.formatDuration(entry.duration);
            }
        }

        section.createEl('h4', { text: t('settings.general.perfActions'), cls: 'nw-h4-section' });

        const btnRow = section.createDiv({
            cls: 'nw-st-btn-row'
        });

        const reportBtn = btnRow.createEl('button', {
            text: t('settings.general.perfReport'),
            cls: 'nw-st-btn nw-st-btn--primary nw-st-btn--fw500',
            attr: { type: 'button' }
        });
        reportBtn.onclick = () => {
            const report = performanceMonitor.generateTextReport(cacheStats);
            this.showPerformanceReport(report);
        };

        const exportBtn = btnRow.createEl('button', {
            text: t('settings.general.perfExport'),
            cls: 'nw-st-btn',
            attr: { type: 'button' }
        });
        exportBtn.onclick = async () => {
            const json = performanceMonitor.exportLog();
            await exportTextFile(this.app, `performance-log-${new Date().toISOString().slice(0, 10)}.json`, json, {
                mime: 'application/json',
                successMessage: t('settings.general.perfExported'),
            });
        };

        const clearBtn = btnRow.createEl('button', {
            text: t('settings.general.perfClear'),
            cls: 'nw-st-btn nw-st-btn--danger',
            attr: { type: 'button' }
        });
        clearBtn.onclick = async () => {
            const confirmed = await OperationConfirmModal.confirm(this.app, {
                title: t('settings.general.perfClearTitle'),
                description: t('settings.general.perfClearDesc'),
                warning: t('settings.general.perfClearWarning'),
                confirmText: t('settings.general.perfClearConfirm'),
                cancelText: t('common.cancel'),
            });
            if (confirmed) {
                performanceMonitor.clearLog();
                this.refresh();
                showSuccessNotice(t('settings.general.perfCleared'), { timeout: 2000 });
            }
        };

        const refreshBtn = btnRow.createEl('button', {
            text: t('settings.general.perfRefresh'),
            cls: 'nw-st-btn',
            attr: { type: 'button' }
        });
        refreshBtn.onclick = () => {
            this.refresh();
        };
    }

    private addStatCard(container: HTMLElement, label: string, value: string): void {
        const card = container.createDiv({
            cls: 'nw-st-stat-card'
        });
        card.createDiv({
            text: label,
            cls: 'nw-st-stat-label'
        });
        card.createDiv({
            text: value,
            cls: 'nw-st-stat-value'
        });
    }

    private showPerformanceReport(report: string): void {
        const modal = new Modal(this.app);
        modal.modalEl.addClass('nw-scope');
        modal.modalEl.addClass('nw-modal');
        const { contentEl } = modal;
        contentEl.empty();
        contentEl.createEl('h3', { text: t('settings.general.reportTitle') });
        const textarea = contentEl.createEl('textarea', {
            cls: 'nw-st-report-textarea',
            attr: { readonly: 'readonly' }
        });
        textarea.value = report;
        const btnRow = contentEl.createDiv({
            cls: 'nw-st-btn-row nw-st-btn-row--end'
        });
        const copyBtn = btnRow.createEl('button', {
            text: t('settings.general.reportCopy'),
            cls: 'nw-st-btn nw-st-btn--primary',
            attr: { type: 'button' }
        });
        copyBtn.onclick = async () => {
            try {
                await copyText(report);
                showSuccessNotice(t('settings.general.reportCopied'), { timeout: 2000 });
            } catch {
                showErrorNotice(t('settings.general.reportCopyFailed'), { timeout: 2000 });
            }
        };
        const closeBtn = btnRow.createEl('button', {
            text: t('common.close'),
            cls: 'nw-st-btn',
            attr: { type: 'button' }
        });
        closeBtn.onclick = () => modal.close();
        modal.open();
    }

    private formatDuration(ms: number): string {
        return formatPerfDuration(ms);
    }

    private formatBytes(bytes: number): string {
        return formatByteSize(bytes);
    }

    /**
     * 供宿主 `display()` 调用：更新提示条不属于任何 tab，需在 tab 栏之前渲染
     *
     * @param container - 容器元素
     */
    renderBanner(container: HTMLElement): void {
        this.renderUpdateBanner(container);
    }

    private renderUpdateBanner(container: HTMLElement): void {
        try {
            const cacheManager = this.plugin.engineRegistry.getOrNull(ENGINE_NAMES.CACHE_MANAGER);
            if (!cacheManager) return;

            const lastResult = cacheManager.getUpdateLastResult() as UpdateCheckResult | null;
            if (!lastResult?.hasUpdate || !lastResult.latestVersion) return;

            const latestVersion = lastResult.latestVersion;
            const updateChecker = this.plugin.engineRegistry.getOrNull(ENGINE_NAMES.UPDATE_CHECKER);
            if (updateChecker && updateChecker.hasNotifiedVersion(latestVersion)) return;

            const banner = container.createDiv({
                cls: 'nw-st-update-banner'
            });

            const left = banner.createDiv({ cls: 'nw-st-update-left' });
            left.createDiv({
                text: t('settings.general.bannerFound', { version: latestVersion }),
                cls: 'nw-st-update-title'
            });
            left.createDiv({
                text: lastResult.releaseNotes
                    ? lastResult.releaseNotes.substring(0, 80) + (lastResult.releaseNotes.length > 80 ? '...' : '')
                    : t('settings.general.bannerHint'),
                cls: 'nw-st-update-note'
            });

            const right = banner.createDiv({ cls: 'nw-st-update-actions' });

            const detailBtn = right.createEl('button', {
                text: t('settings.general.bannerDetails'),
                cls: 'nw-st-banner-btn',
                attr: { type: 'button' }
            });
            detailBtn.addEventListener('click', () => {
                new ChangelogModal(this.app, {
                    highlightVersion: latestVersion,
                }).open();
            });

            const laterBtn = right.createEl('button', {
                text: t('settings.general.bannerLater'),
                cls: 'nw-st-banner-btn nw-st-banner-btn--ghost',
                attr: { type: 'button' }
            });
            laterBtn.addEventListener('click', () => {
                if (updateChecker) {
                    updateChecker.markUpdateNotified(latestVersion);
                }
                this.reopen();
            });
        } catch { // silent-ok: 更新横幅（装饰性：读失败就不显示横幅）
        }
    }
}

/**
 * 写作规则设置分区。
 */
export class RulesSection extends SettingsSection {
    /**
     * 渲染该设置分区。
     *
     * @param container - 容器元素
     */
    async render(container: HTMLElement): Promise<void> {
        const section = container.createEl('section');
        await this.mountRulesSection(section);
        // 语义关键词兜底属于规则层配置，随分区渲染（原来由宿主注入 → 弹窗缺失）
        this.renderRuleKeywords(container);
    }

    /**
     * 渲染「关键词兜底」设置（规则层用）。
     *
     * 内置词表没覆盖某个说法时用户可追加；只影响「词表兜底」层，不改变结构化判定。
     *
     * @param container - 容器元素
     */
    private renderRuleKeywords(container: HTMLElement): void {
        const overrides = this.plugin.settings.semanticKeywordOverrides ?? {};
        const section = container.createDiv({ cls: 'nw-settings-section' });
        new Setting(section)
            .setName(t('settings.general.rulesKeywordTitle'))
            .setDesc(t('settings.general.rulesKeywordDesc'))
            .setHeading();
        const fields: Array<{
            key: keyof NonNullable<typeof overrides>;
            name: string;
            hint: string;
        }> = [
            { key: 'injury', name: t('settings.general.kwInjury'), hint: t('settings.general.kwInjuryHint') },
            { key: 'action', name: t('settings.general.kwAction'), hint: t('settings.general.kwActionHint') },
            { key: 'modern', name: t('settings.general.kwModern'), hint: t('settings.general.kwModernHint') },
            { key: 'location', name: t('settings.general.kwLocation'), hint: t('settings.general.kwLocationHint') },
            { key: 'drastic', name: t('settings.general.kwDrastic'), hint: t('settings.general.kwDrasticHint') },
        ];
        for (const field of fields) {
            new Setting(section)
                .setName(field.name)
                .addTextArea(text => text
                    .setPlaceholder(field.hint)
                    .setValue((overrides[field.key] ?? []).join(', '))
                    .onChange(async value => {
                        const words = value.split(/[,，\s]+/).map(word => word.trim()).filter(Boolean);
                        const next = { ...(this.plugin.settings.semanticKeywordOverrides ?? {}) };
                        next[field.key] = words;
                        this.plugin.settings.semanticKeywordOverrides = next;
                        await this.plugin.saveSettings();
                    }));
        }
    }

    /**
     * 渲染规则版本检查内容到指定容器。
     *
     * 「重新检查」必须只重绘本容器：旧实现直接调用 renderRulesSection()，
     * 而该方法每次都会往 tabContent 追加一个新的 section，导致每点一次
     * 就多出一整块重复模块。
     */
    private async mountRulesSection(section: HTMLElement): Promise<void> {
        section.empty();
        section.createEl('h3', { text: t('settings.general.rulesTitle'), cls: 'nw-st-heading--flush' });

        section.createEl('p', {
            text: t('settings.general.rulesLead'),
            cls: 'nw-st-lead--spaced'
        });

        const statusCard = section.createDiv({
            cls: 'nw-st-card'
        });

        try {
            const rulesService = RulesService.getInstance(this.app);
            const info = await rulesService.checkRulesVersion();
            const isPresent = await rulesService.isRulesFilePresent();

            const statusRow0 = statusCard.createDiv({ cls: 'nw-status-row' });
            statusRow0.createDiv({ text: t('settings.general.rulesSourceLabel'), cls: 'nw-status-label' });
            statusRow0.createDiv({
                text: isPresent ? info.sourcePath : t('settings.general.rulesMissingSource'),
                cls: 'nw-st-mono',
            });

            const statusRow1 = statusCard.createDiv({ cls: 'nw-status-row' });
            statusRow1.createDiv({ text: t('settings.general.rulesVersionLabel'), cls: 'nw-status-label' });
            statusRow1.createDiv({ text: `v${info.version}`, cls: 'nw-st-mono' });

            const statusRow2 = statusCard.createDiv({ cls: 'nw-status-row' });
            statusRow2.createDiv({ text: t('settings.general.rulesModeLabel'), cls: 'nw-status-label' });
            statusRow2.createDiv({ text: t('settings.general.rulesModeHint'), cls: 'nw-st-fs12' });

            if (!isPresent) {
                section.createDiv({
                    text: t('settings.general.rulesMissingFile'),
                    cls: 'nw-st-notice nw-st-notice--warning'
                });
            } else {
                section.createDiv({
                    text: t('settings.general.rulesReady'),
                    cls: 'nw-st-notice nw-st-notice--success'
                });
            }

        const actions = section.createDiv({ cls: 'nw-settings-actions' });

            const refreshBtn = actions.createEl('button', {
                text: t('settings.general.rulesRecheck'),
                cls: 'nw-btn nw-btn-secondary',
                attr: { type: 'button' },
            });
            refreshBtn.addEventListener('click', async () => {
                if (refreshBtn.disabled) return;
                refreshBtn.disabled = true;
                refreshBtn.setText(t('settings.general.rulesChecking'));
                rulesService.invalidateCache();
                // 只重绘本容器，不追加新模块
                await this.mountRulesSection(section);
            });

            const viewBtn = actions.createEl('button', {
                text: t('settings.general.rulesView'),
                cls: 'nw-btn nw-btn-primary',
                attr: { type: 'button' },
            });
            viewBtn.addEventListener('click', async () => {
                const rules = await rulesService.getWritingRules();
                const modal = new (class extends Modal {
                    constructor(app: App) { super(app); }
                    onOpen() {
                        const { contentEl } = this;
                        contentEl.createEl('h3', { text: t('settings.general.rulesContentTitle') });
                        const textarea = contentEl.createEl('textarea', {
                            cls: 'nw-st-code-textarea'
                        });
                        textarea.value = rules;
                    }
                })(this.app);
                modal.open();
            });

            const openBtn = actions.createEl('button', {
                text: t('settings.general.rulesOpen'),
                cls: 'nw-btn nw-btn-secondary',
                attr: { type: 'button' },
            });
            openBtn.addEventListener('click', async () => {
                const { VAULT_RULES_PATH } = await import('@/services/rules-registry');
                const file = this.app.vault.getAbstractFileByPath(VAULT_RULES_PATH);
                if (file instanceof TFile) {
                    await this.app.workspace.getLeaf('tab').openFile(file);
                } else {
                    showWarningNotice(t('settings.general.rulesMissingWarn'), { timeout: 4000 });
                }
            });

        } catch (e) {
            statusCard.createDiv({
                text: t('settings.general.rulesCheckFailed', { message: (e as Error).message }),
                cls: 'nw-text-error'
            });
        }

        new Setting(section)
            .setName(t('settings.general.rulesExperimentName'))
            .setDesc(t('settings.general.rulesExperimentDesc'))
            .addText((text) => text
                .setPlaceholder(t('settings.general.rulesExperimentPlaceholder'))
                .setValue(this.plugin.settings.experimentGroup || '')
                .onChange(async (value) => {
                    this.plugin.settings.experimentGroup = value.trim().slice(0, 60);
                    await this.plugin.saveSettings();
                }));
    }
}

/**
 * 关于分区。
 */
export class AboutSection extends SettingsSection {
    /**
     * 渲染该设置分区。
     *
     * @param container - 容器元素
     */
    render(container: HTMLElement): void {
        const section = container.createEl('section');

        section.createEl('h3', { text: t('settings.general.aboutTitle'), cls: 'nw-st-heading--flush' });

        const currentVersion = PLUGIN_VERSION;

        const versionCard = section.createDiv({
            cls: 'nw-st-card nw-st-card--center'
        });

        versionCard.createDiv({
            text: t('settings.general.aboutCurrentVersion'),
            cls: 'nw-st-label'
        });
        versionCard.createDiv({
            text: `v${currentVersion}`,
            cls: 'nw-st-version'
        });

        let lastCheckInfo = t('settings.general.aboutNever');
        let latestVersionInfo = '—';
        try {
            const cacheManager = this.plugin.engineRegistry.getOrNull(ENGINE_NAMES.CACHE_MANAGER);
            if (cacheManager) {
                const lastCheck = cacheManager.getUpdateLastCheck();
                if (lastCheck) {
                    lastCheckInfo = new Date(lastCheck).toLocaleString('zh-CN');
                }
                const lastResult = cacheManager.getUpdateLastResult() as UpdateCheckResult | null;
                if (lastResult?.latestVersion) {
                    latestVersionInfo = `v${lastResult.latestVersion}` + (lastResult.hasUpdate ? t('settings.general.aboutHasUpdate') : t('settings.general.aboutIsLatest'));
                    if (lastResult.error) {
                        const at = lastResult.lastSuccessAt || lastResult.checkedAt;
                        latestVersionInfo += t('settings.general.aboutLastSuccess', {
                            time: at ? new Date(at).toLocaleString('zh-CN') : '',
                        });
                    }
                } else if (lastResult?.error) {
                    latestVersionInfo = t('settings.general.aboutCheckFailedVersion', { error: lastResult.error });
                }
            }
        } catch { // silent-ok: 版本信息（装饰性：读失败就只显示版本号）
        }

        const infoGrid = versionCard.createDiv({
            cls: 'nw-st-info-grid'
        });

        this.renderInfoItem(infoGrid, t('settings.general.aboutLatestVersion'), latestVersionInfo);
        this.renderInfoItem(infoGrid, t('settings.general.aboutLastCheck'), lastCheckInfo);

        const btnRow = section.createDiv({
            cls: 'nw-st-btn-row nw-st-btn-row--mb24'
        });

        const checkBtn = btnRow.createEl('button', {
            text: t('settings.general.aboutCheck'),
            cls: 'nw-st-btn nw-st-btn--primary nw-st-btn--lg nw-st-btn--fw500',
            attr: { type: 'button' }
        });
        checkBtn.addEventListener('click', async () => {
            checkBtn.disabled = true;
            checkBtn.textContent = t('settings.general.aboutChecking');
            try {
                const updateChecker = this.plugin.engineRegistry.getOrNull(ENGINE_NAMES.UPDATE_CHECKER);
                if (updateChecker) {
                    const result = await updateChecker.checkForUpdates(true);
                    if (result.hasUpdate) {
                        new Notice(t('settings.general.aboutNewVersion', { version: result.latestVersion ?? '' }), 4000);
                    } else if (result.error && result.latestVersion) {
                        showWarningNotice(
                            t('settings.general.aboutCheckFailedKept', { version: result.latestVersion, error: result.error }),
                            { title: t('settings.general.aboutCheckFailedTitle'), timeout: 6000 },
                        );
                    } else if (result.error) {
                        showErrorNotice(t('settings.general.aboutCheckFailed', { error: result.error }), { title: t('settings.general.aboutCheckFailedTitle'), timeout: 5000 });
                    } else {
                        showSuccessNotice(t('settings.general.aboutUpToDate'), { timeout: 2000 });
                    }
                }
            } catch {
                showErrorNotice(t('settings.general.aboutUpdateFailed'), { timeout: 2000 });
            }
            checkBtn.disabled = false;
            checkBtn.textContent = t('settings.general.aboutCheck');
            this.refresh();
        });

        const changelogBtn = btnRow.createEl('button', {
            text: t('settings.general.aboutChangelog'),
            cls: 'nw-st-btn nw-st-btn--lg nw-st-btn--bg-primary',
            attr: { type: 'button' }
        });
        changelogBtn.addEventListener('click', () => {
            new ChangelogModal(this.app, {
                highlightVersion: currentVersion,
            }).open();
        });

        // 支持作者（2026-11-09 用户要求）：独立卡片 + 放大按钮，点开直接展示支付宝收钱码
        // （账号方式已作废；插件不发起支付、不读取支付信息）。
        const supportCard = section.createDiv({ cls: 'nw-support-author-card' });
        supportCard.createEl('h4', { text: t('settings.general.aboutSupport'), cls: 'nw-support-author-title' });
        supportCard.createEl('p', {
            text: t('settings.general.aboutSupportDesc'),
            cls: 'nw-support-author-desc',
        });
        const supportBtn = supportCard.createEl('button', {
            text: t('settings.general.aboutSupportBtn'),
            cls: 'nw-btn nw-btn-primary nw-support-author-btn',
        });
        supportBtn.addEventListener('click', () => new SupportAuthorModal(this.app).open());

        // 热重载：Obsidian 政策禁止插件自行 disable/enable 自身，所以按钮只做
        // 「保存 + 把工作台状态写进 sessionStorage + 提示手动切换」。
        // 原实现放在设置页最底部（任何 tab 都能看到、且是红色内联样式），位置不合理，移到这里。
        section.createEl('h4', { text: t('settings.general.aboutMaintenance'), cls: 'nw-st-h4--spaced' });
        new Setting(section)
            .setName(t('settings.general.aboutReloadName'))
            .setDesc(t('settings.general.aboutReloadDesc'))
            .addButton(button => button
                .setButtonText(t('settings.general.aboutReloadBtn'))
                .onClick(async () => {
                    await this.plugin.saveSettings();
                    const leaves = this.app.workspace.getLeavesOfType('novel-writer-full-writer');
                    if (leaves.length > 0) {
                        const view = leaves[0].view as unknown as { project?: string; chapterName?: string; volume?: string; chapDir?: string };
                        const pending = {
                            project: view.project || '',
                            chapterFileName: view.chapterName || '',
                            volume: view.volume || '',
                            chapDir: view.chapDir || '',
                        };
                        this.plugin._pendingReloadState = pending;
                        // 新实例拿不到旧实例的内存字段，必须落到 sessionStorage（读取即删）
                        if (pending.project) savePendingReloadState(pending);
                    }
                    new Notice(t('settings.general.aboutReloadNotice'), 6000);
                }));

        section.createEl('h4', { text: t('settings.general.aboutUpdateTitle'), cls: 'nw-st-h4--spaced' });

        new Setting(section)
            .setName(t('settings.general.aboutAutoName'))
            .setDesc(t('settings.general.aboutAutoDesc'))
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.autoCheckUpdates ?? false)
                .onChange(async (value) => {
                    this.plugin.settings.autoCheckUpdates = value;
                    await this.plugin.saveSettings();
                    const updateChecker = this.plugin.engineRegistry.getOrNull(ENGINE_NAMES.UPDATE_CHECKER);
                    if (updateChecker) {
                        updateChecker.updateConfig({ enabled: value });
                    }
                    this.refresh();
                })
            );

        const updateSourceSetting = new Setting(section)
            .setName(t('settings.general.aboutSourceName'))
            .setDesc(t('settings.general.aboutSourceDesc'))
            .addDropdown(dropdown => {
                dropdown.addOption('github', 'GitHub Releases');
                dropdown.addOption('custom', t('settings.general.aboutCustomServer'));
                dropdown.setValue(this.plugin.settings.updateSource || 'github');
                dropdown.onChange(async (value) => {
                    this.plugin.settings.updateSource = value as 'github' | 'custom';
                    await this.plugin.saveSettings();
                    const updateChecker = this.plugin.engineRegistry.getOrNull(ENGINE_NAMES.UPDATE_CHECKER);
                    if (updateChecker) {
                        updateChecker.updateConfig({ source: value as 'github' | 'custom' });
                    }
                    this.refresh();
                });
            });

        if (this.plugin.settings.updateSource === 'github') {
            new Setting(section)
                .setName(t('settings.general.aboutRepoName'))
                .setDesc(t('settings.general.aboutRepoDesc', { branch: GITHUB_BRANCH }))
                .addText(text => text
                    .setPlaceholder(GITHUB_REPO_SLUG)
                    .setValue(this.plugin.settings.updateGithubRepo || GITHUB_REPO_SLUG)
                    .onChange(async (value) => {
                        this.plugin.settings.updateGithubRepo = value;
                        await this.plugin.saveSettings();
                        const updateChecker = this.plugin.engineRegistry.getOrNull(ENGINE_NAMES.UPDATE_CHECKER);
                        if (updateChecker) {
                            updateChecker.updateConfig({ githubRepo: value });
                            updateChecker.clearCache?.();
                        }
                    })
                );
            new Setting(section)
                .setName(t('settings.general.aboutTokenName'))
                .setDesc(t('settings.general.aboutTokenDesc'))
                .addText(text => {
                    text.inputEl.type = 'password';
                    // S3-14：Token 框禁止自动填充/密码管理器接管
                    text.inputEl.setAttribute('autocomplete', 'new-password');
                    text.inputEl.setAttribute('data-1p-ignore', 'true');
                    text.inputEl.setAttribute('data-lpignore', 'true');
                    // S3-15：口令未解锁时设置里是 `aes256v2:...` 密文，不能回填成输入值
                    // （既不安全，也会让用户把密文当令牌再存一次）。此时留空并说明状态。
                    const storedToken = this.plugin.settings.updateGithubToken || '';
                    const tokenLocked = isStoredCiphertext(storedToken);
                    text.setPlaceholder(tokenLocked
                        ? t('settings.general.aboutTokenSaved')
                        : t('settings.general.aboutTokenPlaceholder'))
                        .setValue(tokenLocked ? '' : storedToken)
                        .onChange(async (value) => {
                            const next = value.trim();
                            // 空输入且原先已保存密文：视为「未改动」，保留原密文
                            if (!next && tokenLocked) return;
                            this.plugin.settings.updateGithubToken = next;
                            await this.plugin.saveSettings();
                            const updateChecker = this.plugin.engineRegistry.getOrNull(ENGINE_NAMES.UPDATE_CHECKER);
                            if (updateChecker) {
                                updateChecker.updateConfig({ githubToken: next });
                                updateChecker.clearCache?.();
                            }
                        });
                });

        } else {
            new Setting(section)
                .setName(t('settings.general.aboutCustomUrlName'))
                .setDesc(t('settings.general.aboutCustomUrlDesc'))
                .addText(text => text
                    .setPlaceholder('https://example.com/version.json')
                    .setValue(this.plugin.settings.updateCustomUrl || '')
                    .onChange(async (value) => {
                        this.plugin.settings.updateCustomUrl = value;
                        await this.plugin.saveSettings();
                        const updateChecker = this.plugin.engineRegistry.getOrNull(ENGINE_NAMES.UPDATE_CHECKER);
                        if (updateChecker) {
                            updateChecker.updateConfig({ customUrl: value });
                        }
                    })
                );
        }

        new Setting(section)
            .setName(t('settings.general.aboutIntervalName'))
            .setDesc(t('settings.general.aboutIntervalDesc'))
            .addDropdown(dropdown => {
                const options: Record<string, string> = {
                    '24': t('settings.general.aboutIntervalDay'),
                    '72': t('settings.general.aboutInterval3Days'),
                    '168': t('settings.general.aboutIntervalWeek'),
                    '720': t('settings.general.aboutIntervalMonth'),
                };
                for (const [k, v] of Object.entries(options)) {
                    dropdown.addOption(k, v);
                }
                dropdown.setValue(String(this.plugin.settings.updateCheckIntervalHours || 168));
                dropdown.onChange(async (value) => {
                    this.plugin.settings.updateCheckIntervalHours = parseInt(value, 10);
                    await this.plugin.saveSettings();
                    const updateChecker = this.plugin.engineRegistry.getOrNull(ENGINE_NAMES.UPDATE_CHECKER);
                    if (updateChecker) {
                        updateChecker.updateConfig({ checkIntervalHours: parseInt(value, 10) });
                    }
                });
            });

        section.createEl('h4', { text: t('settings.general.aboutPluginTitle'), cls: 'nw-st-h4--gap' });

        const aboutCard = section.createDiv({
            cls: 'nw-st-about-card'
        });

        aboutCard.createEl('p', {
            text: t('settings.general.aboutTagline'),
            cls: 'nw-st-about-p'
        });

        aboutCard.createDiv({ text: t('settings.general.aboutAuthor'), cls: 'nw-st-about-line' });
        aboutCard.createDiv({ text: t('settings.general.aboutLicense'), cls: 'nw-st-about-line' });
    }

    private renderInfoItem(container: HTMLElement, label: string, value: string): void {
        const item = container.createDiv({
            cls: 'nw-st-info-item'
        });
        item.createDiv({
            text: label,
            cls: 'nw-st-info-label'
        });
        item.createDiv({
            text: value,
            cls: 'nw-st-info-value'
        });
    }
}

/**
 * 实体识别设置分区。
 */
export class RecognitionSection extends SettingsSection {
    /**
     * 渲染该设置分区。
     *
     * @param container - 容器元素
     */
    render(container: HTMLElement): void {
        const section = container.createEl('section');

        section.createEl('h3', { text: t('settings.general.recTitle') });
        section.createEl('p', {
            text: t('settings.general.recLead'),
            cls: 'setting-item-description'
        });

        section.createEl('h4', { text: t('settings.general.recLayers'), cls: 'nw-st-h4--section-first' });

        const layers = this.plugin.settings.characterRecognitionLayers || ['rule', 'vector'];

        new Setting(section)
            .setName(t('settings.general.recRuleName'))
            .setDesc(t('settings.general.recRuleDesc'))
            .addToggle(toggle => toggle
                .setValue(layers.includes('rule'))
                .onChange(async (value) => {
                    const current = [...(this.plugin.settings.characterRecognitionLayers || [])];
                    if (value && !current.includes('rule')) {
                        current.push('rule');
                    } else if (!value) {
                        const idx = current.indexOf('rule');
                        if (idx > -1) current.splice(idx, 1);
                    }
                    this.plugin.settings.characterRecognitionLayers = current;
                    await this.plugin.saveSettings();
                }));

        new Setting(section)
            .setName(t('settings.general.recVectorName'))
            .setDesc(t('settings.general.recVectorDesc'))
            .addToggle(toggle => toggle
                .setValue(layers.includes('vector'))
                .onChange(async (value) => {
                    const current = [...(this.plugin.settings.characterRecognitionLayers || [])];
                    if (value && !current.includes('vector')) {
                        current.push('vector');
                    } else if (!value) {
                        const idx = current.indexOf('vector');
                        if (idx > -1) current.splice(idx, 1);
                    }
                    this.plugin.settings.characterRecognitionLayers = current;
                    await this.plugin.saveSettings();
                }));

        new Setting(section)
            .setName(t('settings.general.recLlmName'))
            .setDesc(t('settings.general.recLlmDesc'))
            .addToggle(toggle => toggle
                .setValue(layers.includes('llm'))
                .onChange(async (value) => {
                    const current = [...(this.plugin.settings.characterRecognitionLayers || [])];
                    if (value && !current.includes('llm')) {
                        const confirmed = await OperationConfirmModal.confirm(this.app, {
                            title: t('settings.general.recLlmConfirmTitle'),
                            description: t('settings.general.recLlmConfirmDesc'),
                            confirmText: t('settings.general.recConfirmEnable'),
                            cancelText: t('common.cancel'),
                        });
                        if (!confirmed) {
                            return;
                        }
                        current.push('llm');
                    } else if (!value) {
                        const idx = current.indexOf('llm');
                        if (idx > -1) current.splice(idx, 1);
                    }
                    this.plugin.settings.characterRecognitionLayers = current;
                    await this.plugin.saveSettings();
                    this.refresh();
                }));

        const ruleLayer = this.plugin.settings.ruleLayer || {
            minMentionCount: 5,
            enableFreqFilter: true,
            enableContextCheck: true,
            enableVerbFilter: true,
        };

        section.createEl('h4', { text: t('settings.general.recRulesTitle'), cls: 'nw-st-h4--section' });

        new Setting(section)
            .setName(t('settings.general.recMinMentionsName'))
            .setDesc(t('settings.general.recMinMentionsDesc'))
            .addText(text => text
                .setPlaceholder('5')
                .setValue(String(ruleLayer.minMentionCount))
                .onChange(async (value) => {
                    const num = parseInt(value, 10);
                    if (!isNaN(num) && num > 0) {
                        this.plugin.settings.ruleLayer = {
                            ...this.plugin.settings.ruleLayer!,
                            minMentionCount: num,
                        };
                        await this.plugin.saveSettings();
                    }
                }));

        new Setting(section)
            .setName(t('settings.general.recFreqName'))
            .setDesc(t('settings.general.recFreqDesc'))
            .addToggle(toggle => toggle
                .setValue(ruleLayer.enableFreqFilter)
                .onChange(async (value) => {
                    this.plugin.settings.ruleLayer = {
                        ...this.plugin.settings.ruleLayer!,
                        enableFreqFilter: value,
                    };
                    await this.plugin.saveSettings();
                }));

        new Setting(section)
            .setName(t('settings.general.recContextName'))
            .setDesc(t('settings.general.recContextDesc'))
            .addToggle(toggle => toggle
                .setValue(ruleLayer.enableContextCheck)
                .onChange(async (value) => {
                    this.plugin.settings.ruleLayer = {
                        ...this.plugin.settings.ruleLayer!,
                        enableContextCheck: value,
                    };
                    await this.plugin.saveSettings();
                }));

        new Setting(section)
            .setName(t('settings.general.recVerbName'))
            .setDesc(t('settings.general.recVerbDesc'))
            .addToggle(toggle => toggle
                .setValue(ruleLayer.enableVerbFilter)
                .onChange(async (value) => {
                    this.plugin.settings.ruleLayer = {
                        ...this.plugin.settings.ruleLayer!,
                        enableVerbFilter: value,
                    };
                    await this.plugin.saveSettings();
                }));

        const vectorLayer = this.plugin.settings.vectorLayer || {
            enabled: true,
            semanticFilterThreshold: 0.5,
            mergeSimilarityThreshold: 0.85,
        };

        section.createEl('h4', { text: t('settings.general.recVectorTitle'), cls: 'nw-st-h4--section' });

        new Setting(section)
            .setName(t('settings.general.recVectorEnableName'))
            .setDesc(t('settings.general.recVectorEnableDesc'))
            .addToggle(toggle => toggle
                .setValue(vectorLayer.enabled)
                .onChange(async (value) => {
                    this.plugin.settings.vectorLayer = {
                        ...this.plugin.settings.vectorLayer!,
                        enabled: value,
                    };
                    await this.plugin.saveSettings();
                    this.refresh();
                }));

        if (vectorLayer.enabled) {
            new Setting(section)
                .setName(t('settings.general.recSemanticName'))
                .setDesc(t('settings.general.recSemanticDesc', { value: vectorLayer.semanticFilterThreshold.toFixed(2) }))
                .addSlider(slider => {
                    slider.setLimits(0, 1, 0.01);
                    slider.setValue(vectorLayer.semanticFilterThreshold);
                    slider.setDynamicTooltip();
                    slider.onChange(async (value) => {
                        this.plugin.settings.vectorLayer = {
                            ...this.plugin.settings.vectorLayer!,
                            semanticFilterThreshold: value,
                        };
                        await this.plugin.saveSettings();
                    });
                });

            new Setting(section)
                .setName(t('settings.general.recMergeName'))
                .setDesc(t('settings.general.recMergeDesc', { value: vectorLayer.mergeSimilarityThreshold.toFixed(2) }))
                .addSlider(slider => {
                    slider.setLimits(0, 1, 0.01);
                    slider.setValue(vectorLayer.mergeSimilarityThreshold);
                    slider.setDynamicTooltip();
                    slider.onChange(async (value) => {
                        this.plugin.settings.vectorLayer = {
                            ...this.plugin.settings.vectorLayer!,
                            mergeSimilarityThreshold: value,
                        };
                        await this.plugin.saveSettings();
                    });
                });
        }

        const llmLayer = this.plugin.settings.llmLayer || {
            enabled: false,
            verifyBatchSize: 20,
            titleBatchSize: 8,
            minConfidence: 0.3,
        };

        section.createEl('h4', { text: t('settings.general.recLlmTitle'), cls: 'nw-st-h4--section' });

        new Setting(section)
            .setName(t('settings.general.recLlmEnableName'))
            .setDesc(t('settings.general.recLlmEnableDesc'))
            .addToggle(toggle => toggle
                .setValue(llmLayer.enabled)
                .onChange(async (value) => {
                    if (value) {
                        const confirmed = await OperationConfirmModal.confirm(this.app, {
                            title: t('settings.general.recLlmConfirmTitle'),
                            description: t('settings.general.recLlmConfirmDesc'),
                            confirmText: t('settings.general.recConfirmEnable'),
                            cancelText: t('common.cancel'),
                        });
                        if (!confirmed) return;
                    }
                    this.plugin.settings.llmLayer = {
                        ...this.plugin.settings.llmLayer!,
                        enabled: value,
                    };
                    await this.plugin.saveSettings();
                    this.refresh();
                }));

        if (llmLayer.enabled) {
            new Setting(section)
                .setName(t('settings.general.recVerifyBatchName'))
                .setDesc(t('settings.general.recVerifyBatchDesc'))
                .addText(text => text
                    .setPlaceholder('20')
                    .setValue(String(llmLayer.verifyBatchSize))
                    .onChange(async (value) => {
                        const num = parseInt(value, 10);
                        if (!isNaN(num) && num > 0) {
                            this.plugin.settings.llmLayer = {
                                ...this.plugin.settings.llmLayer!,
                                verifyBatchSize: num,
                            };
                            await this.plugin.saveSettings();
                        }
                    }));

            new Setting(section)
                .setName(t('settings.general.recTitleBatchName'))
                .setDesc(t('settings.general.recTitleBatchDesc'))
                .addText(text => text
                    .setPlaceholder('8')
                    .setValue(String(llmLayer.titleBatchSize))
                    .onChange(async (value) => {
                        const num = parseInt(value, 10);
                        if (!isNaN(num) && num > 0) {
                            this.plugin.settings.llmLayer = {
                                ...this.plugin.settings.llmLayer!,
                                titleBatchSize: num,
                            };
                            await this.plugin.saveSettings();
                        }
                    }));

            new Setting(section)
                .setName(t('settings.general.recConfidenceName'))
                .setDesc(t('settings.general.recConfidenceDesc', { value: llmLayer.minConfidence.toFixed(2) }))
                .addSlider(slider => {
                    slider.setLimits(0, 1, 0.01);
                    slider.setValue(llmLayer.minConfidence);
                    slider.setDynamicTooltip();
                    slider.onChange(async (value) => {
                        this.plugin.settings.llmLayer = {
                            ...this.plugin.settings.llmLayer!,
                            minConfidence: value,
                        };
                        await this.plugin.saveSettings();
                    });
                });
        }
    }
}

/**
 * 建议设置分区。
 */
export class SuggestionsSection extends SettingsSection {
    /**
     * 渲染该设置分区。
     *
     * @param container - 容器元素
     */
    render(container: HTMLElement): void {
        const section = container.createEl('section');

        section.createEl('h3', { text: t('settings.general.sugTitle') });
        section.createEl('p', {
            text: t('settings.general.sugLead'),
            cls: 'setting-item-description'
        });

        const suggestions = this.plugin.settings.suggestions || {
            autoAdoptHighConfidence: false,
            autoAdoptThreshold: 0.9,
            showEvidenceByDefault: false,
            batchAdoptThreshold: 0.7,
        };

        new Setting(section)
            .setName(t('settings.general.sugAutoName'))
            .setDesc(t('settings.general.sugAutoDesc'))
            .addToggle(toggle => toggle
                .setValue(suggestions.autoAdoptHighConfidence)
                .onChange(async (value) => {
                    this.plugin.settings.suggestions = {
                        ...this.plugin.settings.suggestions!,
                        autoAdoptHighConfidence: value,
                    };
                    await this.plugin.saveSettings();
                    this.refresh();
                }));

        if (suggestions.autoAdoptHighConfidence) {
            new Setting(section)
                .setName(t('settings.general.sugAutoThresholdName'))
                .setDesc(t('settings.general.sugAutoThresholdDesc', { value: suggestions.autoAdoptThreshold.toFixed(2) }))
                .addSlider(slider => {
                    slider.setLimits(0.5, 1, 0.01);
                    slider.setValue(suggestions.autoAdoptThreshold);
                    slider.setDynamicTooltip();
                    slider.onChange(async (value) => {
                        this.plugin.settings.suggestions = {
                            ...this.plugin.settings.suggestions!,
                            autoAdoptThreshold: value,
                        };
                        await this.plugin.saveSettings();
                    });
                });
        }

        new Setting(section)
            .setName(t('settings.general.sugEvidenceName'))
            .setDesc(t('settings.general.sugEvidenceDesc'))
            .addToggle(toggle => toggle
                .setValue(suggestions.showEvidenceByDefault)
                .onChange(async (value) => {
                    this.plugin.settings.suggestions = {
                        ...this.plugin.settings.suggestions!,
                        showEvidenceByDefault: value,
                    };
                    await this.plugin.saveSettings();
                }));

        new Setting(section)
            .setName(t('settings.general.sugBatchName'))
            .setDesc(t('settings.general.sugBatchDesc', { value: suggestions.batchAdoptThreshold.toFixed(2) }))
            .addSlider(slider => {
                slider.setLimits(0.5, 1, 0.01);
                slider.setValue(suggestions.batchAdoptThreshold);
                slider.setDynamicTooltip();
                slider.onChange(async (value) => {
                    this.plugin.settings.suggestions = {
                        ...this.plugin.settings.suggestions!,
                        batchAdoptThreshold: value,
                    };
                    await this.plugin.saveSettings();
                });
            });
    }
}
