import type { App } from 'obsidian';
import type { KnowledgeBaseManager, BookBasicInfo, BreakdownStatus } from '@/services/knowledge-base-manager';
import type { WebnovelKnowledgeBase } from '@/shared/webnovel-knowledge-base';
import { radarChart, barChart, donutChart, wordCloud, lineChart, timelineChart, attachChartInteractions } from '@/ui/svg-charts';
import { SmartChart } from '@/ui/components/smart-chart';
import { createEmptyState } from '@/ui/components/empty-state';
import { t } from '@/i18n';
import { createLogger } from '@/shared/logger';
import { formatDetailCount, formatDetailNumber, formatDetailPercent } from '@/ui/knowledge-detail-format';
import {
    buildQualityRadarData,
    buildQualityScoreRows,
    buildScoreBars,
    sortCharactersByImportance,
    sortSuggestionsBySeverity,
    sortTensionPoints,
    topCentralityBars,
} from './book-detail-logic';
import {
    buildFiveSensesRadarData,
    resolveSenseLabel,
    buildSentenceTypeDonutData,
    buildSentenceLengthBarData,
    buildParagraphLengthBarData,
    buildStyleScoreLines,
} from './book-style-logic';
import {
    buildForeshadowDonutData,
    buildForeshadowQualityItems,
    buildForeshadowStatItems,
    foreshadowFilterOptions,
    foreshadowImportanceTier,
    FORESHADOW_IMPORTANCE_STYLES,
    resolveForeshadowTypeLabel,
} from './book-foreshadow-logic';
import {
    buildNrcEmotionRadarData,
    resolveEmotionArcLabel,
    resolveSeverityColor,
    resolveSeverityLabel,
} from './book-emotion-logic';
import type { DeconstructionScheduler, BreakdownDimension, DimensionQualityScore } from '@/engine/deconstruction-scheduler';
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
import { isImeComposing } from '@/shared/keyboard';
import { setSanitizedHtml } from '@/ui/rendering/safe-html';
import {
    buildStyleRadarItems,
    buildRhetoricBarData,
    buildWordCloudItems,
    buildTimelineEvents,
    filterForeshadows,
    rankTechniquesTop,
    resolveTierLabel,
    resolveArcTypeLabel,
    resolveTimelineIcon,
    joinRoleParts,
    normalizeSentenceLength,
    normalizeParagraphLength,
    resolveQualityLevelMeta,
    resolveUsedLevelLabel,
    buildQualityScoreItems,
} from './book-detail-metrics';

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
    /**
     * 渲染书籍文风页签。
     * @param container - 容器元素
     */
    public renderBookStyleTab(container: HTMLElement): void {
        const data = this.deps.getStyleData();
        if (!data) {
            this.renderDetailEmpty(container, t('bookDetail.style.name'));
            return;
        }

        this.renderQualityScoreCard(container, data as unknown as Record<string, unknown>);

        const { sentenceRhythm, paragraphStructure, narrativeStyle, overallStyle, wordPreference, rhetoric, dialogueStyle } = data;

        const book = this.deps.getCurrentBook();
        if (book) {
            container.createDiv({
                text: t('bookDetail.common.basedOn', { wordCount: this.deps.formatWordCount(book.wordCount) }),
                cls: 'nw-kb-detail-caption'
            });
        }

        // 风格特征雷达图
        const radarItems = buildStyleRadarItems(data);

        if (radarItems.length >= 3) {
            const radarSection = this.createDetailSection(container, t('bookDetail.style.radarTitle'));
            const radarDiv = radarSection.createDiv({
                cls: 'nw-kb-detail-chart'
            });
            this.renderChart(radarDiv, radarChart(radarItems, { size: 320, title: t('bookDetail.style.radarTitleFull') }));
        }

        // 基础统计卡片
        if (sentenceRhythm || paragraphStructure || narrativeStyle) {
            const section = this.createDetailSection(container, t('bookDetail.style.base'));
            const grid = section.createDiv({
                cls: 'nw-kb-detail-grid nw-kb-detail-grid--min-160'
            });
            if (sentenceRhythm?.avgSentenceLength !== undefined) {
                this.addInfoItem(grid, t('bookDetail.style.avgSentence'), formatDetailNumber(sentenceRhythm.avgSentenceLength, 1, t('bookDetail.common.charSuffix')));
            }
            if (paragraphStructure?.avgParagraphLength !== undefined) {
                this.addInfoItem(grid, t('bookDetail.style.avgParagraph'), formatDetailNumber(paragraphStructure.avgParagraphLength, 1, t('bookDetail.common.charSuffix')));
            }
            if (narrativeStyle?.dialogueRatio !== undefined) {
                this.addInfoItem(grid, t('bookDetail.style.dialogueRatio'), formatDetailPercent(narrativeStyle.dialogueRatio, 1));
            }
            if (narrativeStyle?.descriptionRatio?.total !== undefined) {
                this.addInfoItem(grid, t('bookDetail.style.descriptionRatio'), formatDetailPercent(narrativeStyle.descriptionRatio.total, 1));
            }
            if (wordPreference?.idiomDensity !== undefined) {
                this.addInfoItem(grid, t('bookDetail.style.idiomDensity'), formatDetailNumber(wordPreference.idiomDensity, 1, t('bookDetail.style.perKchars')));
            }
            if (wordPreference?.colloquialismLevel !== undefined) {
                this.addInfoItem(grid, t('bookDetail.style.colloquial'), formatDetailPercent(wordPreference.colloquialismLevel, 1));
            }
        }

        // 风格特征词云（使用高频词）
        if (wordPreference?.topWords && wordPreference.topWords.length > 0) {
            const section = this.createDetailSection(container, t('bookDetail.style.wordCloud'));
            const wordItems = buildWordCloudItems(wordPreference.topWords);
            const wordCloudDiv = section.createDiv({
                cls: 'nw-kb-detail-chart'
            });
            this.renderChart(wordCloudDiv, wordCloud(wordItems, { width: 500, height: 200, title: t('bookDetail.style.wordCloudTitle') }));
        }

        // 修辞手法柱状图
        if (rhetoric) {
            const section = this.createDetailSection(container, t('bookDetail.style.rhetoric'));
            const barData = buildRhetoricBarData(rhetoric);
            const barDiv = section.createDiv({
                cls: 'nw-kb-detail-chart'
            });
            this.renderChart(barDiv, barChart(barData, { width: 500, height: 180, title: t('bookDetail.style.rhetoricTitle') }));
        }

        // 整体风格
        if (overallStyle) {
            const section = this.createDetailSection(container, t('bookDetail.style.overall'));
            const grid = section.createDiv({
                cls: 'nw-kb-detail-grid'
            });
            const styleCard = grid.createDiv({
                cls: 'nw-kb-detail-card--lg'
            });
            styleCard.createEl('div', { text: t('bookDetail.style.mainStyle'), cls: 'nw-kb-detail-note nw-kb-detail-mb-4' });
            styleCard.createEl('div', { text: overallStyle.primaryStyle, cls: 'nw-kb-detail-primary-style' });
            if (overallStyle.secondaryStyle) {
                styleCard.createEl('div', { text: t('bookDetail.style.secondary', { value: overallStyle.secondaryStyle }), cls: 'nw-kb-detail-note nw-kb-detail-mt-4' });
            }
            styleCard.createEl('div', { text: t('bookDetail.style.confidence', { value: formatDetailPercent(overallStyle.confidence) }), cls: 'nw-kb-detail-note nw-kb-detail-mt-4' });

            if (overallStyle.styleScores) {
                const scoresCard = grid.createDiv({
                    cls: 'nw-kb-detail-card--lg'
                });
                scoresCard.createEl('div', { text: t('bookDetail.style.scores'), cls: 'nw-kb-detail-note nw-kb-detail-mb-8' });
                const scoreList = scoresCard.createDiv({ cls: 'nw-kb-detail-stack nw-kb-detail-stack--gap-4' });
                buildStyleScoreLines(overallStyle.styleScores, score => formatDetailPercent(score)).forEach(line => {
                    scoreList.createEl('div', {
                        text: line,
                        cls: 'nw-kb-detail-fine'
                    });
                });
            }
        }

        if (data.vocabularyRichness) {
            const vr = data.vocabularyRichness;
            const section = this.createDetailSection(container, t('bookDetail.style.vocab'));
            const grid = section.createDiv({
                cls: 'nw-kb-detail-grid nw-kb-detail-grid--min-140'
            });
            this.addInfoItem(grid, 'TTR', formatDetailNumber(vr.ttr, 3));
            this.addInfoItem(grid, 'MTLD', formatDetailNumber(vr.mtld, 1));
            this.addInfoItem(grid, "Yule's K", formatDetailNumber(vr.yulesK, 3));
            this.addInfoItem(grid, t('bookDetail.style.vocabSize'), formatDetailCount(vr.vocabularySize));
            const levelItem = grid.createDiv({
                cls: 'nw-kb-detail-card--inset'
            });
            levelItem.createDiv({ text: t('bookDetail.common.level'), cls: "nw-kb-detail-label-xs nw-kb-detail-mb-4", attr: {} });
            levelItem.createDiv({
                text: t('bookDetail.style.levelValue', { level: vr.level, score: formatDetailNumber(vr.score, 1, t('bookDetail.common.scoreSuffix')) }),
                cls: 'nw-kb-detail-accent-text'
            });
        }

        if (data.fiveSenses) {
            const fs = data.fiveSenses;
            const radarData = buildFiveSensesRadarData(fs);
            if (radarData.length > 0) {
                const section = this.createDetailSection(container, t('bookDetail.style.sense'));
                const radarDiv = section.createDiv({ cls: 'nw-kb-detail-chart' });
                this.renderChart(radarDiv, radarChart(radarData, { size: 300, title: t('bookDetail.style.senseRadar') }));

                const statsRow = section.createDiv({
                    cls: 'nw-kb-detail-grid nw-kb-detail-grid--min-120 nw-kb-detail-mt-16'
                });
                this.addInfoItem(statsRow, t('bookDetail.style.balance'), formatDetailNumber(fs.balanceScore, 1, t('bookDetail.common.scoreSuffix')));
                this.addInfoItem(statsRow, t('bookDetail.common.level'), fs.level);
                this.addInfoItem(statsRow, t('bookDetail.style.dominantSense'), resolveSenseLabel(fs.dominantSense));
            }
        }

        if (data.sentenceRhythm?.sentenceTypeDistribution) {
            const std = data.sentenceRhythm.sentenceTypeDistribution;
            const donutData = buildSentenceTypeDonutData(std);
            const section = this.createDetailSection(container, t('bookDetail.style.sentenceTypes'));
            const chartDiv = section.createDiv({ cls: 'nw-kb-detail-chart' });
            this.renderChart(chartDiv, donutChart(donutData, { size: 260, title: t('bookDetail.style.sentenceTypeTitle') }));
        }

        if (data.sentenceRhythm?.lengthDistribution) {
            const sld = data.sentenceRhythm.lengthDistribution;
            const barData = buildSentenceLengthBarData(sld);
            const section = this.createDetailSection(container, t('bookDetail.style.sentenceLengthTitle'));
            const chartDiv = section.createDiv({ cls: 'nw-kb-detail-chart' });
            this.renderChart(chartDiv, barChart(barData, { width: 400, height: 180, title: t('bookDetail.style.sentenceLengthTitle2') }));
        }

        if (data.paragraphStructure?.lengthDistribution) {
            const pld = data.paragraphStructure.lengthDistribution;
            const barData = buildParagraphLengthBarData(pld);
            const section = this.createDetailSection(container, t('bookDetail.style.paragraphLength'));
            const chartDiv = section.createDiv({ cls: 'nw-kb-detail-chart' });
            this.renderChart(chartDiv, barChart(barData, { width: 400, height: 180, title: t('bookDetail.style.paragraphLengthTitle') }));
        }
    }

    // ---- 节奏分析 Tab ----
    /**
     * 渲染书籍节奏页签。
     * @param container - 容器元素
     */
    public renderBookRhythmTab(container: HTMLElement): void {
        const data = this.deps.getRhythmData();
        if (!data || (!data.emotionPoints && !data.coolPoints && !data.plotStages && !data.structureMatches && !data.chapterRhythm)) {
            this.renderDetailEmpty(container, t('bookDetail.rhythm.name'));
            return;
        }

        const { emotionPoints, chapterRhythm } = data;

        const book = this.deps.getCurrentBook();
        if (book) {
            container.createDiv({
                text: t('bookDetail.common.basedOn', { wordCount: this.deps.formatWordCount(book.wordCount) }),
                cls: 'nw-kb-detail-caption'
            });
        }

        this.renderQualityScoreCard(container, data as unknown as Record<string, unknown>);

        if (data.stats) {
            const statsSection = this.createDetailSection(container, t('bookDetail.rhythm.summary'));
            const statsGrid = statsSection.createDiv({
                cls: 'nw-kb-detail-grid nw-kb-detail-grid--min-120'
            });
            this.addInfoItem(statsGrid, t('bookDetail.rhythm.avgRhythm'), data.stats.avgRhythm != null ? data.stats.avgRhythm.toFixed(2) : '-');
            this.addInfoItem(statsGrid, t('bookDetail.rhythm.climax'), data.stats.climaxCount != null ? String(data.stats.climaxCount) : '-');
            this.addInfoItem(statsGrid, t('bookDetail.common.cool'), data.stats.coolPointCount != null ? String(data.stats.coolPointCount) : '-');
            this.addInfoItem(statsGrid, t('bookDetail.rhythm.hookRate'), data.stats.hookRate != null ? `${(data.stats.hookRate * 100).toFixed(1)}%` : '-');
            this.addInfoItem(statsGrid, t('bookDetail.rhythm.avgTension'), data.stats.avgTension != null ? data.stats.avgTension.toFixed(2) : '-');
        }

        // 情绪点折线图（使用 emotionPoints）
        if (emotionPoints && emotionPoints.length > 0) {
            const section = this.createDetailSection(container, t('bookDetail.rhythm.curve'));
            const emotionSeries = [{
                name: t('bookDetail.rhythm.emotion'),
                data: emotionPoints.slice(0, 50).map(p => ({
                    label: t('bookDetail.rhythm.chapter', { index: p.chapterIndex }),
                    value: p.intensity * 100,
                    annotation: p.type === 'reversal' ? t('bookDetail.rhythm.typeReversal') : p.type === 'small_climax' ? t('bookDetail.rhythm.typeSmallClimax') : p.type === 'trough' ? t('bookDetail.rhythm.typeTrough') : undefined
                })),
                smooth: true
            }];
            const lineDiv = section.createDiv({
                cls: 'nw-kb-detail-chart'
            });
            this.renderChart(lineDiv, lineChart(emotionSeries, { width: 600, height: 200, title: t('bookDetail.rhythm.curveTitle'), xAxisLabel: t('bookDetail.rhythm.axisChapter'), yAxisLabel: t('bookDetail.rhythm.axisIntensity') }));

            // 情绪类型统计柱状图
            const typeCounts: Record<string, number> = {};
            emotionPoints.forEach(p => {
                typeCounts[p.type] = (typeCounts[p.type] || 0) + 1;
            });
            const typeLabels: Record<string, string> = {
                'reversal': t('bookDetail.rhythm.typeReversal'),
                'small_climax': t('bookDetail.rhythm.typeSmallClimax'),
                'trough': t('bookDetail.rhythm.typeTrough'),
                'suspense': t('bookDetail.rhythm.typeSuspense'),
                'climax': t('bookDetail.rhythm.typeClimax')
            };
            const barData = Object.entries(typeCounts).map(([type, count]) => ({
                label: typeLabels[type] || type,
                value: count
            }));
            const barSection = this.createDetailSection(container, t('bookDetail.rhythm.types'));
            const barDiv = barSection.createDiv({
                cls: 'nw-kb-detail-chart'
            });
            this.renderChart(barDiv, barChart(barData, { width: 400, height: 160, title: t('bookDetail.rhythm.typesTitle') }));
        }

        // 章节节奏评分折线图
        if (chapterRhythm && chapterRhythm.length > 0) {
            const section = this.createDetailSection(container, t('bookDetail.rhythm.chapterScore'));
            const series = [
                {
                    name: t('bookDetail.rhythm.seriesEmotion'),
                    data: chapterRhythm.slice(0, 20).map(p => ({
                        label: t('bookDetail.rhythm.chapterN', { index: p.chapterIndex }),
                        value: p.emotionScore * 100
                    })),
                    smooth: true
                },
                {
                    name: t('bookDetail.rhythm.seriesTension'),
                    data: chapterRhythm.slice(0, 20).map(p => ({
                        label: t('bookDetail.rhythm.chapterN', { index: p.chapterIndex }),
                        value: p.tensionScore * 100
                    })),
                    smooth: true
                },
                {
                    name: t('bookDetail.rhythm.seriesDensity'),
                    data: chapterRhythm.slice(0, 20).map(p => ({
                        label: t('bookDetail.rhythm.chapterN', { index: p.chapterIndex }),
                        value: p.densityScore * 100
                    })),
                    smooth: true
                }
            ];
            const lineDiv = section.createDiv({
                cls: 'nw-kb-detail-chart'
            });
            this.renderChart(lineDiv, lineChart(series, { width: 600, height: 220, title: t('bookDetail.rhythm.chapterScoreTitle'), xAxisLabel: t('bookDetail.rhythm.axisChapter'), yAxisLabel: t('bookDetail.rhythm.axisScore') }));
        }

        // 节奏事件散点图（使用 emotionPoints）— Task 11: SmartChart 多视图
        if (emotionPoints && emotionPoints.length > 0) {
            const section = this.createDetailSection(container, t('bookDetail.rhythm.eventDist', { count: emotionPoints.length }));
            const scatterPoints = emotionPoints.slice(0, 50).map(p => ({
                x: p.position * 100,
                y: p.intensity * 100,
                label: p.description,
                category: p.type
            }));
            const scatterDiv = section.createDiv({
                cls: 'nw-kb-detail-chart'
            });
            new SmartChart(scatterDiv, {
                data: scatterPoints,
                preferredType: 'scatter',
                availableTypes: ['scatter', 'densityHeatmap', 'bar'],
                config: {
                    showLegend: true
                },
                context: t('bookDetail.rhythm.eventCtx')
            });
        }

        // 爽点/燃点散点图 — Task 11: SmartChart 多视图
        if (data.coolPoints && data.coolPoints.length > 0) {
            const section = this.createDetailSection(container, t('bookDetail.rhythm.coolDist', { count: data.coolPoints.length }));
            
            const scatterPoints = data.coolPoints.map(p => ({
                x: p.x,
                y: p.y,
                label: p.label,
                category: p.category
            }));
            const scatterDiv = section.createDiv({
                cls: 'nw-kb-detail-chart'
            });
            new SmartChart(scatterDiv, {
                data: scatterPoints,
                preferredType: 'scatter',
                availableTypes: ['scatter', 'densityHeatmap', 'bar'],
                config: {
                    showLegend: true
                },
                context: t('bookDetail.rhythm.coolCtx')
            });

            // 详情卡片
            const grid = section.createDiv({
                cls: 'nw-kb-detail-grid nw-kb-detail-grid--fill-220 nw-kb-detail-grid--tight nw-kb-detail-mt-12'
            });
            data.coolPoints.forEach(p => {
                const card = grid.createDiv({
                    cls: 'nw-kb-detail-peak-tile'
                });
                card.createEl('div', {
                    text: t('bookDetail.rhythm.coolLine', { category: p.category || t('bookDetail.common.uncategorized'), position: formatDetailNumber(p.x, 1, '%') }),
                    cls: 'nw-kb-detail-peak-title'
                });
                card.createEl('div', { text: p.label, cls: 'nw-kb-detail-muted' });
            });
        }

        // 剧情阶段
        if (data.plotStages && data.plotStages.length > 0) {
            const section = this.createDetailSection(container, t('bookDetail.rhythm.stage'));
            const wrap = section.createDiv({ cls: 'nw-kb-detail-stack nw-kb-detail-stack--gap-6' });
            data.plotStages.forEach(p => {
                wrap.createDiv({
                    cls: 'nw-kb-detail-phase'
                }).createEl('div', {
                    text: `${p.name} (${p.start}% - ${p.end}%)`,
                    cls: 'nw-kb-detail-text--strong'
                });
            });
        }

        // 结构匹配度
        if (data.structureMatches && data.structureMatches.length > 0) {
            const section = this.createDetailSection(container, t('bookDetail.rhythm.structureMatch'));
            const barDiv = section.createDiv();
            this.renderChart(barDiv, barChart(data.structureMatches, { width: 500, height: 160 }));
        }

        if (data.hookAnalysis) {
            const ha = data.hookAnalysis;
            const section = this.createDetailSection(container, t('bookDetail.rhythm.hooks'));
            const wrap = section.createDiv({ cls: 'nw-kb-detail-split' });
            const chartWrap = wrap.createDiv({ cls: 'nw-kb-detail-chart-column' });
            const typeDistArr = Object.entries(ha.typeDistribution || {}).map(([k, v]) => ({ label: k, value: v }));
            this.renderChart(chartWrap, donutChart(typeDistArr, { size: 240, title: t('bookDetail.rhythm.hookTypeTitle') }));

            const infoWrap = wrap.createDiv({ cls: 'nw-kb-detail-side-column' });
            infoWrap.createDiv({
                text: t('bookDetail.rhythm.hookRateLine', { value: formatDetailNumber(typeof ha.hookRate === 'number' ? ha.hookRate * 100 : undefined, 1, '%') }),
                cls: 'nw-kb-detail-figure'
            });
            infoWrap.createDiv({
                text: t('bookDetail.rhythm.noHookLine', { count: ha.noHookChapters?.length ?? 0 }),
                cls: 'nw-kb-detail-text'
            });
            infoWrap.createDiv({
                text: t('bookDetail.rhythm.avgIntensityLine', { value: formatDetailNumber(ha.avgIntensity, 2) }),
                cls: 'nw-kb-detail-text'
            });
            const distWrap = infoWrap.createDiv({ cls: 'nw-kb-detail-stack nw-kb-detail-stack--gap-4' });
            if (ha.typeDistribution) {
                Object.entries(ha.typeDistribution).forEach(([type, count]) => {
                    distWrap.createDiv({
                        text: `${type}: ${count}`,
                        cls: 'nw-kb-detail-chip--plain'
                    });
                });
            }
        }

        if (data.tensionCurve) {
            const tc = data.tensionCurve;
            const section = this.createDetailSection(container, t('bookDetail.rhythm.tension'));
            const statsRow = section.createDiv({
                cls: 'nw-kb-detail-grid nw-kb-detail-grid--min-120 nw-kb-detail-mb-16'
            });
            this.addInfoItem(statsRow, t('bookDetail.rhythm.avgTension'), formatDetailNumber(tc.overallTensionAvg, 3));
            this.addInfoItem(statsRow, t('bookDetail.rhythm.tensionStd'), formatDetailNumber(tc.overallTensionStd, 3));
            this.addInfoItem(statsRow, t('bookDetail.rhythm.waveform'), formatDetailNumber(tc.waveformScore, 1));

            if (tc.peaks && tc.valleys) {
                const linePoints = sortTensionPoints(tc.peaks, tc.valleys);
                const lineDiv = section.createDiv({ cls: 'nw-kb-detail-chart' });
                this.renderChart(lineDiv, lineChart([{ name: t('bookDetail.rhythm.tensionSeries'), data: linePoints, showPoints: true }], { width: 600, height: 200, title: t('bookDetail.rhythm.tensionTitle') }));
            }
        }

        if (data.nrcEmotion) {
            const ne = data.nrcEmotion;
            const radarData = buildNrcEmotionRadarData(ne);
            if (radarData.length >= 3) {
                const section = this.createDetailSection(container, t('bookDetail.rhythm.nrc'));
                const radarDiv = section.createDiv({ cls: 'nw-kb-detail-chart' });
                this.renderChart(radarDiv, radarChart(radarData, { size: 320, title: t('bookDetail.rhythm.nrcTitle') }));
            }
        }

        if (data.emotionArc) {
            const ea = data.emotionArc;
            const section = this.createDetailSection(container, t('bookDetail.rhythm.arc'));
            const card = section.createDiv({
                cls: 'nw-kb-detail-card--xl'
            });
            card.createDiv({
                text: t('bookDetail.rhythm.arcType', { type: resolveEmotionArcLabel(ea.arcType) }),
                cls: 'nw-kb-detail-headline nw-kb-detail-headline--lg'
            });
            card.createDiv({
                text: t('bookDetail.common.confidence', { value: formatDetailPercent(ea.confidence) }),
                cls: 'nw-kb-detail-text'
            });
            if (ea.description) {
                card.createDiv({
                    text: ea.description,
                    cls: 'nw-kb-detail-note nw-kb-detail-mt-8'
                });
            }
        }
    }

    // ---- 结构拆解 Tab ----
    /**
     * 渲染书籍结构页签。
     * @param container - 容器元素
     */
    public renderBookStructureTab(container: HTMLElement): void {
        const data = this.deps.getStructureData();
        if (!data || (!data.qcchSegments && !data.rhythmUnits && !data.threeLineStructure && !data.structureType)) {
            this.renderDetailEmpty(container, t('bookDetail.structure.name'));
            return;
        }

        this.renderQualityScoreCard(container, data as unknown as Record<string, unknown>);

        const book = this.deps.getCurrentBook();
        if (book) {
            container.createDiv({
                text: t('bookDetail.common.basedOn', { wordCount: this.deps.formatWordCount(book.wordCount) }),
                cls: 'nw-kb-detail-caption'
            });
        }

        const { qcchSegments, rhythmUnits, threeLineStructure, structureType, stats } = data;

        // 结构类型
        if (structureType) {
            const section = this.createDetailSection(container, t('bookDetail.structure.type'));
            section.createDiv({
                text: structureType,
                cls: 'nw-kb-detail-card--lg nw-kb-detail-heading--light'
            });
        }

        // 统计信息
        if (stats) {
            const section = this.createDetailSection(container, t('bookDetail.structure.stats'));
            const grid = section.createDiv({
                cls: 'nw-kb-detail-grid nw-kb-detail-grid--min-120'
            });
            this.addInfoItem(grid, t('bookDetail.structure.volumes'), stats.volumeCount.toString());
            this.addInfoItem(grid, t('bookDetail.structure.chapters'), stats.chapterCount.toString());
            this.addInfoItem(grid, t('bookDetail.structure.avgWords'), stats.avgChapterWordCount.toString());
            this.addInfoItem(grid, t('bookDetail.structure.totalWords'), stats.totalWordCount.toString());
        }

        // 起承转合结构
        if (qcchSegments && qcchSegments.length > 0) {
            const section = this.createDetailSection(container, t('bookDetail.structure.fourActs'));
            
            const qcchColors: Record<string, string> = {
                '起': '#3b82f6',
                '承': '#10b981',
                '转': '#ef4444',
                '合': '#8b5cf6',
            };
            
            const timelineEvents = buildTimelineEvents(qcchSegments);
            const timelineDiv = section.createDiv({
                cls: 'nw-kb-detail-chart'
            });
            this.renderChart(timelineDiv, timelineChart(timelineEvents, { width: 500, height: 100, title: t('bookDetail.structure.timeline') }));

            const list = section.createDiv({ cls: 'nw-kb-detail-stack nw-kb-detail-mt-12' });
            qcchSegments.forEach(seg => {
                const row = list.createDiv({
                    cls: 'nw-kb-detail-tile-row'
                });
                const typeEl = row.createEl('div', {
                    text: seg.type,
                    cls: 'nw-kb-detail-qcch-badge'
                });
                typeEl.style.setProperty('--nw-detail-tone', qcchColors[seg.type] || '#6b7280');
                const content = row.createDiv({ cls: 'nw-kb-detail-fill' });
                content.createEl('div', {
                    text: t('bookDetail.structure.positionLine', { start: formatDetailPercent(seg.startPosition), end: formatDetailPercent(seg.endPosition) }),
                    cls: 'nw-kb-detail-text--strong nw-kb-detail-mb-2'
                });
                if (seg.chapterRange && seg.chapterRange.length === 2) {
                    content.createEl('div', {
                        text: t('bookDetail.structure.rangeLine', { start: seg.chapterRange[0]+1, end: seg.chapterRange[1]+1 }),
                        cls: 'nw-kb-detail-note'
                    });
                }
            });
        }

        // 三线叙事结构
        if (threeLineStructure) {
            const section = this.createDetailSection(container, t('bookDetail.structure.threeLines'));
            const lines = [
                { key: 'mainLine', label: t('bookDetail.structure.mainLine'), color: '#ef4444' },
                { key: 'subLine', label: t('bookDetail.structure.subLine'), color: '#3b82f6' },
                { key: 'romanceLine', label: t('bookDetail.structure.romanceLine'), color: '#ec4899' },
            ];
            
            lines.forEach(({ key, label, color }) => {
                const lineData = threeLineStructure[key as keyof typeof threeLineStructure] as { description: string; keyNodes?: Array<{ position: number; description: string }> };
                if (!lineData) return;
                
                const card = section.createDiv({ cls: 'nw-kb-detail-line-card' });
                card.style.setProperty('--nw-detail-tone', color);
                card.createDiv({ text: lineData.description, cls: 'nw-kb-detail-prose' });
                
                if (lineData.keyNodes && lineData.keyNodes.length > 0) {
                    const nodes = card.createDiv({ cls: 'nw-kb-detail-tag-row nw-kb-detail-mt-8' });
                    lineData.keyNodes.forEach(node => {
                        const nodeChip = nodes.createSpan({
                            text: `${(node.position * 100).toFixed(0)}%`,
                            cls: 'nw-kb-detail-line-node'
                        });
                        nodeChip.style.setProperty('--nw-detail-tone', color);
                        nodeChip.style.setProperty('--nw-detail-tone-bg', `${color}20`);
                    });
                }
            });
        }

        // 章节列表
        if (rhythmUnits && rhythmUnits.length > 0) {
            const chapters = rhythmUnits.filter(u => u.level === 'chapter').slice(0, 10);
            if (chapters.length > 0) {
                const section = this.createDetailSection(container, t('bookDetail.structure.chapterList'));
                const list = section.createDiv({ cls: 'nw-kb-detail-stack nw-kb-detail-stack--gap-6' });
                chapters.forEach(ch => {
                    const row = list.createDiv({
                        cls: 'nw-kb-detail-tile-row--split'
                    });
                    row.createSpan({ text: ch.title, cls: 'nw-kb-detail-text--strong' });
                    row.createSpan({ text: t('bookDetail.structure.chapterWords', { count: formatDetailCount(ch.wordCount) }), cls: 'nw-kb-detail-note' });
                });
            }
        }
    }

    // ---- 概览 Tab ----
    /**
     * renderBookOverviewTab 方法。
     * @param container - 容器元素
     * @param book - 书籍
     */
    public renderBookOverviewTab(container: HTMLElement, book: BookBasicInfo): void {
        const infoSection = this.createDetailSection(container, t('bookDetail.overview.basic'));
        const infoGrid = infoSection.createDiv({ cls: 'nw-kb-detail-info-grid' });
        this.addInfoItem(infoGrid, t('bookDetail.overview.name'), book.name);
        this.addInfoItem(infoGrid, t('bookDetail.overview.author'), book.author || t('bookDetail.common.unknown'));
        this.addInfoItem(infoGrid, t('bookDetail.overview.words'), this.deps.formatWordCount(book.wordCount));
        this.addInfoItem(infoGrid, t('bookDetail.overview.createdAt'), this.deps.formatDateTime(book.createdAt));
        this.addInfoItem(infoGrid, t('bookDetail.overview.updatedAt'), this.deps.formatDateTime(book.updatedAt));
        this.addInfoItem(infoGrid, t('bookDetail.overview.status'), this.deps.getStatusLabel(book.breakdownStatus));

        if (book.synopsis) {
            const synopsisSection = this.createDetailSection(container, t('bookDetail.overview.synopsis'));
            // 简介可能上千字，直接整段渲染会把概览页拉成数千行；限高滚动保留全文
            synopsisSection.createDiv({ text: book.synopsis, cls: 'nw-kb-detail-synopsis' });
        }

        const genreSection = this.createDetailSection(container, t('bookDetail.overview.genre'));
        this.renderGenreInfo(genreSection, book);

        if (book.qualityScores) {
            const qualitySection = this.createDetailSection(container, t('bookDetail.overview.quality'));
            this.renderQualityChart(qualitySection, book);
        }

        const dimSection = this.createDetailSection(container, t('bookDetail.overview.dimensions'));

        if (book.breakdownStatus === 'processing') {
            const activeTasks = this.deps.getDeconstructionScheduler()?.getActiveTasks() || [];
            const bookTask = activeTasks.find(t => t.bookId === book.id);
            const emitter = bookTask ? this.deps.getDeconstructionScheduler()?.getTaskEmitter(bookTask.id) : undefined;
            const emitterState = emitter?.getState();

            if (emitterState) {
                const progressHeader = dimSection.createDiv({ cls: 'nw-kb-detail-progress' });

                const progressInfo = progressHeader.createDiv({ cls: 'nw-kb-detail-progress-head' });
                progressInfo.createSpan({
                    text: t('bookDetail.overview.progress', { value: Math.round(emitterState.progress) }),
                    cls: 'nw-kb-detail-progress-value',
                });
                if (emitterState.currentStep) {
                    progressInfo.createSpan({
                        text: `📍 ${emitterState.currentStep}`,
                        cls: 'nw-kb-detail-progress-step',
                    });
                }

                const progressBarWrap = progressHeader.createDiv({ cls: 'nw-kb-detail-progress-track' });
                const progressFill = progressBarWrap.createDiv({ cls: 'nw-kb-detail-progress-fill' });
                progressFill.style.setProperty('--nw-progress', `${emitterState.progress}%`);

                if (emitterState.message) {
                    progressHeader.createDiv({ text: emitterState.message, cls: 'nw-kb-detail-progress-message' });
                }

                const timeInfo = progressHeader.createDiv({ cls: 'nw-kb-detail-progress-time' });
                if (emitterState.elapsed !== undefined) {
                    timeInfo.createSpan({ text: t('bookDetail.overview.elapsed', { value: this.deps.formatDuration(emitterState.elapsed) }) });
                }
                if (emitterState.eta !== undefined) {
                    timeInfo.createSpan({ text: t('bookDetail.overview.eta', { value: this.deps.formatDuration(emitterState.eta) }) });
                }
            }
        }

        const dimGrid = dimSection.createDiv({ cls: 'nw-kb-detail-dim-grid' });
        const dimensions: { key: BreakdownDimension; label: string; data: unknown }[] = [
            { key: 'style', label: t('bookDetail.overview.dimStyle'), data: this.deps.getStyleData() },
            { key: 'rhythm', label: t('bookDetail.overview.dimRhythm'), data: this.deps.getRhythmData() },
            { key: 'technique', label: t('bookDetail.overview.dimTechnique'), data: this.deps.getTechniqueData() },
            { key: 'structure', label: t('bookDetail.overview.dimStructure'), data: this.deps.getStructureData() },
            { key: 'character', label: t('bookDetail.overview.dimCharacter'), data: this.deps.getCharacterData() },
            { key: 'foreshadow', label: t('bookDetail.overview.dimForeshadow'), data: this.deps.getForeshadowData() },
        ];

        const activeTasks = this.deps.getDeconstructionScheduler()?.getActiveTasks() || [];
        const bookTask = activeTasks.find(t => t.bookId === book.id);
        const emitter = bookTask ? this.deps.getDeconstructionScheduler()?.getTaskEmitter(bookTask.id) : undefined;
        const emitterState = emitter?.getState();
        const currentStepName = emitterState?.currentStep;

        dimensions.forEach(dim => {
            const isCurrentStep = currentStepName === this.deps.getDimensionLabels()[dim.key as BreakdownDimension];
            // 三态：已完成 / 进行中 / 未开始 —— 状态走修饰类，不再拼内联样式
            const state = dim.data ? 'done' : isCurrentStep ? 'active' : 'pending';
            const item = dimGrid.createDiv({ cls: `nw-kb-detail-dim nw-kb-detail-dim--${state}` });
            item.createDiv({
                text: dim.data ? '✓' : isCurrentStep ? '⏳' : '○',
                cls: 'nw-kb-detail-dim-icon',
            });
            item.createDiv({ text: dim.label, cls: 'nw-kb-detail-dim-label' });
        });
    }

    /**
     * 详情页分区容器（所有页签共用）。
     *
     * 2026-11-16 视觉重构：语义类 nw-kb-detail-section / -title，样式见 27-knowledge-base.css。
     */
    private createDetailSection(container: HTMLElement, title: string): HTMLElement {
        const section = container.createDiv({ cls: 'nw-kb-detail-section' });
        section.createEl('h3', { text: title, cls: 'nw-kb-detail-section-title' });
        return section;
    }

    private renderChart(container: HTMLElement, svgHtml: string): void {
        setSanitizedHtml(container, svgHtml);
        const chartContainer = container.querySelector('.nw-chart-container') as HTMLElement;
        if (chartContainer) {
            attachChartInteractions(chartContainer);
        }
    }

    /**
     * 信息项（label + value），所有页签共用。
     *
     * 2026-11-16 视觉重构：语义类 nw-kb-detail-info-item / -label / -value。
     * 说明：原 label 挂的 nw-text-muted-11 从未定义（死类），本次按设计意图补上 11px 弱化色。
     */
    private addInfoItem(container: HTMLElement, label: string, value: string): void {
        const item = container.createDiv({ cls: 'nw-kb-detail-info-item' });
        item.createDiv({ text: label, cls: 'nw-kb-detail-info-label' });
        item.createDiv({ text: value, cls: 'nw-kb-detail-info-value' });
    }

    private renderGenreInfo(container: HTMLElement, book: BookBasicInfo): void {
        const card = container.createDiv({
            cls: 'nw-kb-detail-card nw-kb-detail-card--xl'
        });

        const headerRow = card.createDiv({
            cls: "nw-kb-detail-card-header"
        });
        headerRow.createSpan({
            text: t('bookDetail.genre.info'),
            cls: 'nw-kb-detail-card-title'
        });

        const actionBtns = headerRow.createDiv({ cls: 'nw-kb-detail-card-actions' });

        const autoClassifyBtn = actionBtns.createEl('button', {
            text: t('bookDetail.genre.auto'),
            cls: 'nw-btn nw-btn-secondary nw-btn-xs',
            attr: { title: t('bookDetail.genre.autoTip') }
        });
        autoClassifyBtn.addEventListener('click', async () => {
            await this.deps.onClassifyBook(book);
        });

        const editBtn = actionBtns.createEl('button', {
            text: t('bookDetail.genre.edit'),
            cls: 'nw-btn nw-btn-secondary nw-btn-xs',
            attr: { title: t('bookDetail.genre.editTip') }
        });
        editBtn.addEventListener('click', () => this.deps.onEditBook(book));

        const rows: { label: string; value: string; confidence?: number }[] = [
            { label: t('bookDetail.genre.channel'), value: this.deps.getChannelLabel(book.genreChannel || t('bookDetail.common.uncategorized')), confidence: book.genreChannelConfidence },
            { label: t('bookDetail.genre.major'), value: this.getGenreName(book.primaryGenre), confidence: book.primaryGenreConfidence },
            { label: t('bookDetail.genre.sub'), value: this.getSubGenreName(book.primaryGenre, book.primarySubGenre), confidence: book.primarySubGenreConfidence },
        ];

        rows.forEach(row => {
            const rowEl = card.createDiv({
                cls: 'nw-kb-detail-field'
            });
            rowEl.createSpan({
                text: row.label + '：',
                cls: "nw-kb-detail-field-label"
            });
            const valueEl = rowEl.createSpan({
                text: row.value,
                cls: 'nw-kb-detail-field-value'
            });
            if (row.confidence !== undefined) {
                valueEl.createSpan({
                    text: ` ${formatDetailPercent(row.confidence)}`,
                    cls: "nw-kb-detail-confidence"
                });
            }
        });

        if (book.genreRecommendations && book.genreRecommendations.length > 0) {
            const recSection = card.createDiv({ cls: 'nw-kb-detail-rec-section' });
            recSection.createDiv({
                text: t('bookDetail.genre.suggest'),
                cls: "nw-kb-detail-rec-title"
            });

            book.genreRecommendations.forEach((rec, idx) => {
                const recRow = recSection.createDiv({
                    cls: 'nw-kb-detail-rec-row'
                });
                recRow.addEventListener('click', async () => {
                    await this.deps.onApplyGenreRecommendation(book, rec);
                });

                const left = recRow.createDiv({ cls: 'nw-kb-detail-rec-main' });
                left.createSpan({
                    text: `${idx + 1}.`,
                    cls: "nw-kb-detail-rec-rank"
                });
                left.createSpan({
                    text: `${this.getGenreName(rec.genreId)}${rec.subGenreId ? ' · ' + this.getSubGenreName(rec.genreId, rec.subGenreId) : ''}`,
                    cls: 'nw-kb-detail-rec-name'
                });

                const confBar = recRow.createDiv({ cls: 'nw-kb-detail-rec-bar' });
                const confFill = confBar.createDiv({ cls: 'nw-kb-detail-bar-fill' });
                confFill.style.setProperty('--nw-kb-detail-pct', `${(rec.confidence * 100).toFixed(0)}%`);
            });
        }

        if (book.secondaryGenres && book.secondaryGenres.length > 0) {
            const row = card.createDiv({ cls: 'nw-kb-detail-subgenres' });
            row.createSpan({
                text: t('bookDetail.genre.secondary'),
                cls: "nw-kb-detail-field-label"
            });
            const tagsEl = row.createDiv({ cls: "nw-kb-detail-subgenre-list" });
            book.secondaryGenres.forEach(gid => {
                const g = this.deps.getKb()?.getGenre(gid);
                if (g) {
                    tagsEl.createSpan({
                        text: g.name,
                        cls: 'nw-kb-detail-subgenre-tag'
                    });
                }
            });
        }
    }

    private getGenreName(genreId?: string): string {
        const kb = this.deps.getKb();
        if (!genreId || !kb) return t('bookDetail.common.uncategorized');
        const genre = kb.getGenre(genreId);
        return genre?.name || genreId;
    }

    private getSubGenreName(genreId?: string, subGenreId?: string): string {
        const kb = this.deps.getKb();
        if (!genreId || !subGenreId || !kb) return t('bookDetail.common.uncategorized');
        const sub = kb.getSubGenre(genreId, subGenreId);
        return sub?.name || subGenreId;
    }

    private renderQualityChart(container: HTMLElement, book: BookBasicInfo): void {
        if (!book.qualityScores) return;

        const qs = book.qualityScores;

        const wrap = container.createDiv({
            cls: 'nw-kb-detail-quality'
        });

        const radarCard = wrap.createDiv({
            cls: 'nw-kb-detail-quality-radar'
        });
        this.renderChart(radarCard, radarChart(buildQualityRadarData(qs), { size: 300, title: t('bookDetail.quality.radar') }));

        const scoresCard = wrap.createDiv({
            cls: 'nw-kb-detail-quality-scores'
        });

        const overall = scoresCard.createDiv({
            cls: 'nw-kb-detail-quality-overall'
        });
        overall.createDiv({
            text: formatDetailNumber(qs.overall, 0),
            cls: 'nw-kb-detail-quality-overall-value'
        });
        overall.createDiv({ text: t('bookDetail.common.overall'), cls: 'nw-kb-detail-quality-overall-label' });

        buildQualityScoreRows(qs).forEach(s => {
            const item = scoresCard.createDiv({ cls: 'nw-kb-detail-score' });
            const top = item.createDiv({ cls: 'nw-kb-detail-score-top' });
            top.createSpan({ text: s.name, cls: 'nw-kb-detail-score-name' });
            if (s.optional && s.value == null) {
                top.createSpan({ text: 'N/A', cls: 'nw-kb-detail-score-na' });
            } else {
                top.createSpan({ text: formatDetailNumber(s.value, 0, t('bookDetail.common.scoreSuffix')), cls: 'nw-text-sm-muted' });
            }
            const bar = item.createDiv({ cls: 'nw-kb-detail-score-bar' });
            const displayVal = s.optional && s.value == null ? 0 : (s.value ?? 0);
            const fill = bar.createDiv({ cls: 'nw-kb-detail-bar-fill' });
            fill.style.setProperty('--nw-kb-detail-pct', `${displayVal}%`);
        });
    }

    // ---- 人设 Tab ----
    /**
     * 渲染书籍角色页签。
     * @param container - 容器元素
     */
    public renderBookCharacterTab(container: HTMLElement): void {
        const data = this.deps.getCharacterData();

        if (!data || !data.characters || data.characters.length === 0) {
            this.renderDetailEmpty(container, t('bookDetail.character.name'));
            return;
        }

        this.renderQualityScoreCard(container, data as unknown as Record<string, unknown>);

        const sortedChars = sortCharactersByImportance(data.characters);

        const book = this.deps.getCurrentBook();
        if (book) {
            container.createDiv({
                text: t('bookDetail.common.basedOn', { wordCount: this.deps.formatWordCount(book.wordCount) }),
                cls: 'nw-kb-detail-caption'
            });
        }

        if (data.stats) {
            const section = this.createDetailSection(container, t('bookDetail.character.stats'));
            const statsGrid = section.createDiv({
                cls: 'nw-kb-detail-grid nw-kb-detail-grid--min-140'
            });
            this.addInfoItem(statsGrid, t('bookDetail.character.total'), String(data.stats.totalCharacters));
            this.addInfoItem(statsGrid, t('bookDetail.character.mains'), String(data.stats.mainCharacterCount));
            this.addInfoItem(statsGrid, t('bookDetail.character.avgAppearance'), formatDetailNumber(data.stats.avgAppearancePerCharacter, 1));
        }

        // 角色重要性排行
        if (sortedChars.length > 0) {
            const rankSection = this.createDetailSection(container, t('bookDetail.character.ranking'));
            const rankTable = rankSection.createDiv({
                cls: 'nw-kb-detail-table-wrap nw-kb-detail-table-wrap--x'
            });
            const table = rankTable.createEl('table', {
                cls: 'nw-kb-detail-table'
            });
            const thead = table.createEl('thead');
            const headRow = thead.createEl('tr', { cls: 'nw-kb-detail-surface' });
            [t('bookDetail.character.hRank'), t('bookDetail.character.hName'), t('bookDetail.character.hTier'), t('bookDetail.character.hOverall'), t('bookDetail.character.hAppearance'), t('bookDetail.character.hDialogue'), t('bookDetail.character.hPlot'), t('bookDetail.character.hRelation'), t('bookDetail.character.hPerspective')].forEach(h => {
                headRow.createEl('th', {
                    text: h,
                    cls: 'nw-kb-detail-th'
                });
            });
            const tbody = table.createEl('tbody');
            sortedChars.slice(0, 10).forEach((char, idx) => {
                const row = tbody.createEl('tr', {
                    cls: idx % 2 === 0 ? undefined : 'nw-kb-detail-tr--alt'
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
                        cls: i === 1 ? 'nw-kb-detail-td nw-kb-detail-td--name' : 'nw-kb-detail-td'
                    });
                });
            });
        }

        // 主角重要性雷达图
        if (sortedChars.length > 0) {
            const topChar = sortedChars[0];
            if (topChar.importance) {
                const radarSection = this.createDetailSection(container, t('bookDetail.character.topRadar', { name: topChar.name }));
                const radarData = [
                    { label: t('bookDetail.character.appearanceFreq'), value: topChar.importance.appearanceFrequency },
                    { label: t('bookDetail.style.dialogueRatio'), value: topChar.importance.dialogueRatio },
                    { label: t('bookDetail.character.plotDriving'), value: topChar.importance.plotDrivingScore },
                    { label: t('bookDetail.character.relationCenter'), value: topChar.importance.relationshipCentrality },
                    { label: t('bookDetail.character.perspectiveRatio'), value: topChar.importance.perspectiveRatio },
                ];
                const radarDiv = radarSection.createDiv({
                    cls: 'nw-kb-detail-chart'
                });
                this.renderChart(radarDiv, radarChart(radarData, { size: 320, title: t('bookDetail.character.radarTitle') }));
            }
        }

        // 角色卡片列表
        const mainSection = this.createDetailSection(container, t('bookDetail.character.list'));
        const grid = mainSection.createDiv({
            cls: 'nw-kb-detail-grid nw-kb-detail-grid--fill-300'
        });

        sortedChars.forEach((char, idx) => {
            const key = `char_main_${idx}`;
            const isExpanded = this.deps.getExpandedItems()[key] ?? false;

            const card = grid.createDiv({
                cls: 'nw-kb-detail-char-card'
            });

            const header = card.createDiv({
                cls: 'nw-kb-detail-char-head'
            });

            const avatar = header.createDiv({
                text: char.name.charAt(0),
                cls: "nw-kb-detail-avatar nw-kb-detail-avatar--accent", attr: {}
            });
            void avatar;

            const info = header.createDiv({ cls: 'nw-kb-detail-grow' });
            info.createDiv({ text: char.name, cls: 'nw-kb-detail-name nw-kb-detail-mb-2' });
            const roleInfo = [char.role || t('bookDetail.character.unknownRole'), char.gender || ''];
            if (char.importance?.tier) roleInfo.push(this.getTierLabel(char.importance.tier));
            info.createDiv({ text: joinRoleParts(roleInfo), cls: 'nw-kb-detail-note' });

            const toggle = header.createSpan({
                text: isExpanded ? '▼' : '▶',
                cls: 'nw-kb-detail-meta'
            });
            void toggle;

            header.addEventListener('click', () => {
                this.deps.getExpandedItems()[key] = !isExpanded;
                this.deps.onRequestReRender();
            });

            // 标签显示（性格+能力）
            const tagsEl = card.createDiv({
                cls: "nw-kb-detail-tag-row nw-kb-detail-tag-row--padded", attr: {}
            });
            const allTags = [...(char.personality || []), ...(char.abilities || [])];
            allTags.slice(0, 4).forEach(tag => {
                tagsEl.createSpan({
                    text: tag,
                    cls: 'nw-kb-detail-chip'
                });
            });

            // 角色弧光进度条
            if (char.characterArc) {
                const arcBar = card.createDiv({
                    cls: 'nw-kb-detail-arc-bar'
                });
                arcBar.createSpan({
                    text: this.getArcTypeLabel(char.characterArc.transformationType),
                    cls: "nw-kb-detail-chip--accent", attr: {}
                });
                const barBg = arcBar.createDiv({
                    cls: 'nw-kb-detail-meter nw-kb-detail-meter--grow'
                });
                const arcFill = barBg.createDiv({ cls: 'nw-kb-detail-meter-fill' });
                arcFill.style.setProperty('--nw-progress', `${char.characterArc.completeness}%`);
                arcBar.createSpan({
                    text: `${char.characterArc.completeness}%`,
                    cls: 'nw-kb-detail-arc-percent'
                });
            }

            if (isExpanded) {
                const body = card.createDiv({
                    cls: 'nw-kb-detail-char-body'
                });

                // 基础统计
                const statsRow = body.createDiv({
                    cls: 'nw-kb-detail-grid nw-kb-detail-grid--cols-4 nw-kb-detail-grid--tight nw-kb-detail-mb-12'
                });
                const quickStats = [
                    { label: t('bookDetail.character.hAppearance'), value: char.appearanceCount ?? '-' },
                    { label: t('bookDetail.character.mentions'), value: char.mentionCount ?? '-' },
                    { label: t('bookDetail.character.first'), value: char.firstAppearance ? `${(char.firstAppearance * 100).toFixed(0)}%` : '-' },
                    { label: t('bookDetail.character.last'), value: char.lastAppearance ? `${(char.lastAppearance * 100).toFixed(0)}%` : '-' },
                ];
                quickStats.forEach(s => {
                    const item = statsRow.createDiv({
                        cls: 'nw-kb-detail-stat--mini'
                    });
                    item.createDiv({ text: String(s.value), cls: 'nw-kb-detail-heading' });
                    item.createDiv({ text: s.label, cls: 'nw-kb-detail-stat-label--mini' });
                });

                // 性格特点
                if (char.personality && char.personality.length > 0) {
                    body.createDiv({ text: t('bookDetail.character.traits'), cls: "nw-kb-detail-subheading", attr: {} });
                    const tagsWrap = body.createDiv({ cls: "nw-kb-detail-tag-row nw-kb-detail-mb-12", attr: {} });
                    char.personality.forEach(tag => {
                        tagsWrap.createSpan({
                            text: tag,
                            cls: 'nw-kb-detail-chip nw-kb-detail-chip--outline'
                        });
                    });
                }

                // 能力特点
                if (char.abilities && char.abilities.length > 0) {
                    body.createDiv({ text: t('bookDetail.character.abilities'), cls: "nw-kb-detail-subheading", attr: {} });
                    const tagsWrap = body.createDiv({ cls: "nw-kb-detail-tag-row nw-kb-detail-mb-12", attr: {} });
                    char.abilities.forEach(tag => {
                        tagsWrap.createSpan({
                            text: tag,
                            cls: 'nw-kb-detail-chip nw-kb-detail-chip--outline'
                        });
                    });
                }

                // 角色弧光详情
                if (char.characterArc) {
                    body.createDiv({ text: t('bookDetail.character.arc'), cls: "nw-kb-detail-subheading", attr: {} });
                    const arcInfo = body.createDiv({
                        cls: 'nw-kb-detail-arc-info'
                    });
                    arcInfo.createDiv({
                        text: t('bookDetail.character.arcTypeLine', { value: this.getArcTypeLabel(char.characterArc.transformationType) }),
                        cls: 'nw-kb-detail-fine nw-kb-detail-mb-4'
                    });
                    arcInfo.createDiv({
                        text: t('bookDetail.character.arcComplete', { value: char.characterArc.completeness }),
                        cls: 'nw-kb-detail-fine nw-kb-detail-mb-4'
                    });
                    if (char.characterArc.initialState?.goals && char.characterArc.initialState.goals.length > 0) {
                        const goalText = char.characterArc.initialState.goals[0];
                        arcInfo.createDiv({
                            text: t('bookDetail.character.goal', { value: goalText.length > 40 ? goalText.substring(0, 40) + '...' : goalText }),
                            cls: 'nw-kb-detail-fine'
                        });
                    }

                    // 成长节点
                    if (char.characterArc.growthNodes && char.characterArc.growthNodes.length > 0) {
                        body.createDiv({ text: t('bookDetail.character.growth'), cls: "nw-kb-detail-subheading", attr: {} });
                        const nodesList = body.createDiv({
                            cls: 'nw-kb-detail-node-list'
                        });
                        char.characterArc.growthNodes.slice(0, 5).forEach(node => {
                            const nodeItem = nodesList.createDiv({
                                cls: 'nw-kb-detail-node'
                            });
                            const topRow = nodeItem.createDiv({ cls: 'nw-kb-detail-node-row' });
                            topRow.createSpan({
                                text: `[${node.changeType}]`,
                                cls: 'nw-kb-detail-accent-strong'
                            });
                            topRow.createSpan({
                                text: `${(node.position * 100).toFixed(0)}%`,
                                cls: 'nw-kb-detail-muted'
                            });
                            nodeItem.createDiv({
                                text: node.event.length > 50 ? node.event.substring(0, 50) + '...' : node.event,
                                cls: 'nw-kb-detail-event-text'
                            });
                        });
                    }
                }
            }
        });

        if (data.relationDetails && data.relationDetails.length > 0) {
            const relSection = this.createDetailSection(container, t('bookDetail.character.relationDepth'));
            const relGrid = relSection.createDiv({
                cls: 'nw-kb-detail-grid nw-kb-detail-grid--fill-280 nw-kb-detail-grid--snug'
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
                    cls: 'nw-kb-detail-card--outlined'
                });
                const header = card.createDiv({
                    cls: 'nw-kb-detail-relation-head'
                });
                header.createDiv({
                    text: `${fromName} ↔ ${toName}`,
                    cls: "nw-kb-detail-relation-name", attr: {}
                });
                const strengthBadge = header.createSpan({
                    text: `${rd.strength}%`,
                    cls: "nw-kb-detail-chip--solid", attr: {}
                });
                void strengthBadge;
                header.createSpan({
                    text: isExpanded ? '▼' : '▶',
                    cls: "nw-kb-detail-toggle nw-kb-detail-toggle--fixed", attr: {}
                });
                header.addEventListener('click', () => {
                    this.deps.getExpandedItems()[relKey] = !isExpanded;
                    this.deps.onRequestReRender();
                });

                card.createDiv({
                    text: rd.type,
                    cls: "nw-kb-detail-relation-type", attr: {}
                });

                if (isExpanded) {
                    const body = card.createDiv({
                        cls: 'nw-kb-detail-relation-body'
                    });
                    if (rd.history && rd.history.length > 0) {
                        body.createDiv({ text: t('bookDetail.character.relationChange'), cls: 'nw-kb-detail-muted-strong nw-kb-detail-mb-6' });
                        rd.history.forEach(h => {
                            body.createDiv({
                                text: `${(h.position * 100).toFixed(0)}%：${h.fromType} → ${h.toType}`,
                                cls: 'nw-kb-detail-history-line'
                            });
                        });
                    }
                    if (rd.keyEvents && rd.keyEvents.length > 0) {
                        body.createDiv({ text: t('bookDetail.character.keyEvents'), cls: 'nw-kb-detail-muted-strong nw-kb-detail-m-8-0-6' });
                        rd.keyEvents.slice(0, 3).forEach(e => {
                            body.createDiv({
                                text: e.length > 50 ? e.substring(0, 50) + '...' : e,
                                cls: 'nw-kb-detail-event-line'
                            });
                        });
                    }
                }
            });
        }

        if (data.relationships && data.relationships.length > 0) {
            const netSection = this.createDetailSection(container, t('bookDetail.character.network', { count: data.relationships.length }));
            const netTable = netSection.createDiv({
                cls: 'nw-kb-detail-table-wrap nw-kb-detail-table-wrap--scroll-250'
            });
            const table = netTable.createEl('table', {
                cls: 'nw-kb-detail-table'
            });
            const thead = table.createEl('thead');
            const headRow = thead.createEl('tr', { cls: 'nw-kb-detail-thead--sticky' });
            [t('bookDetail.character.hCharA'), t('bookDetail.character.hCharB'), t('bookDetail.character.hRelType'), t('bookDetail.character.hStrength')].forEach(h => {
                headRow.createEl('th', {
                    text: h,
                    cls: 'nw-kb-detail-th'
                });
            });
            const tbody = table.createEl('tbody');
            data.relationships.forEach((rel, idx) => {
                const row = tbody.createEl('tr', {
                    cls: idx % 2 === 0 ? undefined : 'nw-kb-detail-tr--alt'
                });
                const fromName = data.mainCharacters?.find(m => m.name === rel.from)?.name ||
                    data.allCharacters?.find(c => c.name === rel.from)?.name || rel.from;
                const toName = data.mainCharacters?.find(m => m.name === rel.to)?.name ||
                    data.allCharacters?.find(c => c.name === rel.to)?.name || rel.to;
                row.createEl('td', { text: fromName, cls: 'nw-kb-detail-td' });
                row.createEl('td', { text: toName, cls: 'nw-kb-detail-td' });
                row.createEl('td', { text: rel.type, cls: 'nw-kb-detail-td' });
                const strength = rel.weight ? Math.round(rel.weight * 100) : '-';
                row.createEl('td', { text: `${strength}${typeof strength === 'number' ? '%' : ''}`, cls: 'nw-kb-detail-td' });
            });
        }

        if (data.allCharacters && data.allCharacters.length > 0) {
            const allSection = this.createDetailSection(container, t('bookDetail.character.all', { count: data.allCharacters.length }));
            const list = allSection.createDiv({
                cls: 'nw-kb-detail-table-wrap nw-kb-detail-table-wrap--scroll-300'
            });
            data.allCharacters.forEach((char) => {
                const item = list.createDiv({ cls: 'nw-kb-detail-char-row' });
                item.createSpan({
                    text: char.name.charAt(0),
                    cls: "nw-kb-detail-avatar nw-kb-detail-avatar--sm", attr: {}
                });
                item.createSpan({ text: char.name, cls: 'nw-kb-detail-text--strong nw-kb-detail-fill' });
                const roleParts = [char.role || ''];
                if (char.tier) roleParts.push(this.getTierLabel(char.tier));
                item.createSpan({ text: joinRoleParts(roleParts), cls: 'nw-kb-detail-meta' });
                if (char.tags && char.tags.length > 0) {
                    const tagsWrap = item.createDiv({ cls: "nw-kb-detail-tag-row--inline", attr: {} });
                    char.tags.slice(0, 2).forEach(tag => {
                        tagsWrap.createSpan({
                            text: tag,
                            cls: 'nw-kb-detail-chip nw-kb-detail-chip--tiny'
                        });
                    });
                }
            });
        }

        if (data.relations && data.relations.length > 0) {
            const relKey = 'char_rel_network';
            const isExpanded = this.deps.getExpandedItems()[relKey] ?? false;
            const section = this.createDetailSection(container, t('bookDetail.character.graph'));
            const header = section.createDiv({
                cls: 'nw-kb-detail-collapse-head'
            });
            header.createSpan({
                text: isExpanded ? '▼' : '▶',
                cls: 'nw-kb-detail-note'
            });
            header.createSpan({
                text: t('bookDetail.character.relationCount', { count: data.relations.length }),
                cls: 'nw-kb-detail-text'
            });
            header.addEventListener('click', () => {
                this.deps.getExpandedItems()[relKey] = !isExpanded;
                this.deps.onRequestReRender();
            });

            if (isExpanded) {
                const list = section.createDiv({
                    cls: 'nw-kb-detail-stack nw-kb-detail-stack--gap-6 nw-kb-detail-scroll-400'
                });
                data.relations.slice(0, 15).forEach(rel => {
                    const relItem = list.createDiv({
                        cls: 'nw-kb-detail-relation-row'
                    });
                    relItem.createSpan({
                        text: `${rel.fromId} → ${rel.toId}`,
                        cls: 'nw-kb-detail-relation-key'
                    });
                    relItem.createSpan({
                        text: rel.type,
                        cls: 'nw-kb-detail-chip--accent-inline'
                    });
                    const weightPct = rel.weight != null ? `${(rel.weight * 100).toFixed(0)}%` : '-';
                    relItem.createSpan({
                        text: t('bookDetail.character.weight', { value: weightPct }),
                        cls: 'nw-kb-detail-muted'
                    });
                    const eventCount = rel.keyEvents?.length ?? 0;
                    relItem.createSpan({
                        text: t('bookDetail.character.events', { value: eventCount }),
                        cls: 'nw-kb-detail-muted nw-kb-detail-ml-auto'
                    });
                });
            }
        }

        if (data.networkCentrality?.centrality && data.networkCentrality.centrality.length > 0) {
            const section = this.createDetailSection(container, t('bookDetail.character.pagerank'));
            const barData = topCentralityBars(data.networkCentrality.centrality);
            const chartDiv = section.createDiv({ cls: 'nw-kb-detail-chart' });
            this.renderChart(chartDiv, barChart(barData, { width: 500, height: 220, horizontal: true, title: t('bookDetail.character.pagerankTitle') }));
        }
    }

    private getTierLabel(tier?: string): string {
        return resolveTierLabel(tier);
    }

    private getArcTypeLabel(type: string): string {
        return resolveArcTypeLabel(type);
    }

    private getTimelineIcon(type: string): string {
        return resolveTimelineIcon(type);
    }

    // ---- 伏笔 Tab ----
    /**
     * 渲染书籍伏笔页签。
     * @param container - 容器元素
     */
    public renderBookForeshadowTab(container: HTMLElement): void {
        const data = this.deps.getForeshadowData();

        if (!data || !data.foreshadows || data.foreshadows.length === 0) {
            this.renderDetailEmpty(container, t('bookDetail.foreshadow.name'));
            return;
        }

        this.renderQualityScoreCard(container, data as unknown as Record<string, unknown>);

        const book = this.deps.getCurrentBook();
        if (book) {
            container.createDiv({
                text: t('bookDetail.common.basedOn', { wordCount: this.deps.formatWordCount(book.wordCount) }),
                cls: 'nw-kb-detail-caption'
            });
        }

        const { foreshadows, typeDistribution, stats, qualityScore } = data;

        // 质量评分
        if (qualityScore) {
            const scoreSection = this.createDetailSection(container, t('bookDetail.foreshadow.quality'));
            const scoreGrid = scoreSection.createDiv({
                cls: 'nw-kb-detail-grid nw-kb-detail-grid--min-120 nw-kb-detail-grid--snug'
            });
            const scoreItems = buildForeshadowQualityItems(qualityScore);
            scoreItems.forEach(item => {
                const card = scoreGrid.createDiv({
                    cls: 'nw-kb-detail-stat nw-kb-detail-stat--compact'
                });
                const valueEl = card.createDiv({ text: item.value, cls: 'nw-kb-detail-stat-value' });
                valueEl.style.setProperty('--nw-detail-tone', item.color);
                card.createDiv({ text: item.label, cls: 'nw-kb-detail-label-xs' });
            });
        }

        // 统计概览
        const statsSection = this.createDetailSection(container, t('bookDetail.foreshadow.stats'));
        
        if (stats) {
            const donutData = buildForeshadowDonutData(stats);
            const donutDiv = statsSection.createDiv({
                cls: 'nw-kb-detail-chart nw-kb-detail-mb-16'
            });
            this.renderChart(donutDiv, donutChart(donutData, { size: 280, title: t('bookDetail.foreshadow.donut') }));

            const statsGrid = statsSection.createDiv({
                cls: 'nw-kb-detail-grid nw-kb-detail-grid--cols-4'
            });
            const statItems = buildForeshadowStatItems(stats, v => formatDetailPercent(v));
            statItems.forEach(item => {
                const card = statsGrid.createDiv({
                    cls: 'nw-kb-detail-stat nw-kb-detail-stat--lg'
                });
                const valueEl = card.createDiv({ text: String(item.value), cls: 'nw-kb-detail-stat-value nw-kb-detail-stat-value--lg' });
                valueEl.style.setProperty('--nw-detail-tone', item.color);
                card.createDiv({ text: item.label, cls: 'nw-kb-detail-note' });
            });
        }

        // 类型分布
        if (typeDistribution && Object.keys(typeDistribution).length > 0) {
            const typeSection = this.createDetailSection(container, t('bookDetail.foreshadow.types'));
            const typeGrid = typeSection.createDiv({
                cls: 'nw-kb-detail-grid nw-kb-detail-grid--min-100 nw-kb-detail-grid--tight'
            });
            Object.entries(typeDistribution).forEach(([type, count]) => {
                typeGrid.createDiv({
                    cls: 'nw-kb-detail-stat'
                }).createDiv({
                    text: `${resolveForeshadowTypeLabel(type)}：${count}`,
                    cls: 'nw-kb-detail-fine'
                });
            });
        }

        // 伏笔列表
        const listSection = this.createDetailSection(container, t('bookDetail.foreshadow.list'));

        const filterRow = listSection.createDiv({
            cls: 'nw-kb-detail-filter-row'
        });
        const filterOptions = foreshadowFilterOptions();
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

        const filteredItems = filterForeshadows(foreshadows, currentFilter);

        const list = listSection.createDiv({
            cls: 'nw-kb-detail-list'
        });

        filteredItems.forEach((item) => {
            const itemEl = list.createDiv({ cls: 'nw-kb-detail-list-item' });

            const header = itemEl.createDiv({
                cls: 'nw-kb-detail-fore-item-head'
            });

            header.createSpan({
                text: item.hasResolution ? '✓' : '○',
                cls: item.hasResolution ? 'nw-kb-detail-mark nw-kb-detail-mark--done' : 'nw-kb-detail-mark'
            });

            const content = header.createDiv({ cls: 'nw-kb-detail-grow' });
            content.createDiv({ text: item.name, cls: 'nw-kb-detail-text--strong nw-kb-detail-mb-4' });
            const meta = content.createDiv({ cls: 'nw-kb-detail-chip-row' });
            
            meta.createSpan({
                text: resolveForeshadowTypeLabel(item.type),
                cls: 'nw-kb-detail-chip'
            });

            const importancePct = formatDetailPercent(item.importance);
            const importanceEl = meta.createSpan({ text: t('bookDetail.foreshadow.importance', { value: importancePct }), cls: 'nw-kb-detail-chip--tone' });
            importanceEl.style.setProperty('--nw-detail-tone',
                item.importance >= 0.7 ? '#e74c3c' : item.importance >= 0.4 ? '#f59e0b' : 'var(--text-muted)');
            importanceEl.style.setProperty('--nw-detail-tone-bg',
                item.importance >= 0.7 ? 'rgba(231,76,60,0.1)' : item.importance >= 0.4 ? 'rgba(245,158,11,0.1)' : 'var(--background-secondary)');

            meta.createSpan({
                text: t('bookDetail.foreshadow.appearances', { count: formatDetailCount(item.totalAppearances) }),
                cls: 'nw-kb-detail-label-xs'
            });
        });
    }

    // ---- 商业 Tab ----
    /**
     * 渲染书籍商业页签。
     * @param container - 容器元素
     */
    public renderBookCommercialTab(container: HTMLElement): void {
        const data = this.deps.getCommercialData();
        if (!data || (!data.overallScore && !data.goldenThreeChapters && !data.waveRhythm)) {
            this.renderDetailEmpty(container, t('bookDetail.commercial.name'));
            return;
        }

        this.renderQualityScoreCard(container, data as unknown as Record<string, unknown>);

        const book = this.deps.getCurrentBook();
        if (book) {
            container.createDiv({
                text: t('bookDetail.common.basedOn', { wordCount: this.deps.formatWordCount(book.wordCount) }),
                cls: 'nw-kb-detail-caption'
            });
        }

        if (data.overallScore !== undefined || data.overallLevel) {
            const section = this.createDetailSection(container, t('bookDetail.commercial.overview'));
            const card = section.createDiv({
                cls: 'nw-kb-detail-hero'
            });
            const scoreCircle = card.createDiv({
                cls: 'nw-kb-detail-score-circle nw-kb-detail-score-circle--warm'
            });
            scoreCircle.createDiv({ text: data.overallScore !== undefined ? data.overallScore.toString() : '-', cls: 'nw-kb-detail-hero-value' });
            scoreCircle.createDiv({ text: t('bookDetail.commercial.total'), cls: 'nw-kb-detail-hero-sub' });
            const infoDiv = card.createDiv({ cls: 'nw-kb-detail-fill' });
            infoDiv.createDiv({
                text: t('bookDetail.commercial.level', { value: data.overallLevel || '-' }),
                cls: 'nw-kb-detail-headline nw-kb-detail-headline--xl'
            });
            infoDiv.createDiv({
                text: t('bookDetail.commercial.overviewDesc'),
                cls: 'nw-kb-detail-text'
            });
        }

        if (data.goldenThreeChapters) {
            const gtc = data.goldenThreeChapters;
            const section = this.createDetailSection(container, t('bookDetail.commercial.golden'));

            if (gtc.totalScore !== undefined || gtc.subScores) {
                const scoreRow = section.createDiv({
                    cls: 'nw-kb-detail-summary-row'
                });
                if (gtc.totalScore !== undefined) {
                    scoreRow.createDiv({
                        text: t('bookDetail.commercial.goldenScore', { value: gtc.totalScore }),
                        cls: 'nw-kb-detail-headline'
                    });
                }
                if (gtc.subScores) {
                    const subLabels: Record<string, string> = {
                        openingConflict: t('bookDetail.commercial.dimOpening'),
                        infoDensity: t('bookDetail.commercial.dimInfo'),
                        protagonistGoal: t('bookDetail.commercial.dimGoal'),
                        goldenFinger: t('bookDetail.commercial.dimGold'),
                        chapterHooks: t('bookDetail.commercial.dimHooks')
                    };
                    const barData = buildScoreBars(gtc.subScores, subLabels);
                    if (barData.length > 0) {
                        const barDiv = section.createDiv({
                            cls: 'nw-kb-detail-chart'
                        });
                        this.renderChart(barDiv, barChart(barData, { width: 480, height: 180, title: t('bookDetail.commercial.dimChart'), horizontal: true }));
                    }
                }
            }

            if (gtc.improvementSuggestions && gtc.improvementSuggestions.length > 0) {
                const suggSection = this.createDetailSection(container, t('bookDetail.common.improve'));
                const sortedSuggestions = sortSuggestionsBySeverity(gtc.improvementSuggestions);
                const list = suggSection.createDiv({ cls: 'nw-kb-detail-stack' });

                sortedSuggestions.forEach(s => {
                    const item = list.createDiv({
                        cls: 'nw-kb-detail-item'
                    });
                    const header = item.createDiv({ cls: 'nw-kb-detail-item-head' });
                    const severityEl = header.createSpan({
                        text: resolveSeverityLabel(s.severity),
                        cls: 'nw-kb-detail-severity'
                    });
                    severityEl.style.setProperty('--nw-detail-tone', resolveSeverityColor(s.severity));
                    header.createSpan({ text: s.category, cls: 'nw-kb-detail-label-strong' });
                    item.createDiv({ text: s.suggestion, cls: 'nw-kb-detail-text' });
                });
            }
        }

        if (data.waveRhythm) {
            const wr = data.waveRhythm;
            const section = this.createDetailSection(container, t('bookDetail.commercial.wave'));

            if (wr.complianceRate !== undefined) {
                const progressWrap = section.createDiv({
                    cls: 'nw-kb-detail-card--lg nw-kb-detail-mb-12'
                });
                progressWrap.createDiv({
                    text: t('bookDetail.commercial.compliance', { value: formatDetailPercent(wr.complianceRate, 1) }),
                    cls: 'nw-kb-detail-heading nw-kb-detail-mb-8'
                });
                const barBg = progressWrap.createDiv({
                    cls: 'nw-kb-detail-meter nw-kb-detail-meter--lg'
                });
                const complianceFill = barBg.createDiv({ cls: 'nw-kb-detail-meter-fill nw-kb-detail-meter-fill--warm' });
                complianceFill.style.setProperty('--nw-progress', `${Math.min(100, Math.max(0, wr.complianceRate * 100))}%`);
            }

            if (wr.violations && wr.violations.length > 0) {
                const typeLabels: Record<string, string> = {
                    small_cool: t('bookDetail.commercial.smallCool'),
                    medium_reversal: t('bookDetail.commercial.mediumReversal'),
                    big_climax: t('bookDetail.commercial.bigClimax')
                };
                const vSection = this.createDetailSection(container, t('bookDetail.commercial.violations', { count: wr.violations.length }));
                const list = vSection.createDiv({ cls: 'nw-kb-detail-stack nw-kb-detail-stack--gap-6' });
                wr.violations.forEach((v, i) => {
                    const item = list.createDiv({
                        cls: 'nw-kb-detail-card--inset nw-kb-detail-fine'
                    });
                    item.createEl('div', {
                        text: t('bookDetail.commercial.violationLine', { index: i + 1, type: typeLabels[v.type] || v.type, start: v.startChapter, end: v.endChapter }),
                        cls: 'nw-kb-detail-violation-title'
                    });
                    item.createEl('div', {
                        text: t('bookDetail.commercial.gap', { gap: v.gap, threshold: v.threshold }),
                        cls: 'nw-kb-detail-muted'
                    });
                });
            }
        }
    }

    // ---- 可读性 Tab ----
    /**
     * 渲染书籍可读性页签。
     * @param container - 容器元素
     */
    public renderBookReadabilityTab(container: HTMLElement): void {
        const data = this.deps.getReadabilityData();
        if (!data || (!data.overallScore && !data.showTell && !data.aiTrace)) {
            this.renderDetailEmpty(container, t('bookDetail.readability.name'));
            return;
        }

        this.renderQualityScoreCard(container, data as unknown as Record<string, unknown>);

        const book = this.deps.getCurrentBook();
        if (book) {
            container.createDiv({
                text: t('bookDetail.common.basedOn', { wordCount: this.deps.formatWordCount(book.wordCount) }),
                cls: 'nw-kb-detail-caption'
            });
        }

        if (data.overallScore !== undefined) {
            const section = this.createDetailSection(container, t('bookDetail.readability.overview'));
            const card = section.createDiv({
                cls: 'nw-kb-detail-hero'
            });
            const scoreCircle = card.createDiv({
                cls: 'nw-kb-detail-score-circle nw-kb-detail-score-circle--cool'
            });
            scoreCircle.createDiv({ text: data.overallScore.toString(), cls: 'nw-kb-detail-hero-value' });
            scoreCircle.createDiv({ text: t('bookDetail.commercial.total'), cls: 'nw-kb-detail-hero-sub' });
            const infoDiv = card.createDiv({ cls: 'nw-kb-detail-fill' });
            infoDiv.createDiv({
                text: t('bookDetail.readability.overall'),
                cls: 'nw-kb-detail-headline nw-kb-detail-headline--xl'
            });
            infoDiv.createDiv({
                text: t('bookDetail.readability.overviewDesc'),
                cls: 'nw-kb-detail-text'
            });
        }

        if (data.showTell) {
            const st = data.showTell;
            const section = this.createDetailSection(container, t('bookDetail.readability.showTell'));

            const hasDonutData = st.showPercentage !== undefined || st.tellPercentage !== undefined || (st.stats && st.stats.mixedCount !== undefined);
            if (hasDonutData) {
                const chartWrap = section.createDiv({
                    cls: 'nw-kb-detail-chart-row'
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
                    this.renderChart(donutDiv, donutChart(donutData, { size: 260, title: t('bookDetail.readability.showTellTitle') }));
                }

                if (st.stats) {
                    const statsDiv = chartWrap.createDiv({
                        cls: 'nw-kb-detail-stats-column'
                    });
                    statsDiv.createDiv({ text: t('bookDetail.readability.stats'), cls: 'nw-kb-detail-heading nw-kb-detail-mb-4' });
                    if (st.stats.totalSegments !== undefined) {
                        this.addInfoItem(statsDiv, t('bookDetail.readability.segments'), st.stats.totalSegments.toString());
                    }
                    if (st.stats.showCount !== undefined) {
                        this.addInfoItem(statsDiv, t('bookDetail.readability.showCount'), st.stats.showCount.toString());
                    }
                    if (st.stats.tellCount !== undefined) {
                        this.addInfoItem(statsDiv, t('bookDetail.readability.tellCount'), st.stats.tellCount.toString());
                    }
                    if (st.stats.mixedCount !== undefined) {
                        this.addInfoItem(statsDiv, t('bookDetail.readability.mixedCount'), st.stats.mixedCount.toString());
                    }
                }
            }

            if (st.highRiskTellSegments && st.highRiskTellSegments.length > 0) {
                const riskSection = this.createDetailSection(container, t('bookDetail.readability.highRiskTell', { count: st.highRiskTellSegments.length }));
                const list = riskSection.createDiv({ cls: 'nw-kb-detail-stack' });
                st.highRiskTellSegments.slice(0, 10).forEach((seg, i) => {
                    const item = list.createDiv({
                        cls: 'nw-kb-detail-item'
                    });
                    const header = item.createDiv({ cls: 'nw-kb-detail-item-head--split' });
                    header.createSpan({ text: `#${i + 1}`, cls: 'nw-kb-detail-excerpt-index' });
                    if (seg.confidence !== undefined) {
                        header.createSpan({ text: t('bookDetail.readability.confidence', { value: formatDetailPercent(seg.confidence) }), cls: 'nw-kb-detail-label-xs' });
                    }
                    item.createDiv({
                        text: seg.excerpt,
                        cls: 'nw-kb-detail-excerpt'
                    });
                });
            }

            if (st.suggestions && st.suggestions.length > 0) {
                const suggSection = this.createDetailSection(container, t('bookDetail.common.improve'));
                const sortedSuggestions = sortSuggestionsBySeverity(st.suggestions);
                const list = suggSection.createDiv({ cls: 'nw-kb-detail-stack' });

                sortedSuggestions.forEach(s => {
                    const item = list.createDiv({
                        cls: 'nw-kb-detail-item'
                    });
                    const header = item.createDiv({ cls: 'nw-kb-detail-item-head' });
                    const severityEl = header.createSpan({
                        text: resolveSeverityLabel(s.severity),
                        cls: 'nw-kb-detail-severity'
                    });
                    severityEl.style.setProperty('--nw-detail-tone', resolveSeverityColor(s.severity));
                    header.createSpan({ text: s.type, cls: 'nw-kb-detail-label-strong' });
                    item.createDiv({ text: s.message, cls: 'nw-kb-detail-text' });
                });
            }
        }

        if (data.aiTrace) {
            const ai = data.aiTrace;
            const section = this.createDetailSection(container, t('bookDetail.readability.aiTrace'));

            const overviewRow = section.createDiv({
                cls: 'nw-kb-detail-summary-row'
            });
            if (ai.overallScore !== undefined) {
                overviewRow.createDiv({
                    text: t('bookDetail.readability.aiRate', { value: formatDetailPercent(ai.overallScore, 1) }),
                    cls: 'nw-kb-detail-headline nw-kb-detail-headline--warning'
                });
            }
            if (ai.level) {
                const levelColors: Record<string, string> = {
                    low: 'var(--color-green)',
                    medium: 'var(--color-orange)',
                    high: 'var(--color-red)'
                };
                const levelLabels: Record<string, string> = {
                    low: t('bookDetail.readability.lowRisk'),
                    medium: t('bookDetail.readability.mediumRisk'),
                    high: t('bookDetail.readability.highRisk')
                };
                const levelEl = overviewRow.createSpan({
                    text: levelLabels[ai.level] || ai.level,
                    cls: 'nw-kb-detail-level-badge'
                });
                levelEl.style.setProperty('--nw-detail-tone', levelColors[ai.level] || 'var(--text-muted)');
            }

            if (ai.dimensions) {
                const dimLabels: Record<string, string> = {
                    sentenceSimilarity: t('bookDetail.readability.sentenceSimilarity'),
                    connectorDensity: t('bookDetail.readability.connectorDensity'),
                    explanatoryEnding: t('bookDetail.readability.explanatoryEnding'),
                    parallelismAbuse: t('bookDetail.readability.parallelismAbuse'),
                    wordRepetition: t('bookDetail.readability.wordRepetition'),
                    emotionUniformity: t('bookDetail.readability.emotionUniformity')
                };
                const barData = Object.entries(ai.dimensions)
                    .filter(([, v]) => v && v.score !== undefined)
                    .map(([k, v]) => ({
                        label: dimLabels[k] || k,
                        value: v.score * 100
                    }));
                if (barData.length > 0) {
                    const barDiv = section.createDiv({
                        cls: 'nw-kb-detail-chart'
                    });
                    this.renderChart(barDiv, barChart(barData, { width: 500, height: 200, title: t('bookDetail.readability.sixDim'), horizontal: true }));
                }
            }

            if (ai.highRiskParagraphs && ai.highRiskParagraphs.length > 0) {
                const riskSection = this.createDetailSection(container, t('bookDetail.readability.highRiskSection', { count: ai.highRiskParagraphs.length }));
                const list = riskSection.createDiv({ cls: 'nw-kb-detail-stack' });
                ai.highRiskParagraphs.slice(0, 10).forEach((p, i) => {
                    const item = list.createDiv({
                        cls: 'nw-kb-detail-item'
                    });
                    const header = item.createDiv({ cls: 'nw-kb-detail-item-head--split' });
                    header.createSpan({ text: `#${i + 1}`, cls: 'nw-kb-detail-excerpt-index' });
                    if (p.score !== undefined) {
                        header.createSpan({ text: t('bookDetail.readability.riskScore', { value: formatDetailPercent(p.score) }), cls: 'nw-kb-detail-label-xs' });
                    }
                    item.createDiv({
                        text: p.excerpt,
                        cls: 'nw-kb-detail-excerpt nw-kb-detail-mb-6'
                    });
                    if (p.reasons && p.reasons.length > 0) {
                        const reasonsDiv = item.createDiv({ cls: 'nw-kb-detail-tag-row' });
                        p.reasons.forEach(r => {
                            reasonsDiv.createSpan({
                                text: r,
                                cls: 'nw-kb-detail-chip--danger'
                            });
                        });
                    }
                });
            }
        }
    }

    // ---- 技巧 Tab ----
    /**
     * 渲染书籍技法页签。
     * @param container - 容器元素
     */
    public renderBookTechniqueTab(container: HTMLElement): void {
        const data = this.deps.getTechniqueData();

        if (!data || !data.techniques || data.techniques.length === 0) {
            this.renderDetailEmpty(container, t('bookDetail.technique.name'));
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
            'emotion': t('bookDetail.technique.catEmotion'),
            'structure': t('bookDetail.technique.catStructure'),
            'cool_point': t('bookDetail.technique.catCoolPoint'),
            'character': t('bookDetail.technique.catCharacter'),
            'setting': t('bookDetail.technique.catSetting'),
            'dialogue': t('bookDetail.technique.catDialogue'),
            'description': t('bookDetail.technique.catDescription'),
        };

        if (Object.keys(categoryCounts).length > 0) {
            const section = this.createDetailSection(container, t('bookDetail.technique.catDist'));
            const donutData = Object.entries(categoryCounts).map(([label, value]) => ({
                label: categoryLabels[label] || label,
                value
            }));
            const donutDiv = section.createDiv({
                cls: 'nw-kb-detail-chart'
            });
            this.renderChart(donutDiv, donutChart(donutData, { size: 300, title: t('bookDetail.technique.catDistTitle') }));
        }

        // Top 技巧排名（按 count 降序，纯函数在 book-detail-metrics 内并有单测）
        const top10 = rankTechniquesTop(techniques);

        const chartSection = this.createDetailSection(container, t('bookDetail.technique.top'));
        const barData = top10.map(t => ({ label: t.name, value: t.count }));
        const barDiv = chartSection.createDiv({
            cls: 'nw-kb-detail-chart'
        });
        this.renderChart(barDiv, barChart(barData, { width: 500, height: 250, title: t('bookDetail.technique.topTitle'), horizontal: true }));

        // 质量评分卡片
        if (qualityScore) {
            const section = this.createDetailSection(container, t('bookDetail.technique.quality'));
            const grid = section.createDiv({
                cls: 'nw-kb-detail-grid nw-kb-detail-grid--min-140'
            });
            this.addInfoItem(grid, t('bookDetail.common.overall'), `${qualityScore.totalScore} / 100`);
            this.addInfoItem(grid, t('bookDetail.technique.diversity'), `${qualityScore.diversityScore}%`);
            this.addInfoItem(grid, t('bookDetail.technique.coverage'), `${qualityScore.coverageScore}%`);
        }

            const section = this.createDetailSection(container, t('bookDetail.technique.detail'));
            top10.forEach((tech, i) => {
                const key = `tech_top_${i}`;
                const isExpanded = this.deps.getExpandedItems()[key] ?? false;

                const item = section.createDiv({
                    cls: 'nw-kb-detail-card--outlined-lg nw-kb-detail-mb-8'
                });

                const header = item.createDiv({
                    cls: 'nw-kb-detail-technique-head'
                });

                header.createSpan({
                    text: `${i + 1}`,
                    cls: i < 3 ? 'nw-kb-detail-rank nw-kb-detail-rank--top' : 'nw-kb-detail-rank'
                });

                const info = header.createDiv({ cls: 'nw-kb-detail-grow' });
                info.createDiv({ text: tech.name, cls: 'nw-kb-detail-text--strong' });
                const meta = info.createDiv({ cls: "nw-kb-detail-meta-row", attr: {} });
                meta.createSpan({ text: t('bookDetail.technique.count', { count: formatDetailCount(tech.count) }) });
                meta.createSpan({ text: t('bookDetail.technique.category', { value: categoryLabels[tech.category] || tech.category }) });
                meta.createSpan({ text: t('bookDetail.technique.confidence', { value: formatDetailPercent(tech.confidence) }) });
                meta.createSpan({ text: t('bookDetail.technique.qualityScore', { value: formatDetailPercent(tech.qualityScore) }) });

                const toggle = header.createSpan({
                    text: isExpanded ? '▼' : '▶',
                    cls: 'nw-kb-detail-meta'
                });
                void toggle;

                header.addEventListener('click', () => {
                    this.deps.getExpandedItems()[key] = !isExpanded;
                    this.deps.onRequestReRender();
                });

                if (isExpanded) {
                    const body = item.createDiv({
                        cls: 'nw-kb-detail-char-body'
                    });
                    body.createDiv({ text: t('bookDetail.technique.id', { value: tech.id }), cls: 'nw-kb-detail-note nw-kb-detail-mb-4' });
                    body.createDiv({ text: t('bookDetail.technique.genreWeight', { value: formatDetailNumber(tech.genreWeight, 1, 'x') }), cls: 'nw-kb-detail-note' });
                }
            });
    }

    // ---- 标签 Tab ----
    /**
     * 渲染书籍标签列表页签。
     * @param container - 容器元素
     * @param book - 书籍
     */
    public renderBookTagsTab(container: HTMLElement, book: BookBasicInfo): void {
        const themeSection = this.createDetailSection(container, t('bookDetail.tags.theme'));
        const themeWrap = themeSection.createDiv({ cls: 'nw-kb-detail-tag-group' });
        if (book.themeTags.length === 0) {
            themeWrap.createSpan({ text: t('bookDetail.tags.noTheme'), cls: 'nw-kb-detail-text' });
        } else {
            book.themeTags.forEach(tag => {
                themeWrap.createSpan({
                    text: tag,
                    cls: 'nw-kb-detail-tag'
                });
            });
        }

        const techniqueSection = this.createDetailSection(container, t('bookDetail.tags.technique'));
        const techWrap = techniqueSection.createDiv({ cls: 'nw-kb-detail-tag-group' });
        if (book.techniqueTags.length === 0) {
            techWrap.createSpan({ text: t('bookDetail.tags.noTechnique'), cls: 'nw-kb-detail-text' });
        } else {
            book.techniqueTags.forEach(tag => {
                techWrap.createSpan({
                    text: tag,
                    cls: 'nw-kb-detail-tag'
                });
            });
        }

        const customSection = this.createDetailSection(container, t('bookDetail.tags.custom'));
        const customTagsWrap = customSection.createDiv({ cls: 'nw-kb-detail-tag-group nw-kb-detail-tag-group--spaced' });

        if (book.customTags.length === 0) {
            customTagsWrap.createSpan({ text: t('bookDetail.tags.noCustom'), cls: 'nw-kb-detail-text' });
        } else {
            book.customTags.forEach((tag, idx) => {
                const tagEl = customTagsWrap.createSpan({
                    cls: "nw-kb-detail-tag nw-kb-detail-tag--custom"
                });
                tagEl.createSpan({ text: tag });
                const delBtn = tagEl.createSpan({
                    text: '×',
                    cls: 'nw-kb-detail-tag-del',
                    attr: { 'aria-label': t('bookDetail.tags.delete', { tag }), role: 'button', tabindex: '0' }
                });
                delBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.deps.onDeleteCustomTag(book, idx).catch(err => { // silent-ok: 失败提示在 onDeleteCustomTag 内部
                        log.error('删除标签失败:', err);
                    });
                });
            });
        }

        const addWrap = customSection.createDiv({ cls: 'nw-kb-detail-tag-add' });
        const addInput = addWrap.createEl('input', {
            type: 'text',
            cls: 'nw-kb-detail-tag-input',
            attr: { placeholder: t('bookDetail.tags.placeholder') }
        });
        const addBtn = addWrap.createEl('button', {
            text: t('bookDetail.tags.add'),
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
            title: t('bookDetail.common.emptyTitle', { label }),
            description: t('bookDetail.common.emptyDesc')
        });
        container.appendChild(emptyState);
    }

    private renderQualityScoreCard(container: HTMLElement, data: Record<string, unknown> | null): void {
        if (!data) return;
        const qs = data._qualityScore as DimensionQualityScore | undefined;
        if (!qs || typeof qs.overall !== 'number') return;

        const levelMeta = resolveQualityLevelMeta(qs.level);
        const TONE_COLOR: Record<string, string> = {
            green: 'var(--color-green)',
            orange: 'var(--color-orange)',
            red: 'var(--color-red)',
        };
        const levelColor = TONE_COLOR[levelMeta.tone];
        const levelLabel = levelMeta.label;
        const usedLevelLabel = resolveUsedLevelLabel(qs.usedLevel);

        const card = container.createDiv({ cls: 'nw-kb-detail-quality-card' });

        const header = card.createDiv({ cls: 'nw-kb-detail-quality-head' });
        header.createSpan({ text: t('bookDetail.quality.title'), cls: 'nw-kb-detail-quality-title' });
        const scoreEl = header.createSpan({ text: `${qs.overall}/100`, cls: 'nw-kb-detail-quality-score' });
        scoreEl.style.setProperty('--nw-detail-tone', levelColor);
        const levelEl = header.createSpan({ text: levelLabel, cls: 'nw-kb-detail-quality-level' });
        levelEl.style.setProperty('--nw-detail-tone', levelColor);
        header.createSpan({
            text: t('bookDetail.detail.tier', { value: usedLevelLabel }),
            cls: 'nw-kb-detail-toggle nw-kb-detail-ml-auto'
        });

        const metrics = card.createDiv({ cls: 'nw-kb-detail-quality-metrics' });

        const scoreItems = buildQualityScoreItems(qs);
        for (const item of scoreItems) {
            const metric = metrics.createDiv({ cls: 'nw-kb-detail-metric' });
            const valueEl = metric.createSpan({ text: `${item.value}`, cls: 'nw-kb-detail-metric-value' });
            valueEl.style.setProperty('--nw-detail-tone', TONE_COLOR[item.tone]);
            metric.createSpan({ text: item.label, cls: 'nw-kb-detail-metric-label' });
        }
    }
}
