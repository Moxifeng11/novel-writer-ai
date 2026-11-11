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

import type { BookBasicInfo } from '@/services/knowledge-base-manager';
import { radarChart, barChart, donutChart } from '@/ui/svg-charts';
import {
    KB_QUALITY_DIMENSIONS,
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
    const content = rightContentEl.createDiv({
        cls: "nw-kb-stats-tab nw-u-p-16px nw-u-ovy-auto nw-u-h-100",
        attr: {}
    });

    content.createEl('h2', { text: '质量统计', cls: 'nw-u-m-0-0-20px-0 nw-u-fs-18px' });

    const completedBooks = selectCompletedBooks(host.allBooks);

    const overviewGrid = content.createDiv({
        cls: 'nw-u-d-grid nw-u-gtc-repeat-4-1fr nw-u-gap-12px nw-u-marginbottom-24px'
    });
    const overviewItems = buildStatsOverviewCards(host.allBooks);
    overviewItems.forEach(item => {
        const card = overviewGrid.createDiv({
            cls: 'nw-u-p-20px nw-u-bg-background-secondary nw-u-brd-8px nw-u-ta-center'
        });
        card.createDiv({ text: item.icon, cls: 'nw-u-fs-28px nw-u-marginbottom-8px' });
        card.createDiv({ text: item.value.toString(), attr: { style: `font-size:24px;font-weight:700;color:${item.color};margin-bottom:4px;` } });
        card.createDiv({ text: item.label, cls: 'nw-text-sm-muted' });
    });

    if (completedBooks.length > 0) {
        const qualitySection = content.createDiv({
            cls: 'nw-u-marginbottom-24px nw-u-p-20px nw-u-bg-background-secondary nw-u-brd-8px'
        });
        qualitySection.createEl('h3', { text: '各维度质量分布', cls: 'nw-u-m-0-0-16px-0 nw-u-fs-15px' });

        const dimensions = KB_QUALITY_DIMENSIONS;

        const chartWrap = qualitySection.createDiv({
            cls: 'nw-u-d-flex nw-u-gap-24px nw-u-fwr-wrap nw-u-ai-center nw-u-jc-center'
        });

        const dimensionAverages = computeDimensionAverages(completedBooks);
        const radarData = dimensionAverages.map(d => ({ label: d.label, value: d.avg }));
        const radarCard = chartWrap.createDiv({ cls: 'nw-u-flex-1 nw-u-minw-280px nw-u-d-flex nw-u-jc-center' });
        host.renderChart(radarCard, radarChart(radarData, { size: 280, title: '平均质量雷达图' }));

        const avgCard = chartWrap.createDiv({ cls: 'nw-u-flex-1 nw-u-minw-200px' });
        dimensionAverages.forEach(d => {
            const avg = d.avg;
            const item = avgCard.createDiv({ cls: 'nw-u-marginbottom-14px' });
            const top = item.createDiv({ cls: 'nw-u-d-flex nw-u-jc-space-between nw-u-marginbottom-6px' });
            top.createSpan({ text: d.label, cls: 'nw-u-fs-13px nw-u-c-text-normal' });
            top.createSpan({ text: avg.toFixed(1) + '分', cls: 'nw-u-fs-13px nw-u-c-text-muted nw-u-fwt-500' });
            const bar = item.createDiv({
                cls: 'nw-u-h-8px nw-u-bg-background-primary nw-u-brd-4px nw-u-ov-hidden'
            });
            bar.createDiv({
                attr: { style: `height:100%;width:${avg}%;background:var(--interactive-accent);border-radius:4px;` }
            });
        });
    }

    const genreSection = content.createDiv({
        cls: 'nw-u-marginbottom-24px nw-u-p-20px nw-u-bg-background-secondary nw-u-brd-8px'
    });
    genreSection.createEl('h3', { text: '题材分布', cls: 'nw-u-m-0-0-16px-0 nw-u-fs-15px' });

    const genreData = buildGenreBarData(host.allBooks, id => host.getGenreName(id));

    if (genreData.length > 0) {
        const chartCard = genreSection.createDiv({ cls: 'nw-u-d-flex nw-u-jc-center' });
        host.renderChart(chartCard, barChart(genreData, { width: 500, height: 300, title: 'Top 10 题材分布' }));
    } else {
        genreSection.createDiv({
            text: '暂无题材数据',
            cls: 'nw-u-ta-center nw-u-p-40px nw-u-c-text-muted'
        });
    }

    const statusSection = content.createDiv({
        cls: 'nw-u-marginbottom-24px nw-u-p-20px nw-u-bg-background-secondary nw-u-brd-8px'
    });
    statusSection.createEl('h3', { text: '拆解状态分布', cls: 'nw-u-m-0-0-16px-0 nw-u-fs-15px' });

    const statusCounts = computeStatusCounts(host.allBooks);

    const donutData = buildStatusDonutData(statusCounts);

    const statusWrap = statusSection.createDiv({
        cls: 'nw-u-d-flex nw-u-gap-24px nw-u-fwr-wrap nw-u-ai-center nw-u-jc-center'
    });

    if (donutData.length > 0) {
        const donutCard = statusWrap.createDiv({ cls: 'nw-u-flex-1 nw-u-minw-200px nw-u-d-flex nw-u-jc-center' });
        host.renderChart(donutCard, donutChart(donutData, { size: 220, title: '状态分布' }));
    }

    const statusList = statusWrap.createDiv({ cls: 'nw-u-flex-1 nw-u-minw-200px' });
    const statusItems = buildStatusLegendData(statusCounts);
    statusItems.forEach(item => {
        const row = statusList.createDiv({
            attr: { style: 'display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--background-modifier-border);&:last-child{border-bottom:none;}' }
        });
        const left = row.createDiv({ cls: 'nw-u-d-flex nw-u-ai-center nw-u-gap-8px' });
        left.createSpan({
            attr: { style: `width:10px;height:10px;border-radius:50%;background:${item.color};` }
        });
        left.createSpan({ text: item.label, cls: 'nw-u-fs-13px nw-u-c-text-normal' });
        row.createSpan({ text: item.value.toString(), cls: 'nw-u-fs-13px nw-u-fwt-600 nw-u-c-text-normal' });
    });
}
