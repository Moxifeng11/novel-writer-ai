/**
 * writing-stats-modal.ts — 写作统计（日 / 周 / 月）
 *
 * 数据来自 WritingStatsService 的本地台账（正文净增长，按文件 mtime 归日）。
 * 顶部是四个关键数字，下面按页签给柱状图 + 明细，最后按项目拆分。
 */

import { Modal, type App } from 'obsidian';
import type NovelWriterPlugin from '../main';
import { barChart, attachChartInteractions } from './svg-charts';
import { formatWords, type DayPoint, type StatsSummary } from '../shared/writing-stats';
import { collectKnowledgeUsage } from '../engine/knowledge-usage';
import { summarizeRagSources } from '../shared/rag-sources';

type StatsTab = 'day' | 'week' | 'month';

const TAB_LABELS: Record<StatsTab, string> = {
    day: '按日',
    week: '按周',
    month: '按月',
};

/**
 * WritingStatsModal 类。
 */
export class WritingStatsModal extends Modal {
    private plugin: NovelWriterPlugin;
    private tab: StatsTab;

    constructor(app: App, plugin: NovelWriterPlugin, initialTab: StatsTab = 'day') {
        super(app);
        this.plugin = plugin;
        this.tab = initialTab;
    }

    /**
     * onOpen 方法。
     */
    onOpen(): void {
        this.modalEl.addClass('nw-scope');
        this.modalEl.addClass('nw-stats-modal');
        this.render();
    }

    /**
     * onClose 方法。
     */
    onClose(): void {
        this.contentEl.empty();
    }

    private getStats(): StatsSummary | null {
        const service = this.plugin.writingStats;
        if (!service) return null;
        return service.getReport().global;
    }

    private render(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h2', { text: '📊 写作统计' });
        contentEl.createEl('p', {
            text: '只统计正文净增长：改写/删章造成的字数下降不计入，历史日期也不会被后来的删改污染。',
            cls: 'setting-item-description',
        });

        const summary = this.getStats();
        if (!summary) {
            contentEl.createEl('p', { text: '统计服务未就绪，请稍后重试。', cls: 'nw-stats-empty' });
            return;
        }

        this.renderMetricRow(contentEl, summary);
        this.renderTargetBar(contentEl, summary);

        const tabs = contentEl.createDiv({ cls: 'nw-stats-tabs' });
        (Object.keys(TAB_LABELS) as StatsTab[]).forEach(tab => {
            const btn = tabs.createEl('button', {
                cls: `nw-stats-tab${this.tab === tab ? ' nw-is-active' : ''}`,
                text: TAB_LABELS[tab],
                attr: { type: 'button' },
            });
            btn.addEventListener('click', () => {
                this.tab = tab;
                this.render();
            });
        });

        const chartWrap = contentEl.createDiv({ cls: 'nw-stats-chart' });
        const points: DayPoint[] = this.tab === 'day'
            ? summary.daily
            : this.tab === 'week'
                ? summary.weekly
                : summary.monthly;
        this.renderChart(chartWrap, points, this.tab);
        this.renderBreakdown(contentEl, points, this.tab);
        this.renderKnowledgeUsage(contentEl);
        this.renderProjectTable(contentEl);
    }

    private renderMetricRow(container: HTMLElement, summary: StatsSummary): void {
        const row = container.createDiv({ cls: 'nw-stats-metrics' });
        const items: Array<{ label: string; value: string; hint?: string }> = [
            { label: '今日', value: formatWords(summary.today) },
            { label: '本周', value: formatWords(summary.week) },
            { label: '本月', value: formatWords(summary.month) },
            { label: '累计', value: formatWords(summary.total) },
            { label: '连续写作', value: `${summary.streak} 天` },
            { label: '最佳一天', value: summary.best ? `${formatWords(summary.best.words)}` : '—', hint: summary.best?.date },
        ];
        for (const item of items) {
            const card = row.createDiv({ cls: 'nw-stats-metric' });
            card.createDiv({ cls: 'nw-stats-metric-value', text: item.value });
            card.createDiv({ cls: 'nw-stats-metric-label', text: item.label });
            if (item.hint) card.setAttribute('title', item.hint);
        }
    }

    private renderTargetBar(container: HTMLElement, summary: StatsSummary): void {
        const target = Math.max(0, Number(this.plugin.settings.dailyWordTarget) || 0);
        if (target <= 0) return;
        const ratio = Math.min(1, summary.today / target);
        const wrap = container.createDiv({ cls: 'nw-stats-target' });
        const head = wrap.createDiv({ cls: 'nw-stats-target-head' });
        head.createSpan({ text: `今日目标 ${formatWords(target)} 字` });
        head.createSpan({
            text: `${formatWords(summary.today)} / ${Math.round(ratio * 100)}%`,
            cls: 'nw-stats-target-num',
        });
        const track = wrap.createDiv({ cls: 'nw-stats-target-track' });
        const fill = track.createDiv({ cls: 'nw-stats-target-fill' });
        fill.style.width = `${Math.round(ratio * 100)}%`;
        if (ratio >= 1) fill.addClass('nw-is-done');
    }

    private renderChart(container: HTMLElement, points: DayPoint[], tab: StatsTab): void {
        if (points.length === 0 || points.every(point => point.words === 0)) {
            container.createDiv({ cls: 'nw-stats-empty', text: '这段时间还没有字数记录。写一章就会出现在这里。' });
            return;
        }
        const data = points.map(point => ({ label: this.formatLabel(point.date, tab), value: point.words }));
        container.innerHTML = barChart(data, {
            width: 720,
            height: 240,
            title: tab === 'day' ? '最近 7 天' : tab === 'week' ? '最近 8 周' : '最近 6 个月',
        });
        attachChartInteractions(container);
    }

    private renderBreakdown(container: HTMLElement, points: DayPoint[], tab: StatsTab): void {
        const list = container.createDiv({ cls: 'nw-stats-breakdown' });
        const nonZero = [...points].reverse().filter(point => point.words > 0).slice(0, 6);
        if (nonZero.length === 0) return;
        for (const point of nonZero) {
            const row = list.createDiv({ cls: 'nw-stats-breakdown-row' });
            row.createSpan({ text: this.formatLabel(point.date, tab), cls: 'nw-stats-breakdown-label' });
            row.createSpan({ text: `${formatWords(point.words)} 字`, cls: 'nw-stats-breakdown-value' });
        }
    }

    private renderProjectTable(container: HTMLElement): void {
        const service = this.plugin.writingStats;
        if (!service) return;
        const report = service.getReport();
        const entries = Object.entries(report.byProject)
            .map(([project, summary]) => ({ project, summary }))
            .sort((a, b) => b.summary.total - a.summary.total)
            .slice(0, 6);
        if (entries.length <= 1) return;

        container.createEl('h3', { text: '分项目' });
        const table = container.createEl('table', { cls: 'nw-stats-table' });
        const head = table.createEl('thead').createEl('tr');
        for (const label of ['项目', '今日', '本周', '本月', '累计']) {
            head.createEl('th', { text: label });
        }
        const body = table.createEl('tbody');
        for (const { project, summary } of entries) {
            const row = body.createEl('tr');
            row.createEl('td', { text: project });
            row.createEl('td', { text: formatWords(summary.today) });
            row.createEl('td', { text: formatWords(summary.week) });
            row.createEl('td', { text: formatWords(summary.month) });
            row.createEl('td', { text: formatWords(summary.total) });
        }
    }

    /** G2-3b：知识引用命中率与常用书目（按当前项目，按需扫描 metadataCache） */
    private renderKnowledgeUsage(container: HTMLElement): void {
        const project = this.plugin.getActiveProject?.() || '';
        if (!project) return;
        let usage;
        try {
            usage = collectKnowledgeUsage(this.app as never, project, { recentLimit: 5 });
        } catch {
            return;
        }
        if (usage.stepsTotal === 0) return;

        container.createEl('h3', { text: '📚 知识引用' });
        const metrics = container.createDiv({ cls: 'nw-stats-metrics' });
        const items: Array<{ label: string; value: string }> = [
            { label: '命中率', value: `${Math.round(usage.hitRate * 100)}%` },
            { label: '引用片段', value: String(usage.totalSources) },
            { label: '涉及书目', value: String(usage.byBook.length) },
        ];
        for (const item of items) {
            const card = metrics.createDiv({ cls: 'nw-stats-metric' });
            card.createDiv({ cls: 'nw-stats-metric-value', text: item.value });
            card.createDiv({ cls: 'nw-stats-metric-label', text: item.label });
        }

        if (usage.byBook.length > 0) {
            const books = container.createDiv({ cls: 'nw-stats-breakdown' });
            for (const entry of usage.byBook.slice(0, 4)) {
                const row = books.createDiv({ cls: 'nw-stats-breakdown-row' });
                row.createSpan({ text: entry.book, cls: 'nw-stats-breakdown-label' });
                row.createSpan({ text: `${entry.count} 条`, cls: 'nw-stats-breakdown-value' });
            }
        }

        if (usage.recent.length > 0) {
            container.createDiv({ text: '最近引用', cls: 'nw-text-sm-muted nw-u-margintop-8px' });
            const list = container.createDiv({ cls: 'nw-stats-breakdown' });
            for (const record of usage.recent) {
                const row = list.createDiv({ cls: 'nw-stats-breakdown-row', attr: { title: record.path } });
                row.createSpan({ text: record.label, cls: 'nw-stats-breakdown-label' });
                const summary = summarizeRagSources(record.sources);
                row.createSpan({
                    text: summary.length > 48 ? `${summary.slice(0, 48)}…` : summary,
                    cls: 'nw-stats-breakdown-value',
                });
            }
        }
    }

    private formatLabel(date: string, tab: StatsTab): string {
        if (tab === 'month') return date.slice(0, 7);
        const md = date.slice(5);
        if (tab === 'week') return `${md} 周`;
        return md;
    }
}
