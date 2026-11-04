/**
 * general-sections.ts — 设置页「通用」分区集合
 *
 * 承载六个分区：性能监控（L4047-L4390）、提示词（L4391-L4400）、
 * 规则版本（L4401-L4518）、关于（L4519-L4739 + L5098-L5112）、
 * 角色识别（L4740-L5019）、建议设置（L5020-L5097）。
 * 来源：原 settings-tab.ts，方法体逐行搬移，无逻辑改动。
 */
import { Setting, Notice, Modal, TFile } from 'obsidian';
import { performanceMonitor } from '@/services/performance-monitor';
import { ENGINE_NAMES } from '@/shared/engine-names';
import { ChangelogModal } from '@/ui/changelog-modal';
import { PromptManagerSettings } from '@/ui/prompt-manager-settings';
import { RulesService } from '@/services/rules-service';
import { GITHUB_BRANCH, GITHUB_REPO_SLUG } from '@/shared/github-repo';
import { exportTextFile } from '@/shared/export-file';
import { OperationConfirmModal } from '@/ui/components/progress';
import { SettingsSection } from './section-base';

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

        section.createEl('h3', { text: '📊 性能监控' });
        section.createEl('p', { text: '监控插件关键操作的性能，识别性能瓶颈并优化。', cls: 'nw-u-c-text-muted-2 nw-u-fs-13px-2 nw-u-marginbottom-16px-2' });

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
                cls: "nw-empty-info-card nw-u-margintop-16px-2", attr: {}
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
        } catch {
        }

        section.createEl('h4', { text: '📈 概览统计', cls: 'nw-h4-section' });

        const statsGrid = section.createEl('div', {
            cls: 'nw-u-d-grid-2 nw-u-gtc-repeat-auto-fit-minmax-6 nw-u-gap-12px-2 nw-u-marginbottom-20px-2'
        });

        const totalOps = Object.values(categoryStats).reduce((sum, c) => sum + c.count, 0);
        const totalDuration = Object.values(categoryStats).reduce((sum, c) => sum + c.totalDuration, 0);

        this.addStatCard(statsGrid, '总操作数', totalOps.toString());
        this.addStatCard(statsGrid, '总耗时', this.formatDuration(totalDuration));
        this.addStatCard(statsGrid, '平均耗时', totalOps > 0 ? this.formatDuration(totalDuration / totalOps) : 'N/A');
        this.addStatCard(statsGrid, '慢操作', slowOps.length.toString());

        if (memoryInfo.current || memoryInfo.peak) {
            this.addStatCard(statsGrid, '当前内存', memoryInfo.current ? this.formatBytes(memoryInfo.current) : 'N/A');
            this.addStatCard(statsGrid, '峰值内存', memoryInfo.peak ? this.formatBytes(memoryInfo.peak) : 'N/A');
        }

        if (cacheStats) {
            this.addStatCard(statsGrid, '缓存命中率', (cacheStats.hitRate * 100).toFixed(1) + '%');
            this.addStatCard(statsGrid, '缓存条目', cacheStats.totalEntries.toString());
        }

        section.createEl('h4', { text: '📂 分类统计', cls: 'nw-h4-section' });

        const catTable = section.createEl('table', {
            cls: 'nw-u-w-100-2 nw-u-bordercollapse-collapse-2 nw-u-marginbottom-20px-2 nw-u-fs-13px-2'
        });
        const thead = catTable.createEl('thead');
        const headRow = thead.createEl('tr');
        ['分类', '次数', '总耗时', '平均耗时', '占比'].forEach(h => {
            const th = headRow.createEl('th');
            th.textContent = h;
            th.setAttribute('style', 'padding:8px 12px;text-align:left;background:var(--background-secondary);border-bottom:1px solid var(--background-modifier-border);');
        });
        const tbody = catTable.createEl('tbody');
        for (const [cat, stats] of Object.entries(categoryStats)) {
            if (stats.count === 0) continue;
            const row = tbody.createEl('tr');
            const percent = totalDuration > 0 ? ((stats.totalDuration / totalDuration) * 100).toFixed(1) + '%' : '0%';
            [cat, stats.count.toString(), this.formatDuration(stats.totalDuration), this.formatDuration(stats.avgDuration), percent].forEach((v, i) => {
                const td = row.createEl('td');
                td.textContent = v;
                td.setAttribute('style', 'padding:8px 12px;border-bottom:1px solid var(--background-modifier-border);');
                if (i === 0) td.style.fontWeight = '600';
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
                cls: 'nw-u-maxh-240px nw-u-ovy-auto-2 nw-u-b-1px-solid-background-m-2 nw-u-brd-8px-2'
            });
            for (const op of slowOps.slice(0, 20)) {
                const item = slowList.createEl('div', {
                    cls: 'nw-u-p-10px-14px-2 nw-u-bb-1px-solid-background-m-2'
                });
                const top = item.createEl('div', { cls: 'nw-u-d-flex-2 nw-u-jc-space-between-2 nw-u-ai-center-2' });
                top.createEl('span', { text: op.name, cls: 'nw-u-fwt-600-2' });
                top.createEl('span', {
                    text: this.formatDuration(op.duration),
                    cls: 'nw-u-c-text-error nw-u-fwt-600-2'
                });
                const bottom = item.createEl('div', {
                    text: `${op.category} · ${new Date(op.timestamp).toLocaleString()} · 阈值: ${this.formatDuration(op.threshold)}`,
                    cls: 'nw-u-fs-12px-2 nw-u-c-text-muted-2 nw-u-margintop-4px-3'
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
                cls: 'nw-u-maxh-300px-2 nw-u-ovy-auto-2 nw-u-b-1px-solid-background-m-2 nw-u-brd-8px-2 nw-u-fontfamily-font-monospace nw-u-fs-12px-2'
            });
            for (const entry of log.slice(0, 50)) {
                const item = logContainer.createEl('div', {
                    cls: 'nw-u-p-6px-12px nw-u-bb-1px-solid-background-m-2 nw-u-d-flex-2 nw-u-jc-space-between-2 nw-u-gap-12px-2'
                });
                const left = item.createEl('span');
                left.textContent = `[${entry.category}] ${entry.name}`;
                const right = item.createEl('span', {
                    cls: 'nw-u-c-text-muted-2 nw-u-ws-nowrap-2'
                });
                right.textContent = this.formatDuration(entry.duration);
            }
        }

        section.createEl('h4', { text: '⚙️ 操作', cls: 'nw-h4-section' });

        const btnRow = section.createEl('div', {
            cls: 'nw-u-d-flex-2 nw-u-gap-10px-2 nw-u-fwr-wrap-2'
        });

        const reportBtn = btnRow.createEl('button', {
            text: '📄 生成性能报告',
            attr: {
                type: 'button',
                style: 'padding:8px 16px;cursor:pointer;background:var(--interactive-accent);color:var(--text-on-accent);border:none;border-radius:6px;font-size:13px;font-weight:500;'
            }
        });
        reportBtn.onclick = () => {
            const report = performanceMonitor.generateTextReport(cacheStats);
            this.showPerformanceReport(report);
        };

        const exportBtn = btnRow.createEl('button', {
            text: '📤 导出日志',
            attr: {
                type: 'button',
                style: 'padding:8px 16px;cursor:pointer;background:var(--background-secondary);color:var(--text-normal);border:1px solid var(--background-modifier-border);border-radius:6px;font-size:13px;'
            }
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
            attr: {
                type: 'button',
                style: 'padding:8px 16px;cursor:pointer;background:var(--background-secondary);color:var(--text-error);border:1px solid var(--background-modifier-error);border-radius:6px;font-size:13px;'
            }
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
                new Notice('✅ 性能日志已清空', 2000);
            }
        };

        const refreshBtn = btnRow.createEl('button', {
            text: '🔄 刷新',
            attr: {
                type: 'button',
                style: 'padding:8px 16px;cursor:pointer;background:var(--background-secondary);color:var(--text-normal);border:1px solid var(--background-modifier-border);border-radius:6px;font-size:13px;'
            }
        });
        refreshBtn.onclick = () => {
            this.refresh();
        };
    }

    private addStatCard(container: HTMLElement, label: string, value: string): void {
        const card = container.createEl('div', {
            cls: 'nw-u-p-14px-2 nw-u-bg-background-secondary-2 nw-u-brd-8px-2'
        });
        card.createEl('div', {
            text: label,
            cls: 'nw-u-fs-12px-2 nw-u-c-text-muted-2 nw-u-marginbottom-6px-2'
        });
        card.createEl('div', {
            text: value,
            cls: 'nw-u-fs-18px-2 nw-u-fwt-700-2'
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
            attr: {
                style: 'width:100%;height:400px;font-family:var(--font-monospace);font-size:12px;padding:12px;border:1px solid var(--background-modifier-border);border-radius:6px;background:var(--background-primary);color:var(--text-normal);resize:vertical;',
                readonly: 'readonly'
            }
        });
        textarea.value = report;
        const btnRow = contentEl.createEl('div', {
            cls: 'nw-u-d-flex-2 nw-u-gap-10px-2 nw-u-jc-flex-end-2 nw-u-margintop-16px-2'
        });
        const copyBtn = btnRow.createEl('button', {
            text: '📋 复制报告',
            attr: {
                type: 'button',
                style: 'padding:8px 16px;cursor:pointer;background:var(--interactive-accent);color:var(--text-on-accent);border:none;border-radius:6px;font-size:13px;'
            }
        });
        copyBtn.onclick = async () => {
            try {
                await navigator.clipboard.writeText(report);
                new Notice('✅ 报告已复制到剪贴板', 2000);
            } catch {
                new Notice('❌ 复制失败', 2000);
            }
        };
        const closeBtn = btnRow.createEl('button', {
            text: '关闭',
            attr: {
                type: 'button',
                style: 'padding:8px 16px;cursor:pointer;background:var(--background-secondary);color:var(--text-normal);border:1px solid var(--background-modifier-border);border-radius:6px;font-size:13px;'
            }
        });
        closeBtn.onclick = () => modal.close();
        modal.open();
    }

    private formatDuration(ms: number): string {
        if (ms < 1) return `${(ms * 1000).toFixed(2)}μs`;
        if (ms < 1000) return `${ms.toFixed(2)}ms`;
        if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`;
        return `${(ms / 60000).toFixed(2)}min`;
    }

    private formatBytes(bytes: number): string {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
        if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
        return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
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
            const cacheManager = this.plugin.engineRegistry.getOrNull<any>(ENGINE_NAMES.CACHE_MANAGER);
            if (!cacheManager) return;

            const lastResult = cacheManager.getUpdateLastResult();
            if (!lastResult?.hasUpdate || !lastResult.latestVersion) return;

            const latestVersion = lastResult.latestVersion;
            const updateChecker = this.plugin.engineRegistry.getOrNull(ENGINE_NAMES.UPDATE_CHECKER);
            if (updateChecker && updateChecker.hasNotifiedVersion(latestVersion)) return;

            const banner = container.createDiv({
                cls: 'nw-u-marginbottom-16px-2 nw-u-p-14px-18px nw-u-bg-linear-gradient-135deg-3 nw-u-brd-10px-2 nw-u-c-white-2 nw-u-d-flex-2 nw-u-ai-center-2 nw-u-jc-space-between-2 nw-u-gap-12px-2 nw-u-fwr-wrap-2'
            });

            const left = banner.createDiv({ cls: 'nw-u-flex-1-2 nw-u-minw-200px-2' });
            left.createEl('div', {
                text: `🎉 发现新版本 v${latestVersion}`,
                cls: 'nw-u-fwt-600-2 nw-u-fs-15px-2 nw-u-marginbottom-4px-2'
            });
            left.createEl('div', {
                text: lastResult.releaseNotes
                    ? lastResult.releaseNotes.substring(0, 80) + (lastResult.releaseNotes.length > 80 ? '...' : '')
                    : '点击查看详情了解新功能和改进',
                cls: 'nw-u-fs-12px-2 nw-u-op-0-9-2'
            });

            const right = banner.createDiv({ cls: 'nw-u-d-flex-2 nw-u-gap-8px-2 nw-u-fsh-0-2' });

            const detailBtn = right.createEl('button', {
                text: '查看详情',
                attr: {
                    type: 'button',
                    style: 'padding:6px 14px;cursor:pointer;background:white;color:var(--interactive-accent);border:none;border-radius:6px;font-size:12px;font-weight:600;'
                }
            });
            detailBtn.addEventListener('click', () => {
                new ChangelogModal(this.app, {
                    highlightVersion: latestVersion,
                }).open();
            });

            const laterBtn = right.createEl('button', {
                text: '稍后提醒',
                attr: {
                    type: 'button',
                    style: 'padding:6px 14px;cursor:pointer;background:rgba(255,255,255,0.2);color:white;border:1px solid rgba(255,255,255,0.3);border-radius:6px;font-size:12px;'
                }
            });
            laterBtn.addEventListener('click', () => {
                if (updateChecker) {
                    updateChecker.markUpdateNotified(latestVersion);
                }
                this.reopen();
            });
        } catch {
        }
    }
}

/**
 * 提示词设置分区。
 */
export class PromptsSection extends SettingsSection {
    /**
     * 渲染该设置分区。
     *
     * @param container - 容器元素
     */
    render(container: HTMLElement): void {
        const section = container.createEl('section');
        if (!this.plugin.promptManager) {
            section.createDiv({ text: '提示词管理器未初始化', cls: 'nw-text-error' });
            return;
        }
        const manager = new PromptManagerSettings(this.app, this.plugin, section);
        manager.render();
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
        section.createEl('h3', { text: '📜 写作规则版本管理', cls: 'nw-u-margintop-0' });

        section.createEl('p', {
            text: '写作规则是 AI 生成正文时遵循的核心准则。唯一来源是 vault 的「元文件/00-系统模板/写作规则.md」——编辑这个文件，就是修改所有项目的写作规则。',
            cls: 'nw-u-c-text-muted-2 nw-u-fs-13px-2 nw-u-marginbottom-20px-2'
        });

        const statusCard = section.createDiv({
            cls: 'nw-u-p-20px-2 nw-u-bg-background-secondary-2 nw-u-brd-10px-2 nw-u-marginbottom-20px-2'
        });

        try {
            const rulesService = RulesService.getInstance(this.app);
            const info = await rulesService.checkRulesVersion();
            const isPresent = await rulesService.isRulesFilePresent();

            const statusRow0 = statusCard.createDiv({ cls: 'nw-status-row' });
            statusRow0.createDiv({ text: '唯一来源:', cls: 'nw-status-label' });
            statusRow0.createDiv({
                text: isPresent ? info.sourcePath : '⚠️ 未找到（将写入 v4 模板）',
                cls: 'nw-u-fontfamily-monospace',
            });

            const statusRow1 = statusCard.createDiv({ cls: 'nw-status-row' });
            statusRow1.createDiv({ text: '规则版本:', cls: 'nw-status-label' });
            statusRow1.createDiv({ text: `v${info.version}`, cls: 'nw-u-fontfamily-monospace' });

            const statusRow2 = statusCard.createDiv({ cls: 'nw-status-row' });
            statusRow2.createDiv({ text: '模式附录:', cls: 'nw-status-label' });
            statusRow2.createDiv({ text: '当前项目按创作模式自动拼接（长篇连载 / 短篇单元 / 剧本分镜）', cls: 'nw-u-fs-12px-2' });

            if (!isPresent) {
                section.createDiv({
                    text: '⚠️ 未找到写作规则文件。重启插件时会自动写入 v4 引导版模板；也可点击「重新检查」立即生成。',
                    cls: 'nw-u-p-12px-2 nw-u-bg-background-modifier-wa nw-u-c-text-warning nw-u-brd-6px-2 nw-u-marginbottom-16px-2'
                });
            } else {
                section.createDiv({
                    text: '✅ 单一来源已就绪。没有可选版本、没有漂移——改文件即全局生效。',
                    cls: 'nw-u-p-12px-2 nw-u-bg-background-modifier-su nw-u-c-text-success nw-u-brd-6px-2 nw-u-marginbottom-16px-2'
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
                    constructor(app: any) { super(app); }
                    onOpen() {
                        const { contentEl } = this;
                        contentEl.createEl('h3', { text: '写作规则内容' });
                        const textarea = contentEl.createEl('textarea', {
                            cls: 'nw-u-w-100-2 nw-u-h-400px nw-u-p-12px-2 nw-u-fontfamily-monospace nw-u-fs-12px-2 nw-u-b-1px-solid-background-m-2 nw-u-brd-6px-2 nw-u-bg-background-primary-2 nw-u-c-text-primary nw-u-resize-none'
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
                    new Notice('⚠️ 规则文件不存在，点击「重新检查」生成', 4000);
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

        section.createEl('h3', { text: '📖 小说工坊 AI', cls: 'nw-u-margintop-0' });

        const currentVersion = PLUGIN_VERSION;

        const versionCard = section.createDiv({
            cls: 'nw-u-p-20px-2 nw-u-bg-background-secondary-2 nw-u-brd-10px-2 nw-u-marginbottom-20px-2 nw-u-ta-center-2'
        });

        versionCard.createEl('div', {
            text: '当前版本',
            cls: 'nw-u-fs-13px-2 nw-u-c-text-muted-2 nw-u-marginbottom-4px-2'
        });
        versionCard.createEl('div', {
            text: `v${currentVersion}`,
            cls: 'nw-u-fs-32px nw-u-fwt-700-2 nw-u-c-text-normal-2 nw-u-marginbottom-8px-2'
        });

        let lastCheckInfo = '从未检查';
        let latestVersionInfo = '—';
        try {
            const cacheManager = this.plugin.engineRegistry.getOrNull<any>(ENGINE_NAMES.CACHE_MANAGER);
            if (cacheManager) {
                const lastCheck = cacheManager.getUpdateLastCheck();
                if (lastCheck) {
                    lastCheckInfo = new Date(lastCheck).toLocaleString('zh-CN');
                }
                const lastResult = cacheManager.getUpdateLastResult();
                if (lastResult?.latestVersion) {
                    latestVersionInfo = `v${lastResult.latestVersion}` + (lastResult.hasUpdate ? ' (有更新)' : ' (已是最新)');
                } else if (lastResult?.error) {
                    latestVersionInfo = `检查失败：${lastResult.error}`;
                }
            }
        } catch {
        }

        const infoGrid = versionCard.createDiv({
            cls: 'nw-u-d-grid-2 nw-u-gtc-1fr-1fr-2 nw-u-gap-12px-2 nw-u-margintop-16px-2 nw-u-ta-left-2'
        });

        this.renderInfoItem(infoGrid, '最新版本', latestVersionInfo);
        this.renderInfoItem(infoGrid, '上次检查', lastCheckInfo);

        const btnRow = section.createDiv({
            cls: 'nw-u-d-flex-2 nw-u-gap-10px-2 nw-u-marginbottom-24px-2 nw-u-fwr-wrap-2'
        });

        const checkBtn = btnRow.createEl('button', {
            text: '🔍 检查更新',
            attr: {
                type: 'button',
                style: 'padding:8px 18px;cursor:pointer;background:var(--interactive-accent);color:var(--text-on-accent);border:none;border-radius:6px;font-size:13px;font-weight:500;'
            }
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
                    } else if (result.error) {
                        new Notice(`检查失败: ${result.error}`, 3000);
                    } else {
                        new Notice('✅ 已是最新版本', 2000);
                    }
                }
            } catch (e) {
                new Notice('检查更新失败', 2000);
            }
            checkBtn.disabled = false;
            checkBtn.textContent = '🔍 检查更新';
            this.refresh();
        });

        const changelogBtn = btnRow.createEl('button', {
            text: '📜 更新日志',
            attr: {
                type: 'button',
                style: 'padding:8px 18px;cursor:pointer;border:1px solid var(--background-modifier-border);background:var(--background-primary);color:var(--text-normal);border-radius:6px;font-size:13px;'
            }
        });
        changelogBtn.addEventListener('click', () => {
            new ChangelogModal(this.app, {
                highlightVersion: currentVersion,
            }).open();
        });

        section.createEl('h4', { text: '⚙️ 更新设置', cls: 'nw-u-marginbottom-12px-2' });

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
                    text.setPlaceholder('github_pat_... 或 ghp_...')
                        .setValue(this.plugin.settings.updateGithubToken || '')
                        .onChange(async (value) => {
                            this.plugin.settings.updateGithubToken = value.trim();
                            await this.plugin.saveSettings();
                            const updateChecker = this.plugin.engineRegistry.getOrNull(ENGINE_NAMES.UPDATE_CHECKER);
                            if (updateChecker) {
                                updateChecker.updateConfig({ githubToken: value.trim() });
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

        section.createEl('h4', { text: '📌 关于插件', cls: 'nw-u-m-24px-0-12px-0' });

        const aboutCard = section.createDiv({
            cls: 'nw-u-p-16px-2 nw-u-bg-background-secondary-2 nw-u-brd-8px-2 nw-u-fs-13px-2 nw-u-lh-1-7 nw-u-c-text-muted-2'
        });

        aboutCard.createEl('p', {
            text: '全流程 AI 长篇小说创作系统 — 协同写作工作台 + 多模型智能引擎 + 数据安全架构。',
            cls: 'nw-u-m-0-0-12px-0-2'
        });

        aboutCard.createEl('div', { text: '作者：南柯一梦', cls: 'nw-u-marginbottom-4px-2' });
        aboutCard.createEl('div', { text: '许可证：MIT', cls: 'nw-u-marginbottom-4px-2' });
    }

    private renderInfoItem(container: HTMLElement, label: string, value: string): void {
        const item = container.createDiv({
            cls: 'nw-u-p-10px-12px-2 nw-u-bg-background-primary-2 nw-u-brd-6px-2'
        });
        item.createEl('div', {
            text: label,
            cls: 'nw-u-fs-11px-2 nw-u-c-text-muted-2 nw-u-marginbottom-2px-2'
        });
        item.createEl('div', {
            text: value,
            cls: 'nw-u-fs-14px-2 nw-u-fwt-600-2 nw-u-c-text-normal-2'
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

        section.createEl('h4', { text: '启用的识别层', cls: 'nw-u-margintop-20px-2 nw-u-marginbottom-8px-2' });

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

        section.createEl('h4', { text: '📋 规则层配置', cls: 'nw-u-margintop-24px nw-u-marginbottom-8px-2' });

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

        section.createEl('h4', { text: '🔗 向量层配置', cls: 'nw-u-margintop-24px nw-u-marginbottom-8px-2' });

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

        section.createEl('h4', { text: '🤖 LLM 层配置', cls: 'nw-u-margintop-24px nw-u-marginbottom-8px-2' });

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
