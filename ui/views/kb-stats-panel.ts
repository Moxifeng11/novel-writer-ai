/**
 * kb-stats-panel.ts — 知识库质量统计页签的纯 DOM 构建（自 knowledge-base-view 抽出）
 *
 * 只负责「给定书籍列表 + 宿主能力，构建出统计页签 DOM」这一件事：
 *  - 概览指标卡（总数/已拆解/拆解中/平均质量分）
 *  - 各维度质量分布（平均质量雷达图 + 平均分横条）
 *  - 题材分布柱状图（Top 10）与拆解状态分布环图 + 状态清单
 *  - 自身不持有任何状态：书籍数据、图表挂载、题材命名全部通过 KbStatsPanelHost
 *    回调宿主（KnowledgeBaseView），保证与抽取前行为完全一致
 */

import { t } from '@/i18n';
import type { BookBasicInfo } from '@/services/knowledge-base-manager';
import { radarChart, barChart, donutChart } from '@/ui/svg-charts';
import type { KbStatusKey } from './kb-panels-logic';
import {
    getKbQualityDimensions,
    selectCompletedBooks,
    buildStatsOverviewCards,
    computeDimensionAverages,
    buildGenreBarData,
    computeStatusCounts,
    buildStatusDonutData,
    buildStatusLegendData,
} from './kb-panels-logic';

/**
 * 质量统计页签构建所需的宿主能力集合。
 *
 * 由 KnowledgeBaseView 以自身方法/字段注入，构建函数不直接依赖视图实例。
 */
export interface KbStatsPanelHost {
    /** 全部书籍基础信息列表（统计数据源，构建期只读快照）。 */
    readonly allBooks: BookBasicInfo[];
    /** 将 SVG 图表 HTML 挂载到容器并绑定图表交互（宿主统一入口）。 */
    renderChart(container: HTMLElement, svgHtml: string): void;
    /** 查询题材显示名；题材不存在时回退为 id，知识库未就绪时返回「未分类」。 */
    getGenreName(genreId?: string): string;
    /**
     * 点击状态清单某一行时回调（未注入则图例行保持只读）。
     *
     * 宿主负责「跳到书架并按该状态筛选」；构建器只把用户选中的状态原样传出，
     * 不持有筛选状态、也不改变自己渲染的数据快照。
     */
    onStatusClick?: (status: KbStatusKey) => void;
}

/**
 * 构建质量统计页签 DOM（结构、类名与抽取前完全一致）。
 *
 * 与 renderTasksTab 同理：任务完成回调会直接调用本页签，因此会先清空
 * 宿主容器再整体重建。
 *
 * @param rightContentEl 右侧面板内容容器（将被清空并填充统计页签）
 * @param host 宿主能力回调集合（书籍数据 / 图表挂载 / 题材命名）
 */
export function buildKbStatsPanel(rightContentEl: HTMLElement, host: KbStatsPanelHost): void {
    // 同 renderTasksTab：任务完成回调会直接调用它，必须先清空再重建
    rightContentEl.empty();
    const content = rightContentEl.createDiv({ cls: 'nw-ks-panel' });

    content.createEl('h2', { text: t('knowledgebase.stats.title'), cls: 'nw-ks-title' });

    const completedBooks = selectCompletedBooks(host.allBooks);

    const overviewGrid = content.createDiv({ cls: 'nw-ks-overview' });
    const overviewItems = buildStatsOverviewCards(host.allBooks);
    overviewItems.forEach(item => {
        const card = overviewGrid.createDiv({ cls: 'nw-ks-overview-card' });
        card.createDiv({ text: item.icon, cls: 'nw-ks-overview-icon' });
        card.createDiv({
            text: item.value.toString(),
            cls: `nw-ks-overview-value nw-ks-overview-value--${item.tone}`
        });
        card.createDiv({ text: item.label, cls: 'nw-text-sm-muted' });
    });

    if (completedBooks.length > 0) {
        const qualitySection = content.createDiv({ cls: 'nw-ks-section' });
        qualitySection.createEl('h3', { text: t('knowledgebase.stats.dimensions'), cls: 'nw-ks-section-title' });

        getKbQualityDimensions();

        const chartWrap = qualitySection.createDiv({ cls: 'nw-ks-chart-row' });

        const dimensionAverages = computeDimensionAverages(completedBooks);
        const radarData = dimensionAverages.map(d => ({ label: d.label, value: d.avg }));
        const radarCard = chartWrap.createDiv({ cls: 'nw-ks-chart-card nw-ks-chart-card--radar' });
        host.renderChart(radarCard, radarChart(radarData, { size: 280, title: t('knowledgebase.stats.radarTitle') }));

        const avgCard = chartWrap.createDiv({ cls: 'nw-ks-chart-card' });
        dimensionAverages.forEach(d => {
            const avg = d.avg;
            const item = avgCard.createDiv({ cls: 'nw-ks-avg-item' });
            const top = item.createDiv({ cls: 'nw-ks-avg-top' });
            top.createSpan({ text: d.label, cls: 'nw-ks-avg-label' });
            top.createSpan({ text: t('knowledgebase.stats.score', { score: avg.toFixed(1) }), cls: 'nw-ks-avg-score' });
            const bar = item.createDiv({ cls: 'nw-ks-bar' });
            const fill = bar.createDiv({ cls: 'nw-ks-bar-fill' });
            fill.style.setProperty('--nw-ks-pct', `${avg}%`);
        });
    }

    const genreSection = content.createDiv({ cls: 'nw-ks-section' });
    genreSection.createEl('h3', { text: t('knowledgebase.stats.genreTitle'), cls: 'nw-ks-section-title' });

    const genreData = buildGenreBarData(host.allBooks, id => host.getGenreName(id));

    if (genreData.length > 0) {
        const chartCard = genreSection.createDiv({ cls: 'nw-ks-bar-chart' });
        host.renderChart(chartCard, barChart(genreData, { width: 500, height: 300, title: t('knowledgebase.stats.genreChartTitle') }));
    } else {
        genreSection.createDiv({ text: t('knowledgebase.stats.genreEmpty'), cls: 'nw-ks-empty' });
    }

    const statusSection = content.createDiv({ cls: 'nw-ks-section' });
    statusSection.createEl('h3', { text: t('knowledgebase.stats.statusTitle'), cls: 'nw-ks-section-title' });

    const statusCounts = computeStatusCounts(host.allBooks);

    const donutData = buildStatusDonutData(statusCounts);

    const statusWrap = statusSection.createDiv({ cls: 'nw-ks-chart-row' });

    if (donutData.length > 0) {
        const donutCard = statusWrap.createDiv({ cls: 'nw-ks-chart-card nw-ks-chart-card--centered' });
        host.renderChart(donutCard, donutChart(donutData, { size: 220, title: t('knowledgebase.stats.donutTitle') }));
    }

    const statusList = statusWrap.createDiv({ cls: 'nw-ks-chart-card' });
    const statusItems = buildStatusLegendData(statusCounts);
    const onStatusClick = host.onStatusClick;
    statusItems.forEach(item => {
        // 0 本的状态不提供跳转：点进空书架只会让用户以为自己筛错了
        const actionable = Boolean(onStatusClick) && item.value > 0;
        const row = statusList.createDiv({
            cls: `nw-ks-legend-row${actionable ? ' nw-ks-legend-row--action' : ' nw-ks-legend-row--idle'}`,
        });
        const left = row.createDiv({ cls: 'nw-ks-legend-left' });
        left.createSpan({ cls: `nw-ks-legend-dot nw-ks-legend-dot--${item.status}` });
        left.createSpan({ text: item.label, cls: 'nw-ks-legend-label' });
        row.createSpan({ text: item.value.toString(), cls: 'nw-ks-legend-value' });

        if (!actionable || !onStatusClick) return;
        const status = item.status;
        const activate = () => onStatusClick(status);
        row.setAttribute('role', 'button');
        row.setAttribute('tabindex', '0');
        row.setAttribute('title', t('knowledgebase.stats.rowTitle', { label: item.label, value: item.value }));
        row.addEventListener('click', activate);
        row.addEventListener('keydown', (event: KeyboardEvent) => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            activate();
        });
    });
}
