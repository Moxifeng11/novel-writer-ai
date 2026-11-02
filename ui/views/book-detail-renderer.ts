import type { App } from 'obsidian';
import type { KnowledgeBaseManager, BookBasicInfo, BreakdownStatus } from '../../services/knowledge-base-manager';
import type { WebnovelKnowledgeBase } from '../../shared/webnovel-knowledge-base';
import { radarChart, barChart, donutChart, wordCloud, lineChart, timelineChart, attachChartInteractions } from '../svg-charts';
import { SmartChart } from '../components/smart-chart';
import { createEmptyState } from '../components/empty-state';
import { createLogger } from '../../shared/logger';
import { formatDetailCount, formatDetailNumber, formatDetailPercent } from '../knowledge-detail-format';
import type { DeconstructionScheduler, BreakdownDimension, DimensionQualityScore } from '../../engine/deconstruction-scheduler';
import type {
    StyleData,
    RhythmData,
    TechniqueData,
    StructureData,
    CharacterKnowledgeData,
    ForeshadowData,
    CommercialData,
    ReadabilityData,
} from './knowledge-base-view';
import { isImeComposing } from '../../shared/keyboard';

const log = createLogger('BookDetailRenderer');

/**
 * 书籍详情渲染依赖。
 */
export interface BookDetailRendererDeps {
    app: App;
    getKb: () => WebnovelKnowledgeBase | null;
    getKbManager: () => KnowledgeBaseManager | null;
    getStyleData: () => StyleData | null;
    getRhythmData: () => RhythmData | null;
    getTechniqueData: () => TechniqueData | null;
    getStructureData: () => StructureData | null;
    getCharacterData: () => CharacterKnowledgeData | null;
    getForeshadowData: () => ForeshadowData | null;
    getCommercialData: () => CommercialData | null;
    getReadabilityData: () => ReadabilityData | null;
    getCurrentBook: () => BookBasicInfo | undefined;
    formatWordCount: (count?: number) => string;
    formatDateTime: (timestamp: number) => string;
    formatDuration: (ms: number) => string;
    getChannelLabel: (channel: string) => string;
    getStatusLabel: (status: BreakdownStatus) => string;
    getDeconstructionScheduler: () => DeconstructionScheduler | null;
    getExpandedItems: () => Record<string, boolean>;
    getForeshadowFilter: () => string;
    setForeshadowFilter: (value: string) => void;
    getDimensionLabels: () => Record<BreakdownDimension, string>;
    onClassifyBook: (book: BookBasicInfo) => Promise<void>;
    onEditBook: (book: BookBasicInfo) => void;
    onApplyGenreRecommendation: (book: BookBasicInfo, rec: { genreId: string; subGenreId?: string; confidence: number }) => Promise<void>;
    onAddCustomTag: (book: BookBasicInfo, tag: string) => Promise<void>;
    onDeleteCustomTag: (book: BookBasicInfo, index: number) => Promise<void>;
    onRequestReRender: () => void;
}

/**
 * 书籍详情渲染器。
 */
export class BookDetailRenderer {
    private deps: BookDetailRendererDeps;

    constructor(deps: BookDetailRendererDeps) {
        this.deps = deps;
    }

    // ---- 风格分析 Tab ----
    public renderBookStyleTab(container: HTMLElement): void {
        const data = this.deps.getStyleData();
        if (!data) {
            this.renderDetailEmpty(container, '风格分析数据');
            return;
        }

        this.renderQualityScoreCard(container, data as unknown as Record<string, unknown>);

        const { sentenceRhythm, paragraphStructure, narrativeStyle, overallStyle, wordPreference, rhetoric, dialogueStyle } = data;

        const book = this.deps.getCurrentBook();
        if (book) {
            container.createDiv({
                text: `基于全书 ${this.deps.formatWordCount(book.wordCount)} 字`,
                cls: 'nw-u-fs-12px nw-u-c-text-muted nw-u-marginbottom-16px'
            });
        }

        // 风格特征雷达图
        const radarItems: Array<{ label: string; value: number }> = [];
        if (sentenceRhythm?.avgSentenceLength !== undefined) {
            const normalizedLength = Math.min(100, (sentenceRhythm.avgSentenceLength / 50) * 100);
            radarItems.push({ label: '平均句长', value: normalizedLength });
        }
        if (paragraphStructure?.avgParagraphLength !== undefined) {
            const normalizedPara = Math.min(100, (paragraphStructure.avgParagraphLength / 200) * 100);
            radarItems.push({ label: '平均段长', value: normalizedPara });
        }
        if (narrativeStyle?.dialogueRatio !== undefined) {
            radarItems.push({ label: '对白占比', value: narrativeStyle.dialogueRatio * 100 });
        }
        if (narrativeStyle?.descriptionRatio?.total !== undefined) {
            radarItems.push({ label: '描写占比', value: narrativeStyle.descriptionRatio.total * 100 });
        }
        if (wordPreference?.colloquialismLevel !== undefined) {
            radarItems.push({ label: '口语化程度', value: wordPreference.colloquialismLevel * 100 });
        }
        if (wordPreference?.idiomDensity !== undefined) {
            radarItems.push({ label: '成语密度', value: Math.min(100, wordPreference.idiomDensity / 100 * 100) });
        }

        if (radarItems.length >= 3) {
            const radarSection = this.createDetailSection(container, '风格雷达图');
            const radarDiv = radarSection.createDiv({
                cls: 'nw-u-d-flex nw-u-jc-center'
            });
            this.renderChart(radarDiv, radarChart(radarItems, { size: 320, title: '写作风格特征' }));
        }

        // 基础统计卡片
        if (sentenceRhythm || paragraphStructure || narrativeStyle) {
            const section = this.createDetailSection(container, '基础统计');
            const grid = section.createDiv({
                cls: 'nw-u-d-grid nw-u-gtc-repeat-auto-fit-minmax nw-u-gap-12px'
            });
            if (sentenceRhythm?.avgSentenceLength !== undefined) {
                this.addInfoItem(grid, '平均句长', formatDetailNumber(sentenceRhythm.avgSentenceLength, 1, ' 字'));
            }
            if (paragraphStructure?.avgParagraphLength !== undefined) {
                this.addInfoItem(grid, '平均段长', formatDetailNumber(paragraphStructure.avgParagraphLength, 1, ' 字'));
            }
            if (narrativeStyle?.dialogueRatio !== undefined) {
                this.addInfoItem(grid, '对白占比', formatDetailPercent(narrativeStyle.dialogueRatio, 1));
            }
            if (narrativeStyle?.descriptionRatio?.total !== undefined) {
                this.addInfoItem(grid, '描写占比', formatDetailPercent(narrativeStyle.descriptionRatio.total, 1));
            }
            if (wordPreference?.idiomDensity !== undefined) {
                this.addInfoItem(grid, '成语密度', formatDetailNumber(wordPreference.idiomDensity, 1, ' /千字'));
            }
            if (wordPreference?.colloquialismLevel !== undefined) {
                this.addInfoItem(grid, '口语化程度', formatDetailPercent(wordPreference.colloquialismLevel, 1));
            }
        }

        // 风格特征词云（使用高频词）
        if (wordPreference?.topWords && wordPreference.topWords.length > 0) {
            const section = this.createDetailSection(container, '高频词词云');
            const wordItems = wordPreference.topWords.slice(0, 30).map(item => ({
                text: item.word,
                weight: item.count
            }));
            const wordCloudDiv = section.createDiv({
                cls: 'nw-u-d-flex nw-u-jc-center'
            });
            this.renderChart(wordCloudDiv, wordCloud(wordItems, { width: 500, height: 200, title: '高频词分布' }));
        }

        // 修辞手法柱状图
        if (rhetoric) {
            const section = this.createDetailSection(container, '修辞手法');
            const barData = [
                { label: '比喻', value: rhetoric.metaphor },
                { label: '拟人', value: rhetoric.personification },
                { label: '排比', value: rhetoric.parallelism },
                { label: '反问', value: rhetoric.rhetoricalQuestion },
                { label: '夸张', value: rhetoric.hyperbole },
                { label: '对偶', value: rhetoric.antithesis },
            ];
            const barDiv = section.createDiv({
                cls: 'nw-u-d-flex nw-u-jc-center'
            });
            this.renderChart(barDiv, barChart(barData, { width: 500, height: 180, title: '修辞手法统计' }));
        }

        // 整体风格
        if (overallStyle) {
            const section = this.createDetailSection(container, '整体风格');
            const grid = section.createDiv({
                cls: 'nw-u-d-grid nw-u-gtc-repeat-auto-fit-minmax-2 nw-u-gap-12px'
            });
            const styleCard = grid.createDiv({
                cls: 'nw-u-p-14px nw-u-bg-background-secondary nw-u-brd-8px'
            });
            styleCard.createEl('div', { text: '主要文风', cls: 'nw-u-fs-12px nw-u-c-text-muted nw-u-marginbottom-4px' });
            styleCard.createEl('div', { text: overallStyle.primaryStyle, cls: 'nw-u-fs-18px nw-u-fwt-700 nw-u-c-interactive-accent' });
            if (overallStyle.secondaryStyle) {
                styleCard.createEl('div', { text: `次要文风: ${overallStyle.secondaryStyle}`, cls: 'nw-u-fs-12px nw-u-c-text-muted nw-u-margintop-4px' });
            }
            styleCard.createEl('div', { text: `置信度: ${formatDetailPercent(overallStyle.confidence)}`, cls: 'nw-u-fs-12px nw-u-c-text-muted nw-u-margintop-4px' });

            if (overallStyle.styleScores) {
                const scoresCard = grid.createDiv({
                    cls: 'nw-u-p-14px nw-u-bg-background-secondary nw-u-brd-8px'
                });
                scoresCard.createEl('div', { text: '文风评分', cls: 'nw-u-fs-12px nw-u-c-text-muted nw-u-marginbottom-8px' });
                const scoreList = scoresCard.createDiv({ cls: 'nw-u-d-flex nw-u-fd-column nw-u-gap-4px' });
                Object.entries(overallStyle.styleScores).slice(0, 5).forEach(([style, score]) => {
                    scoreList.createEl('div', {
                        text: `${style}: ${formatDetailPercent(score)}`,
                        cls: 'nw-u-fs-12px'
                    });
                });
            }
        }

        if (data.vocabularyRichness) {
            const vr = data.vocabularyRichness;
            const section = this.createDetailSection(container, '词汇丰富度');
            const grid = section.createDiv({
                cls: 'nw-u-d-grid nw-u-gtc-repeat-auto-fit-minmax-3 nw-u-gap-12px'
            });
            this.addInfoItem(grid, 'TTR', formatDetailNumber(vr.ttr, 3));
            this.addInfoItem(grid, 'MTLD', formatDetailNumber(vr.mtld, 1));
            this.addInfoItem(grid, "Yule's K", formatDetailNumber(vr.yulesK, 3));
            this.addInfoItem(grid, '词汇量', formatDetailCount(vr.vocabularySize));
            const levelItem = grid.createDiv({
                cls: 'nw-u-p-10px-12px nw-u-bg-background-secondary nw-u-brd-6px'
            });
            levelItem.createDiv({ text: '级别', cls: "nw-text-muted-11 nw-u-marginbottom-4px", attr: {} });
            levelItem.createDiv({
                text: `${vr.level} (${formatDetailNumber(vr.score, 1, '分')})`,
                cls: 'nw-u-fs-13px nw-u-c-interactive-accent nw-u-fwt-500'
            });
        }

        if (data.fiveSenses) {
            const fs = data.fiveSenses;
            if (fs.distribution && Object.keys(fs.distribution).length >= 3) {
                const senseNameMap: Record<string, string> = {
                    visual: '视觉', auditory: '听觉', olfactory: '嗅觉', gustatory: '味觉', tactile: '触觉'
                };
                const section = this.createDetailSection(container, '五感描写分布');
                const radarData = Object.entries(fs.distribution).map(([k, v]) => ({
                    label: senseNameMap[k] || k,
                    value: Math.min(100, v * 100)
                }));
                const radarDiv = section.createDiv({ cls: 'nw-u-d-flex nw-u-jc-center' });
                this.renderChart(radarDiv, radarChart(radarData, { size: 300, title: '五感雷达图' }));

                const statsRow = section.createDiv({
                    cls: 'nw-u-d-grid nw-u-gtc-repeat-auto-fit-minmax-4 nw-u-gap-12px nw-u-margintop-16px'
                });
                this.addInfoItem(statsRow, '平衡度', formatDetailNumber(fs.balanceScore, 1, '分'));
                this.addInfoItem(statsRow, '级别', fs.level);
                this.addInfoItem(statsRow, '主导感', senseNameMap[fs.dominantSense] || fs.dominantSense);
            }
        }

        if (data.sentenceRhythm?.sentenceTypeDistribution) {
            const std = data.sentenceRhythm.sentenceTypeDistribution;
            const typeNameMap: Record<string, string> = {
                declarative: '陈述句', interrogative: '疑问句', exclamatory: '感叹句', elliptical: '省略句'
            };
            const donutData = Object.entries(std).map(([k, v]) => ({
                label: typeNameMap[k] || k,
                value: v
            }));
            const section = this.createDetailSection(container, '句式类型分布');
            const chartDiv = section.createDiv({ cls: 'nw-u-d-flex nw-u-jc-center' });
            this.renderChart(chartDiv, donutChart(donutData, { size: 260, title: '句式类型' }));
        }

        if (data.sentenceRhythm?.lengthDistribution) {
            const sld = data.sentenceRhythm.lengthDistribution;
            const sdNameMap: Record<string, string> = { short: '短句', medium: '中句', long: '长句' };
            const barData = Object.entries(sld).map(([k, v]) => ({ label: sdNameMap[k] || k, value: v }));
            const section = this.createDetailSection(container, '句长分布');
            const chartDiv = section.createDiv({ cls: 'nw-u-d-flex nw-u-jc-center' });
            this.renderChart(chartDiv, barChart(barData, { width: 400, height: 180, title: '句长分布' }));
        }

        if (data.paragraphStructure?.lengthDistribution) {
            const pld = data.paragraphStructure.lengthDistribution;
            const pdNameMap: Record<string, string> = { short: '短段', medium: '中段', long: '长段', veryLong: '超长段' };
            const barData = Object.entries(pld).map(([k, v]) => ({ label: pdNameMap[k] || k, value: v }));
            const section = this.createDetailSection(container, '段落长度分布');
            const chartDiv = section.createDiv({ cls: 'nw-u-d-flex nw-u-jc-center' });
            this.renderChart(chartDiv, barChart(barData, { width: 400, height: 180, title: '段落长度' }));
        }
    }

    // ---- 节奏分析 Tab ----
    public renderBookRhythmTab(container: HTMLElement): void {
        const data = this.deps.getRhythmData();
        if (!data || (!data.emotionPoints && !data.coolPoints && !data.plotStages && !data.structureMatches && !data.chapterRhythm)) {
            this.renderDetailEmpty(container, '节奏分析数据');
            return;
        }

        const { emotionPoints, chapterRhythm } = data;

        const book = this.deps.getCurrentBook();
        if (book) {
            container.createDiv({
                text: `基于全书 ${this.deps.formatWordCount(book.wordCount)} 字`,
                cls: 'nw-u-fs-12px nw-u-c-text-muted nw-u-marginbottom-16px'
            });
        }

        this.renderQualityScoreCard(container, data as unknown as Record<string, unknown>);

        if (data.stats) {
            const statsSection = this.createDetailSection(container, '节奏统计摘要');
            const statsGrid = statsSection.createDiv({
                cls: 'nw-u-d-grid nw-u-gtc-repeat-auto-fit-minmax-4 nw-u-gap-12px'
            });
            this.addInfoItem(statsGrid, '平均节奏', data.stats.avgRhythm != null ? data.stats.avgRhythm.toFixed(2) : '-');
            this.addInfoItem(statsGrid, '高潮点', data.stats.climaxCount != null ? String(data.stats.climaxCount) : '-');
            this.addInfoItem(statsGrid, '爽点', data.stats.coolPointCount != null ? String(data.stats.coolPointCount) : '-');
            this.addInfoItem(statsGrid, '钩子率', data.stats.hookRate != null ? `${(data.stats.hookRate * 100).toFixed(1)}%` : '-');
            this.addInfoItem(statsGrid, '平均张力', data.stats.avgTension != null ? data.stats.avgTension.toFixed(2) : '-');
        }

        // 情绪点折线图（使用 emotionPoints）
        if (emotionPoints && emotionPoints.length > 0) {
            const section = this.createDetailSection(container, '情绪变化曲线');
            const emotionSeries = [{
                name: '情绪强度',
                data: emotionPoints.slice(0, 50).map(p => ({
                    label: `章节${p.chapterIndex}`,
                    value: p.intensity * 100,
                    annotation: p.type === 'reversal' ? '反转' : p.type === 'small_climax' ? '小高潮' : p.type === 'trough' ? '低谷' : undefined
                })),
                smooth: true
            }];
            const lineDiv = section.createDiv({
                cls: 'nw-u-d-flex nw-u-jc-center'
            });
            this.renderChart(lineDiv, lineChart(emotionSeries, { width: 600, height: 200, title: '情绪强度变化', xAxisLabel: '章节', yAxisLabel: '强度(%)' }));

            // 情绪类型统计柱状图
            const typeCounts: Record<string, number> = {};
            emotionPoints.forEach(p => {
                typeCounts[p.type] = (typeCounts[p.type] || 0) + 1;
            });
            const typeLabels: Record<string, string> = {
                'reversal': '反转',
                'small_climax': '小高潮',
                'trough': '低谷',
                'suspense': '悬念',
                'climax': '高潮'
            };
            const barData = Object.entries(typeCounts).map(([type, count]) => ({
                label: typeLabels[type] || type,
                value: count
            }));
            const barSection = this.createDetailSection(container, '情绪类型分布');
            const barDiv = barSection.createDiv({
                cls: 'nw-u-d-flex nw-u-jc-center'
            });
            this.renderChart(barDiv, barChart(barData, { width: 400, height: 160, title: '情绪类型统计' }));
        }

        // 章节节奏评分折线图
        if (chapterRhythm && chapterRhythm.length > 0) {
            const section = this.createDetailSection(container, '章节节奏评分');
            const series = [
                {
                    name: '情绪分',
                    data: chapterRhythm.slice(0, 20).map(p => ({
                        label: `第${p.chapterIndex}章`,
                        value: p.emotionScore * 100
                    })),
                    smooth: true
                },
                {
                    name: '紧张分',
                    data: chapterRhythm.slice(0, 20).map(p => ({
                        label: `第${p.chapterIndex}章`,
                        value: p.tensionScore * 100
                    })),
                    smooth: true
                },
                {
                    name: '密度分',
                    data: chapterRhythm.slice(0, 20).map(p => ({
                        label: `第${p.chapterIndex}章`,
                        value: p.densityScore * 100
                    })),
                    smooth: true
                }
            ];
            const lineDiv = section.createDiv({
                cls: 'nw-u-d-flex nw-u-jc-center'
            });
            this.renderChart(lineDiv, lineChart(series, { width: 600, height: 220, title: '章节节奏多维评分', xAxisLabel: '章节', yAxisLabel: '评分(%)' }));
        }

        // 节奏事件散点图（使用 emotionPoints）— Task 11: SmartChart 多视图
        if (emotionPoints && emotionPoints.length > 0) {
            const section = this.createDetailSection(container, `节奏事件分布 (${emotionPoints.length})`);
            const scatterPoints = emotionPoints.slice(0, 50).map(p => ({
                x: p.position * 100,
                y: p.intensity * 100,
                label: p.description,
                category: p.type
            }));
            const scatterDiv = section.createDiv({
                cls: 'nw-u-d-flex nw-u-jc-center'
            });
            new SmartChart(scatterDiv, {
                data: scatterPoints,
                preferredType: 'scatter',
                availableTypes: ['scatter', 'densityHeatmap', 'bar'],
                config: {
                    showLegend: true
                },
                context: '节奏事件分布'
            });
        }

        // 爽点/燃点散点图 — Task 11: SmartChart 多视图
        if (data.coolPoints && data.coolPoints.length > 0) {
            const section = this.createDetailSection(container, `爽点/燃点分布 (${data.coolPoints.length})`);
            
            const scatterPoints = data.coolPoints.map(p => ({
                x: p.x,
                y: p.y,
                label: p.label,
                category: p.category
            }));
            const scatterDiv = section.createDiv({
                cls: 'nw-u-d-flex nw-u-jc-center'
            });
            new SmartChart(scatterDiv, {
                data: scatterPoints,
                preferredType: 'scatter',
                availableTypes: ['scatter', 'densityHeatmap', 'bar'],
                config: {
                    showLegend: true
                },
                context: '爽点位置分布'
            });

            // 详情卡片
            const grid = section.createDiv({
                cls: 'nw-u-margintop-12px nw-u-d-grid nw-u-gtc-repeat-auto-fill-minma nw-u-gap-8px'
            });
            data.coolPoints.forEach(p => {
                const card = grid.createDiv({
                    cls: 'nw-u-p-10px nw-u-bg-background-secondary nw-u-brd-6px nw-u-fs-12px'
                });
                card.createEl('div', {
                    text: `${p.category || '未分类'} · 位置 ${formatDetailNumber(p.x, 1, '%')}`,
                    cls: 'nw-u-fwt-500 nw-u-c-interactive-accent nw-u-marginbottom-4px'
                });
                card.createEl('div', { text: p.label, cls: 'nw-u-c-text-muted' });
            });
        }

        // 剧情阶段
        if (data.plotStages && data.plotStages.length > 0) {
            const section = this.createDetailSection(container, '剧情阶段');
            const wrap = section.createDiv({ cls: 'nw-u-d-flex nw-u-fd-column nw-u-gap-6px' });
            data.plotStages.forEach(p => {
                wrap.createDiv({
                    cls: 'nw-u-d-flex nw-u-gap-12px nw-u-ai-center nw-u-p-8px-12px nw-u-bg-background-secondary nw-u-brd-6px'
                }).createEl('div', {
                    text: `${p.name} (${p.start}% - ${p.end}%)`,
                    cls: 'nw-u-fs-13px nw-u-fwt-500'
                });
            });
        }

        // 结构匹配度
        if (data.structureMatches && data.structureMatches.length > 0) {
            const section = this.createDetailSection(container, '结构匹配度');
            const barDiv = section.createDiv();
            this.renderChart(barDiv, barChart(data.structureMatches, { width: 500, height: 160 }));
        }

        if (data.hookAnalysis) {
            const ha = data.hookAnalysis;
            const section = this.createDetailSection(container, '钩子分析');
            const wrap = section.createDiv({ cls: 'nw-u-d-flex nw-u-gap-24px nw-u-fwr-wrap nw-u-ai-flex-start' });
            const chartWrap = wrap.createDiv({ cls: 'nw-u-flex-1 nw-u-minw-200px' });
            const typeDistArr = Object.entries(ha.typeDistribution || {}).map(([k, v]) => ({ label: k, value: v }));
            this.renderChart(chartWrap, donutChart(typeDistArr, { size: 240, title: '钩子类型分布' }));

            const infoWrap = wrap.createDiv({ cls: 'nw-u-flex-1 nw-u-minw-180px nw-u-d-flex nw-u-fd-column nw-u-gap-10px' });
            infoWrap.createDiv({
                text: `钩子率: ${formatDetailNumber(typeof ha.hookRate === 'number' ? ha.hookRate * 100 : undefined, 1, '%')}`,
                cls: 'nw-u-fs-20px nw-u-fwt-700 nw-u-c-interactive-accent'
            });
            infoWrap.createDiv({
                text: `无钩子章节: ${ha.noHookChapters?.length ?? 0} 章`,
                cls: 'nw-u-fs-13px nw-u-c-text-muted'
            });
            infoWrap.createDiv({
                text: `平均强度: ${formatDetailNumber(ha.avgIntensity, 2)}`,
                cls: 'nw-u-fs-13px nw-u-c-text-muted'
            });
            const distWrap = infoWrap.createDiv({ cls: 'nw-u-d-flex nw-u-fd-column nw-u-gap-4px' });
            if (ha.typeDistribution) {
                Object.entries(ha.typeDistribution).forEach(([type, count]) => {
                    distWrap.createDiv({
                        text: `${type}: ${count}`,
                        cls: 'nw-u-fs-12px nw-u-c-text-normal nw-u-p-2px-8px nw-u-bg-background-secondary nw-u-brd-4px'
                    });
                });
            }
        }

        if (data.tensionCurve) {
            const tc = data.tensionCurve;
            const section = this.createDetailSection(container, '张力曲线分析');
            const statsRow = section.createDiv({
                cls: 'nw-u-d-grid nw-u-gtc-repeat-auto-fit-minmax-4 nw-u-gap-12px nw-u-marginbottom-16px'
            });
            this.addInfoItem(statsRow, '平均张力', formatDetailNumber(tc.overallTensionAvg, 3));
            this.addInfoItem(statsRow, '张力标准差', formatDetailNumber(tc.overallTensionStd, 3));
            this.addInfoItem(statsRow, '波形分', formatDetailNumber(tc.waveformScore, 1));

            if (tc.peaks && tc.valleys) {
                const linePoints = [
                    ...tc.peaks.map(p => ({ label: `C${p.chapterIndex}`, value: p.intensity })),
                    ...tc.valleys.map(v => ({ label: `C${v.chapterIndex}`, value: v.intensity }))
                ].sort((a, b) => {
                    const aNum = parseInt(a.label.replace('C', ''), 10);
                    const bNum = parseInt(b.label.replace('C', ''), 10);
                    return aNum - bNum;
                });
                const lineDiv = section.createDiv({ cls: 'nw-u-d-flex nw-u-jc-center' });
                this.renderChart(lineDiv, lineChart([{ name: '张力', data: linePoints, showPoints: true }], { width: 600, height: 200, title: '张力峰谷' }));
            }
        }

        if (data.nrcEmotion) {
            const ne = data.nrcEmotion;
            if (ne.overallDistribution) {
                const nameMap: Record<string, string> = {
                    anger: '愤怒', anticipation: '期待', disgust: '厌恶', fear: '恐惧',
                    joy: '喜悦', sadness: '悲伤', surprise: '惊讶', trust: '信任'
                };
                const section = this.createDetailSection(container, 'NRC 情绪分布');
                const radarData = Object.entries(ne.overallDistribution).map(([k, v]) => ({
                    label: nameMap[k] || k,
                    value: Math.min(100, v * 100)
                }));
                if (radarData.length >= 3) {
                    const radarDiv = section.createDiv({ cls: 'nw-u-d-flex nw-u-jc-center' });
                    this.renderChart(radarDiv, radarChart(radarData, { size: 320, title: 'NRC 八维情绪雷达' }));
                }
            }
        }

        if (data.emotionArc) {
            const ea = data.emotionArc;
            const section = this.createDetailSection(container, '情绪弧线');
            const arcTypeMap: Record<string, string> = {
                rags_to_riches: '逆袭上升 (Rags to Riches)',
                riches_to_rags: '盛极而衰 (Riches to Rags)',
                man_in_hole: '跌入谷底回升 (Man in Hole)',
                icarus: '伊卡洛斯 (Icarus)',
                cinderella: '灰姑娘 (Cinderella)',
                oedipus: '俄狄浦斯 (Oedipus)',
                steady: '平稳型 (Steady)',
                complex: '复杂型 (Complex)'
            };
            const card = section.createDiv({
                cls: 'nw-u-p-16px nw-u-bg-background-secondary nw-u-brd-8px'
            });
            card.createDiv({
                text: `弧线类型: ${arcTypeMap[ea.arcType] || ea.arcType}`,
                cls: 'nw-u-fs-16px nw-u-fwt-600 nw-u-c-interactive-accent nw-u-marginbottom-8px'
            });
            card.createDiv({
                text: `置信度: ${formatDetailPercent(ea.confidence)}`,
                cls: 'nw-u-fs-13px nw-u-c-text-muted'
            });
            if (ea.description) {
                card.createDiv({
                    text: ea.description,
                    cls: 'nw-u-fs-12px nw-u-c-text-muted nw-u-margintop-8px'
                });
            }
        }
    }

    // ---- 结构拆解 Tab ----
    public renderBookStructureTab(container: HTMLElement): void {
        const data = this.deps.getStructureData();
        if (!data || (!data.qcchSegments && !data.rhythmUnits && !data.threeLineStructure && !data.structureType)) {
            this.renderDetailEmpty(container, '结构拆解数据');
            return;
        }

        this.renderQualityScoreCard(container, data as unknown as Record<string, unknown>);

        const book = this.deps.getCurrentBook();
        if (book) {
            container.createDiv({
                text: `基于全书 ${this.deps.formatWordCount(book.wordCount)} 字`,
                cls: 'nw-u-fs-12px nw-u-c-text-muted nw-u-marginbottom-16px'
            });
        }

        const { qcchSegments, rhythmUnits, threeLineStructure, structureType, stats } = data;

        // 结构类型
        if (structureType) {
            const section = this.createDetailSection(container, '结构类型');
            section.createDiv({
                text: structureType,
                cls: 'nw-u-p-14px nw-u-bg-background-secondary nw-u-brd-8px nw-u-fs-14px nw-u-fwt-500'
            });
        }

        // 统计信息
        if (stats) {
            const section = this.createDetailSection(container, '结构统计');
            const grid = section.createDiv({
                cls: 'nw-u-d-grid nw-u-gtc-repeat-auto-fit-minmax-4 nw-u-gap-12px'
            });
            this.addInfoItem(grid, '卷数', stats.volumeCount.toString());
            this.addInfoItem(grid, '章节数', stats.chapterCount.toString());
            this.addInfoItem(grid, '平均章字数', stats.avgChapterWordCount.toString());
            this.addInfoItem(grid, '总字数', stats.totalWordCount.toString());
        }

        // 起承转合结构
        if (qcchSegments && qcchSegments.length > 0) {
            const section = this.createDetailSection(container, '起承转合结构');
            
            const qcchColors: Record<string, string> = {
                '起': '#3b82f6',
                '承': '#10b981',
                '转': '#ef4444',
                '合': '#8b5cf6',
            };
            
            const timelineEvents = qcchSegments.map((seg, i) => ({
                position: seg.startPosition,
                label: seg.type,
                description: seg.type,
                type: seg.type,
                level: 0
            }));
            const timelineDiv = section.createDiv({
                cls: 'nw-u-d-flex nw-u-jc-center'
            });
            this.renderChart(timelineDiv, timelineChart(timelineEvents, { width: 500, height: 100, title: '起承转合时间轴' }));

            const list = section.createDiv({ cls: 'nw-u-margintop-12px nw-u-d-flex nw-u-fd-column nw-u-gap-8px' });
            qcchSegments.forEach(seg => {
                const row = list.createDiv({
                    cls: 'nw-u-d-flex nw-u-gap-12px nw-u-ai-center nw-u-p-10px nw-u-bg-background-secondary nw-u-brd-6px'
                });
                const typeEl = row.createEl('div', {
                    text: seg.type,
                    attr: { style: `min-width:40px;padding:4px 12px;background:${qcchColors[seg.type] || '#6b7280'};color:#fff;border-radius:4px;font-size:13px;font-weight:500;text-align:center;` }
                });
                const content = row.createDiv({ cls: 'nw-u-flex-1' });
                content.createEl('div', {
                    text: `位置: ${formatDetailPercent(seg.startPosition)} - ${formatDetailPercent(seg.endPosition)}`,
                    cls: 'nw-u-fs-13px nw-u-fwt-500 nw-u-marginbottom-2px'
                });
                if (seg.chapterRange && seg.chapterRange.length === 2) {
                    content.createEl('div', {
                        text: `章节范围: 第${seg.chapterRange[0]+1}-${seg.chapterRange[1]+1}章`,
                        cls: 'nw-u-fs-12px nw-u-c-text-muted'
                    });
                }
            });
        }

        // 三线叙事结构
        if (threeLineStructure) {
            const section = this.createDetailSection(container, '三线叙事');
            const lines = [
                { key: 'mainLine', label: '主线', color: '#ef4444' },
                { key: 'subLine', label: '副线', color: '#3b82f6' },
                { key: 'romanceLine', label: '感情线', color: '#ec4899' },
            ];
            
            lines.forEach(({ key, label, color }) => {
                const lineData = threeLineStructure[key as keyof typeof threeLineStructure] as { description: string; keyNodes?: Array<{ position: number; description: string }> };
                if (!lineData) return;
                
                const card = section.createDiv({
                    attr: { style: `border-left:3px solid ${color};padding:12px;background:var(--background-secondary);border-radius:0 6px 6px 0;margin-bottom:8px;` }
                });
                card.createDiv({ text: lineData.description, cls: 'nw-u-fs-12px nw-u-c-text-normal nw-u-lh-1-5' });
                
                if (lineData.keyNodes && lineData.keyNodes.length > 0) {
                    const nodes = card.createDiv({ cls: 'nw-u-margintop-8px nw-u-d-flex nw-u-fwr-gap-4px' });
                    lineData.keyNodes.forEach(node => {
                        nodes.createSpan({
                            text: `${(node.position * 100).toFixed(0)}%`,
                            attr: { style: `padding:2px 8px;background:${color}20;color:${color};border-radius:4px;font-size:11px;margin-right:4px;margin-bottom:4px;display:inline-block;` }
                        });
                    });
                }
            });
        }

        // 章节列表
        if (rhythmUnits && rhythmUnits.length > 0) {
            const chapters = rhythmUnits.filter(u => u.level === 'chapter').slice(0, 10);
            if (chapters.length > 0) {
                const section = this.createDetailSection(container, '章节列表（前10章）');
                const list = section.createDiv({ cls: 'nw-u-d-flex nw-u-fd-column nw-u-gap-6px' });
                chapters.forEach(ch => {
                    const row = list.createDiv({
                        cls: 'nw-u-d-flex nw-u-jc-space-between nw-u-ai-center nw-u-p-8px-12px nw-u-bg-background-secondary nw-u-brd-6px'
                    });
                    row.createSpan({ text: ch.title, cls: 'nw-u-fs-13px nw-u-fwt-500' });
                    row.createSpan({ text: `${formatDetailCount(ch.wordCount)}字`, cls: 'nw-u-fs-12px nw-u-c-text-muted' });
                });
            }
        }
    }

    // ---- 概览 Tab ----
    public renderBookOverviewTab(container: HTMLElement, book: BookBasicInfo): void {
        const infoSection = this.createDetailSection(container, '基本信息');
        const infoGrid = infoSection.createDiv({
            cls: 'nw-u-d-grid nw-u-gtc-repeat-auto-fit-minmax-2 nw-u-gap-12px'
        });
        this.addInfoItem(infoGrid, '书名', book.name);
        this.addInfoItem(infoGrid, '作者', book.author || '未知');
        this.addInfoItem(infoGrid, '字数', this.deps.formatWordCount(book.wordCount));
        this.addInfoItem(infoGrid, '添加时间', this.deps.formatDateTime(book.createdAt));
        this.addInfoItem(infoGrid, '更新时间', this.deps.formatDateTime(book.updatedAt));
        this.addInfoItem(infoGrid, '拆解状态', this.deps.getStatusLabel(book.breakdownStatus));

        if (book.synopsis) {
            const synopsisSection = this.createDetailSection(container, '简介');
            // 简介可能上千字，直接整段渲染会把概览页拉成数千行；限高滚动保留全文
            synopsisSection.createDiv({
                text: book.synopsis,
                cls: 'nw-u-fs-13px nw-u-lh-1-6 nw-u-c-text-normal nw-u-p-12px nw-u-bg-background-secondary nw-u-brd-6px nw-u-maxh-400px nw-u-ovy-auto'
            });
        }

        const genreSection = this.createDetailSection(container, '题材分类');
        this.renderGenreInfo(genreSection, book);

        if (book.qualityScores) {
            const qualitySection = this.createDetailSection(container, '质量评分');
            this.renderQualityChart(qualitySection, book);
        }

        const dimSection = this.createDetailSection(container, '拆解维度');

        if (book.breakdownStatus === 'processing') {
            const activeTasks = this.deps.getDeconstructionScheduler()?.getActiveTasks() || [];
            const bookTask = activeTasks.find(t => t.bookId === book.id);
            const emitter = bookTask ? this.deps.getDeconstructionScheduler()?.getTaskEmitter(bookTask.id) : undefined;
            const emitterState = emitter?.getState();

            if (emitterState) {
                const progressHeader = dimSection.createDiv({
                    cls: 'nw-u-marginbottom-12px'
                });

                const progressInfo = progressHeader.createDiv({
                    cls: 'nw-u-d-flex nw-u-jc-space-between nw-u-ai-center nw-u-marginbottom-6px'
                });
                progressInfo.createSpan({
                    text: `拆解进度：${Math.round(emitterState.progress)}%`,
                    cls: 'nw-u-fs-13px nw-u-fwt-500 nw-u-c-text-normal'
                });
                if (emitterState.currentStep) {
                    progressInfo.createSpan({
                        text: `📍 ${emitterState.currentStep}`,
                        cls: 'nw-u-fs-12px nw-u-c-3b82f6 nw-u-fwt-500'
                    });
                }

                const progressBarWrap = progressHeader.createDiv({
                    cls: 'nw-u-h-8px nw-u-bg-background-secondary nw-u-brd-4px nw-u-ov-hidden nw-u-marginbottom-8px'
                });
                progressBarWrap.createDiv({
                    attr: { style: `height:100%;width:${emitterState.progress}%;background:var(--interactive-accent);transition:width 0.3s;` }
                });

                if (emitterState.message) {
                    progressHeader.createDiv({
                        text: emitterState.message,
                        cls: 'nw-u-fs-12px nw-u-c-text-muted nw-u-marginbottom-8px'
                    });
                }

                const timeInfo = progressHeader.createDiv({
                    cls: 'nw-u-d-flex nw-u-gap-20px nw-u-fs-12px nw-u-c-text-muted'
                });
                if (emitterState.elapsed !== undefined) {
                    timeInfo.createSpan({ text: `⏱️ 已用：${this.deps.formatDuration(emitterState.elapsed)}` });
                }
                if (emitterState.eta !== undefined) {
                    timeInfo.createSpan({ text: `⏳ 剩余：${this.deps.formatDuration(emitterState.eta)}` });
                }
            }
        }

        const dimGrid = dimSection.createDiv({
            cls: 'nw-u-d-grid nw-u-gtc-repeat-auto-fit-minmax-4 nw-u-gap-8px'
        });
        const dimensions: { key: BreakdownDimension; label: string; data: unknown }[] = [
            { key: 'style', label: '风格分析', data: this.deps.getStyleData() },
            { key: 'rhythm', label: '节奏分析', data: this.deps.getRhythmData() },
            { key: 'technique', label: '写作技巧', data: this.deps.getTechniqueData() },
            { key: 'structure', label: '结构拆解', data: this.deps.getStructureData() },
            { key: 'character', label: '人设提取', data: this.deps.getCharacterData() },
            { key: 'foreshadow', label: '伏笔梳理', data: this.deps.getForeshadowData() },
        ];

        const activeTasks = this.deps.getDeconstructionScheduler()?.getActiveTasks() || [];
        const bookTask = activeTasks.find(t => t.bookId === book.id);
        const emitter = bookTask ? this.deps.getDeconstructionScheduler()?.getTaskEmitter(bookTask.id) : undefined;
        const emitterState = emitter?.getState();
        const currentStepName = emitterState?.currentStep;

        dimensions.forEach(dim => {
            const isCurrentStep = currentStepName === this.deps.getDimensionLabels()[dim.key as BreakdownDimension];
            const item = dimGrid.createDiv({
                attr: {
                    style: `padding:12px;border-radius:6px;text-align:center;${
                        dim.data
                            ? 'background:rgba(46,204,113,0.1);'
                            : isCurrentStep
                                ? 'background:rgba(59,130,246,0.1);border:1px solid rgba(59,130,246,0.3);'
                                : 'background:var(--background-secondary);'
                    }`
                }
            });
            item.createDiv({
                text: dim.data ? '✓' : isCurrentStep ? '⏳' : '○',
                attr: {
                    style: `font-size:20px;margin-bottom:4px;${
                        dim.data
                            ? 'color:#2ecc71;'
                            : isCurrentStep
                                ? 'color:#3b82f6;'
                                : 'color:var(--text-muted);'
                    }`
                }
            });
            item.createDiv({
                text: dim.label,
                attr: {
                    style: `font-size:12px;${
                        dim.data
                            ? 'color:var(--text-normal);'
                            : isCurrentStep
                                ? 'color:#3b82f6;font-weight:500;'
                                : 'color:var(--text-muted);'
                    }`
                }
            });
        });
    }

    private createDetailSection(container: HTMLElement, title: string): HTMLElement {
        const section = container.createDiv({ cls: 'nw-u-marginbottom-24px' });
        section.createEl('h3', {
            text: title,
            cls: 'nw-u-m-0-0-12px-0 nw-u-fs-15px nw-u-fwt-600'
        });
        return section;
    }

    private renderChart(container: HTMLElement, svgHtml: string): void {
        container.innerHTML = svgHtml;
        const chartContainer = container.querySelector('.nw-chart-container') as HTMLElement;
        if (chartContainer) {
            attachChartInteractions(chartContainer);
        }
    }

    private addInfoItem(container: HTMLElement, label: string, value: string): void {
        const item = container.createDiv({
            cls: 'nw-u-p-10px-12px nw-u-bg-background-secondary nw-u-brd-6px'
        });
        item.createDiv({ text: label, cls: "nw-text-muted-11 nw-u-marginbottom-4px", attr: {} });
        item.createDiv({ text: value, cls: 'nw-u-fs-13px nw-u-c-text-normal nw-u-fwt-500' });
    }

    private renderGenreInfo(container: HTMLElement, book: BookBasicInfo): void {
        const card = container.createDiv({
            cls: 'nw-u-p-16px nw-u-bg-background-secondary nw-u-brd-8px'
        });

        const headerRow = card.createDiv({
            cls: "nw-flex-between nw-u-marginbottom-12px", attr: {}
        });
        headerRow.createSpan({
            text: '分类信息',
            cls: 'nw-u-fs-13px nw-u-fwt-600 nw-u-c-text-normal'
        });

        const actionBtns = headerRow.createDiv({ cls: 'nw-u-d-flex nw-u-gap-6px' });

        const autoClassifyBtn = actionBtns.createEl('button', {
            text: '🔍 自动分类',
            cls: 'nw-btn nw-btn-secondary nw-btn-xs',
            attr: { title: 'AI 自动识别本书题材与子题材' }
        });
        autoClassifyBtn.addEventListener('click', async () => {
            await this.deps.onClassifyBook(book);
        });

        const editBtn = actionBtns.createEl('button', {
            text: '✏️ 编辑',
            cls: 'nw-btn nw-btn-secondary nw-btn-xs',
            attr: { title: '编辑分类信息' }
        });
        editBtn.addEventListener('click', () => this.deps.onEditBook(book));

        const rows: { label: string; value: string; confidence?: number }[] = [
            { label: '频道', value: this.deps.getChannelLabel(book.genreChannel || '未分类'), confidence: book.genreChannelConfidence },
            { label: '大类', value: this.getGenreName(book.primaryGenre), confidence: book.primaryGenreConfidence },
            { label: '细分', value: this.getSubGenreName(book.primaryGenre, book.primarySubGenre), confidence: book.primarySubGenreConfidence },
        ];

        rows.forEach(row => {
            const rowEl = card.createDiv({
                cls: 'nw-u-d-flex nw-u-ai-center nw-u-marginbottom-8px'
            });
            rowEl.createSpan({
                text: row.label + '：',
                cls: "nw-flex-shrink-0 nw-u-fs-13px nw-u-c-text-muted nw-u-w-60px", attr: {}
            });
            const valueEl = rowEl.createSpan({
                text: row.value,
                cls: 'nw-u-fs-13px nw-u-c-text-normal nw-u-fwt-500 nw-u-flex-1'
            });
            if (row.confidence !== undefined) {
                valueEl.createSpan({
                    text: ` ${formatDetailPercent(row.confidence)}`,
                    cls: "nw-text-muted-11 nw-u-fwt-400 nw-u-marginleft-4px", attr: {}
                });
            }
        });

        if (book.genreRecommendations && book.genreRecommendations.length > 0) {
            const recSection = card.createDiv({ cls: 'nw-u-margintop-12px nw-u-paddingtop-12px nw-u-bt-1px-solid-background-m' });
            recSection.createDiv({
                text: '分类建议 (Top 3)',
                cls: "nw-text-sm-muted nw-u-marginbottom-8px", attr: {}
            });

            book.genreRecommendations.forEach((rec, idx) => {
                const recRow = recSection.createDiv({
                    cls: 'nw-u-d-flex nw-u-ai-center nw-u-jc-space-between nw-u-p-6px-8px nw-u-brd-4px nw-u-cur-pointer nw-u-transition-background-0-15s nw-u-marginbottom-4px'
                });
                recRow.addEventListener('mouseenter', () => {
                    recRow.style.background = 'var(--background-primary)';
                });
                recRow.addEventListener('mouseleave', () => {
                    recRow.style.background = 'transparent';
                });
                recRow.addEventListener('click', async () => {
                    await this.deps.onApplyGenreRecommendation(book, rec);
                });

                const left = recRow.createDiv({ cls: 'nw-u-d-flex nw-u-ai-center nw-u-gap-8px' });
                left.createSpan({
                    text: `${idx + 1}.`,
                    cls: "nw-text-sm-muted nw-u-w-16px", attr: {}
                });
                left.createSpan({
                    text: `${this.getGenreName(rec.genreId)}${rec.subGenreId ? ' · ' + this.getSubGenreName(rec.genreId, rec.subGenreId) : ''}`,
                    cls: 'nw-u-fs-12px nw-u-c-text-normal'
                });

                const confBar = recRow.createDiv({
                    cls: 'nw-u-w-80px nw-u-h-6px nw-u-bg-background-primary nw-u-brd-3px nw-u-ov-hidden'
                });
                confBar.createDiv({
                    attr: { style: `height:100%;width:${(rec.confidence * 100).toFixed(0)}%;background:var(--interactive-accent);border-radius:3px;` }
                });
            });
        }

        if (book.secondaryGenres && book.secondaryGenres.length > 0) {
            const row = card.createDiv({ cls: 'nw-u-d-flex nw-u-ai-flex-start nw-u-margintop-8px' });
            row.createSpan({
                text: '次要：',
                cls: "nw-flex-shrink-0 nw-u-fs-13px nw-u-c-text-muted nw-u-w-60px", attr: {}
            });
            const tagsEl = row.createDiv({ cls: "nw-flex-wrap-sm nw-u-flex-1", attr: {} });
            book.secondaryGenres.forEach(gid => {
                const g = this.deps.getKb()?.getGenre(gid);
                if (g) {
                    tagsEl.createSpan({
                        text: g.name,
                        cls: 'nw-u-p-2px-8px nw-u-fs-11px nw-u-bg-background-primary nw-u-brd-10px nw-u-c-text-muted'
                    });
                }
            });
        }
    }

    private getGenreName(genreId?: string): string {
        const kb = this.deps.getKb();
        if (!genreId || !kb) return '未分类';
        const genre = kb.getGenre(genreId);
        return genre?.name || genreId;
    }

    private getSubGenreName(genreId?: string, subGenreId?: string): string {
        const kb = this.deps.getKb();
        if (!genreId || !subGenreId || !kb) return '未分类';
        const sub = kb.getSubGenre(genreId, subGenreId);
        return sub?.name || subGenreId;
    }

    private renderQualityChart(container: HTMLElement, book: BookBasicInfo): void {
        if (!book.qualityScores) return;

        const qs = book.qualityScores;

        const wrap = container.createDiv({
            cls: 'nw-u-d-flex nw-u-gap-24px nw-u-fwr-wrap nw-u-ai-flex-start'
        });

        const radarCard = wrap.createDiv({
            cls: 'nw-u-flex-1 nw-u-minw-320px nw-u-d-flex nw-u-jc-center'
        });
        const radarData = [
            { label: '人设', value: qs.character },
            { label: '伏笔', value: qs.foreshadow },
            { label: '技巧', value: qs.technique },
            { label: '风格', value: qs.style },
            { label: '节奏', value: qs.rhythm },
            { label: '结构', value: qs.structure },
            { label: '商业', value: qs.commercial ?? 0 },
            { label: '可读', value: qs.readability ?? 0 },
        ];
        this.renderChart(radarCard, radarChart(radarData, { size: 300, title: '质量雷达图 (8维)' }));

        const scoresCard = wrap.createDiv({
            cls: 'nw-u-flex-1 nw-u-minw-200px'
        });

        const overall = scoresCard.createDiv({
            cls: 'nw-u-ta-center nw-u-marginbottom-20px nw-u-p-16px nw-u-bg-background-secondary nw-u-brd-8px'
        });
        overall.createDiv({
            text: formatDetailNumber(qs.overall, 0),
            cls: 'nw-u-fs-36px nw-u-fwt-700 nw-u-c-interactive-accent'
        });
        overall.createDiv({ text: '综合评分', cls: 'nw-u-fs-13px nw-u-c-text-muted nw-u-margintop-4px' });

        const scores = [
            { name: '人设', value: qs.character },
            { name: '伏笔', value: qs.foreshadow },
            { name: '技巧', value: qs.technique },
            { name: '风格', value: qs.style },
            { name: '节奏', value: qs.rhythm },
            { name: '结构', value: qs.structure },
            { name: '商业', value: qs.commercial, optional: true },
            { name: '可读', value: qs.readability, optional: true },
        ];
        scores.forEach(s => {
            const item = scoresCard.createDiv({ cls: 'nw-u-marginbottom-10px' });
            const top = item.createDiv({ cls: 'nw-u-d-flex nw-u-jc-space-between nw-u-marginbottom-4px' });
            top.createSpan({ text: s.name, cls: 'nw-u-fs-12px nw-u-c-text-normal' });
            if (s.optional && s.value == null) {
                top.createSpan({ text: 'N/A', cls: 'nw-u-fs-12px nw-u-c-text-faint' });
            } else {
                top.createSpan({ text: formatDetailNumber(s.value, 0, '分'), cls: 'nw-text-sm-muted' });
            }
            const bar = item.createDiv({
                cls: 'nw-u-h-6px nw-u-bg-background-secondary nw-u-brd-3px nw-u-ov-hidden'
            });
            const displayVal = s.optional && s.value == null ? 0 : (s.value ?? 0);
            bar.createDiv({
                attr: { style: `height:100%;width:${displayVal}%;background:var(--interactive-accent);border-radius:3px;` }
            });
        });
    }

    // ---- 人设 Tab ----
    public renderBookCharacterTab(container: HTMLElement): void {
        const data = this.deps.getCharacterData();

        if (!data || !data.characters || data.characters.length === 0) {
            this.renderDetailEmpty(container, '人设数据');
            return;
        }

        this.renderQualityScoreCard(container, data as unknown as Record<string, unknown>);

        const sortedChars = [...data.characters].sort((a, b) =>
            (b.importance?.totalScore ?? 0) - (a.importance?.totalScore ?? 0)
        );

        const book = this.deps.getCurrentBook();
        if (book) {
            container.createDiv({
                text: `基于全书 ${this.deps.formatWordCount(book.wordCount)} 字`,
                cls: 'nw-u-fs-12px nw-u-c-text-muted nw-u-marginbottom-16px'
            });
        }

        if (data.stats) {
            const section = this.createDetailSection(container, '角色统计');
            const statsGrid = section.createDiv({
                cls: 'nw-u-d-grid nw-u-gtc-repeat-auto-fit-minmax-3 nw-u-gap-12px'
            });
            this.addInfoItem(statsGrid, '总角色数', String(data.stats.totalCharacters));
            this.addInfoItem(statsGrid, '主角数', String(data.stats.mainCharacterCount));
            this.addInfoItem(statsGrid, '人均出场', formatDetailNumber(data.stats.avgAppearancePerCharacter, 1));
        }

        // 角色重要性排行
        if (sortedChars.length > 0) {
            const rankSection = this.createDetailSection(container, '角色重要度排行');
            const rankTable = rankSection.createDiv({
                cls: 'nw-u-ovx-auto nw-u-b-1px-solid-background-m nw-u-brd-6px'
            });
            const table = rankTable.createEl('table', {
                cls: 'nw-u-w-100 nw-u-bordercollapse-collapse nw-u-fs-12px'
            });
            const thead = table.createEl('thead');
            const headRow = thead.createEl('tr', { cls: 'nw-u-bg-background-secondary' });
            ['排名', '姓名', '分级', '综合', '出场', '对话', '剧情', '关系', '视角'].forEach(h => {
                headRow.createEl('th', {
                    text: h,
                    cls: 'nw-u-p-8px-10px nw-u-ta-left nw-u-fwt-600 nw-u-bb-1px-solid-background-m'
                });
            });
            const tbody = table.createEl('tbody');
            sortedChars.slice(0, 10).forEach((char, idx) => {
                const row = tbody.createEl('tr', {
                    attr: { style: idx % 2 === 0 ? '' : 'background:var(--background-secondary-alt);' }
                });
                const imp = char.importance;
                const cells = [
                    idx + 1,
                    char.name,
                    this.getTierLabel(imp?.tier),
                    `${imp?.totalScore ?? 0}`,
                    `${imp?.appearanceFrequency ?? 0}%`,
                    `${imp?.dialogueRatio ?? 0}%`,
                    `${imp?.plotDrivingScore ?? 0}%`,
                    `${imp?.relationshipCentrality ?? 0}%`,
                    `${imp?.perspectiveRatio ?? 0}%`,
                ];
                cells.forEach((c, i) => {
                    row.createEl('td', {
                        text: String(c),
                        attr: { style: 'padding:6px 10px;border-bottom:1px solid var(--background-modifier-border);' + (i === 1 ? 'font-weight:500;' : '') }
                    });
                });
            });
        }

        // 主角重要性雷达图
        if (sortedChars.length > 0) {
            const topChar = sortedChars[0];
            if (topChar.importance) {
                const radarSection = this.createDetailSection(container, `主角重要性分析 - ${topChar.name}`);
                const radarData = [
                    { label: '出场频率', value: topChar.importance.appearanceFrequency },
                    { label: '对白占比', value: topChar.importance.dialogueRatio },
                    { label: '剧情驱动', value: topChar.importance.plotDrivingScore },
                    { label: '关系中心', value: topChar.importance.relationshipCentrality },
                    { label: '视角占比', value: topChar.importance.perspectiveRatio },
                ];
                const radarDiv = radarSection.createDiv({
                    cls: 'nw-u-d-flex nw-u-jc-center'
                });
                this.renderChart(radarDiv, radarChart(radarData, { size: 320, title: '角色重要性维度' }));
            }
        }

        // 角色卡片列表
        const mainSection = this.createDetailSection(container, '角色列表');
        const grid = mainSection.createDiv({
            cls: 'nw-u-d-grid nw-u-gtc-repeat-auto-fill-minma-2 nw-u-gap-12px'
        });

        sortedChars.forEach((char, idx) => {
            const key = `char_main_${idx}`;
            const isExpanded = this.deps.getExpandedItems()[key] ?? false;

            const card = grid.createDiv({
                cls: 'nw-u-b-1px-solid-background-m nw-u-brd-8px nw-u-ov-hidden nw-u-bg-background-primary'
            });

            const header = card.createDiv({
                cls: 'nw-u-p-12px nw-u-cur-pointer nw-u-d-flex nw-u-ai-center nw-u-gap-10px'
            });

            const avatar = header.createDiv({
                text: char.name.charAt(0),
                cls: "nw-flex-center nw-flex-shrink-0 nw-u-w-40px nw-u-h-40px nw-u-brd-50 nw-u-bg-interactive-accent nw-u-c-text-on-accent nw-u-fs-16px nw-u-fwt-600", attr: {}
            });
            void avatar;

            const info = header.createDiv({ cls: 'nw-u-flex-1 nw-u-minw-0' });
            info.createDiv({ text: char.name, cls: 'nw-u-fs-14px nw-u-fwt-500 nw-u-marginbottom-2px' });
            const roleInfo = [char.role || '未知角色', char.gender || ''];
            if (char.importance?.tier) roleInfo.push(this.getTierLabel(char.importance.tier));
            info.createDiv({ text: roleInfo.filter(Boolean).join(' · '), cls: 'nw-text-sm-muted' });

            const toggle = header.createSpan({
                text: isExpanded ? '▼' : '▶',
                cls: 'nw-text-sm-muted nw-flex-shrink-0'
            });
            void toggle;

            header.addEventListener('click', () => {
                this.deps.getExpandedItems()[key] = !isExpanded;
                this.deps.onRequestReRender();
            });

            // 标签显示（性格+能力）
            const tagsEl = card.createDiv({
                cls: "nw-flex-wrap-sm nw-u-p-0-12px-12px", attr: {}
            });
            const allTags = [...(char.personality || []), ...(char.abilities || [])];
            allTags.slice(0, 4).forEach(tag => {
                tagsEl.createSpan({
                    text: tag,
                    cls: 'nw-u-p-2px-8px nw-u-fs-11px nw-u-bg-background-secondary nw-u-c-text-muted nw-u-brd-10px'
                });
            });

            // 角色弧光进度条
            if (char.characterArc) {
                const arcBar = card.createDiv({
                    cls: 'nw-u-p-0-12px-10px nw-u-d-flex nw-u-ai-center nw-u-gap-8px'
                });
                arcBar.createSpan({
                    text: this.getArcTypeLabel(char.characterArc.transformationType),
                    cls: "nw-flex-shrink-0 nw-u-fs-11px nw-u-p-2px-6px nw-u-bg-rgba-interactive-accen nw-u-c-interactive-accent nw-u-brd-4px", attr: {}
                });
                const barBg = arcBar.createDiv({
                    cls: 'nw-u-flex-1 nw-u-h-6px nw-u-bg-background-secondary nw-u-brd-3px nw-u-ov-hidden'
                });
                barBg.createDiv({
                    attr: { style: `height:100%;width:${char.characterArc.completeness}%;background:var(--interactive-accent);border-radius:3px;` }
                });
                arcBar.createSpan({
                    text: `${char.characterArc.completeness}%`,
                    cls: 'nw-text-muted-11 nw-flex-shrink-0'
                });
            }

            if (isExpanded) {
                const body = card.createDiv({
                    cls: 'nw-u-p-12px nw-u-bt-1px-solid-background-m nw-u-bg-background-secondary'
                });

                // 基础统计
                const statsRow = body.createDiv({
                    cls: 'nw-u-d-grid nw-u-gtc-repeat-4-1fr nw-u-gap-8px nw-u-marginbottom-12px'
                });
                const quickStats = [
                    { label: '出场', value: char.appearanceCount ?? '-' },
                    { label: '提及', value: char.mentionCount ?? '-' },
                    { label: '首次', value: char.firstAppearance ? `${(char.firstAppearance * 100).toFixed(0)}%` : '-' },
                    { label: '末次', value: char.lastAppearance ? `${(char.lastAppearance * 100).toFixed(0)}%` : '-' },
                ];
                quickStats.forEach(s => {
                    const item = statsRow.createDiv({
                        cls: 'nw-u-ta-center nw-u-p-6px nw-u-bg-background-primary nw-u-brd-4px'
                    });
                    item.createDiv({ text: String(s.value), cls: 'nw-u-fs-14px nw-u-fwt-600' });
                    item.createDiv({ text: s.label, cls: 'nw-u-fs-10px nw-u-c-text-muted' });
                });

                // 性格特点
                if (char.personality && char.personality.length > 0) {
                    body.createDiv({ text: '🏷️ 性格特点', cls: "nw-text-sm-muted nw-u-marginbottom-6px nw-u-fwt-500", attr: {} });
                    const tagsWrap = body.createDiv({ cls: "nw-flex-wrap-sm nw-u-marginbottom-12px", attr: {} });
                    char.personality.forEach(tag => {
                        tagsWrap.createSpan({
                            text: tag,
                            cls: 'nw-u-p-2px-8px nw-u-fs-11px nw-u-bg-background-primary nw-u-c-text-normal nw-u-brd-10px'
                        });
                    });
                }

                // 能力特点
                if (char.abilities && char.abilities.length > 0) {
                    body.createDiv({ text: '🛡️ 能力特点', cls: "nw-text-sm-muted nw-u-marginbottom-6px nw-u-fwt-500", attr: {} });
                    const tagsWrap = body.createDiv({ cls: "nw-flex-wrap-sm nw-u-marginbottom-12px", attr: {} });
                    char.abilities.forEach(tag => {
                        tagsWrap.createSpan({
                            text: tag,
                            cls: 'nw-u-p-2px-8px nw-u-fs-11px nw-u-bg-background-primary nw-u-c-text-normal nw-u-brd-10px'
                        });
                    });
                }

                // 角色弧光详情
                if (char.characterArc) {
                    body.createDiv({ text: '⚡ 角色弧光', cls: "nw-text-sm-muted nw-u-marginbottom-6px nw-u-fwt-500", attr: {} });
                    const arcInfo = body.createDiv({
                        cls: 'nw-u-p-8px nw-u-bg-background-primary nw-u-brd-4px nw-u-marginbottom-12px'
                    });
                    arcInfo.createDiv({
                        text: `转变类型：${this.getArcTypeLabel(char.characterArc.transformationType)}`,
                        cls: 'nw-u-fs-12px nw-u-marginbottom-4px'
                    });
                    arcInfo.createDiv({
                        text: `弧光完整度：${char.characterArc.completeness}%`,
                        cls: 'nw-u-fs-12px nw-u-marginbottom-4px'
                    });
                    if (char.characterArc.initialState?.goals && char.characterArc.initialState.goals.length > 0) {
                        const goalText = char.characterArc.initialState.goals[0];
                        arcInfo.createDiv({
                            text: `初始目标：${goalText.length > 40 ? goalText.substring(0, 40) + '...' : goalText}`,
                            cls: 'nw-u-fs-12px'
                        });
                    }

                    // 成长节点
                    if (char.characterArc.growthNodes && char.characterArc.growthNodes.length > 0) {
                        body.createDiv({ text: '📈 成长节点', cls: "nw-text-sm-muted nw-u-marginbottom-6px nw-u-fwt-500", attr: {} });
                        const nodesList = body.createDiv({
                            cls: 'nw-u-marginbottom-12px nw-u-maxh-150px nw-u-ovy-auto'
                        });
                        char.characterArc.growthNodes.slice(0, 5).forEach(node => {
                            const nodeItem = nodesList.createDiv({
                                cls: 'nw-u-p-6px-8px nw-u-bg-background-primary nw-u-brd-4px nw-u-marginbottom-4px nw-u-fs-11px'
                            });
                            const topRow = nodeItem.createDiv({ cls: 'nw-u-d-flex nw-u-jc-space-between nw-u-marginbottom-2px' });
                            topRow.createSpan({
                                text: `[${node.changeType}]`,
                                cls: 'nw-u-c-interactive-accent nw-u-fwt-500'
                            });
                            topRow.createSpan({
                                text: `${(node.position * 100).toFixed(0)}%`,
                                cls: 'nw-u-c-text-muted'
                            });
                            nodeItem.createDiv({
                                text: node.event.length > 50 ? node.event.substring(0, 50) + '...' : node.event,
                                cls: 'nw-u-c-text-normal nw-u-lh-1-4'
                            });
                        });
                    }
                }
            }
        });

        if (data.relationDetails && data.relationDetails.length > 0) {
            const relSection = this.createDetailSection(container, '关系深度分析');
            const relGrid = relSection.createDiv({
                cls: 'nw-u-d-grid nw-u-gtc-repeat-auto-fill-minma-3 nw-u-gap-10px'
            });
            data.relationDetails.slice(0, 8).forEach((rd, idx) => {
                const relKey = `rel_detail_${idx}`;
                const isExpanded = this.deps.getExpandedItems()[relKey] ?? false;
                const fromChar = data.allCharacters?.find(c => c.name === (data.mainCharacters?.find(m => m.name)?.name)) ||
                    { name: rd.fromId };
                const toChar = { name: rd.toId };
                const fromName = data.mainCharacters?.find(m => m.name === rd.fromId)?.name ||
                    data.allCharacters?.find(c => c.name === rd.fromId)?.name || rd.fromId;
                const toName = data.mainCharacters?.find(m => m.name === rd.toId)?.name ||
                    data.allCharacters?.find(c => c.name === rd.toId)?.name || rd.toId;

                const card = relGrid.createDiv({
                    cls: 'nw-u-b-1px-solid-background-m nw-u-brd-6px nw-u-ov-hidden'
                });
                const header = card.createDiv({
                    cls: 'nw-u-p-10px nw-u-cur-pointer nw-u-d-flex nw-u-ai-center nw-u-gap-8px nw-u-bg-background-secondary'
                });
                header.createDiv({
                    text: `${fromName} ↔ ${toName}`,
                    cls: "nw-ellipsis nw-u-flex-1 nw-u-fs-13px nw-u-fwt-500 nw-u-minw-0", attr: {}
                });
                const strengthBadge = header.createSpan({
                    text: `${rd.strength}%`,
                    cls: "nw-flex-shrink-0 nw-u-p-2px-6px nw-u-fs-10px nw-u-bg-interactive-accent nw-u-c-text-on-accent nw-u-brd-4px", attr: {}
                });
                void strengthBadge;
                header.createSpan({
                    text: isExpanded ? '▼' : '▶',
                    cls: "nw-flex-shrink-0 nw-u-fs-10px nw-u-c-text-muted", attr: {}
                });
                header.addEventListener('click', () => {
                    this.deps.getExpandedItems()[relKey] = !isExpanded;
                    this.deps.onRequestReRender();
                });

                card.createDiv({
                    text: rd.type,
                    cls: "nw-text-muted-11 nw-u-p-4px-10px nw-u-bg-background-primary", attr: {}
                });

                if (isExpanded) {
                    const body = card.createDiv({
                        cls: 'nw-u-p-10px nw-u-bt-1px-solid-background-m nw-u-fs-12px'
                    });
                    if (rd.history && rd.history.length > 0) {
                        body.createDiv({ text: '关系变化', cls: 'nw-u-fwt-500 nw-u-marginbottom-6px nw-u-c-text-muted' });
                        rd.history.forEach(h => {
                            body.createDiv({
                                text: `${(h.position * 100).toFixed(0)}%：${h.fromType} → ${h.toType}`,
                                cls: 'nw-u-p-4px-0 nw-u-bb-1px-dashed-background-'
                            });
                        });
                    }
                    if (rd.keyEvents && rd.keyEvents.length > 0) {
                        body.createDiv({ text: '关键事件', cls: 'nw-u-fwt-500 nw-u-m-8px-0-6px nw-u-c-text-muted' });
                        rd.keyEvents.slice(0, 3).forEach(e => {
                            body.createDiv({
                                text: e.length > 50 ? e.substring(0, 50) + '...' : e,
                                cls: 'nw-u-p-4px-0 nw-u-fs-11px nw-u-lh-1-4'
                            });
                        });
                    }
                }
            });
        }

        if (data.relationships && data.relationships.length > 0) {
            const netSection = this.createDetailSection(container, `人物关系网络 (${data.relationships.length})`);
            const netTable = netSection.createDiv({
                cls: 'nw-u-maxh-250px nw-u-ovy-auto nw-u-b-1px-solid-background-m nw-u-brd-6px'
            });
            const table = netTable.createEl('table', {
                cls: 'nw-u-w-100 nw-u-bordercollapse-collapse nw-u-fs-12px'
            });
            const thead = table.createEl('thead');
            const headRow = thead.createEl('tr', { cls: 'nw-u-pos-sticky nw-u-t-0 nw-u-bg-background-secondary nw-u-z-1' });
            ['人物A', '人物B', '关系类型', '强度'].forEach(h => {
                headRow.createEl('th', {
                    text: h,
                    cls: 'nw-u-p-8px-10px nw-u-ta-left nw-u-fwt-600 nw-u-bb-1px-solid-background-m'
                });
            });
            const tbody = table.createEl('tbody');
            data.relationships.forEach((rel, idx) => {
                const row = tbody.createEl('tr', {
                    attr: { style: idx % 2 === 0 ? '' : 'background:var(--background-secondary-alt);' }
                });
                const fromName = data.mainCharacters?.find(m => m.name === rel.from)?.name ||
                    data.allCharacters?.find(c => c.name === rel.from)?.name || rel.from;
                const toName = data.mainCharacters?.find(m => m.name === rel.to)?.name ||
                    data.allCharacters?.find(c => c.name === rel.to)?.name || rel.to;
                row.createEl('td', { text: fromName, cls: 'nw-u-p-6px-10px nw-u-bb-1px-solid-background-m' });
                row.createEl('td', { text: toName, cls: 'nw-u-p-6px-10px nw-u-bb-1px-solid-background-m' });
                row.createEl('td', { text: rel.type, cls: 'nw-u-p-6px-10px nw-u-bb-1px-solid-background-m' });
                const strength = rel.weight ? Math.round(rel.weight * 100) : '-';
                row.createEl('td', { text: `${strength}${typeof strength === 'number' ? '%' : ''}`, cls: 'nw-u-p-6px-10px nw-u-bb-1px-solid-background-m' });
            });
        }

        if (data.allCharacters && data.allCharacters.length > 0) {
            const allSection = this.createDetailSection(container, `全部角色 (${data.allCharacters.length})`);
            const list = allSection.createDiv({
                cls: 'nw-u-maxh-300px nw-u-ovy-auto nw-u-b-1px-solid-background-m nw-u-brd-6px'
            });
            data.allCharacters.forEach((char, idx) => {
                const item = list.createDiv({
                    attr: {
                        style: `padding:8px 12px;display:flex;align-items:center;gap:10px;${
                            idx < data.allCharacters!.length - 1 ? 'border-bottom:1px solid var(--background-modifier-border);' : ''
                        }`
                    }
                });
                item.createSpan({
                    text: char.name.charAt(0),
                    cls: "nw-flex-center nw-flex-shrink-0 nw-u-w-24px nw-u-h-24px nw-u-brd-50 nw-u-bg-background-secondary nw-u-fs-11px nw-u-fwt-500", attr: {}
                });
                item.createSpan({ text: char.name, cls: 'nw-u-fs-13px nw-u-fwt-500 nw-u-flex-1' });
                const roleParts = [char.role || ''];
                if (char.tier) roleParts.push(this.getTierLabel(char.tier));
                item.createSpan({ text: roleParts.filter(Boolean).join(' · '), cls: 'nw-text-sm-muted nw-flex-shrink-0' });
                if (char.tags && char.tags.length > 0) {
                    const tagsWrap = item.createDiv({ cls: "nw-flex-shrink-0 nw-u-d-flex nw-u-gap-4px", attr: {} });
                    char.tags.slice(0, 2).forEach(tag => {
                        tagsWrap.createSpan({
                            text: tag,
                            cls: 'nw-u-p-1px-6px nw-u-fs-10px nw-u-bg-background-secondary nw-u-c-text-muted nw-u-brd-8px'
                        });
                    });
                }
            });
        }

        if (data.relations && data.relations.length > 0) {
            const relKey = 'char_rel_network';
            const isExpanded = this.deps.getExpandedItems()[relKey] ?? false;
            const section = this.createDetailSection(container, '角色关系网络');
            const header = section.createDiv({
                cls: 'nw-u-d-flex nw-u-ai-center nw-u-gap-8px nw-u-cur-pointer nw-u-p-8px-0'
            });
            header.createSpan({
                text: isExpanded ? '▼' : '▶',
                cls: 'nw-u-fs-12px nw-u-c-text-muted'
            });
            header.createSpan({
                text: `${data.relations.length} 条关系`,
                cls: 'nw-u-fs-13px nw-u-c-text-muted'
            });
            header.addEventListener('click', () => {
                this.deps.getExpandedItems()[relKey] = !isExpanded;
                this.deps.onRequestReRender();
            });

            if (isExpanded) {
                const list = section.createDiv({
                    cls: 'nw-u-d-flex nw-u-fd-column nw-u-gap-6px nw-u-maxh-400px nw-u-ovy-auto'
                });
                data.relations.slice(0, 15).forEach(rel => {
                    const relItem = list.createDiv({
                        cls: 'nw-u-p-8px-12px nw-u-bg-background-secondary nw-u-brd-6px nw-u-fs-12px nw-u-d-flex nw-u-ai-center nw-u-gap-10px'
                    });
                    relItem.createSpan({
                        text: `${rel.fromId} → ${rel.toId}`,
                        cls: 'nw-u-fwt-500 nw-u-c-text-normal nw-u-minw-120px'
                    });
                    relItem.createSpan({
                        text: rel.type,
                        cls: 'nw-u-c-interactive-accent nw-u-p-2px-8px nw-u-bg-rgba-interactive-accen nw-u-brd-4px'
                    });
                    const weightPct = rel.weight != null ? `${(rel.weight * 100).toFixed(0)}%` : '-';
                    relItem.createSpan({
                        text: `权重: ${weightPct}`,
                        cls: 'nw-u-c-text-muted'
                    });
                    const eventCount = rel.keyEvents?.length ?? 0;
                    relItem.createSpan({
                        text: `事件: ${eventCount}`,
                        cls: 'nw-u-c-text-muted nw-u-marginleft-auto'
                    });
                });
            }
        }

        if (data.networkCentrality?.centrality && data.networkCentrality.centrality.length > 0) {
            const centralityList = [...data.networkCentrality.centrality]
                .sort((a, b) => b.pagerank - a.pagerank);
            const section = this.createDetailSection(container, '角色中心度排名 (PageRank)');
            const barData = centralityList.slice(0, 10).map(c => ({
                label: c.characterName,
                value: c.pagerank
            }));
            const chartDiv = section.createDiv({ cls: 'nw-u-d-flex nw-u-jc-center' });
            this.renderChart(chartDiv, barChart(barData, { width: 500, height: 220, horizontal: true, title: 'PageRank 中心度' }));
        }
    }

    private getTierLabel(tier?: string): string {
        const labels: Record<string, string> = {
            protagonist: '主角',
            core_supporting: '核心配角',
            important_supporting: '重要配角',
            minor_supporting: '次要配角',
            extra: '路人角色'
        };
        return labels[tier || 'extra'] || tier || '';
    }

    private getArcTypeLabel(type: string): string {
        const labels: Record<string, string> = {
            growth: '成长型',
            fall: '堕落型',
            awakening: '觉醒型',
            darkening: '黑化型',
            return: '回归型',
            stable: '稳定型'
        };
        return labels[type] || type;
    }

    private getTimelineIcon(type: string): string {
        const icons: Record<string, string> = {
            appearance: '👤',
            growth: '📈',
            relationship: '💞',
            plot: '📌',
            turning_point: '⚡'
        };
        return icons[type] || '•';
    }

    // ---- 伏笔 Tab ----
    public renderBookForeshadowTab(container: HTMLElement): void {
        const data = this.deps.getForeshadowData();

        if (!data || !data.foreshadows || data.foreshadows.length === 0) {
            this.renderDetailEmpty(container, '伏笔数据');
            return;
        }

        this.renderQualityScoreCard(container, data as unknown as Record<string, unknown>);

        const book = this.deps.getCurrentBook();
        if (book) {
            container.createDiv({
                text: `基于全书 ${this.deps.formatWordCount(book.wordCount)} 字`,
                cls: 'nw-u-fs-12px nw-u-c-text-muted nw-u-marginbottom-16px'
            });
        }

        const { foreshadows, typeDistribution, stats, qualityScore } = data;

        // 质量评分
        if (qualityScore) {
            const scoreSection = this.createDetailSection(container, '伏笔质量评分');
            const scoreGrid = scoreSection.createDiv({
                cls: 'nw-u-d-grid nw-u-gtc-repeat-auto-fit-minmax-4 nw-u-gap-10px'
            });
            const scoreItems = [
                { label: '综合评分', value: `${qualityScore.totalScore}分`, color: 'var(--interactive-accent)' },
                { label: '类型多样性', value: `${qualityScore.diversityScore}%`, color: '#2ecc71' },
                { label: '回收率', value: `${qualityScore.resolutionRate}%`, color: '#f59e0b' },
                { label: '信噪比', value: `${qualityScore.signalNoiseRatio}%`, color: '#9b59b6' },
                { label: '覆盖度', value: `${qualityScore.coverageScore}%`, color: '#3b82f6' },
            ];
            scoreItems.forEach(item => {
                const card = scoreGrid.createDiv({
                    cls: 'nw-u-p-12px nw-u-ta-center nw-u-bg-background-secondary nw-u-brd-6px'
                });
                card.createDiv({
                    text: item.value,
                    attr: { style: `font-size:16px;font-weight:700;color:${item.color};margin-bottom:4px;` }
                });
                card.createDiv({ text: item.label, cls: 'nw-text-muted-11' });
            });
        }

        // 统计概览
        const statsSection = this.createDetailSection(container, '伏笔统计');
        
        if (stats) {
            const donutData = [
                { label: '已回收', value: stats.resolvedCount, color: '#2ecc71' },
                { label: '未回收', value: stats.unresolvedCount, color: '#f59e0b' },
            ];
            const donutDiv = statsSection.createDiv({
                cls: 'nw-u-d-flex nw-u-jc-center nw-u-marginbottom-16px'
            });
            this.renderChart(donutDiv, donutChart(donutData, { size: 280, title: '伏笔回收状态' }));

            const statsGrid = statsSection.createDiv({
                cls: 'nw-u-d-grid nw-u-gtc-repeat-4-1fr nw-u-gap-12px'
            });
            const statItems = [
                { label: '总伏笔数', value: stats.totalForeshadows, color: 'var(--interactive-accent)' },
                { label: '已回收', value: stats.resolvedCount, color: '#2ecc71' },
                { label: '未回收', value: stats.unresolvedCount, color: '#f59e0b' },
                { label: '平均重要度', value: formatDetailPercent(stats.avgImportance), color: '#9b59b6' },
            ];
            statItems.forEach(item => {
                const card = statsGrid.createDiv({
                    cls: 'nw-u-p-14px nw-u-ta-center nw-u-bg-background-secondary nw-u-brd-8px'
                });
                card.createDiv({
                    text: String(item.value),
                    attr: { style: `font-size:20px;font-weight:700;color:${item.color};margin-bottom:4px;` }
                });
                card.createDiv({ text: item.label, cls: 'nw-text-sm-muted' });
            });
        }

        // 类型分布
        if (typeDistribution && Object.keys(typeDistribution).length > 0) {
            const typeSection = this.createDetailSection(container, '类型分布');
            const typeGrid = typeSection.createDiv({
                cls: 'nw-u-d-grid nw-u-gtc-repeat-auto-fit-minmax-5 nw-u-gap-8px'
            });
            const typeLabels: Record<string, string> = {
                'item': '物品伏笔',
                'skill': '功法伏笔',
                'character': '人物伏笔',
                'setting': '设定伏笔',
                'event': '事件伏笔',
            };
            Object.entries(typeDistribution).forEach(([type, count]) => {
                typeGrid.createDiv({
                    cls: 'nw-u-p-10px nw-u-ta-center nw-u-bg-background-secondary nw-u-brd-6px'
                }).createDiv({
                    text: `${typeLabels[type] || type}：${count}`,
                    cls: 'nw-u-fs-12px'
                });
            });
        }

        // 伏笔列表
        const listSection = this.createDetailSection(container, '伏笔列表');

        const filterRow = listSection.createDiv({
            cls: 'nw-u-d-flex nw-u-gap-8px nw-u-marginbottom-12px nw-u-fwr-wrap'
        });
        const filterOptions: { value: string; label: string }[] = [
            { value: 'all', label: '全部' },
            { value: 'resolved', label: '已回收' },
            { value: 'unresolved', label: '未回收' },
        ];
        const currentFilter = this.deps.getForeshadowFilter() || 'all';

        filterOptions.forEach(opt => {
            const btn = filterRow.createEl('button', {
                text: opt.label,
                cls: `nw-btn ${currentFilter === opt.value ? 'nw-btn-primary' : 'nw-btn-secondary'} nw-btn-sm`
            });
            btn.addEventListener('click', () => {
                this.deps.setForeshadowFilter(opt.value);
                this.deps.onRequestReRender();
            });
        });

        const filteredItems = foreshadows.filter(item => {
            if (currentFilter === 'all') return true;
            if (currentFilter === 'resolved') return item.hasResolution;
            return !item.hasResolution;
        });

        const list = listSection.createDiv({
            cls: 'nw-u-maxh-400px nw-u-ovy-auto nw-u-b-1px-solid-background-m nw-u-brd-8px'
        });

        filteredItems.forEach((item) => {
            const itemEl = list.createDiv({
                attr: {
                    style: `border-bottom:1px solid var(--background-modifier-border);&:last-child{border-bottom:none;}`
                }
            });

            const header = itemEl.createDiv({
                cls: 'nw-u-p-12px nw-u-cur-pointer nw-u-d-flex nw-u-ai-flex-start nw-u-gap-10px'
            });

            const statusIcon = header.createSpan({
                text: item.hasResolution ? '✓' : '○',
                cls: 'nw-flex-center nw-flex-shrink-0',
                attr: {
                    style: `width:20px;height:20px;border-radius:50%;font-size:12px;margin-top:1px;${
                        item.hasResolution ? 'background:rgba(46,204,113,0.15);color:#2ecc71;' : 'background:var(--background-secondary);color:var(--text-muted);'
                    }`
                }
            });
            void statusIcon;

            const content = header.createDiv({ cls: 'nw-u-flex-1 nw-u-minw-0' });
            content.createDiv({ text: item.name, cls: 'nw-u-fs-13px nw-u-fwt-500 nw-u-marginbottom-4px' });
            const meta = content.createDiv({ cls: 'nw-u-d-flex nw-u-gap-8px nw-u-ai-center nw-u-fwr-wrap' });
            
            const typeLabels: Record<string, string> = {
                'item': '物品伏笔',
                'skill': '功法伏笔',
                'character': '人物伏笔',
                'setting': '设定伏笔',
                'event': '事件伏笔',
            };
            meta.createSpan({
                text: typeLabels[item.type] || item.type,
                cls: 'nw-u-p-2px-8px nw-u-fs-11px nw-u-bg-background-secondary nw-u-brd-10px nw-u-c-text-muted'
            });

            const importancePct = formatDetailPercent(item.importance);
            meta.createSpan({
                text: `重要度 ${importancePct}`,
                attr: {
                    style: `padding:2px 8px;font-size:11px;border-radius:10px;${
                        item.importance >= 0.7 ? 'background:rgba(231,76,60,0.1);color:#e74c3c;' :
                        item.importance >= 0.4 ? 'background:rgba(245,158,11,0.1);color:#f59e0b;' :
                        'background:var(--background-secondary);color:var(--text-muted);'
                    }`
                }
            });

            meta.createSpan({
                text: `出场 ${formatDetailCount(item.totalAppearances)}次`,
                cls: 'nw-text-muted-11'
            });
        });
    }

    // ---- 商业 Tab ----
    public renderBookCommercialTab(container: HTMLElement): void {
        const data = this.deps.getCommercialData();
        if (!data || (!data.overallScore && !data.goldenThreeChapters && !data.waveRhythm)) {
            this.renderDetailEmpty(container, '商业分析数据');
            return;
        }

        this.renderQualityScoreCard(container, data as unknown as Record<string, unknown>);

        const book = this.deps.getCurrentBook();
        if (book) {
            container.createDiv({
                text: `基于全书 ${this.deps.formatWordCount(book.wordCount)} 字`,
                cls: 'nw-u-fs-12px nw-u-c-text-muted nw-u-marginbottom-16px'
            });
        }

        if (data.overallScore !== undefined || data.overallLevel) {
            const section = this.createDetailSection(container, '商业可行性总览');
            const card = section.createDiv({
                cls: 'nw-u-p-20px nw-u-bg-background-secondary nw-u-brd-10px nw-u-d-flex nw-u-ai-center nw-u-gap-24px'
            });
            const scoreCircle = card.createDiv({
                cls: 'nw-u-w-100px nw-u-h-100px nw-u-brd-50 nw-u-bg-linear-gradient-135deg nw-u-d-flex nw-u-fd-column nw-u-ai-center nw-u-jc-center nw-u-c-white nw-u-fsh-0'
            });
            scoreCircle.createDiv({ text: data.overallScore !== undefined ? data.overallScore.toString() : '-', cls: 'nw-u-fs-28px nw-u-fwt-700 nw-u-lh-1' });
            scoreCircle.createDiv({ text: '总分', cls: 'nw-u-fs-11px nw-u-op-0-9' });
            const infoDiv = card.createDiv({ cls: 'nw-u-flex-1' });
            infoDiv.createDiv({
                text: `等级：${data.overallLevel || '-'}`,
                cls: 'nw-u-fs-18px nw-u-fwt-600 nw-u-marginbottom-8px nw-u-c-interactive-accent'
            });
            infoDiv.createDiv({
                text: '综合评估作品的市场竞争力和读者吸引力',
                cls: 'nw-u-fs-13px nw-u-c-text-muted'
            });
        }

        if (data.goldenThreeChapters) {
            const gtc = data.goldenThreeChapters;
            const section = this.createDetailSection(container, '黄金三章分析');

            if (gtc.totalScore !== undefined || gtc.subScores) {
                const scoreRow = section.createDiv({
                    cls: 'nw-u-d-flex nw-u-ai-center nw-u-gap-20px nw-u-marginbottom-16px nw-u-p-14px nw-u-bg-background-secondary nw-u-brd-8px'
                });
                if (gtc.totalScore !== undefined) {
                    scoreRow.createDiv({
                        text: `黄金三章总分：${gtc.totalScore} 分`,
                        cls: 'nw-u-fs-15px nw-u-fwt-600 nw-u-c-interactive-accent'
                    });
                }
                if (gtc.subScores) {
                    const subLabels: Record<string, string> = {
                        openingConflict: '开篇冲突',
                        infoDensity: '信息密度',
                        protagonistGoal: '主角目标',
                        goldenFinger: '金手指',
                        chapterHooks: '章节钩子'
                    };
                    const barData = Object.entries(gtc.subScores)
                        .filter(([, v]) => v !== undefined)
                        .map(([k, v]) => ({
                            label: subLabels[k] || k,
                            value: (v as number) * 100
                        }));
                    if (barData.length > 0) {
                        const barDiv = section.createDiv({
                            cls: 'nw-u-d-flex nw-u-jc-center'
                        });
                        this.renderChart(barDiv, barChart(barData, { width: 480, height: 180, title: '五维评分', horizontal: true }));
                    }
                }
            }

            if (gtc.improvementSuggestions && gtc.improvementSuggestions.length > 0) {
                const suggSection = this.createDetailSection(container, '改进建议');
                const severityOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
                const sortedSuggestions = [...gtc.improvementSuggestions].sort((a, b) =>
                    (severityOrder[a.severity] ?? 99) - (severityOrder[b.severity] ?? 99)
                );
                const list = suggSection.createDiv({ cls: 'nw-u-d-flex nw-u-fd-column nw-u-gap-8px' });
                const severityColors: Record<string, string> = {
                    high: 'var(--color-red)',
                    medium: 'var(--color-orange)',
                    low: 'var(--color-green)'
                };
                const severityLabels: Record<string, string> = {
                    high: '高',
                    medium: '中',
                    low: '低'
                };
                sortedSuggestions.forEach(s => {
                    const item = list.createDiv({
                        cls: 'nw-u-p-10px-14px nw-u-bg-background-secondary nw-u-brd-6px'
                    });
                    const header = item.createDiv({ cls: 'nw-u-d-flex nw-u-ai-center nw-u-gap-8px nw-u-marginbottom-4px' });
                    header.createSpan({
                        text: severityLabels[s.severity] || s.severity,
                        attr: {
                            style: `padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;color:white;background:${severityColors[s.severity] || 'var(--text-muted)'};`
                        }
                    });
                    header.createSpan({ text: s.category, cls: 'nw-u-fs-12px nw-u-fwt-500' });
                    item.createDiv({ text: s.suggestion, cls: 'nw-u-fs-13px nw-u-c-text-muted' });
                });
            }
        }

        if (data.waveRhythm) {
            const wr = data.waveRhythm;
            const section = this.createDetailSection(container, '波浪节奏验证');

            if (wr.complianceRate !== undefined) {
                const progressWrap = section.createDiv({
                    cls: 'nw-u-p-14px nw-u-bg-background-secondary nw-u-brd-8px nw-u-marginbottom-12px'
                });
                progressWrap.createDiv({
                    text: `节奏合规率：${formatDetailPercent(wr.complianceRate, 1)}`,
                    cls: 'nw-u-fs-14px nw-u-fwt-600 nw-u-marginbottom-8px'
                });
                const barBg = progressWrap.createDiv({
                    cls: 'nw-u-h-10px nw-u-bg-background-modifier-bo nw-u-brd-5px nw-u-ov-hidden'
                });
                barBg.createDiv({
                    attr: {
                        style: `height:100%;width:${Math.min(100, Math.max(0, wr.complianceRate * 100))}%;background:linear-gradient(90deg,var(--interactive-accent),var(--nw-warning-hover));border-radius:5px;transition:width 0.3s;`
                    }
                });
            }

            if (wr.violations && wr.violations.length > 0) {
                const typeLabels: Record<string, string> = {
                    small_cool: '小爽点',
                    medium_reversal: '中反转',
                    big_climax: '大高潮'
                };
                const vSection = this.createDetailSection(container, `违规记录 (${wr.violations.length})`);
                const list = vSection.createDiv({ cls: 'nw-u-d-flex nw-u-fd-column nw-u-gap-6px' });
                wr.violations.forEach((v, i) => {
                    const item = list.createDiv({
                        cls: 'nw-u-p-10px-12px nw-u-bg-background-secondary nw-u-brd-6px nw-u-fs-12px'
                    });
                    item.createEl('div', {
                        text: `#${i + 1} ${typeLabels[v.type] || v.type} · 第${v.startChapter}-${v.endChapter}章`,
                        cls: 'nw-u-fwt-500 nw-u-c-color-orange nw-u-marginbottom-4px'
                    });
                    item.createEl('div', {
                        text: `间隔：${v.gap} 章（阈值：${v.threshold} 章）`,
                        cls: 'nw-u-c-text-muted'
                    });
                });
            }
        }
    }

    // ---- 可读性 Tab ----
    public renderBookReadabilityTab(container: HTMLElement): void {
        const data = this.deps.getReadabilityData();
        if (!data || (!data.overallScore && !data.showTell && !data.aiTrace)) {
            this.renderDetailEmpty(container, '可读性分析数据');
            return;
        }

        this.renderQualityScoreCard(container, data as unknown as Record<string, unknown>);

        const book = this.deps.getCurrentBook();
        if (book) {
            container.createDiv({
                text: `基于全书 ${this.deps.formatWordCount(book.wordCount)} 字`,
                cls: 'nw-u-fs-12px nw-u-c-text-muted nw-u-marginbottom-16px'
            });
        }

        if (data.overallScore !== undefined) {
            const section = this.createDetailSection(container, '可读性总览');
            const card = section.createDiv({
                cls: 'nw-u-p-20px nw-u-bg-background-secondary nw-u-brd-10px nw-u-d-flex nw-u-ai-center nw-u-gap-24px'
            });
            const scoreCircle = card.createDiv({
                cls: 'nw-u-w-100px nw-u-h-100px nw-u-brd-50 nw-u-bg-linear-gradient-135deg-2 nw-u-d-flex nw-u-fd-column nw-u-ai-center nw-u-jc-center nw-u-c-white nw-u-fsh-0'
            });
            scoreCircle.createDiv({ text: data.overallScore.toString(), cls: 'nw-u-fs-28px nw-u-fwt-700 nw-u-lh-1' });
            scoreCircle.createDiv({ text: '总分', cls: 'nw-u-fs-11px nw-u-op-0-9' });
            const infoDiv = card.createDiv({ cls: 'nw-u-flex-1' });
            infoDiv.createDiv({
                text: '可读性综合评分',
                cls: 'nw-u-fs-18px nw-u-fwt-600 nw-u-marginbottom-8px nw-u-c-interactive-accent'
            });
            infoDiv.createDiv({
                text: '评估作品的阅读流畅度、代入感和AI痕迹水平',
                cls: 'nw-u-fs-13px nw-u-c-text-muted'
            });
        }

        if (data.showTell) {
            const st = data.showTell;
            const section = this.createDetailSection(container, 'Show vs Tell 分析');

            const hasDonutData = st.showPercentage !== undefined || st.tellPercentage !== undefined || (st.stats && st.stats.mixedCount !== undefined);
            if (hasDonutData) {
                const chartWrap = section.createDiv({
                    cls: 'nw-u-d-flex nw-u-jc-center nw-u-gap-24px nw-u-ai-flex-start nw-u-fwr-wrap'
                });
                const donutData = [];
                if (st.showPercentage !== undefined) {
                    donutData.push({ label: 'Show', value: st.showPercentage * 100, color: '#10b981' });
                }
                if (st.tellPercentage !== undefined) {
                    donutData.push({ label: 'Tell', value: st.tellPercentage * 100, color: '#ef4444' });
                }
                if (st.stats?.mixedCount !== undefined && st.stats?.totalSegments !== undefined && st.stats.totalSegments > 0) {
                    const mixedPct = (st.stats.mixedCount / st.stats.totalSegments) * 100;
                    donutData.push({ label: 'Mixed', value: mixedPct, color: '#f59e0b' });
                }
                if (donutData.length > 0) {
                    const donutDiv = chartWrap.createDiv();
                    this.renderChart(donutDiv, donutChart(donutData, { size: 260, title: 'Show/Tell 比例' }));
                }

                if (st.stats) {
                    const statsDiv = chartWrap.createDiv({
                        cls: 'nw-u-d-flex nw-u-fd-column nw-u-gap-10px nw-u-minw-180px'
                    });
                    statsDiv.createDiv({ text: '统计数据', cls: 'nw-u-fs-14px nw-u-fwt-600 nw-u-marginbottom-4px' });
                    if (st.stats.totalSegments !== undefined) {
                        this.addInfoItem(statsDiv, '总片段数', st.stats.totalSegments.toString());
                    }
                    if (st.stats.showCount !== undefined) {
                        this.addInfoItem(statsDiv, 'Show 数量', st.stats.showCount.toString());
                    }
                    if (st.stats.tellCount !== undefined) {
                        this.addInfoItem(statsDiv, 'Tell 数量', st.stats.tellCount.toString());
                    }
                    if (st.stats.mixedCount !== undefined) {
                        this.addInfoItem(statsDiv, 'Mixed 数量', st.stats.mixedCount.toString());
                    }
                }
            }

            if (st.highRiskTellSegments && st.highRiskTellSegments.length > 0) {
                const riskSection = this.createDetailSection(container, `高风险 Tell 段落 (${st.highRiskTellSegments.length})`);
                const list = riskSection.createDiv({ cls: 'nw-u-d-flex nw-u-fd-column nw-u-gap-8px' });
                st.highRiskTellSegments.slice(0, 10).forEach((seg, i) => {
                    const item = list.createDiv({
                        cls: 'nw-u-p-10px-14px nw-u-bg-background-secondary nw-u-brd-6px'
                    });
                    const header = item.createDiv({ cls: 'nw-u-d-flex nw-u-jc-space-between nw-u-ai-center nw-u-marginbottom-6px' });
                    header.createSpan({ text: `#${i + 1}`, cls: 'nw-u-fs-12px nw-u-fwt-600 nw-u-c-color-red' });
                    if (seg.confidence !== undefined) {
                        header.createSpan({ text: `置信度：${formatDetailPercent(seg.confidence)}`, cls: 'nw-u-fs-11px nw-u-c-text-muted' });
                    }
                    item.createDiv({
                        text: seg.excerpt,
                        cls: 'nw-u-fs-12px nw-u-c-text-muted nw-u-lh-1-6 nw-u-d-webkit-box nw-u-webkitlineclamp-3 nw-u-webkitboxorient-vertical nw-u-ov-hidden'
                    });
                });
            }

            if (st.suggestions && st.suggestions.length > 0) {
                const suggSection = this.createDetailSection(container, '改进建议');
                const severityOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
                const sortedSuggestions = [...st.suggestions].sort((a, b) =>
                    (severityOrder[a.severity] ?? 99) - (severityOrder[b.severity] ?? 99)
                );
                const list = suggSection.createDiv({ cls: 'nw-u-d-flex nw-u-fd-column nw-u-gap-8px' });
                const severityColors: Record<string, string> = {
                    high: 'var(--color-red)',
                    medium: 'var(--color-orange)',
                    low: 'var(--color-green)'
                };
                const severityLabels: Record<string, string> = {
                    high: '高',
                    medium: '中',
                    low: '低'
                };
                sortedSuggestions.forEach(s => {
                    const item = list.createDiv({
                        cls: 'nw-u-p-10px-14px nw-u-bg-background-secondary nw-u-brd-6px'
                    });
                    const header = item.createDiv({ cls: 'nw-u-d-flex nw-u-ai-center nw-u-gap-8px nw-u-marginbottom-4px' });
                    header.createSpan({
                        text: severityLabels[s.severity] || s.severity,
                        attr: {
                            style: `padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;color:white;background:${severityColors[s.severity] || 'var(--text-muted)'};`
                        }
                    });
                    header.createSpan({ text: s.type, cls: 'nw-u-fs-12px nw-u-fwt-500' });
                    item.createDiv({ text: s.message, cls: 'nw-u-fs-13px nw-u-c-text-muted' });
                });
            }
        }

        if (data.aiTrace) {
            const ai = data.aiTrace;
            const section = this.createDetailSection(container, 'AI 痕迹检测');

            const overviewRow = section.createDiv({
                cls: 'nw-u-d-flex nw-u-ai-center nw-u-gap-20px nw-u-marginbottom-16px nw-u-p-14px nw-u-bg-background-secondary nw-u-brd-8px'
            });
            if (ai.overallScore !== undefined) {
                overviewRow.createDiv({
                    text: `AI 痕迹率：${formatDetailPercent(ai.overallScore, 1)}`,
                    cls: 'nw-u-fs-15px nw-u-fwt-600 nw-u-c-color-orange'
                });
            }
            if (ai.level) {
                const levelColors: Record<string, string> = {
                    low: 'var(--color-green)',
                    medium: 'var(--color-orange)',
                    high: 'var(--color-red)'
                };
                const levelLabels: Record<string, string> = {
                    low: '低风险',
                    medium: '中风险',
                    high: '高风险'
                };
                overviewRow.createSpan({
                    text: levelLabels[ai.level] || ai.level,
                    attr: {
                        style: `padding:4px 12px;border-radius:6px;font-size:12px;font-weight:600;color:white;background:${levelColors[ai.level] || 'var(--text-muted)'};`
                    }
                });
            }

            if (ai.dimensions) {
                const dimLabels: Record<string, string> = {
                    sentenceSimilarity: '句式相似度',
                    connectorDensity: '连接词密度',
                    explanatoryEnding: '说明性结尾',
                    parallelismAbuse: '排比滥用',
                    wordRepetition: '词汇重复',
                    emotionUniformity: '情绪均匀度'
                };
                const barData = Object.entries(ai.dimensions)
                    .filter(([, v]) => v && v.score !== undefined)
                    .map(([k, v]) => ({
                        label: dimLabels[k] || k,
                        value: v.score * 100
                    }));
                if (barData.length > 0) {
                    const barDiv = section.createDiv({
                        cls: 'nw-u-d-flex nw-u-jc-center'
                    });
                    this.renderChart(barDiv, barChart(barData, { width: 500, height: 200, title: '六维分析', horizontal: true }));
                }
            }

            if (ai.highRiskParagraphs && ai.highRiskParagraphs.length > 0) {
                const riskSection = this.createDetailSection(container, `高风险段落 (${ai.highRiskParagraphs.length})`);
                const list = riskSection.createDiv({ cls: 'nw-u-d-flex nw-u-fd-column nw-u-gap-8px' });
                ai.highRiskParagraphs.slice(0, 10).forEach((p, i) => {
                    const item = list.createDiv({
                        cls: 'nw-u-p-10px-14px nw-u-bg-background-secondary nw-u-brd-6px'
                    });
                    const header = item.createDiv({ cls: 'nw-u-d-flex nw-u-jc-space-between nw-u-ai-center nw-u-marginbottom-6px' });
                    header.createSpan({ text: `#${i + 1}`, cls: 'nw-u-fs-12px nw-u-fwt-600 nw-u-c-color-red' });
                    if (p.score !== undefined) {
                        header.createSpan({ text: `风险分：${formatDetailPercent(p.score)}`, cls: 'nw-u-fs-11px nw-u-c-text-muted' });
                    }
                    item.createDiv({
                        text: p.excerpt,
                        cls: 'nw-u-fs-12px nw-u-c-text-muted nw-u-lh-1-6 nw-u-d-webkit-box nw-u-webkitlineclamp-3 nw-u-webkitboxorient-vertical nw-u-ov-hidden nw-u-marginbottom-6px'
                    });
                    if (p.reasons && p.reasons.length > 0) {
                        const reasonsDiv = item.createDiv({ cls: 'nw-u-d-flex nw-u-fwr-wrap nw-u-gap-4px' });
                        p.reasons.forEach(r => {
                            reasonsDiv.createSpan({
                                text: r,
                                cls: 'nw-u-p-2px-6px nw-u-bg-color-red nw-u-op-0-2 nw-u-brd-3px nw-u-fs-10px nw-u-c-color-red'
                            });
                        });
                    }
                });
            }
        }
    }

    // ---- 技巧 Tab ----
    public renderBookTechniqueTab(container: HTMLElement): void {
        const data = this.deps.getTechniqueData();

        if (!data || !data.techniques || data.techniques.length === 0) {
            this.renderDetailEmpty(container, '写作技巧数据');
            return;
        }

        this.renderQualityScoreCard(container, data as unknown as Record<string, unknown>);

        const { techniques, typeDistribution, qualityScore } = data;

        // 技巧分类环形图（使用 typeDistribution 或从 techniques 计算）
        const categoryCounts: Record<string, number> = typeDistribution || {};
        if (!typeDistribution) {
            techniques.forEach(tech => {
                categoryCounts[tech.category] = (categoryCounts[tech.category] || 0) + tech.count;
            });
        }

        const categoryLabels: Record<string, string> = {
            'emotion': '情感',
            'structure': '结构',
            'cool_point': '爽点',
            'character': '人物',
            'setting': '设定',
            'dialogue': '对话',
            'description': '描写',
        };

        if (Object.keys(categoryCounts).length > 0) {
            const section = this.createDetailSection(container, '技巧分类分布');
            const donutData = Object.entries(categoryCounts).map(([label, value]) => ({
                label: categoryLabels[label] || label,
                value
            }));
            const donutDiv = section.createDiv({
                cls: 'nw-u-d-flex nw-u-jc-center'
            });
            this.renderChart(donutDiv, donutChart(donutData, { size: 300, title: '技巧分类占比' }));
        }

        // Top技巧排名柱状图（按 count 排序）
        const sortedTechniques = [...techniques].sort((a, b) => b.count - a.count);
        const top10 = sortedTechniques.slice(0, 10);
        
        const chartSection = this.createDetailSection(container, 'Top 10 写作技巧排名');
        const barData = top10.map(t => ({ label: t.name, value: t.count }));
        const barDiv = chartSection.createDiv({
            cls: 'nw-u-d-flex nw-u-jc-center'
        });
        this.renderChart(barDiv, barChart(barData, { width: 500, height: 250, title: '技巧使用频率', horizontal: true }));

        // 质量评分卡片
        if (qualityScore) {
            const section = this.createDetailSection(container, '技巧质量评分');
            const grid = section.createDiv({
                cls: 'nw-u-d-grid nw-u-gtc-repeat-auto-fit-minmax-3 nw-u-gap-12px'
            });
            this.addInfoItem(grid, '综合评分', `${qualityScore.totalScore} / 100`);
            this.addInfoItem(grid, '多样性', `${qualityScore.diversityScore}%`);
            this.addInfoItem(grid, '覆盖度', `${qualityScore.coverageScore}%`);
        }

            const section = this.createDetailSection(container, '技巧详情');
            top10.forEach((tech, i) => {
                const key = `tech_top_${i}`;
                const isExpanded = this.deps.getExpandedItems()[key] ?? false;

                const item = section.createDiv({
                    cls: 'nw-u-b-1px-solid-background-m nw-u-brd-8px nw-u-marginbottom-8px nw-u-ov-hidden'
                });

                const header = item.createDiv({
                    cls: 'nw-u-p-10px-12px nw-u-cur-pointer nw-u-d-flex nw-u-ai-center nw-u-gap-10px'
                });

                const rank = header.createSpan({
                    text: `${i + 1}`,
                    cls: 'nw-flex-center nw-flex-shrink-0',
                    attr: {
                        style: `width:24px;height:24px;border-radius:50%;font-size:12px;font-weight:600;${
                            i < 3 ? 'background:var(--interactive-accent);color:var(--text-on-accent);' : 'background:var(--background-secondary);color:var(--text-muted);'
                        }`
                    }
                });
                void rank;

                const info = header.createDiv({ cls: 'nw-u-flex-1 nw-u-minw-0' });
                info.createDiv({ text: tech.name, cls: 'nw-u-fs-13px nw-u-fwt-500' });
                const meta = info.createDiv({ cls: "nw-text-muted-11 nw-u-d-flex nw-u-gap-12px nw-u-margintop-2px nw-u-fwr-wrap", attr: {} });
                meta.createSpan({ text: `出现 ${formatDetailCount(tech.count)} 次` });
                meta.createSpan({ text: `分类: ${categoryLabels[tech.category] || tech.category}` });
                meta.createSpan({ text: `置信度 ${formatDetailPercent(tech.confidence)}` });
                meta.createSpan({ text: `质量分 ${formatDetailPercent(tech.qualityScore)}` });

                const toggle = header.createSpan({
                    text: isExpanded ? '▼' : '▶',
                    cls: 'nw-text-sm-muted nw-flex-shrink-0'
                });
                void toggle;

                header.addEventListener('click', () => {
                    this.deps.getExpandedItems()[key] = !isExpanded;
                    this.deps.onRequestReRender();
                });

                if (isExpanded) {
                    const body = item.createDiv({
                        cls: 'nw-u-p-12px nw-u-bt-1px-solid-background-m nw-u-bg-background-secondary'
                    });
                    body.createDiv({ text: `技巧ID: ${tech.id}`, cls: 'nw-u-fs-12px nw-u-c-text-muted nw-u-marginbottom-4px' });
                    body.createDiv({ text: `题材权重: ${formatDetailNumber(tech.genreWeight, 1, 'x')}`, cls: 'nw-u-fs-12px nw-u-c-text-muted' });
                }
            });
    }

    // ---- 标签 Tab ----
    public renderBookTagsTab(container: HTMLElement, book: BookBasicInfo): void {
        const themeSection = this.createDetailSection(container, '主题标签');
        const themeWrap = themeSection.createDiv({ cls: 'nw-u-d-flex nw-u-fwr-wrap nw-u-gap-6px' });
        if (book.themeTags.length === 0) {
            themeWrap.createSpan({ text: '暂无主题标签', cls: 'nw-u-c-text-muted nw-u-fs-13px' });
        } else {
            book.themeTags.forEach(tag => {
                themeWrap.createSpan({
                    text: tag,
                    cls: 'nw-u-p-4px-12px nw-u-fs-12px nw-u-bg-background-secondary nw-u-brd-12px nw-u-c-text-normal'
                });
            });
        }

        const techniqueSection = this.createDetailSection(container, '技巧标签');
        const techWrap = techniqueSection.createDiv({ cls: 'nw-u-d-flex nw-u-fwr-wrap nw-u-gap-6px' });
        if (book.techniqueTags.length === 0) {
            techWrap.createSpan({ text: '暂无技巧标签', cls: 'nw-u-c-text-muted nw-u-fs-13px' });
        } else {
            book.techniqueTags.forEach(tag => {
                techWrap.createSpan({
                    text: tag,
                    cls: 'nw-u-p-4px-12px nw-u-fs-12px nw-u-bg-background-secondary nw-u-brd-12px nw-u-c-text-normal'
                });
            });
        }

        const customSection = this.createDetailSection(container, '自定义标签');
        const customTagsWrap = customSection.createDiv({ cls: 'nw-u-d-flex nw-u-fwr-wrap nw-u-gap-6px nw-u-marginbottom-12px' });

        if (book.customTags.length === 0) {
            customTagsWrap.createSpan({ text: '暂无自定义标签', cls: 'nw-u-c-text-muted nw-u-fs-13px' });
        } else {
            book.customTags.forEach((tag, idx) => {
                const tagEl = customTagsWrap.createSpan({
                    cls: "nw-flex-row-sm nw-u-p-4px-12px nw-u-fs-12px nw-u-bg-background-secondary nw-u-brd-12px nw-u-c-text-normal", attr: {}
                });
                tagEl.createSpan({ text: tag });
                const delBtn = tagEl.createSpan({
                    text: '×',
                    cls: 'nw-u-cur-pointer nw-u-c-text-muted nw-u-fs-14px nw-u-lh-1',
                    attr: { 'aria-label': `删除标签 ${tag}`, role: 'button', tabindex: '0' }
                });
                delBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.deps.onDeleteCustomTag(book, idx).catch(err => { // silent-ok: 失败提示在 onDeleteCustomTag 内部
                        log.error('删除标签失败:', err);
                    });
                });
            });
        }

        const addWrap = customSection.createDiv({ cls: 'nw-u-d-flex nw-u-gap-8px' });
        const addInput = addWrap.createEl('input', {
            type: 'text',
            attr: {
                placeholder: '输入新标签，按回车添加',
                style: 'flex:1;padding:6px 10px;border:1px solid var(--background-modifier-border);border-radius:4px;font-size:12px;background:var(--background-primary);color:var(--text-normal);'
            }
        });
        const addBtn = addWrap.createEl('button', {
            text: '添加',
            cls: 'nw-btn nw-btn-primary nw-btn-sm'
        });

        const addHandler = async () => {
            const tag = addInput.value.trim();
            if (!tag) return;
            await this.deps.onAddCustomTag(book, tag);
            addInput.value = '';
        };
        addBtn.addEventListener('click', addHandler);
        addInput.addEventListener('keydown', (e) => {
            if (isImeComposing(e)) return;
            if (e.key === 'Enter') addHandler();
        });
    }

    private renderDetailEmpty(container: HTMLElement, label: string): void {
        const emptyState = createEmptyState({
            icon: 'data',
            title: `暂无${label}`,
            description: '完成书籍拆解后即可查看详细数据'
        });
        container.appendChild(emptyState);
    }

    private renderQualityScoreCard(container: HTMLElement, data: Record<string, unknown> | null): void {
        if (!data) return;
        const qs = data._qualityScore as DimensionQualityScore | undefined;
        if (!qs || typeof qs.overall !== 'number') return;

        const levelColor = qs.level === 'high' ? 'var(--color-green)' : qs.level === 'medium' ? 'var(--color-orange)' : 'var(--color-red)';
        const levelLabel = qs.level === 'high' ? '优秀' : qs.level === 'medium' ? '一般' : '较差';
        const usedLevelLabel = qs.usedLevel === 'fast' ? '快速' : qs.usedLevel === 'standard' ? '标准' : '深度';

        const card = container.createDiv({
            cls: 'nw-u-marginbottom-16px nw-u-p-12px-16px nw-u-bg-background-secondary nw-u-brd-8px nw-u-blt-4px-solid-interactive-'
        });

        const header = card.createDiv({
            cls: 'nw-u-d-flex nw-u-ai-center nw-u-gap-12px nw-u-marginbottom-10px'
        });
        header.createSpan({ text: '质量评分', cls: 'nw-u-fs-13px nw-u-fwt-600 nw-u-c-text-normal' });
        header.createSpan({
            text: `${qs.overall}/100`,
            attr: { style: `font-size:20px;font-weight:700;color:${levelColor};` }
        });
        header.createSpan({
            text: levelLabel,
            attr: { style: `font-size:11px;padding:2px 8px;border-radius:4px;background:${levelColor}22;color:${levelColor};font-weight:600;` }
        });
        header.createSpan({
            text: `档位: ${usedLevelLabel}`,
            cls: 'nw-u-fs-10px nw-u-c-text-muted nw-u-marginleft-auto'
        });

        const metrics = card.createDiv({
            cls: 'nw-u-d-flex nw-u-gap-16px nw-u-fwr-wrap'
        });
        const metricStyle = 'display:flex;flex-direction:column;align-items:center;min-width:60px;';
        const valueStyle = 'font-size:16px;font-weight:600;';
        const labelStyle = 'font-size:10px;color:var(--text-muted);margin-top:2px;';

        const completenessColor = qs.completeness >= 80 ? 'var(--color-green)' : qs.completeness >= 50 ? 'var(--color-orange)' : 'var(--color-red)';
        const consistencyColor = qs.consistency >= 80 ? 'var(--color-green)' : qs.consistency >= 50 ? 'var(--color-orange)' : 'var(--color-red)';
        const confidenceColor = qs.confidence >= 80 ? 'var(--color-green)' : qs.confidence >= 50 ? 'var(--color-orange)' : 'var(--color-red)';

        const m1 = metrics.createDiv({ attr: { style: metricStyle } });
        m1.createSpan({ text: `${qs.completeness}`, attr: { style: `${valueStyle}color:${completenessColor};` } });
        m1.createSpan({ text: '完整性', attr: { style: labelStyle } });

        const m2 = metrics.createDiv({ attr: { style: metricStyle } });
        m2.createSpan({ text: `${qs.consistency}`, attr: { style: `${valueStyle}color:${consistencyColor};` } });
        m2.createSpan({ text: '一致性', attr: { style: labelStyle } });

        const m3 = metrics.createDiv({ attr: { style: metricStyle } });
        m3.createSpan({ text: `${qs.confidence}`, attr: { style: `${valueStyle}color:${confidenceColor};` } });
        m3.createSpan({ text: '置信度', attr: { style: labelStyle } });
    }
}
