import type { App } from 'obsidian';
import type { KnowledgeBaseManager, BookBasicInfo, BreakdownStatus } from '../../services/knowledge-base-manager';
import type { WebnovelKnowledgeBase } from '../../engine/webnovel-knowledge-base';
import { radarChart, barChart, donutChart, wordCloud, lineChart, timelineChart, attachChartInteractions } from '../svg-charts';
import { SmartChart } from '../components/smart-chart';
import { createEmptyState } from '../components/empty-state';
import { createLogger } from '../../shared/logger';
import { formatDetailNumber } from '../knowledge-detail-format';
import type { DeconstructionScheduler, BreakdownDimension, DimensionQualityScore } from '../../services/deconstruction-scheduler';
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

const log = createLogger('BookDetailRenderer');

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
                attr: { style: 'font-size:12px;color:var(--text-muted);margin-bottom:16px;' }
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
                attr: { style: 'display:flex;justify-content:center;' }
            });
            this.renderChart(radarDiv, radarChart(radarItems, { size: 320, title: '写作风格特征' }));
        }

        // 基础统计卡片
        if (sentenceRhythm || paragraphStructure || narrativeStyle) {
            const section = this.createDetailSection(container, '基础统计');
            const grid = section.createDiv({
                attr: { style: 'display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;' }
            });
            if (sentenceRhythm?.avgSentenceLength !== undefined) {
                this.addInfoItem(grid, '平均句长', `${sentenceRhythm.avgSentenceLength.toFixed(1)} 字`);
            }
            if (paragraphStructure?.avgParagraphLength !== undefined) {
                this.addInfoItem(grid, '平均段长', `${paragraphStructure.avgParagraphLength.toFixed(1)} 字`);
            }
            if (narrativeStyle?.dialogueRatio !== undefined) {
                this.addInfoItem(grid, '对白占比', `${(narrativeStyle.dialogueRatio * 100).toFixed(1)}%`);
            }
            if (narrativeStyle?.descriptionRatio?.total !== undefined) {
                this.addInfoItem(grid, '描写占比', `${(narrativeStyle.descriptionRatio.total * 100).toFixed(1)}%`);
            }
            if (wordPreference?.idiomDensity !== undefined) {
                this.addInfoItem(grid, '成语密度', `${wordPreference.idiomDensity.toFixed(1)} /千字`);
            }
            if (wordPreference?.colloquialismLevel !== undefined) {
                this.addInfoItem(grid, '口语化程度', `${(wordPreference.colloquialismLevel * 100).toFixed(1)}%`);
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
                attr: { style: 'display:flex;justify-content:center;' }
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
                attr: { style: 'display:flex;justify-content:center;' }
            });
            this.renderChart(barDiv, barChart(barData, { width: 500, height: 180, title: '修辞手法统计' }));
        }

        // 整体风格
        if (overallStyle) {
            const section = this.createDetailSection(container, '整体风格');
            const grid = section.createDiv({
                attr: { style: 'display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;' }
            });
            const styleCard = grid.createDiv({
                attr: { style: 'padding:14px;background:var(--background-secondary);border-radius:8px;' }
            });
            styleCard.createEl('div', { text: '主要文风', attr: { style: 'font-size:12px;color:var(--text-muted);margin-bottom:4px;' } });
            styleCard.createEl('div', { text: overallStyle.primaryStyle, attr: { style: 'font-size:18px;font-weight:700;color:var(--interactive-accent);' } });
            if (overallStyle.secondaryStyle) {
                styleCard.createEl('div', { text: `次要文风: ${overallStyle.secondaryStyle}`, attr: { style: 'font-size:12px;color:var(--text-muted);margin-top:4px;' } });
            }
            styleCard.createEl('div', { text: `置信度: ${(overallStyle.confidence * 100).toFixed(0)}%`, attr: { style: 'font-size:12px;color:var(--text-muted);margin-top:4px;' } });

            if (overallStyle.styleScores) {
                const scoresCard = grid.createDiv({
                    attr: { style: 'padding:14px;background:var(--background-secondary);border-radius:8px;' }
                });
                scoresCard.createEl('div', { text: '文风评分', attr: { style: 'font-size:12px;color:var(--text-muted);margin-bottom:8px;' } });
                const scoreList = scoresCard.createDiv({ attr: { style: 'display:flex;flex-direction:column;gap:4px;' } });
                Object.entries(overallStyle.styleScores).slice(0, 5).forEach(([style, score]) => {
                    scoreList.createEl('div', {
                        text: `${style}: ${(score * 100).toFixed(0)}%`,
                        attr: { style: 'font-size:12px;' }
                    });
                });
            }
        }

        if (data.vocabularyRichness) {
            const vr = data.vocabularyRichness;
            const section = this.createDetailSection(container, '词汇丰富度');
            const grid = section.createDiv({
                attr: { style: 'display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;' }
            });
            this.addInfoItem(grid, 'TTR', vr.ttr.toFixed(3));
            this.addInfoItem(grid, 'MTLD', vr.mtld.toFixed(1));
            this.addInfoItem(grid, "Yule's K", vr.yulesK.toFixed(3));
            this.addInfoItem(grid, '词汇量', vr.vocabularySize.toLocaleString());
            const levelItem = grid.createDiv({
                attr: { style: 'padding:10px 12px;background:var(--background-secondary);border-radius:6px;' }
            });
            levelItem.createDiv({ text: '级别', cls: 'nw-text-muted-11', attr: { style: 'margin-bottom:4px;' } });
            levelItem.createDiv({
                text: `${vr.level} (${vr.score.toFixed(1)}分)`,
                attr: { style: 'font-size:13px;color:var(--interactive-accent);font-weight:500;' }
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
                const radarDiv = section.createDiv({ attr: { style: 'display:flex;justify-content:center;' } });
                this.renderChart(radarDiv, radarChart(radarData, { size: 300, title: '五感雷达图' }));

                const statsRow = section.createDiv({
                    attr: { style: 'display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:12px;margin-top:16px;' }
                });
                this.addInfoItem(statsRow, '平衡度', `${fs.balanceScore.toFixed(1)}分`);
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
            const chartDiv = section.createDiv({ attr: { style: 'display:flex;justify-content:center;' } });
            this.renderChart(chartDiv, donutChart(donutData, { size: 260, title: '句式类型' }));
        }

        if (data.sentenceRhythm?.lengthDistribution) {
            const sld = data.sentenceRhythm.lengthDistribution;
            const sdNameMap: Record<string, string> = { short: '短句', medium: '中句', long: '长句' };
            const barData = Object.entries(sld).map(([k, v]) => ({ label: sdNameMap[k] || k, value: v }));
            const section = this.createDetailSection(container, '句长分布');
            const chartDiv = section.createDiv({ attr: { style: 'display:flex;justify-content:center;' } });
            this.renderChart(chartDiv, barChart(barData, { width: 400, height: 180, title: '句长分布' }));
        }

        if (data.paragraphStructure?.lengthDistribution) {
            const pld = data.paragraphStructure.lengthDistribution;
            const pdNameMap: Record<string, string> = { short: '短段', medium: '中段', long: '长段', veryLong: '超长段' };
            const barData = Object.entries(pld).map(([k, v]) => ({ label: pdNameMap[k] || k, value: v }));
            const section = this.createDetailSection(container, '段落长度分布');
            const chartDiv = section.createDiv({ attr: { style: 'display:flex;justify-content:center;' } });
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
                attr: { style: 'font-size:12px;color:var(--text-muted);margin-bottom:16px;' }
            });
        }

        this.renderQualityScoreCard(container, data as unknown as Record<string, unknown>);

        if (data.stats) {
            const statsSection = this.createDetailSection(container, '节奏统计摘要');
            const statsGrid = statsSection.createDiv({
                attr: { style: 'display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:12px;' }
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
                attr: { style: 'display:flex;justify-content:center;' }
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
                attr: { style: 'display:flex;justify-content:center;' }
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
                attr: { style: 'display:flex;justify-content:center;' }
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
                attr: { style: 'display:flex;justify-content:center;' }
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
                attr: { style: 'display:flex;justify-content:center;' }
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
                attr: { style: 'margin-top:12px;display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:8px;' }
            });
            data.coolPoints.forEach(p => {
                const card = grid.createDiv({
                    attr: { style: 'padding:10px;background:var(--background-secondary);border-radius:6px;font-size:12px;' }
                });
                card.createEl('div', {
                    text: `${p.category || '未分类'} · 位置 ${formatDetailNumber(p.x, 1, '%')}`,
                    attr: { style: 'font-weight:500;color:var(--interactive-accent);margin-bottom:4px;' }
                });
                card.createEl('div', { text: p.label, attr: { style: 'color:var(--text-muted);' } });
            });
        }

        // 剧情阶段
        if (data.plotStages && data.plotStages.length > 0) {
            const section = this.createDetailSection(container, '剧情阶段');
            const wrap = section.createDiv({ attr: { style: 'display:flex;flex-direction:column;gap:6px;' } });
            data.plotStages.forEach(p => {
                wrap.createDiv({
                    attr: { style: 'display:flex;gap:12px;align-items:center;padding:8px 12px;background:var(--background-secondary);border-radius:6px;' }
                }).createEl('div', {
                    text: `${p.name} (${p.start}% - ${p.end}%)`,
                    attr: { style: 'font-size:13px;font-weight:500;' }
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
            const wrap = section.createDiv({ attr: { style: 'display:flex;gap:24px;flex-wrap:wrap;align-items:flex-start;' } });
            const chartWrap = wrap.createDiv({ attr: { style: 'flex:1;min-width:200px;' } });
            const typeDistArr = Object.entries(ha.typeDistribution || {}).map(([k, v]) => ({ label: k, value: v }));
            this.renderChart(chartWrap, donutChart(typeDistArr, { size: 240, title: '钩子类型分布' }));

            const infoWrap = wrap.createDiv({ attr: { style: 'flex:1;min-width:180px;display:flex;flex-direction:column;gap:10px;' } });
            infoWrap.createDiv({
                text: `钩子率: ${formatDetailNumber(typeof ha.hookRate === 'number' ? ha.hookRate * 100 : undefined, 1, '%')}`,
                attr: { style: 'font-size:20px;font-weight:700;color:var(--interactive-accent);' }
            });
            infoWrap.createDiv({
                text: `无钩子章节: ${ha.noHookChapters?.length ?? 0} 章`,
                attr: { style: 'font-size:13px;color:var(--text-muted);' }
            });
            infoWrap.createDiv({
                text: `平均强度: ${formatDetailNumber(ha.avgIntensity, 2)}`,
                attr: { style: 'font-size:13px;color:var(--text-muted);' }
            });
            const distWrap = infoWrap.createDiv({ attr: { style: 'display:flex;flex-direction:column;gap:4px;' } });
            if (ha.typeDistribution) {
                Object.entries(ha.typeDistribution).forEach(([type, count]) => {
                    distWrap.createDiv({
                        text: `${type}: ${count}`,
                        attr: { style: 'font-size:12px;color:var(--text-normal);padding:2px 8px;background:var(--background-secondary);border-radius:4px;' }
                    });
                });
            }
        }

        if (data.tensionCurve) {
            const tc = data.tensionCurve;
            const section = this.createDetailSection(container, '张力曲线分析');
            const statsRow = section.createDiv({
                attr: { style: 'display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:12px;margin-bottom:16px;' }
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
                const lineDiv = section.createDiv({ attr: { style: 'display:flex;justify-content:center;' } });
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
                    const radarDiv = section.createDiv({ attr: { style: 'display:flex;justify-content:center;' } });
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
                attr: { style: 'padding:16px;background:var(--background-secondary);border-radius:8px;' }
            });
            card.createDiv({
                text: `弧线类型: ${arcTypeMap[ea.arcType] || ea.arcType}`,
                attr: { style: 'font-size:16px;font-weight:600;color:var(--interactive-accent);margin-bottom:8px;' }
            });
            card.createDiv({
                text: `置信度: ${(ea.confidence * 100).toFixed(0)}%`,
                attr: { style: 'font-size:13px;color:var(--text-muted);' }
            });
            if (ea.description) {
                card.createDiv({
                    text: ea.description,
                    attr: { style: 'font-size:12px;color:var(--text-muted);margin-top:8px;' }
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
                attr: { style: 'font-size:12px;color:var(--text-muted);margin-bottom:16px;' }
            });
        }

        const { qcchSegments, rhythmUnits, threeLineStructure, structureType, stats } = data;

        // 结构类型
        if (structureType) {
            const section = this.createDetailSection(container, '结构类型');
            section.createDiv({
                text: structureType,
                attr: { style: 'padding:14px;background:var(--background-secondary);border-radius:8px;font-size:14px;font-weight:500;' }
            });
        }

        // 统计信息
        if (stats) {
            const section = this.createDetailSection(container, '结构统计');
            const grid = section.createDiv({
                attr: { style: 'display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:12px;' }
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
                attr: { style: 'display:flex;justify-content:center;' }
            });
            this.renderChart(timelineDiv, timelineChart(timelineEvents, { width: 500, height: 100, title: '起承转合时间轴' }));

            const list = section.createDiv({ attr: { style: 'margin-top:12px;display:flex;flex-direction:column;gap:8px;' } });
            qcchSegments.forEach(seg => {
                const row = list.createDiv({
                    attr: { style: 'display:flex;gap:12px;align-items:center;padding:10px;background:var(--background-secondary);border-radius:6px;' }
                });
                const typeEl = row.createEl('div', {
                    text: seg.type,
                    attr: { style: `min-width:40px;padding:4px 12px;background:${qcchColors[seg.type] || '#6b7280'};color:#fff;border-radius:4px;font-size:13px;font-weight:500;text-align:center;` }
                });
                const content = row.createDiv({ attr: { style: 'flex:1;' } });
                content.createEl('div', {
                    text: `位置: ${(seg.startPosition * 100).toFixed(0)}% - ${(seg.endPosition * 100).toFixed(0)}%`,
                    attr: { style: 'font-size:13px;font-weight:500;margin-bottom:2px;' }
                });
                if (seg.chapterRange && seg.chapterRange.length === 2) {
                    content.createEl('div', {
                        text: `章节范围: 第${seg.chapterRange[0]+1}-${seg.chapterRange[1]+1}章`,
                        attr: { style: 'font-size:12px;color:var(--text-muted);' }
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
                card.createDiv({ text: lineData.description, attr: { style: 'font-size:12px;color:var(--text-normal);line-height:1.5;' } });
                
                if (lineData.keyNodes && lineData.keyNodes.length > 0) {
                    const nodes = card.createDiv({ attr: { style: 'margin-top:8px;display:flex;flex-wrap:gap:4px;' } });
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
                const list = section.createDiv({ attr: { style: 'display:flex;flex-direction:column;gap:6px;' } });
                chapters.forEach(ch => {
                    const row = list.createDiv({
                        attr: { style: 'display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:var(--background-secondary);border-radius:6px;' }
                    });
                    row.createSpan({ text: ch.title, attr: { style: 'font-size:13px;font-weight:500;' } });
                    row.createSpan({ text: `${ch.wordCount.toLocaleString()}字`, attr: { style: 'font-size:12px;color:var(--text-muted);' } });
                });
            }
        }
    }

    // ---- 概览 Tab ----
    public renderBookOverviewTab(container: HTMLElement, book: BookBasicInfo): void {
        const infoSection = this.createDetailSection(container, '基本信息');
        const infoGrid = infoSection.createDiv({
            attr: { style: 'display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;' }
        });
        this.addInfoItem(infoGrid, '书名', book.name);
        this.addInfoItem(infoGrid, '作者', book.author || '未知');
        this.addInfoItem(infoGrid, '字数', this.deps.formatWordCount(book.wordCount));
        this.addInfoItem(infoGrid, '添加时间', this.deps.formatDateTime(book.createdAt));
        this.addInfoItem(infoGrid, '更新时间', this.deps.formatDateTime(book.updatedAt));
        this.addInfoItem(infoGrid, '拆解状态', this.deps.getStatusLabel(book.breakdownStatus));

        if (book.synopsis) {
            const synopsisSection = this.createDetailSection(container, '简介');
            synopsisSection.createDiv({
                text: book.synopsis,
                attr: { style: 'font-size:13px;line-height:1.6;color:var(--text-normal);padding:12px;background:var(--background-secondary);border-radius:6px;' }
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
                    attr: { style: 'margin-bottom:12px;' }
                });

                const progressInfo = progressHeader.createDiv({
                    attr: { style: 'display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;' }
                });
                progressInfo.createSpan({
                    text: `拆解进度：${Math.round(emitterState.progress)}%`,
                    attr: { style: 'font-size:13px;font-weight:500;color:var(--text-normal);' }
                });
                if (emitterState.currentStep) {
                    progressInfo.createSpan({
                        text: `📍 ${emitterState.currentStep}`,
                        attr: { style: 'font-size:12px;color:#3b82f6;font-weight:500;' }
                    });
                }

                const progressBarWrap = progressHeader.createDiv({
                    attr: { style: 'height:8px;background:var(--background-secondary);border-radius:4px;overflow:hidden;margin-bottom:8px;' }
                });
                progressBarWrap.createDiv({
                    attr: { style: `height:100%;width:${emitterState.progress}%;background:var(--interactive-accent);transition:width 0.3s;` }
                });

                if (emitterState.message) {
                    progressHeader.createDiv({
                        text: emitterState.message,
                        attr: { style: 'font-size:12px;color:var(--text-muted);margin-bottom:8px;' }
                    });
                }

                const timeInfo = progressHeader.createDiv({
                    attr: { style: 'display:flex;gap:20px;font-size:12px;color:var(--text-muted);' }
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
            attr: { style: 'display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;' }
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
        const section = container.createDiv({ attr: { style: 'margin-bottom:24px;' } });
        section.createEl('h3', {
            text: title,
            attr: { style: 'margin:0 0 12px 0;font-size:15px;font-weight:600;' }
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
            attr: { style: 'padding:10px 12px;background:var(--background-secondary);border-radius:6px;' }
        });
        item.createDiv({ text: label, cls: 'nw-text-muted-11', attr: { style: 'margin-bottom:4px;' } });
        item.createDiv({ text: value, attr: { style: 'font-size:13px;color:var(--text-normal);font-weight:500;' } });
    }

    private renderGenreInfo(container: HTMLElement, book: BookBasicInfo): void {
        const card = container.createDiv({
            attr: { style: 'padding:16px;background:var(--background-secondary);border-radius:8px;' }
        });

        const headerRow = card.createDiv({
            cls: 'nw-flex-between', attr: { style: 'margin-bottom:12px;' }
        });
        headerRow.createSpan({
            text: '分类信息',
            attr: { style: 'font-size:13px;font-weight:600;color:var(--text-normal);' }
        });

        const actionBtns = headerRow.createDiv({ attr: { style: 'display:flex;gap:6px;' } });

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
                attr: { style: 'display:flex;align-items:center;margin-bottom:8px;last-child{margin-bottom:0;}' }
            });
            rowEl.createSpan({
                text: row.label + '：',
                cls: 'nw-flex-shrink-0', attr: { style: 'font-size:13px;color:var(--text-muted);width:60px;' }
            });
            const valueEl = rowEl.createSpan({
                text: row.value,
                attr: { style: 'font-size:13px;color:var(--text-normal);font-weight:500;flex:1;' }
            });
            if (row.confidence !== undefined) {
                valueEl.createSpan({
                    text: ` ${(row.confidence * 100).toFixed(0)}%`,
                    cls: 'nw-text-muted-11', attr: { style: 'font-weight:400;margin-left:4px;' }
                });
            }
        });

        if (book.genreRecommendations && book.genreRecommendations.length > 0) {
            const recSection = card.createDiv({ attr: { style: 'margin-top:12px;padding-top:12px;border-top:1px solid var(--background-modifier-border);' } });
            recSection.createDiv({
                text: '分类建议 (Top 3)',
                cls: 'nw-text-sm-muted', attr: { style: 'margin-bottom:8px;' }
            });

            book.genreRecommendations.forEach((rec, idx) => {
                const recRow = recSection.createDiv({
                    attr: { style: 'display:flex;align-items:center;justify-content:space-between;padding:6px 8px;border-radius:4px;cursor:pointer;transition:background 0.15s;margin-bottom:4px;' }
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

                const left = recRow.createDiv({ attr: { style: 'display:flex;align-items:center;gap:8px;' } });
                left.createSpan({
                    text: `${idx + 1}.`,
                    cls: 'nw-text-sm-muted', attr: { style: 'width:16px;' }
                });
                left.createSpan({
                    text: `${this.getGenreName(rec.genreId)}${rec.subGenreId ? ' · ' + this.getSubGenreName(rec.genreId, rec.subGenreId) : ''}`,
                    attr: { style: 'font-size:12px;color:var(--text-normal);' }
                });

                const confBar = recRow.createDiv({
                    attr: { style: 'width:80px;height:6px;background:var(--background-primary);border-radius:3px;overflow:hidden;' }
                });
                confBar.createDiv({
                    attr: { style: `height:100%;width:${(rec.confidence * 100).toFixed(0)}%;background:var(--interactive-accent);border-radius:3px;` }
                });
            });
        }

        if (book.secondaryGenres && book.secondaryGenres.length > 0) {
            const row = card.createDiv({ attr: { style: 'display:flex;align-items:flex-start;margin-top:8px;' } });
            row.createSpan({
                text: '次要：',
                cls: 'nw-flex-shrink-0', attr: { style: 'font-size:13px;color:var(--text-muted);width:60px;' }
            });
            const tagsEl = row.createDiv({ cls: 'nw-flex-wrap-sm', attr: { style: 'flex:1;' } });
            book.secondaryGenres.forEach(gid => {
                const g = this.deps.getKb()?.getGenre(gid);
                if (g) {
                    tagsEl.createSpan({
                        text: g.name,
                        attr: { style: 'padding:2px 8px;font-size:11px;background:var(--background-primary);border-radius:10px;color:var(--text-muted);' }
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
            attr: { style: 'display:flex;gap:24px;flex-wrap:wrap;align-items:flex-start;' }
        });

        const radarCard = wrap.createDiv({
            attr: { style: 'flex:1;min-width:320px;display:flex;justify-content:center;' }
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
            attr: { style: 'flex:1;min-width:200px;' }
        });

        const overall = scoresCard.createDiv({
            attr: { style: 'text-align:center;margin-bottom:20px;padding:16px;background:var(--background-secondary);border-radius:8px;' }
        });
        overall.createDiv({
            text: qs.overall.toFixed(0),
            attr: { style: 'font-size:36px;font-weight:700;color:var(--interactive-accent);' }
        });
        overall.createDiv({ text: '综合评分', attr: { style: 'font-size:13px;color:var(--text-muted);margin-top:4px;' } });

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
            const item = scoresCard.createDiv({ attr: { style: 'margin-bottom:10px;' } });
            const top = item.createDiv({ attr: { style: 'display:flex;justify-content:space-between;margin-bottom:4px;' } });
            top.createSpan({ text: s.name, attr: { style: 'font-size:12px;color:var(--text-normal);' } });
            if (s.optional && s.value == null) {
                top.createSpan({ text: 'N/A', attr: { style: 'font-size:12px;color:var(--text-faint);' } });
            } else {
                top.createSpan({ text: `${(s.value ?? 0).toFixed(0)}分`, cls: 'nw-text-sm-muted' });
            }
            const bar = item.createDiv({
                attr: { style: 'height:6px;background:var(--background-secondary);border-radius:3px;overflow:hidden;' }
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
                attr: { style: 'font-size:12px;color:var(--text-muted);margin-bottom:16px;' }
            });
        }

        if (data.stats) {
            const section = this.createDetailSection(container, '角色统计');
            const statsGrid = section.createDiv({
                attr: { style: 'display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;' }
            });
            this.addInfoItem(statsGrid, '总角色数', String(data.stats.totalCharacters));
            this.addInfoItem(statsGrid, '主角数', String(data.stats.mainCharacterCount));
            this.addInfoItem(statsGrid, '人均出场', data.stats.avgAppearancePerCharacter.toFixed(1));
        }

        // 角色重要性排行
        if (sortedChars.length > 0) {
            const rankSection = this.createDetailSection(container, '角色重要度排行');
            const rankTable = rankSection.createDiv({
                attr: { style: 'overflow-x:auto;border:1px solid var(--background-modifier-border);border-radius:6px;' }
            });
            const table = rankTable.createEl('table', {
                attr: { style: 'width:100%;border-collapse:collapse;font-size:12px;' }
            });
            const thead = table.createEl('thead');
            const headRow = thead.createEl('tr', { attr: { style: 'background:var(--background-secondary);' } });
            ['排名', '姓名', '分级', '综合', '出场', '对话', '剧情', '关系', '视角'].forEach(h => {
                headRow.createEl('th', {
                    text: h,
                    attr: { style: 'padding:8px 10px;text-align:left;font-weight:600;border-bottom:1px solid var(--background-modifier-border);' }
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
                    attr: { style: 'display:flex;justify-content:center;' }
                });
                this.renderChart(radarDiv, radarChart(radarData, { size: 320, title: '角色重要性维度' }));
            }
        }

        // 角色卡片列表
        const mainSection = this.createDetailSection(container, '角色列表');
        const grid = mainSection.createDiv({
            attr: { style: 'display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px;' }
        });

        sortedChars.forEach((char, idx) => {
            const key = `char_main_${idx}`;
            const isExpanded = this.deps.getExpandedItems()[key] ?? false;

            const card = grid.createDiv({
                attr: {
                    style: `border:1px solid var(--background-modifier-border);border-radius:8px;overflow:hidden;background:var(--background-primary);`
                }
            });

            const header = card.createDiv({
                attr: { style: 'padding:12px;cursor:pointer;display:flex;align-items:center;gap:10px;' }
            });

            const avatar = header.createDiv({
                text: char.name.charAt(0),
                cls: 'nw-flex-center nw-flex-shrink-0', attr: { style: 'width:40px;height:40px;border-radius:50%;background:var(--interactive-accent);color:var(--text-on-accent);font-size:16px;font-weight:600;' }
            });
            void avatar;

            const info = header.createDiv({ attr: { style: 'flex:1;min-width:0;' } });
            info.createDiv({ text: char.name, attr: { style: 'font-size:14px;font-weight:500;margin-bottom:2px;' } });
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
                cls: 'nw-flex-wrap-sm', attr: { style: 'padding:0 12px 12px;' }
            });
            const allTags = [...(char.personality || []), ...(char.abilities || [])];
            allTags.slice(0, 4).forEach(tag => {
                tagsEl.createSpan({
                    text: tag,
                    attr: { style: 'padding:2px 8px;font-size:11px;background:var(--background-secondary);color:var(--text-muted);border-radius:10px;' }
                });
            });

            // 角色弧光进度条
            if (char.characterArc) {
                const arcBar = card.createDiv({
                    attr: { style: 'padding:0 12px 10px;display:flex;align-items:center;gap:8px;' }
                });
                arcBar.createSpan({
                    text: this.getArcTypeLabel(char.characterArc.transformationType),
                    cls: 'nw-flex-shrink-0', attr: { style: 'font-size:11px;padding:2px 6px;background:rgba(var(--interactive-accent-rgb),0.1);color:var(--interactive-accent);border-radius:4px;' }
                });
                const barBg = arcBar.createDiv({
                    attr: { style: 'flex:1;height:6px;background:var(--background-secondary);border-radius:3px;overflow:hidden;' }
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
                    attr: { style: 'padding:12px;border-top:1px solid var(--background-modifier-border);background:var(--background-secondary);' }
                });

                // 基础统计
                const statsRow = body.createDiv({
                    attr: { style: 'display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:12px;' }
                });
                const quickStats = [
                    { label: '出场', value: char.appearanceCount ?? '-' },
                    { label: '提及', value: char.mentionCount ?? '-' },
                    { label: '首次', value: char.firstAppearance ? `${(char.firstAppearance * 100).toFixed(0)}%` : '-' },
                    { label: '末次', value: char.lastAppearance ? `${(char.lastAppearance * 100).toFixed(0)}%` : '-' },
                ];
                quickStats.forEach(s => {
                    const item = statsRow.createDiv({
                        attr: { style: 'text-align:center;padding:6px;background:var(--background-primary);border-radius:4px;' }
                    });
                    item.createDiv({ text: String(s.value), attr: { style: 'font-size:14px;font-weight:600;' } });
                    item.createDiv({ text: s.label, attr: { style: 'font-size:10px;color:var(--text-muted);' } });
                });

                // 性格特点
                if (char.personality && char.personality.length > 0) {
                    body.createDiv({ text: '🏷️ 性格特点', cls: 'nw-text-sm-muted', attr: { style: 'margin-bottom:6px;font-weight:500;' } });
                    const tagsWrap = body.createDiv({ cls: 'nw-flex-wrap-sm', attr: { style: 'margin-bottom:12px;' } });
                    char.personality.forEach(tag => {
                        tagsWrap.createSpan({
                            text: tag,
                            attr: { style: 'padding:2px 8px;font-size:11px;background:var(--background-primary);color:var(--text-normal);border-radius:10px;' }
                        });
                    });
                }

                // 能力特点
                if (char.abilities && char.abilities.length > 0) {
                    body.createDiv({ text: '🛡️ 能力特点', cls: 'nw-text-sm-muted', attr: { style: 'margin-bottom:6px;font-weight:500;' } });
                    const tagsWrap = body.createDiv({ cls: 'nw-flex-wrap-sm', attr: { style: 'margin-bottom:12px;' } });
                    char.abilities.forEach(tag => {
                        tagsWrap.createSpan({
                            text: tag,
                            attr: { style: 'padding:2px 8px;font-size:11px;background:var(--background-primary);color:var(--text-normal);border-radius:10px;' }
                        });
                    });
                }

                // 角色弧光详情
                if (char.characterArc) {
                    body.createDiv({ text: '⚡ 角色弧光', cls: 'nw-text-sm-muted', attr: { style: 'margin-bottom:6px;font-weight:500;' } });
                    const arcInfo = body.createDiv({
                        attr: { style: 'padding:8px;background:var(--background-primary);border-radius:4px;margin-bottom:12px;' }
                    });
                    arcInfo.createDiv({
                        text: `转变类型：${this.getArcTypeLabel(char.characterArc.transformationType)}`,
                        attr: { style: 'font-size:12px;margin-bottom:4px;' }
                    });
                    arcInfo.createDiv({
                        text: `弧光完整度：${char.characterArc.completeness}%`,
                        attr: { style: 'font-size:12px;margin-bottom:4px;' }
                    });
                    if (char.characterArc.initialState?.goals && char.characterArc.initialState.goals.length > 0) {
                        const goalText = char.characterArc.initialState.goals[0];
                        arcInfo.createDiv({
                            text: `初始目标：${goalText.length > 40 ? goalText.substring(0, 40) + '...' : goalText}`,
                            attr: { style: 'font-size:12px;' }
                        });
                    }

                    // 成长节点
                    if (char.characterArc.growthNodes && char.characterArc.growthNodes.length > 0) {
                        body.createDiv({ text: '📈 成长节点', cls: 'nw-text-sm-muted', attr: { style: 'margin-bottom:6px;font-weight:500;' } });
                        const nodesList = body.createDiv({
                            attr: { style: 'margin-bottom:12px;max-height:150px;overflow-y:auto;' }
                        });
                        char.characterArc.growthNodes.slice(0, 5).forEach(node => {
                            const nodeItem = nodesList.createDiv({
                                attr: { style: 'padding:6px 8px;background:var(--background-primary);border-radius:4px;margin-bottom:4px;font-size:11px;' }
                            });
                            const topRow = nodeItem.createDiv({ attr: { style: 'display:flex;justify-content:space-between;margin-bottom:2px;' } });
                            topRow.createSpan({
                                text: `[${node.changeType}]`,
                                attr: { style: 'color:var(--interactive-accent);font-weight:500;' }
                            });
                            topRow.createSpan({
                                text: `${(node.position * 100).toFixed(0)}%`,
                                attr: { style: 'color:var(--text-muted);' }
                            });
                            nodeItem.createDiv({
                                text: node.event.length > 50 ? node.event.substring(0, 50) + '...' : node.event,
                                attr: { style: 'color:var(--text-normal);line-height:1.4;' }
                            });
                        });
                    }
                }
            }
        });

        if (data.relationDetails && data.relationDetails.length > 0) {
            const relSection = this.createDetailSection(container, '关系深度分析');
            const relGrid = relSection.createDiv({
                attr: { style: 'display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:10px;' }
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
                    attr: { style: 'border:1px solid var(--background-modifier-border);border-radius:6px;overflow:hidden;' }
                });
                const header = card.createDiv({
                    attr: { style: 'padding:10px;cursor:pointer;display:flex;align-items:center;gap:8px;background:var(--background-secondary);' }
                });
                header.createDiv({
                    text: `${fromName} ↔ ${toName}`,
                    cls: 'nw-ellipsis', attr: { style: 'flex:1;font-size:13px;font-weight:500;min-width:0;' }
                });
                const strengthBadge = header.createSpan({
                    text: `${rd.strength}%`,
                    cls: 'nw-flex-shrink-0', attr: { style: 'padding:2px 6px;font-size:10px;background:var(--interactive-accent);color:var(--text-on-accent);border-radius:4px;' }
                });
                void strengthBadge;
                header.createSpan({
                    text: isExpanded ? '▼' : '▶',
                    cls: 'nw-flex-shrink-0', attr: { style: 'font-size:10px;color:var(--text-muted);' }
                });
                header.addEventListener('click', () => {
                    this.deps.getExpandedItems()[relKey] = !isExpanded;
                    this.deps.onRequestReRender();
                });

                card.createDiv({
                    text: rd.type,
                    cls: 'nw-text-muted-11', attr: { style: 'padding:4px 10px;background:var(--background-primary);' }
                });

                if (isExpanded) {
                    const body = card.createDiv({
                        attr: { style: 'padding:10px;border-top:1px solid var(--background-modifier-border);font-size:12px;' }
                    });
                    if (rd.history && rd.history.length > 0) {
                        body.createDiv({ text: '关系变化', attr: { style: 'font-weight:500;margin-bottom:6px;color:var(--text-muted);' } });
                        rd.history.forEach(h => {
                            body.createDiv({
                                text: `${(h.position * 100).toFixed(0)}%：${h.fromType} → ${h.toType}`,
                                attr: { style: 'padding:4px 0;border-bottom:1px dashed var(--background-modifier-border);' }
                            });
                        });
                    }
                    if (rd.keyEvents && rd.keyEvents.length > 0) {
                        body.createDiv({ text: '关键事件', attr: { style: 'font-weight:500;margin:8px 0 6px;color:var(--text-muted);' } });
                        rd.keyEvents.slice(0, 3).forEach(e => {
                            body.createDiv({
                                text: e.length > 50 ? e.substring(0, 50) + '...' : e,
                                attr: { style: 'padding:4px 0;font-size:11px;line-height:1.4;' }
                            });
                        });
                    }
                }
            });
        }

        if (data.relationships && data.relationships.length > 0) {
            const netSection = this.createDetailSection(container, `人物关系网络 (${data.relationships.length})`);
            const netTable = netSection.createDiv({
                attr: { style: 'max-height:250px;overflow-y:auto;border:1px solid var(--background-modifier-border);border-radius:6px;' }
            });
            const table = netTable.createEl('table', {
                attr: { style: 'width:100%;border-collapse:collapse;font-size:12px;' }
            });
            const thead = table.createEl('thead');
            const headRow = thead.createEl('tr', { attr: { style: 'position:sticky;top:0;background:var(--background-secondary);z-index:1;' } });
            ['人物A', '人物B', '关系类型', '强度'].forEach(h => {
                headRow.createEl('th', {
                    text: h,
                    attr: { style: 'padding:8px 10px;text-align:left;font-weight:600;border-bottom:1px solid var(--background-modifier-border);' }
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
                row.createEl('td', { text: fromName, attr: { style: 'padding:6px 10px;border-bottom:1px solid var(--background-modifier-border);' } });
                row.createEl('td', { text: toName, attr: { style: 'padding:6px 10px;border-bottom:1px solid var(--background-modifier-border);' } });
                row.createEl('td', { text: rel.type, attr: { style: 'padding:6px 10px;border-bottom:1px solid var(--background-modifier-border);' } });
                const strength = rel.weight ? Math.round(rel.weight * 100) : '-';
                row.createEl('td', { text: `${strength}${typeof strength === 'number' ? '%' : ''}`, attr: { style: 'padding:6px 10px;border-bottom:1px solid var(--background-modifier-border);' } });
            });
        }

        if (data.allCharacters && data.allCharacters.length > 0) {
            const allSection = this.createDetailSection(container, `全部角色 (${data.allCharacters.length})`);
            const list = allSection.createDiv({
                attr: { style: 'max-height:300px;overflow-y:auto;border:1px solid var(--background-modifier-border);border-radius:6px;' }
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
                    cls: 'nw-flex-center nw-flex-shrink-0', attr: { style: 'width:24px;height:24px;border-radius:50%;background:var(--background-secondary);font-size:11px;font-weight:500;' }
                });
                item.createSpan({ text: char.name, attr: { style: 'font-size:13px;font-weight:500;flex:1;' } });
                const roleParts = [char.role || ''];
                if (char.tier) roleParts.push(this.getTierLabel(char.tier));
                item.createSpan({ text: roleParts.filter(Boolean).join(' · '), cls: 'nw-text-sm-muted nw-flex-shrink-0' });
                if (char.tags && char.tags.length > 0) {
                    const tagsWrap = item.createDiv({ cls: 'nw-flex-shrink-0', attr: { style: 'display:flex;gap:4px;' } });
                    char.tags.slice(0, 2).forEach(tag => {
                        tagsWrap.createSpan({
                            text: tag,
                            attr: { style: 'padding:1px 6px;font-size:10px;background:var(--background-secondary);color:var(--text-muted);border-radius:8px;' }
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
                attr: { style: 'display:flex;align-items:center;gap:8px;cursor:pointer;padding:8px 0;' }
            });
            header.createSpan({
                text: isExpanded ? '▼' : '▶',
                attr: { style: 'font-size:12px;color:var(--text-muted);' }
            });
            header.createSpan({
                text: `${data.relations.length} 条关系`,
                attr: { style: 'font-size:13px;color:var(--text-muted);' }
            });
            header.addEventListener('click', () => {
                this.deps.getExpandedItems()[relKey] = !isExpanded;
                this.deps.onRequestReRender();
            });

            if (isExpanded) {
                const list = section.createDiv({
                    attr: { style: 'display:flex;flex-direction:column;gap:6px;max-height:400px;overflow-y:auto;' }
                });
                data.relations.slice(0, 15).forEach(rel => {
                    const relItem = list.createDiv({
                        attr: { style: 'padding:8px 12px;background:var(--background-secondary);border-radius:6px;font-size:12px;display:flex;align-items:center;gap:10px;' }
                    });
                    relItem.createSpan({
                        text: `${rel.fromId} → ${rel.toId}`,
                        attr: { style: 'font-weight:500;color:var(--text-normal);min-width:120px;' }
                    });
                    relItem.createSpan({
                        text: rel.type,
                        attr: { style: 'color:var(--interactive-accent);padding:2px 8px;background:rgba(var(--interactive-accent-rgb),0.1);border-radius:4px;' }
                    });
                    const weightPct = rel.weight != null ? `${(rel.weight * 100).toFixed(0)}%` : '-';
                    relItem.createSpan({
                        text: `权重: ${weightPct}`,
                        attr: { style: 'color:var(--text-muted);' }
                    });
                    const eventCount = rel.keyEvents?.length ?? 0;
                    relItem.createSpan({
                        text: `事件: ${eventCount}`,
                        attr: { style: 'color:var(--text-muted);margin-left:auto;' }
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
            const chartDiv = section.createDiv({ attr: { style: 'display:flex;justify-content:center;' } });
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
                attr: { style: 'font-size:12px;color:var(--text-muted);margin-bottom:16px;' }
            });
        }

        const { foreshadows, typeDistribution, stats, qualityScore } = data;

        // 质量评分
        if (qualityScore) {
            const scoreSection = this.createDetailSection(container, '伏笔质量评分');
            const scoreGrid = scoreSection.createDiv({
                attr: { style: 'display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;' }
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
                    attr: { style: 'padding:12px;text-align:center;background:var(--background-secondary);border-radius:6px;' }
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
                attr: { style: 'display:flex;justify-content:center;margin-bottom:16px;' }
            });
            this.renderChart(donutDiv, donutChart(donutData, { size: 280, title: '伏笔回收状态' }));

            const statsGrid = statsSection.createDiv({
                attr: { style: 'display:grid;grid-template-columns:repeat(4,1fr);gap:12px;' }
            });
            const statItems = [
                { label: '总伏笔数', value: stats.totalForeshadows, color: 'var(--interactive-accent)' },
                { label: '已回收', value: stats.resolvedCount, color: '#2ecc71' },
                { label: '未回收', value: stats.unresolvedCount, color: '#f59e0b' },
                { label: '平均重要度', value: `${(stats.avgImportance * 100).toFixed(0)}%`, color: '#9b59b6' },
            ];
            statItems.forEach(item => {
                const card = statsGrid.createDiv({
                    attr: { style: 'padding:14px;text-align:center;background:var(--background-secondary);border-radius:8px;' }
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
                attr: { style: 'display:grid;grid-template-columns:repeat(auto-fit,minmax(100px,1fr));gap:8px;' }
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
                    attr: { style: 'padding:10px;text-align:center;background:var(--background-secondary);border-radius:6px;' }
                }).createDiv({
                    text: `${typeLabels[type] || type}：${count}`,
                    attr: { style: 'font-size:12px;' }
                });
            });
        }

        // 伏笔列表
        const listSection = this.createDetailSection(container, '伏笔列表');

        const filterRow = listSection.createDiv({
            attr: { style: 'display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;' }
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
            attr: { style: 'max-height:400px;overflow-y:auto;border:1px solid var(--background-modifier-border);border-radius:8px;' }
        });

        filteredItems.forEach((item, idx) => {
            const key = `fs_${idx}`;
            const isExpanded = this.deps.getExpandedItems()[key] ?? false;

            const itemEl = list.createDiv({
                attr: {
                    style: `border-bottom:1px solid var(--background-modifier-border);&:last-child{border-bottom:none;}`
                }
            });

            const header = itemEl.createDiv({
                attr: { style: 'padding:12px;cursor:pointer;display:flex;align-items:flex-start;gap:10px;' }
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

            const content = header.createDiv({ attr: { style: 'flex:1;min-width:0;' } });
            content.createDiv({ text: item.name, attr: { style: 'font-size:13px;font-weight:500;margin-bottom:4px;' } });
            const meta = content.createDiv({ attr: { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;' } });
            
            const typeLabels: Record<string, string> = {
                'item': '物品伏笔',
                'skill': '功法伏笔',
                'character': '人物伏笔',
                'setting': '设定伏笔',
                'event': '事件伏笔',
            };
            meta.createSpan({
                text: typeLabels[item.type] || item.type,
                attr: { style: 'padding:2px 8px;font-size:11px;background:var(--background-secondary);border-radius:10px;color:var(--text-muted);' }
            });

            const importancePct = (item.importance * 100).toFixed(0);
            meta.createSpan({
                text: `重要度 ${importancePct}%`,
                attr: {
                    style: `padding:2px 8px;font-size:11px;border-radius:10px;${
                        item.importance >= 0.7 ? 'background:rgba(231,76,60,0.1);color:#e74c3c;' :
                        item.importance >= 0.4 ? 'background:rgba(245,158,11,0.1);color:#f59e0b;' :
                        'background:var(--background-secondary);color:var(--text-muted);'
                    }`
                }
            });

            meta.createSpan({
                text: `出场 ${item.totalAppearances}次`,
                cls: 'nw-text-muted-11'
            });

            const toggle = header.createSpan({
                text: isExpanded ? '▼' : '▶',
                cls: 'nw-text-sm-muted nw-flex-shrink-0', attr: { style: 'margin-top:2px;' }
            });
            void toggle;

            header.addEventListener('click', () => {
                this.deps.getExpandedItems()[key] = !isExpanded;
                this.deps.onRequestReRender();
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
                attr: { style: 'font-size:12px;color:var(--text-muted);margin-bottom:16px;' }
            });
        }

        if (data.overallScore !== undefined || data.overallLevel) {
            const section = this.createDetailSection(container, '商业可行性总览');
            const card = section.createDiv({
                attr: { style: 'padding:20px;background:var(--background-secondary);border-radius:10px;display:flex;align-items:center;gap:24px;' }
            });
            const scoreCircle = card.createDiv({
                attr: { style: 'width:100px;height:100px;border-radius:50%;background:linear-gradient(135deg,var(--interactive-accent),#D97706);display:flex;flex-direction:column;align-items:center;justify-content:center;color:white;flex-shrink:0;' }
            });
            scoreCircle.createDiv({ text: data.overallScore !== undefined ? data.overallScore.toString() : '-', attr: { style: 'font-size:28px;font-weight:700;line-height:1;' } });
            scoreCircle.createDiv({ text: '总分', attr: { style: 'font-size:11px;opacity:0.9;' } });
            const infoDiv = card.createDiv({ attr: { style: 'flex:1;' } });
            infoDiv.createDiv({
                text: `等级：${data.overallLevel || '-'}`,
                attr: { style: 'font-size:18px;font-weight:600;margin-bottom:8px;color:var(--interactive-accent);' }
            });
            infoDiv.createDiv({
                text: '综合评估作品的市场竞争力和读者吸引力',
                attr: { style: 'font-size:13px;color:var(--text-muted);' }
            });
        }

        if (data.goldenThreeChapters) {
            const gtc = data.goldenThreeChapters;
            const section = this.createDetailSection(container, '黄金三章分析');

            if (gtc.totalScore !== undefined || gtc.subScores) {
                const scoreRow = section.createDiv({
                    attr: { style: 'display:flex;align-items:center;gap:20px;margin-bottom:16px;padding:14px;background:var(--background-secondary);border-radius:8px;' }
                });
                if (gtc.totalScore !== undefined) {
                    scoreRow.createDiv({
                        text: `黄金三章总分：${gtc.totalScore} 分`,
                        attr: { style: 'font-size:15px;font-weight:600;color:var(--interactive-accent);' }
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
                            attr: { style: 'display:flex;justify-content:center;' }
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
                const list = suggSection.createDiv({ attr: { style: 'display:flex;flex-direction:column;gap:8px;' } });
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
                        attr: { style: 'padding:10px 14px;background:var(--background-secondary);border-radius:6px;' }
                    });
                    const header = item.createDiv({ attr: { style: 'display:flex;align-items:center;gap:8px;margin-bottom:4px;' } });
                    header.createSpan({
                        text: severityLabels[s.severity] || s.severity,
                        attr: {
                            style: `padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;color:white;background:${severityColors[s.severity] || 'var(--text-muted)'};`
                        }
                    });
                    header.createSpan({ text: s.category, attr: { style: 'font-size:12px;font-weight:500;' } });
                    item.createDiv({ text: s.suggestion, attr: { style: 'font-size:13px;color:var(--text-muted);' } });
                });
            }
        }

        if (data.waveRhythm) {
            const wr = data.waveRhythm;
            const section = this.createDetailSection(container, '波浪节奏验证');

            if (wr.complianceRate !== undefined) {
                const progressWrap = section.createDiv({
                    attr: { style: 'padding:14px;background:var(--background-secondary);border-radius:8px;margin-bottom:12px;' }
                });
                progressWrap.createDiv({
                    text: `节奏合规率：${(wr.complianceRate * 100).toFixed(1)}%`,
                    attr: { style: 'font-size:14px;font-weight:600;margin-bottom:8px;' }
                });
                const barBg = progressWrap.createDiv({
                    attr: { style: 'height:10px;background:var(--background-modifier-border);border-radius:5px;overflow:hidden;' }
                });
                barBg.createDiv({
                    attr: {
                        style: `height:100%;width:${Math.min(100, Math.max(0, wr.complianceRate * 100))}%;background:linear-gradient(90deg,var(--interactive-accent),#D97706);border-radius:5px;transition:width 0.3s;`
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
                const list = vSection.createDiv({ attr: { style: 'display:flex;flex-direction:column;gap:6px;' } });
                wr.violations.forEach((v, i) => {
                    const item = list.createDiv({
                        attr: { style: 'padding:10px 12px;background:var(--background-secondary);border-radius:6px;font-size:12px;' }
                    });
                    item.createEl('div', {
                        text: `#${i + 1} ${typeLabels[v.type] || v.type} · 第${v.startChapter}-${v.endChapter}章`,
                        attr: { style: 'font-weight:500;color:var(--color-orange);margin-bottom:4px;' }
                    });
                    item.createEl('div', {
                        text: `间隔：${v.gap} 章（阈值：${v.threshold} 章）`,
                        attr: { style: 'color:var(--text-muted);' }
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
                attr: { style: 'font-size:12px;color:var(--text-muted);margin-bottom:16px;' }
            });
        }

        if (data.overallScore !== undefined) {
            const section = this.createDetailSection(container, '可读性总览');
            const card = section.createDiv({
                attr: { style: 'padding:20px;background:var(--background-secondary);border-radius:10px;display:flex;align-items:center;gap:24px;' }
            });
            const scoreCircle = card.createDiv({
                attr: { style: 'width:100px;height:100px;border-radius:50%;background:linear-gradient(135deg,#10b981,#3b82f6);display:flex;flex-direction:column;align-items:center;justify-content:center;color:white;flex-shrink:0;' }
            });
            scoreCircle.createDiv({ text: data.overallScore.toString(), attr: { style: 'font-size:28px;font-weight:700;line-height:1;' } });
            scoreCircle.createDiv({ text: '总分', attr: { style: 'font-size:11px;opacity:0.9;' } });
            const infoDiv = card.createDiv({ attr: { style: 'flex:1;' } });
            infoDiv.createDiv({
                text: '可读性综合评分',
                attr: { style: 'font-size:18px;font-weight:600;margin-bottom:8px;color:var(--interactive-accent);' }
            });
            infoDiv.createDiv({
                text: '评估作品的阅读流畅度、代入感和AI痕迹水平',
                attr: { style: 'font-size:13px;color:var(--text-muted);' }
            });
        }

        if (data.showTell) {
            const st = data.showTell;
            const section = this.createDetailSection(container, 'Show vs Tell 分析');

            const hasDonutData = st.showPercentage !== undefined || st.tellPercentage !== undefined || (st.stats && st.stats.mixedCount !== undefined);
            if (hasDonutData) {
                const chartWrap = section.createDiv({
                    attr: { style: 'display:flex;justify-content:center;gap:24px;align-items:flex-start;flex-wrap:wrap;' }
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
                        attr: { style: 'display:flex;flex-direction:column;gap:10px;min-width:180px;' }
                    });
                    statsDiv.createDiv({ text: '统计数据', attr: { style: 'font-size:14px;font-weight:600;margin-bottom:4px;' } });
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
                const list = riskSection.createDiv({ attr: { style: 'display:flex;flex-direction:column;gap:8px;' } });
                st.highRiskTellSegments.slice(0, 10).forEach((seg, i) => {
                    const item = list.createDiv({
                        attr: { style: 'padding:10px 14px;background:var(--background-secondary);border-radius:6px;' }
                    });
                    const header = item.createDiv({ attr: { style: 'display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;' } });
                    header.createSpan({ text: `#${i + 1}`, attr: { style: 'font-size:12px;font-weight:600;color:var(--color-red);' } });
                    if (seg.confidence !== undefined) {
                        header.createSpan({ text: `置信度：${(seg.confidence * 100).toFixed(0)}%`, attr: { style: 'font-size:11px;color:var(--text-muted);' } });
                    }
                    item.createDiv({
                        text: seg.excerpt,
                        attr: { style: 'font-size:12px;color:var(--text-muted);line-height:1.6;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;' }
                    });
                });
            }

            if (st.suggestions && st.suggestions.length > 0) {
                const suggSection = this.createDetailSection(container, '改进建议');
                const severityOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
                const sortedSuggestions = [...st.suggestions].sort((a, b) =>
                    (severityOrder[a.severity] ?? 99) - (severityOrder[b.severity] ?? 99)
                );
                const list = suggSection.createDiv({ attr: { style: 'display:flex;flex-direction:column;gap:8px;' } });
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
                        attr: { style: 'padding:10px 14px;background:var(--background-secondary);border-radius:6px;' }
                    });
                    const header = item.createDiv({ attr: { style: 'display:flex;align-items:center;gap:8px;margin-bottom:4px;' } });
                    header.createSpan({
                        text: severityLabels[s.severity] || s.severity,
                        attr: {
                            style: `padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;color:white;background:${severityColors[s.severity] || 'var(--text-muted)'};`
                        }
                    });
                    header.createSpan({ text: s.type, attr: { style: 'font-size:12px;font-weight:500;' } });
                    item.createDiv({ text: s.message, attr: { style: 'font-size:13px;color:var(--text-muted);' } });
                });
            }
        }

        if (data.aiTrace) {
            const ai = data.aiTrace;
            const section = this.createDetailSection(container, 'AI 痕迹检测');

            const overviewRow = section.createDiv({
                attr: { style: 'display:flex;align-items:center;gap:20px;margin-bottom:16px;padding:14px;background:var(--background-secondary);border-radius:8px;' }
            });
            if (ai.overallScore !== undefined) {
                overviewRow.createDiv({
                    text: `AI 痕迹率：${(ai.overallScore * 100).toFixed(1)}%`,
                    attr: { style: 'font-size:15px;font-weight:600;color:var(--color-orange);' }
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
                        attr: { style: 'display:flex;justify-content:center;' }
                    });
                    this.renderChart(barDiv, barChart(barData, { width: 500, height: 200, title: '六维分析', horizontal: true }));
                }
            }

            if (ai.highRiskParagraphs && ai.highRiskParagraphs.length > 0) {
                const riskSection = this.createDetailSection(container, `高风险段落 (${ai.highRiskParagraphs.length})`);
                const list = riskSection.createDiv({ attr: { style: 'display:flex;flex-direction:column;gap:8px;' } });
                ai.highRiskParagraphs.slice(0, 10).forEach((p, i) => {
                    const item = list.createDiv({
                        attr: { style: 'padding:10px 14px;background:var(--background-secondary);border-radius:6px;' }
                    });
                    const header = item.createDiv({ attr: { style: 'display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;' } });
                    header.createSpan({ text: `#${i + 1}`, attr: { style: 'font-size:12px;font-weight:600;color:var(--color-red);' } });
                    if (p.score !== undefined) {
                        header.createSpan({ text: `风险分：${(p.score * 100).toFixed(0)}%`, attr: { style: 'font-size:11px;color:var(--text-muted);' } });
                    }
                    item.createDiv({
                        text: p.excerpt,
                        attr: { style: 'font-size:12px;color:var(--text-muted);line-height:1.6;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;margin-bottom:6px;' }
                    });
                    if (p.reasons && p.reasons.length > 0) {
                        const reasonsDiv = item.createDiv({ attr: { style: 'display:flex;flex-wrap:wrap;gap:4px;' } });
                        p.reasons.forEach(r => {
                            reasonsDiv.createSpan({
                                text: r,
                                attr: { style: 'padding:2px 6px;background:var(--color-red);opacity:0.2;border-radius:3px;font-size:10px;color:var(--color-red);' }
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
                attr: { style: 'display:flex;justify-content:center;' }
            });
            this.renderChart(donutDiv, donutChart(donutData, { size: 300, title: '技巧分类占比' }));
        }

        // Top技巧排名柱状图（按 count 排序）
        const sortedTechniques = [...techniques].sort((a, b) => b.count - a.count);
        const top10 = sortedTechniques.slice(0, 10);
        
        const chartSection = this.createDetailSection(container, 'Top 10 写作技巧排名');
        const barData = top10.map(t => ({ label: t.name, value: t.count }));
        const barDiv = chartSection.createDiv({
            attr: { style: 'display:flex;justify-content:center;' }
        });
        this.renderChart(barDiv, barChart(barData, { width: 500, height: 250, title: '技巧使用频率', horizontal: true }));

        // 质量评分卡片
        if (qualityScore) {
            const section = this.createDetailSection(container, '技巧质量评分');
            const grid = section.createDiv({
                attr: { style: 'display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;' }
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
                    attr: {
                        style: `border:1px solid var(--background-modifier-border);border-radius:8px;margin-bottom:8px;overflow:hidden;`
                    }
                });

                const header = item.createDiv({
                    attr: { style: 'padding:10px 12px;cursor:pointer;display:flex;align-items:center;gap:10px;' }
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

                const info = header.createDiv({ attr: { style: 'flex:1;min-width:0;' } });
                info.createDiv({ text: tech.name, attr: { style: 'font-size:13px;font-weight:500;' } });
                const meta = info.createDiv({ cls: 'nw-text-muted-11', attr: { style: 'display:flex;gap:12px;margin-top:2px;flex-wrap:wrap;' } });
                meta.createSpan({ text: `出现 ${tech.count} 次` });
                meta.createSpan({ text: `分类: ${categoryLabels[tech.category] || tech.category}` });
                meta.createSpan({ text: `置信度 ${(tech.confidence * 100).toFixed(0)}%` });
                meta.createSpan({ text: `质量分 ${(tech.qualityScore * 100).toFixed(0)}%` });

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
                        attr: { style: 'padding:12px;border-top:1px solid var(--background-modifier-border);background:var(--background-secondary);' }
                    });
                    body.createDiv({ text: `技巧ID: ${tech.id}`, attr: { style: 'font-size:12px;color:var(--text-muted);margin-bottom:4px;' } });
                    body.createDiv({ text: `题材权重: ${tech.genreWeight.toFixed(1)}x`, attr: { style: 'font-size:12px;color:var(--text-muted);' } });
                }
            });
    }

    // ---- 标签 Tab ----
    public renderBookTagsTab(container: HTMLElement, book: BookBasicInfo): void {
        const themeSection = this.createDetailSection(container, '主题标签');
        const themeWrap = themeSection.createDiv({ attr: { style: 'display:flex;flex-wrap:wrap;gap:6px;' } });
        if (book.themeTags.length === 0) {
            themeWrap.createSpan({ text: '暂无主题标签', attr: { style: 'color:var(--text-muted);font-size:13px;' } });
        } else {
            book.themeTags.forEach(tag => {
                themeWrap.createSpan({
                    text: tag,
                    attr: { style: 'padding:4px 12px;font-size:12px;background:var(--background-secondary);border-radius:12px;color:var(--text-normal);' }
                });
            });
        }

        const techniqueSection = this.createDetailSection(container, '技巧标签');
        const techWrap = techniqueSection.createDiv({ attr: { style: 'display:flex;flex-wrap:wrap;gap:6px;' } });
        if (book.techniqueTags.length === 0) {
            techWrap.createSpan({ text: '暂无技巧标签', attr: { style: 'color:var(--text-muted);font-size:13px;' } });
        } else {
            book.techniqueTags.forEach(tag => {
                techWrap.createSpan({
                    text: tag,
                    attr: { style: 'padding:4px 12px;font-size:12px;background:var(--background-secondary);border-radius:12px;color:var(--text-normal);' }
                });
            });
        }

        const customSection = this.createDetailSection(container, '自定义标签');
        const customTagsWrap = customSection.createDiv({ attr: { style: 'display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px;' } });

        if (book.customTags.length === 0) {
            customTagsWrap.createSpan({ text: '暂无自定义标签', attr: { style: 'color:var(--text-muted);font-size:13px;' } });
        } else {
            book.customTags.forEach((tag, idx) => {
                const tagEl = customTagsWrap.createSpan({
                    cls: 'nw-flex-row-sm', attr: { style: 'padding:4px 12px;font-size:12px;background:var(--background-secondary);border-radius:12px;color:var(--text-normal);' }
                });
                tagEl.createSpan({ text: tag });
                const delBtn = tagEl.createSpan({
                    text: '×',
                    attr: { style: 'cursor:pointer;color:var(--text-muted);font-size:14px;line-height:1;' }
                });
                delBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.deps.onDeleteCustomTag(book, idx).catch(err => {
                        log.error('删除标签失败:', err);
                    });
                });
            });
        }

        const addWrap = customSection.createDiv({ attr: { style: 'display:flex;gap:8px;' } });
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
            attr: { style: 'margin-bottom:16px;padding:12px 16px;background:var(--background-secondary);border-radius:8px;border-left:4px solid var(--interactive-accent);' }
        });

        const header = card.createDiv({
            attr: { style: 'display:flex;align-items:center;gap:12px;margin-bottom:10px;' }
        });
        header.createSpan({ text: '质量评分', attr: { style: 'font-size:13px;font-weight:600;color:var(--text-normal);' } });
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
            attr: { style: 'font-size:10px;color:var(--text-muted);margin-left:auto;' }
        });

        const metrics = card.createDiv({
            attr: { style: 'display:flex;gap:16px;flex-wrap:wrap;' }
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
