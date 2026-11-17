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

        section.createEl('h3', { text: '🔒 只读模式' });
        section.createEl('p', { text: '开启后，所有会修改作品的命令（写正文 / 改设定 / 改规划）都会被拒绝，只保留查看、统计、导出。适合审阅或多人协作时防止误改。', cls: 'nw-st-lead' });
        new Setting(section)
            .setName('启用只读模式')
            .setDesc('由动作契约判定（shared/action-contract）：读动作不受影响，写动作会被阻止并提示')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.readOnlyMode === true)
                .onChange(async (value) => {
                    this.plugin.settings.readOnlyMode = value;
                    await this.plugin.saveSettings();
                    this.refresh();
                })
            );

        section.createEl('h3', { text: '📊 性能监控' });
        section.createEl('p', { text: '监控插件关键操作的性能，识别性能瓶颈并优化。', cls: 'nw-st-lead' });

        const perfEnabled = performanceMonitor.isEnabled();
        new Setting(section)
            .setName('启用性能监控')
            .setDesc('开启后将记录关键操作的耗时和内存使用，用于性能分析和优化')
            .addToggle(toggle => toggle
                .setValue(perfEnabled)
                .onChange(value => {
                    performanceMonitor.setEnabled(value);
                    this.refresh();
                })
            );

        // v4.34.0：会话保留清理的用户入口（开关 + 手动命令「🧹 清理旧会话」）
        new Setting(section)
            .setName('启动时清理旧会话')
            .setDesc('Agent 会话与分析会话各保留最近 30 个，当前项目存档不受影响。关闭后仍可手动执行「清理旧会话」命令。')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.sessionRetentionEnabled !== false)
                .onChange(async (value) => {
                    this.plugin.settings.sessionRetentionEnabled = value;
                    await this.plugin.saveSettings();
                })
            );

        if (!performanceMonitor.isEnabled()) {
            section.createEl('div', {
                text: '⚠️  性能监控已关闭',
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

        section.createEl('h4', { text: '📈 概览统计', cls: 'nw-h4-section' });

        const statsGrid = section.createEl('div', {
            cls: 'nw-st-stat-grid'
        });

        const totals = aggregateOperationStats(categoryStats);

        this.addStatCard(statsGrid, '总操作数', totals.totalOps.toString());
        this.addStatCard(statsGrid, '总耗时', this.formatDuration(totals.totalDuration));
        this.addStatCard(statsGrid, '平均耗时', totals.totalOps > 0 ? this.formatDuration(totals.avgDuration) : 'N/A');
        this.addStatCard(statsGrid, '慢操作', slowOps.length.toString());

        if (memoryInfo.current || memoryInfo.peak) {
            this.addStatCard(statsGrid, '当前内存', memoryInfo.current ? this.formatBytes(memoryInfo.current) : 'N/A');
            this.addStatCard(statsGrid, '峰值内存', memoryInfo.peak ? this.formatBytes(memoryInfo.peak) : 'N/A');
        }

        if (cacheStats) {
            this.addStatCard(statsGrid, '缓存命中率', formatHitRate(cacheStats.hitRate));
            this.addStatCard(statsGrid, '缓存条目', cacheStats.totalEntries.toString());
        }

        section.createEl('h4', { text: '📂 分类统计', cls: 'nw-h4-section' });

        const catTable = section.createEl('table', {
            cls: 'nw-st-table'
        });
        const thead = catTable.createEl('thead');
        const headRow = thead.createEl('tr');
        ['分类', '次数', '总耗时', '平均耗时', '占比'].forEach(h => {
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

        section.createEl('h4', { text: '🐢 最近慢操作', cls: 'nw-h4-section' });

        if (slowOps.length === 0) {
            section.createEl('div', {
                text: '✅ 暂无慢操作记录',
                cls: 'nw-empty-info-card'
            });
        } else {
            const slowList = section.createEl('div', {
                cls: 'nw-st-scroll-box'
            });
            for (const op of slowOps.slice(0, 20)) {
                const item = slowList.createEl('div', {
                    cls: 'nw-st-scroll-item'
                });
                const top = item.createEl('div', { cls: 'nw-st-row' });
                top.createEl('span', { text: op.name, cls: 'nw-st-strong' });
                top.createEl('span', {
                    text: this.formatDuration(op.duration),
                    cls: 'nw-st-duration'
                });
                const bottom = item.createEl('div', {
                    text: `${op.category} · ${new Date(op.timestamp).toLocaleString()} · 阈值: ${this.formatDuration(op.threshold)}`,
                    cls: 'nw-st-meta'
                });
            }
        }

        section.createEl('h4', { text: '📝 最近操作日志', cls: 'nw-h4-section' });

        if (log.length === 0) {
            section.createEl('div', {
                text: '暂无性能数据，请先使用插件功能',
                cls: 'nw-empty-info-card'
            });
        } else {
            const logContainer = section.createEl('div', {
                cls: 'nw-st-scroll-box nw-st-scroll-box--tall nw-st-scroll-box--mono'
            });
            for (const entry of log.slice(0, 50)) {
                const item = logContainer.createEl('div', {
                    cls: 'nw-st-log-item'
                });
                const left = item.createEl('span');
                left.textContent = `[${entry.category}] ${entry.name}`;
                const right = item.createEl('span', {
                    cls: 'nw-st-muted-nowrap'
                });
                right.textContent = this.formatDuration(entry.duration);
            }
        }

        section.createEl('h4', { text: '⚙️ 操作', cls: 'nw-h4-section' });

        const btnRow = section.createEl('div', {
            cls: 'nw-st-btn-row'
        });

        const reportBtn = btnRow.createEl('button', {
            text: '📄 生成性能报告',
            cls: 'nw-st-btn nw-st-btn--primary nw-st-btn--fw500',
            attr: { type: 'button' }
        });
        reportBtn.onclick = () => {
            const report = performanceMonitor.generateTextReport(cacheStats);
            this.showPerformanceReport(report);
        };

        const exportBtn = btnRow.createEl('button', {
            text: '📤 导出日志',
            cls: 'nw-st-btn',
            attr: { type: 'button' }
        });
        exportBtn.onclick = async () => {
            const json = performanceMonitor.exportLog();
            await exportTextFile(this.app, `performance-log-${new Date().toISOString().slice(0, 10)}.json`, json, {
                mime: 'application/json',
                successMessage: '✅ 性能日志已导出',
            });
        };

        const clearBtn = btnRow.createEl('button', {
            text: '🗑️ 清空日志',
            cls: 'nw-st-btn nw-st-btn--danger',
            attr: { type: 'button' }
        });
        clearBtn.onclick = async () => {
            const confirmed = await OperationConfirmModal.confirm(this.app, {
                title: '清空性能日志',
                description: '确定要清空所有性能日志吗？',
                warning: '此操作不可恢复',
                confirmText: '确认清空',
                cancelText: '取消',
            });
            if (confirmed) {
                performanceMonitor.clearLog();
                this.refresh();
                showSuccessNotice('性能日志已清空', { timeout: 2000 });
            }
        };

        const refreshBtn = btnRow.createEl('button', {
            text: '🔄 刷新',
            cls: 'nw-st-btn',
            attr: { type: 'button' }
        });
        refreshBtn.onclick = () => {
            this.refresh();
        };
    }

    private addStatCard(container: HTMLElement, label: string, value: string): void {
        const card = container.createEl('div', {
            cls: 'nw-st-stat-card'
        });
        card.createEl('div', {
            text: label,
            cls: 'nw-st-stat-label'
        });
        card.createEl('div', {
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
        contentEl.createEl('h3', { text: '📊 性能报告' });
        const textarea = contentEl.createEl('textarea', {
            cls: 'nw-st-report-textarea',
            attr: { readonly: 'readonly' }
        });
        textarea.value = report;
        const btnRow = contentEl.createEl('div', {
            cls: 'nw-st-btn-row nw-st-btn-row--end'
        });
        const copyBtn = btnRow.createEl('button', {
            text: '📋 复制报告',
            cls: 'nw-st-btn nw-st-btn--primary',
            attr: { type: 'button' }
        });
        copyBtn.onclick = async () => {
            try {
                await copyText(report);
                showSuccessNotice('报告已复制到剪贴板', { timeout: 2000 });
            } catch {
                showErrorNotice('复制失败', { timeout: 2000 });
            }
        };
        const closeBtn = btnRow.createEl('button', {
            text: '关闭',
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
            left.createEl('div', {
                text: `🎉 发现新版本 v${latestVersion}`,
                cls: 'nw-st-update-title'
            });
            left.createEl('div', {
                text: lastResult.releaseNotes
                    ? lastResult.releaseNotes.substring(0, 80) + (lastResult.releaseNotes.length > 80 ? '...' : '')
                    : '点击查看详情了解新功能和改进',
                cls: 'nw-st-update-note'
            });

            const right = banner.createDiv({ cls: 'nw-st-update-actions' });

            const detailBtn = right.createEl('button', {
                text: '查看详情',
                cls: 'nw-st-banner-btn',
                attr: { type: 'button' }
            });
            detailBtn.addEventListener('click', () => {
                new ChangelogModal(this.app, {
                    highlightVersion: latestVersion,
                }).open();
            });

            const laterBtn = right.createEl('button', {
                text: '稍后提醒',
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
            .setName('🧩 关键词兜底（追加）')
            .setDesc('内置词表没覆盖的说法可在此补充（逗号分隔）。只影响「词表兜底」层，不改变结构化判定。')
            .setHeading();
        const fields: Array<{
            key: keyof NonNullable<typeof overrides>;
            name: string;
            hint: string;
        }> = [
            { key: 'injury', name: '伤情词', hint: '逗号分隔，如：气若游丝, 命悬一线' },
            { key: 'action', name: '行动词', hint: '逗号分隔，如：疾掠, 腾挪' },
            { key: 'modern', name: '现代词（时代错位）', hint: '逗号分隔，如：平板, 智能机' },
            { key: 'location', name: '地点词', hint: '逗号分隔，如：坊市, 渡口' },
            { key: 'drastic', name: '剧变词（死亡/重伤/能力变化）', hint: '逗号分隔，如：形神俱灭, 灰飞烟灭' },
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
        section.createEl('h3', { text: '📜 写作规则版本管理', cls: 'nw-st-heading--flush' });

        section.createEl('p', {
            text: '写作规则是 AI 生成正文时遵循的核心准则。唯一来源是 vault 的「元文件/00-系统模板/写作规则.md」——编辑这个文件，就是修改所有项目的写作规则。',
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
            statusRow0.createDiv({ text: '唯一来源:', cls: 'nw-status-label' });
            statusRow0.createDiv({
                text: isPresent ? info.sourcePath : '⚠️ 未找到（将写入 v4 模板）',
                cls: 'nw-st-mono',
            });

            const statusRow1 = statusCard.createDiv({ cls: 'nw-status-row' });
            statusRow1.createDiv({ text: '规则版本:', cls: 'nw-status-label' });
            statusRow1.createDiv({ text: `v${info.version}`, cls: 'nw-st-mono' });

            const statusRow2 = statusCard.createDiv({ cls: 'nw-status-row' });
            statusRow2.createDiv({ text: '模式附录:', cls: 'nw-status-label' });
            statusRow2.createDiv({ text: '当前项目按创作模式自动拼接（长篇连载 / 短篇单元 / 剧本分镜）', cls: 'nw-st-fs12' });

            if (!isPresent) {
                section.createDiv({
                    text: '⚠️ 未找到写作规则文件。重启插件时会自动写入 v4 引导版模板；也可点击「重新检查」立即生成。',
                    cls: 'nw-st-notice nw-st-notice--warning'
                });
            } else {
                section.createDiv({
                    text: '✅ 单一来源已就绪。没有可选版本、没有漂移——改文件即全局生效。',
                    cls: 'nw-st-notice nw-st-notice--success'
                });
            }

        const actions = section.createDiv({ cls: 'nw-settings-actions' });

            const refreshBtn = actions.createEl('button', {
                text: '🔄 重新检查',
                cls: 'nw-btn nw-btn-secondary',
                attr: { type: 'button' },
            });
            refreshBtn.addEventListener('click', async () => {
                if (refreshBtn.disabled) return;
                refreshBtn.disabled = true;
                refreshBtn.setText('⏳ 检查中…');
                rulesService.invalidateCache();
                // 只重绘本容器，不追加新模块
                await this.mountRulesSection(section);
            });

            const viewBtn = actions.createEl('button', {
                text: '📝 查看规则内容',
                cls: 'nw-btn nw-btn-primary',
                attr: { type: 'button' },
            });
            viewBtn.addEventListener('click', async () => {
                const rules = await rulesService.getWritingRules();
                const modal = new (class extends Modal {
                    constructor(app: App) { super(app); }
                    onOpen() {
                        const { contentEl } = this;
                        contentEl.createEl('h3', { text: '写作规则内容' });
                        const textarea = contentEl.createEl('textarea', {
                            cls: 'nw-st-code-textarea'
                        });
                        textarea.value = rules;
                    }
                })(this.app);
                modal.open();
            });

            const openBtn = actions.createEl('button', {
                text: '📂 在 Obsidian 中打开',
                cls: 'nw-btn nw-btn-secondary',
                attr: { type: 'button' },
            });
            openBtn.addEventListener('click', async () => {
                const { VAULT_RULES_PATH } = await import('@/services/rules-registry');
                const file = this.app.vault.getAbstractFileByPath(VAULT_RULES_PATH);
                if (file) {
                    await this.app.workspace.getLeaf('tab').openFile(file as TFile);
                } else {
                    showWarningNotice('规则文件不存在，点击「重新检查」生成', { timeout: 4000 });
                }
            });

        } catch (e) {
            statusCard.createDiv({
                text: `❌ 检查失败: ${(e as Error).message}`,
                cls: 'nw-text-error'
            });
        }

        new Setting(section)
            .setName('实验分组标签')
            .setDesc('写进注入账本与步骤结果 frontmatter，便于把「哪一组实验产生的正文」与规则/模板版本对上。留空不记录。')
            .addText((text) => text
                .setPlaceholder('例如 G2-新规则+样文')
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

        section.createEl('h3', { text: '📖 小说工坊 AI', cls: 'nw-st-heading--flush' });

        const currentVersion = PLUGIN_VERSION;

        const versionCard = section.createDiv({
            cls: 'nw-st-card nw-st-card--center'
        });

        versionCard.createEl('div', {
            text: '当前版本',
            cls: 'nw-st-label'
        });
        versionCard.createEl('div', {
            text: `v${currentVersion}`,
            cls: 'nw-st-version'
        });

        let lastCheckInfo = '从未检查';
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
                    latestVersionInfo = `v${lastResult.latestVersion}` + (lastResult.hasUpdate ? ' (有更新)' : ' (已是最新)');
                    if (lastResult.error) {
                        const at = lastResult.lastSuccessAt || lastResult.checkedAt;
                        latestVersionInfo += `（上次成功${at ? ` ${new Date(at).toLocaleString('zh-CN')}` : ''}）`;
                    }
                } else if (lastResult?.error) {
                    latestVersionInfo = `检查失败：${lastResult.error}`;
                }
            }
        } catch { // silent-ok: 版本信息（装饰性：读失败就只显示版本号）
        }

        const infoGrid = versionCard.createDiv({
            cls: 'nw-st-info-grid'
        });

        this.renderInfoItem(infoGrid, '最新版本', latestVersionInfo);
        this.renderInfoItem(infoGrid, '上次检查', lastCheckInfo);

        const btnRow = section.createDiv({
            cls: 'nw-st-btn-row nw-st-btn-row--mb24'
        });

        const checkBtn = btnRow.createEl('button', {
            text: '🔍 检查更新',
            cls: 'nw-st-btn nw-st-btn--primary nw-st-btn--lg nw-st-btn--fw500',
            attr: { type: 'button' }
        });
        checkBtn.addEventListener('click', async () => {
            checkBtn.disabled = true;
            checkBtn.textContent = '检查中...';
            try {
                const updateChecker = this.plugin.engineRegistry.getOrNull(ENGINE_NAMES.UPDATE_CHECKER);
                if (updateChecker) {
                    const result = await updateChecker.checkForUpdates(true);
                    if (result.hasUpdate) {
                        new Notice(`🎉 发现新版本 v${result.latestVersion}`, 4000);
                    } else if (result.error && result.latestVersion) {
                        showWarningNotice(
                            `本次检查失败，沿用上次结果 v${result.latestVersion}：${result.error}`,
                            { title: '检查更新失败', timeout: 6000 },
                        );
                    } else if (result.error) {
                        showErrorNotice(`检查失败: ${result.error}`, { title: '检查更新失败', timeout: 5000 });
                    } else {
                        showSuccessNotice('已是最新版本', { timeout: 2000 });
                    }
                }
            } catch (e) {
                showErrorNotice('检查更新失败', { timeout: 2000 });
            }
            checkBtn.disabled = false;
            checkBtn.textContent = '🔍 检查更新';
            this.refresh();
        });

        const changelogBtn = btnRow.createEl('button', {
            text: '📜 更新日志',
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
        supportCard.createEl('h4', { text: '💝 支持作者', cls: 'nw-support-author-title' });
        supportCard.createEl('p', {
            text: '如果这个插件帮到了你，欢迎扫码请作者喝杯咖啡。',
            cls: 'nw-support-author-desc',
        });
        const supportBtn = supportCard.createEl('button', {
            text: '💝 支持作者',
            cls: 'nw-btn nw-btn-primary nw-support-author-btn',
        });
        supportBtn.addEventListener('click', () => new SupportAuthorModal(this.app).open());

        // 热重载：Obsidian 政策禁止插件自行 disable/enable 自身，所以按钮只做
        // 「保存 + 把工作台状态写进 sessionStorage + 提示手动切换」。
        // 原实现放在设置页最底部（任何 tab 都能看到、且是红色内联样式），位置不合理，移到这里。
        section.createEl('h4', { text: '🧰 维护', cls: 'nw-st-h4--spaced' });
        new Setting(section)
            .setName('热重载插件')
            .setDesc('Obsidian 不允许插件自行重启：点击后请到「设置 → 第三方插件」关闭再启用，工作台会自动恢复。')
            .addButton(button => button
                .setButtonText('🔄 准备重载')
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
                    new Notice('请在「设置 → 第三方插件」中关闭再启用「小说工坊 AI」完成重载（工作台状态会自动恢复）', 6000);
                }));

        section.createEl('h4', { text: '⚙️ 更新设置', cls: 'nw-st-h4--spaced' });

        new Setting(section)
            .setName('自动检查更新')
            .setDesc('定期检查插件更新，仅在后台静默检查，不打扰使用')
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
            .setName('更新源')
            .setDesc('选择检查更新的来源')
            .addDropdown(dropdown => {
                dropdown.addOption('github', 'GitHub Releases');
                dropdown.addOption('custom', '自定义服务器');
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
                .setName('GitHub 仓库')
                .setDesc('格式：owner/repo · 默认分支：' + GITHUB_BRANCH)
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
                .setName('GitHub Token（私有仓库必填）')
                .setDesc('公开仓库留空；私有仓库需要 repo 读取权限。Token 只保存在本地设置中。')
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
                        ? '已保存（口令未解锁，不显示；输入新值可替换）'
                        : 'github_pat_... 或 ghp_...')
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
                .setName('自定义更新 URL')
                .setDesc('返回 JSON 格式的最新版本信息')
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
            .setName('检查间隔')
            .setDesc('自动检查更新的频率（小时）')
            .addDropdown(dropdown => {
                const options: Record<string, string> = {
                    '24': '每天',
                    '72': '每 3 天',
                    '168': '每周',
                    '720': '每月',
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

        section.createEl('h4', { text: '📌 关于插件', cls: 'nw-st-h4--gap' });

        const aboutCard = section.createDiv({
            cls: 'nw-st-about-card'
        });

        aboutCard.createEl('p', {
            text: '全流程 AI 长篇小说创作系统 — 协同写作工作台 + 多模型智能引擎 + 数据安全架构。',
            cls: 'nw-st-about-p'
        });

        aboutCard.createEl('div', { text: '作者：南柯一梦', cls: 'nw-st-about-line' });
        aboutCard.createEl('div', { text: '许可证：MIT', cls: 'nw-st-about-line' });
    }

    private renderInfoItem(container: HTMLElement, label: string, value: string): void {
        const item = container.createDiv({
            cls: 'nw-st-info-item'
        });
        item.createEl('div', {
            text: label,
            cls: 'nw-st-info-label'
        });
        item.createEl('div', {
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

        section.createEl('h3', { text: '🎭 角色识别设置' });
        section.createEl('p', {
            text: '配置角色识别三层流水线的各层参数。',
            cls: 'setting-item-description'
        });

        section.createEl('h4', { text: '启用的识别层', cls: 'nw-st-h4--section-first' });

        const layers = this.plugin.settings.characterRecognitionLayers || ['rule', 'vector'];

        new Setting(section)
            .setName('规则层')
            .setDesc('基于统计规则的角色提取（提及次数、频率过滤等）')
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
            .setName('向量层')
            .setDesc('基于语义向量的角色过滤与同指消解')
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
            .setName('LLM 层')
            .setDesc('⚠️ 启用后会消耗额外的 token，用于角色校验和称号抽取')
            .addToggle(toggle => toggle
                .setValue(layers.includes('llm'))
                .onChange(async (value) => {
                    const current = [...(this.plugin.settings.characterRecognitionLayers || [])];
                    if (value && !current.includes('llm')) {
                        const confirmed = await OperationConfirmModal.confirm(this.app, {
                            title: '启用 LLM 层',
                            description: '启用 LLM 层会显著增加 token 消耗，确定要开启吗？',
                            confirmText: '确认开启',
                            cancelText: '取消',
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

        section.createEl('h4', { text: '📋 规则层配置', cls: 'nw-st-h4--section' });

        new Setting(section)
            .setName('最小提及次数')
            .setDesc('角色名在文本中出现的最少次数才会被识别为角色候选')
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
            .setName('启用频率过滤')
            .setDesc('过滤掉出现频率异常高或异常低的候选词')
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
            .setName('启用上下文虚词检查')
            .setDesc('检查候选词前后是否为虚词，排除非人名用法')
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
            .setName('启用动词前后缀过滤')
            .setDesc('过滤掉前后紧跟动词的候选词（通常不是人名）')
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

        section.createEl('h4', { text: '🔗 向量层配置', cls: 'nw-st-h4--section' });

        new Setting(section)
            .setName('启用向量层')
            .setDesc('启用语义向量过滤和同指消解功能')
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
                .setName('语义过滤阈值')
                .setDesc(`候选词与"角色"语义的相似度阈值，低于此值将被过滤。当前: ${vectorLayer.semanticFilterThreshold.toFixed(2)}`)
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
                .setName('合并相似度阈值')
                .setDesc(`两个角色候选的语义相似度高于此值时将被合并。当前: ${vectorLayer.mergeSimilarityThreshold.toFixed(2)}`)
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

        section.createEl('h4', { text: '🤖 LLM 层配置', cls: 'nw-st-h4--section' });

        new Setting(section)
            .setName('启用 LLM 层')
            .setDesc('⚠️ 启用后会消耗额外 token，用于角色校验和称号抽取')
            .addToggle(toggle => toggle
                .setValue(llmLayer.enabled)
                .onChange(async (value) => {
                    if (value) {
                        const confirmed = await OperationConfirmModal.confirm(this.app, {
                            title: '启用 LLM 层',
                            description: '启用 LLM 层会显著增加 token 消耗，确定要开启吗？',
                            confirmText: '确认开启',
                            cancelText: '取消',
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
                .setName('校验批处理大小')
                .setDesc('每批发送给 LLM 进行角色校验的候选数量')
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
                .setName('称号抽取批处理大小')
                .setDesc('每批发送给 LLM 进行称号抽取的角色数量')
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
                .setName('最小置信度')
                .setDesc(`LLM 确认角色身份的最低置信度阈值。当前: ${llmLayer.minConfidence.toFixed(2)}`)
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

        section.createEl('h3', { text: '💡 建议采纳设置' });
        section.createEl('p', {
            text: '配置分析建议的自动采纳和显示方式。',
            cls: 'setting-item-description'
        });

        const suggestions = this.plugin.settings.suggestions || {
            autoAdoptHighConfidence: false,
            autoAdoptThreshold: 0.9,
            showEvidenceByDefault: false,
            batchAdoptThreshold: 0.7,
        };

        new Setting(section)
            .setName('自动采纳高置信度建议')
            .setDesc('自动采纳置信度高于阈值的建议，无需手动确认')
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
                .setName('自动采纳阈值')
                .setDesc(`置信度高于此值的建议将被自动采纳。当前: ${suggestions.autoAdoptThreshold.toFixed(2)}`)
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
            .setName('默认展开证据')
            .setDesc('建议列表中默认展开证据详情（关闭可节省界面空间）')
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
            .setName('批量采纳默认阈值')
            .setDesc(`批量采纳时的默认置信度阈值。当前: ${suggestions.batchAdoptThreshold.toFixed(2)}`)
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
