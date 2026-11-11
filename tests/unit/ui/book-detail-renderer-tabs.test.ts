/**
 * book-detail-renderer-tabs.test.ts — 书籍详情页签渲染回归（阶段 D2 / DSH-20261112-11）
 *
 * book-detail-renderer.ts（900+ 行，此前 1/906 覆盖）承载着五个数据页签的
 * 全部渲染分支：空数据占位、页签分区、图表挂载、列表截断、徽标配色。
 * 判定函数已抽到 *-logic 模块单测；本文件用假 DOM + 注入 deps 锁「分支为真时
 * DOM 真的长出来」，顺带把 *-logic 的调用点也纳入覆盖。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeEl, stubCreateDiv, stubDocument } from './support/fake-dom';
import { BookDetailRenderer, type BookDetailRendererDeps } from '../../../ui/views/book-detail-renderer';

/** 最小 deps：数据全部注入，格式化直出 */
function makeDeps(overrides: Partial<BookDetailRendererDeps> = {}): BookDetailRendererDeps {
    return {
        app: {} as never,
        getKb: () => null,
        getKbManager: () => null,
        getStyleData: () => null,
        getRhythmData: () => null,
        getTechniqueData: () => null,
        getStructureData: () => null,
        getCharacterData: () => null,
        getForeshadowData: () => null,
        getCommercialData: () => null,
        getReadabilityData: () => null,
        getCurrentBook: () => undefined,
        formatWordCount: (n?: number) => `${n ?? 0} 字`,
        formatDateTime: () => '2026-01-02 03:04',
        formatDuration: (ms: number) => `${ms}ms`,
        getChannelLabel: (c: string) => c,
        getStatusLabel: (s: string) => s,
        getDeconstructionScheduler: () => null,
        getExpandedItems: () => ({}),
        getForeshadowFilter: () => 'all',
        setForeshadowFilter: () => {},
        getDimensionLabels: () => ({}) as never,
        onClassifyBook: async () => {},
        ...overrides,
    } as unknown as BookDetailRendererDeps;
}

function render(deps: BookDetailRendererDeps): FakeEl {
    const container = new FakeEl('div');
    new BookDetailRenderer(deps).renderBookStyleTab(container as unknown as HTMLElement);
    return container;
}

beforeEach(() => {
    stubCreateDiv();
    stubDocument();
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('renderBookStyleTab', () => {
    it('无数据：给空态占位，不渲染任何分区', () => {
        const root = render(makeDeps());
        expect(root.allText()).toContain('风格分析数据');
        expect(root.findAll('nw-u-mb-lg')).toHaveLength(0);
    });

    it('完整风格数据：雷达/统计/词云/修辞/整体风格/词汇/五感/句式/句长/段长全渲染', () => {
        const root = render(makeDeps({
            getStyleData: () => ({
                sentenceRhythm: { avgSentenceLength: 18.4, sentenceTypeDistribution: { declarative: 8, interrogative: 2 }, lengthDistribution: { short: 3, medium: 5, long: 2 } },
                paragraphStructure: { avgParagraphLength: 120, lengthDistribution: { short: 1, medium: 2, long: 3, veryLong: 4 } },
                narrativeStyle: { dialogueRatio: 0.35, descriptionRatio: { total: 0.2 } },
                wordPreference: { idiomDensity: 2.5, colloquialismLevel: 0.4, topWords: [{ word: '灵气', count: 12 }, { word: '剑光', count: 9 }] },
                rhetoric: { metaphor: 5 },
                overallStyle: { primaryStyle: '冷峻', secondaryStyle: '克制', confidence: 0.8, styleScores: { a: 0.6, b: 0.5 } },
                vocabularyRichness: { ttr: 0.42, mtld: 88, yulesK: 1200, vocabularySize: 5600, level: '丰富', score: 82 },
                fiveSenses: { distribution: { visual: 0.5, auditory: 0.3, tactile: 0.2 }, balanceScore: 0.7, level: '均衡', dominantSense: 'visual' },
            } as never),
        }));

        const text = root.allText();
        expect(text).toContain('风格雷达图');
        expect(text).toContain('平均句长');
        expect(text).toContain('高频词词云');
        expect(text).toContain('修辞手法');
        expect(text).toContain('主要文风');
        expect(text).toContain('冷峻');
        expect(text).toContain('次要文风: 克制');
        expect(text).toContain('词汇丰富度');
        expect(text).toContain('五感描写分布');
        expect(text).toContain('主导感');
        expect(text).toContain('视觉');
        expect(text).toContain('句式类型分布');
        expect(text).toContain('句长分布');
        expect(text).toContain('段落长度分布');
        // 图表走 sanitizeHTMLToDom 替身（innerHTML 拼接）；查整棵树的 innerHTML
        expect(collectHtml(root).some(h => h.includes('<svg'))).toBe(true);
        // 图表容器类名出现在 SVG 串里（attachChartInteractions 的宿主）
        expect(collectHtml(root).some(h => h.includes('nw-chart-container'))).toBe(true);
    });

    it('五感不足 3 维：不渲染五感分区（门槛在 buildFiveSensesRadarData）', () => {
        const root = render(makeDeps({
            getStyleData: () => ({
                fiveSenses: { distribution: { visual: 0.7, auditory: 0.3 }, balanceScore: 0.5, level: '偏科', dominantSense: 'visual' },
            } as never),
        }));
        expect(root.allText()).not.toContain('五感描写分布');
    });
});

describe('renderBookStructureTab', () => {
    it('无数据：空态占位', () => {
        const root = new FakeEl('div');
        new BookDetailRenderer(makeDeps()).renderBookStructureTab(root as unknown as HTMLElement);
        expect(root.allText()).toContain('结构拆解数据');
    });

    it('完整结构数据：类型/统计/起承转合/三线/章节列表全渲染', () => {
        const root = new FakeEl('div');
        new BookDetailRenderer(makeDeps({
            getCurrentBook: () => ({ id: 'b1', name: '赤潮', wordCount: 120000 } as never),
            getStructureData: () => ({
                structureType: '三幕式',
                stats: { volumeCount: 3, chapterCount: 42, avgChapterWordCount: 2850, totalWordCount: 120000 },
                qcchSegments: [
                    { type: '起', startPosition: 0, endPosition: 0.25, chapterRange: [0, 10] },
                    { type: '承', startPosition: 0.25, endPosition: 0.5 },
                ],
                threeLineStructure: {
                    mainLine: { description: '复仇主线', keyNodes: [{ position: 0.3, description: '灭门' }] },
                    romanceLine: { description: '同门情谊' },
                },
                rhythmUnits: [
                    { level: 'chapter', title: '第一章 灭门', wordCount: 2800 },
                    { level: 'scene', title: '开场', wordCount: 300 },
                    { level: 'chapter', title: '第二章 流亡', wordCount: 2900 },
                ],
            } as never),
        })).renderBookStructureTab(root as unknown as HTMLElement);

        const text = root.allText();
        expect(text).toContain('基于全书 120000 字');
        expect(text).toContain('三幕式');
        expect(text).toContain('结构统计');
        expect(text).toContain('起承转合结构');
        expect(text).toContain('位置: 0% - 25%');
        expect(text).toContain('章节范围: 第1-11章'); // chapterRange 0-based → +1
        expect(text).toContain('三线叙事');
        expect(text).toContain('复仇主线');
        expect(text).toContain('30%'); // keyNodes 位置百分比
        expect(text).toContain('第一章 灭门');
        // 章节列表只取 level==='chapter' 的前 10 章，scene 不进列表
        expect(text).not.toContain('开场');
    });
});

describe('renderBookForeshadowTab', () => {
    function foreshadowData() {
        return {
            foreshadows: [
                { name: '断剑', type: 'item', importance: 0.85, hasResolution: true, totalAppearances: 5 },
                { name: '预言', type: 'event', importance: 0.3, hasResolution: false, totalAppearances: 2 },
            ],
            stats: { totalForeshadows: 2, resolvedCount: 1, unresolvedCount: 1, avgImportance: 0.575 },
            qualityScore: { totalScore: 76, diversityScore: 60, resolutionRate: 50, signalNoiseRatio: 90, coverageScore: 66 },
            typeDistribution: { item: 1, event: 1 },
        };
    }

    it('完整伏笔数据：评分卡/统计/类型分布/列表全渲染，徽标按重要度分档', () => {
        const root = new FakeEl('div');
        new BookDetailRenderer(makeDeps({ getForeshadowData: () => foreshadowData() as never }))
            .renderBookForeshadowTab(root as unknown as HTMLElement);

        const text = root.allText();
        expect(text).toContain('伏笔质量评分');
        expect(text).toContain('76分');
        expect(text).toContain('伏笔统计');
        expect(text).toContain('物品伏笔：1');
        expect(text).toContain('断剑');
        expect(text).toContain('预言');
        expect(text).toContain('重要度 85%');
        expect(text).toContain('出场 5次');
        // 重要度徽标档位（foreshadowImportanceTier）：0.85 高、0.3 默认
        const styles = root.children.flatMap(c => collectAttrs(c)).join('\n');
        expect(styles).toContain('#e74c3c'); // high
        expect(styles).toContain('--text-muted'); // default
        // 筛选按钮三枚，全部态为当前
        const buttons = root.children.flatMap(c => collectTags(c)).filter(t => t.tagName === 'button');
        expect(buttons.length).toBeGreaterThanOrEqual(3);
    });

    it('无伏笔：空态占位', () => {
        const root = new FakeEl('div');
        new BookDetailRenderer(makeDeps()).renderBookForeshadowTab(root as unknown as HTMLElement);
        expect(root.allText()).toContain('伏笔数据');
    });
});

describe('renderBookCommercialTab', () => {
    it('无数据：空态占位', () => {
        const root = new FakeEl('div');
        new BookDetailRenderer(makeDeps()).renderBookCommercialTab(root as unknown as HTMLElement);
        expect(root.allText()).toContain('商业分析数据');
    });

    it('完整商业数据：总览/黄金三章/建议/波浪节奏/违规全渲染', () => {
        const root = new FakeEl('div');
        new BookDetailRenderer(makeDeps({
            getCommercialData: () => ({
                overallScore: 78,
                overallLevel: '良好',
                goldenThreeChapters: {
                    totalScore: 74,
                    subScores: { openingConflict: 0.8, infoDensity: 0.6, protagonistGoal: 0.7, goldenFinger: 0.9, chapterHooks: 0.5 },
                    improvementSuggestions: [
                        { severity: 'high', category: '开篇', suggestion: '第一章直接进入冲突' },
                        { severity: 'low', category: '钩子', suggestion: '章末加悬念' },
                    ],
                },
                waveRhythm: {
                    complianceRate: 0.72,
                    violations: [{ type: 'small_cool', startChapter: 3, endChapter: 7, gap: 9, threshold: 6 }],
                },
            } as never),
        })).renderBookCommercialTab(root as unknown as HTMLElement);

        const text = root.allText();
        expect(text).toContain('商业可行性总览');
        expect(text).toContain('等级：良好');
        expect(text).toContain('黄金三章分析');
        expect(text).toContain('黄金三章总分：74 分');
        // 五维评分标签在 SVG 里（innerHTML 拼接），不在 textContent
        expect(collectHtml(root).some(h => h.includes('开篇冲突'))).toBe(true);
        expect(collectHtml(root).some(h => h.includes('金手指'))).toBe(true);
        expect(text).toContain('第一章直接进入冲突');
        expect(text).toContain('节奏合规率：72.0%');
        expect(text).toContain('违规记录 (1)');
        expect(text).toContain('小爽点 · 第3-7章');
        expect(text).toContain('间隔：9 章（阈值：6 章）');
    });
});

describe('renderBookReadabilityTab', () => {
    it('无数据：空态占位', () => {
        const root = new FakeEl('div');
        new BookDetailRenderer(makeDeps()).renderBookReadabilityTab(root as unknown as HTMLElement);
        expect(root.allText()).toContain('可读性');
    });

    it('Show/Tell 与 AI 痕迹全渲染：比例环图/统计/高风险段/建议/等级徽标', () => {
        const root = new FakeEl('div');
        new BookDetailRenderer(makeDeps({
            getReadabilityData: () => ({
                showTell: {
                    stats: { totalSegments: 10, showCount: 6, tellCount: 2, mixedCount: 2 },
                    showPercentage: 0.6,
                    tellPercentage: 0.2,
                    highRiskTellSegments: [{ excerpt: '他感到非常愤怒', confidence: 0.9 }],
                    suggestions: [{ severity: 'medium', type: 'tell', message: '把情绪写进动作' }],
                },
                aiTrace: {
                    overallScore: 0.32,
                    level: 'medium',
                    dimensions: { sentenceSimilarity: { score: 0.4 }, connectorDensity: { score: 0.2 } },
                    highRiskParagraphs: [{ score: 0.8, excerpt: '综上所述……', reasons: ['说明性结尾'] }],
                },
            } as never),
        })).renderBookReadabilityTab(root as unknown as HTMLElement);

        const text = root.allText();
        expect(text).toContain('统计数据');
        expect(text).toContain('总片段数');
        expect(text).toContain('高风险 Tell 段落 (1)');
        expect(text).toContain('他感到非常愤怒');
        expect(text).toContain('置信度：90%');
        expect(text).toContain('改进建议');
        expect(text).toContain('把情绪写进动作');
        expect(text).toContain('AI 痕迹检测');
        expect(text).toContain('AI 痕迹率：32.0%');
        expect(text).toContain('中风险');
        // 六维标签在 SVG 里
        expect(collectHtml(root).some(h => h.includes('句式相似度'))).toBe(true);
        expect(text).toContain('高风险段落 (1)');
        expect(text).toContain('综上所述……');
        expect(text).toContain('说明性结尾');
    });
});

describe('renderBookTechniqueTab', () => {
    it('无技巧数据：空态占位', () => {
        const root = new FakeEl('div');
        new BookDetailRenderer(makeDeps()).renderBookTechniqueTab(root as unknown as HTMLElement);
        expect(root.allText()).toContain('写作技巧数据');
    });

    it('技巧数据：分类环图 / Top 排名 / 质量评分卡全渲染', () => {
        const root = new FakeEl('div');
        new BookDetailRenderer(makeDeps({
            getTechniqueData: () => ({
                techniques: [
                    { name: '三段式爽点', category: 'cool_point', count: 8 },
                    { name: '对话推进', category: 'dialogue', count: 12 },
                ],
                typeDistribution: { cool_point: 8, dialogue: 12 },
                qualityScore: { totalScore: 71, diversityScore: 55, coverageScore: 64 },
            } as never),
        })).renderBookTechniqueTab(root as unknown as HTMLElement);

        const text = root.allText();
        expect(text).toContain('技巧分类分布');
        expect(text).toContain('爽点');
        expect(text).toContain('Top 10 写作技巧排名');
        expect(text).toContain('对话推进');
        expect(text).toContain('技巧质量评分');
        expect(text).toContain('71 / 100');
    });
});

/** 收集子树里的 innerHTML（图表 SVG 走 sanitize 替身拼接） */
function collectHtml(el: FakeEl): string[] {
    return [el.innerHTML, ...el.children.flatMap(c => collectHtml(c))].filter(Boolean);
}

/** 收集子树里的 attr.style 串 */
function collectAttrs(el: FakeEl): string[] {
    return [el.attr['style'] ?? '', ...el.children.flatMap(c => collectAttrs(c))].filter(Boolean);
}

/** 收集子树全部元素 */
function collectTags(el: FakeEl): FakeEl[] {
    return [el, ...el.children.flatMap(c => collectTags(c))];
}
