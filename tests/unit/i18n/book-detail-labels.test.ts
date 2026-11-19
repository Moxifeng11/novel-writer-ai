/**
 * book-detail-labels.test.ts — 知识库 D 类两文件双语（缺口⑦ 第二期第47片）
 *
 * 覆盖 `ui/knowledge-detail-modal.ts` 与 `ui/views/book-detail-*.ts` 的 `bookDetail.*`
 * 资源（365 键）：分类标签、风格/节奏/结构/概览/题材/人设/伏笔/商业/可读/技巧/标签各页签，
 * 以及质量环图的 qdim 维度与 NRC/情绪弧线/严重度等枚举展示名。
 *
 * 刻意保留中文的不是界面文案：`features` 的数据键（句式节奏等）、
 * 起承转合的配色键、技巧分类的英文键、`log.*` 与注释。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { setLocale, translate } from '../../../i18n';

const CJK = /[\u4e00-\u9fff]/;

/** 全部 365 条 bookDetail 键（与资源文件一一对应） */
const KEYS: readonly string[] = [
    'character.abilities', 'character.all', 'character.appearanceFreq', 'character.arc', 'character.arcComplete', 'character.arcType.awakening',
    'character.arcType.darkening', 'character.arcType.fall', 'character.arcType.growth', 'character.arcType.return', 'character.arcType.stable', 'character.arcTypeLine',
    'character.avgAppearance', 'character.events', 'character.first', 'character.goal', 'character.grade.coreSupporting', 'character.grade.extra',
    'character.grade.importantSupporting', 'character.grade.minorSupporting', 'character.grade.protagonist', 'character.graph', 'character.growth', 'character.hAppearance',
    'character.hCharA', 'character.hCharB', 'character.hDialogue', 'character.hName', 'character.hOverall', 'character.hPerspective',
    'character.hPlot', 'character.hRank', 'character.hRelType', 'character.hRelation', 'character.hStrength', 'character.hTier',
    'character.keyEvents', 'character.last', 'character.list', 'character.mains', 'character.mentions', 'character.name',
    'character.network', 'character.pagerank', 'character.pagerankTitle', 'character.perspectiveRatio', 'character.plotDriving', 'character.radarTitle',
    'character.ranking', 'character.relationCenter', 'character.relationChange', 'character.relationCount', 'character.relationDepth', 'character.stats',
    'character.topRadar', 'character.total', 'character.traits', 'character.unknownRole', 'character.weight', 'commercial.bigClimax',
    'commercial.compliance', 'commercial.dimChart', 'commercial.dimGoal', 'commercial.dimGold', 'commercial.dimHooks', 'commercial.dimInfo',
    'commercial.dimOpening', 'commercial.gap', 'commercial.golden', 'commercial.goldenScore', 'commercial.level', 'commercial.mediumReversal',
    'commercial.name', 'commercial.overview', 'commercial.overviewDesc', 'commercial.smallCool', 'commercial.total', 'commercial.violationLine',
    'commercial.violations', 'commercial.wave', 'common.basedOn', 'common.charSuffix', 'common.confidence', 'common.cool',
    'common.emptyDesc', 'common.emptyTitle', 'common.improve', 'common.level', 'common.overall', 'common.score',
    'common.scoreSuffix', 'common.uncategorized', 'common.unknown', 'detail.tier', 'emotion.arc.cinderella', 'emotion.arc.complex',
    'emotion.arc.icarus', 'emotion.arc.manInHole', 'emotion.arc.oedipus', 'emotion.arc.ragsToRiches', 'emotion.arc.richesToRags', 'emotion.arc.steady',
    'emotion.nrc.anger', 'emotion.nrc.anticipation', 'emotion.nrc.disgust', 'emotion.nrc.fear', 'emotion.nrc.joy', 'emotion.nrc.sadness',
    'emotion.nrc.surprise', 'emotion.nrc.trust', 'emotion.severity.high', 'emotion.severity.low', 'emotion.severity.medium', 'foreshadow.appearances',
    'foreshadow.avgImportance', 'foreshadow.avgImportanceAlt', 'foreshadow.donut', 'foreshadow.filter.all', 'foreshadow.filter.resolved', 'foreshadow.filter.unresolved',
    'foreshadow.importance', 'foreshadow.list', 'foreshadow.name', 'foreshadow.qCoverage', 'foreshadow.qDiversity', 'foreshadow.qOverall',
    'foreshadow.qRatio', 'foreshadow.qResolution', 'foreshadow.quality', 'foreshadow.stats', 'foreshadow.total', 'foreshadow.totalAlt',
    'foreshadow.type.character', 'foreshadow.type.event', 'foreshadow.type.item', 'foreshadow.type.setting', 'foreshadow.type.skill', 'foreshadow.types',
    'genre.auto', 'genre.autoTip', 'genre.channel', 'genre.edit', 'genre.editTip', 'genre.info',
    'genre.major', 'genre.secondary', 'genre.sub', 'genre.suggest', 'overview.author', 'overview.basic',
    'overview.createdAt', 'overview.dimCharacter', 'overview.dimForeshadow', 'overview.dimRhythm', 'overview.dimStructure', 'overview.dimStyle',
    'overview.dimTechnique', 'overview.dimensions', 'overview.elapsed', 'overview.eta', 'overview.genre', 'overview.name',
    'overview.progress', 'overview.quality', 'overview.status', 'overview.synopsis', 'overview.updatedAt', 'overview.words',
    'qdim.character', 'qdim.commercial', 'qdim.foreshadow', 'qdim.readability', 'qdim.rhythm', 'qdim.structure',
    'qdim.style', 'qdim.technique', 'quality.completeness', 'quality.confidence', 'quality.consistency', 'quality.radar',
    'quality.title', 'readability.aiRate', 'readability.aiTrace', 'readability.confidence', 'readability.connectorDensity', 'readability.emotionUniformity',
    'readability.explanatoryEnding', 'readability.highRisk', 'readability.highRiskSection', 'readability.highRiskTell', 'readability.lowRisk', 'readability.mediumRisk',
    'readability.mixedCount', 'readability.name', 'readability.overall', 'readability.overview', 'readability.overviewDesc', 'readability.parallelismAbuse',
    'readability.riskScore', 'readability.segments', 'readability.sentenceSimilarity', 'readability.showCount', 'readability.showTell', 'readability.showTellTitle',
    'readability.sixDim', 'readability.stats', 'readability.tellCount', 'readability.wordRepetition', 'rhythm.arc', 'rhythm.arcType',
    'rhythm.avgIntensityLine', 'rhythm.avgRhythm', 'rhythm.avgTension', 'rhythm.axisChapter', 'rhythm.axisIntensity', 'rhythm.axisScore',
    'rhythm.chapter', 'rhythm.chapterN', 'rhythm.chapterScore', 'rhythm.chapterScoreTitle', 'rhythm.climax', 'rhythm.coolCtx',
    'rhythm.coolDist', 'rhythm.coolLine', 'rhythm.curve', 'rhythm.curveTitle', 'rhythm.emotion', 'rhythm.eventCtx',
    'rhythm.eventDist', 'rhythm.hookRate', 'rhythm.hookRateLine', 'rhythm.hookTypeTitle', 'rhythm.hooks', 'rhythm.name',
    'rhythm.noHookLine', 'rhythm.nrc', 'rhythm.nrcTitle', 'rhythm.seriesDensity', 'rhythm.seriesEmotion', 'rhythm.seriesTension',
    'rhythm.stage', 'rhythm.structureMatch', 'rhythm.summary', 'rhythm.tension', 'rhythm.tensionSeries', 'rhythm.tensionStd',
    'rhythm.tensionTitle', 'rhythm.typeClimax', 'rhythm.typeReversal', 'rhythm.typeSmallClimax', 'rhythm.typeSuspense', 'rhythm.typeTrough',
    'rhythm.types', 'rhythm.typesTitle', 'rhythm.waveform', 'structure.avgWords', 'structure.chapterList', 'structure.chapterWords',
    'structure.chapters', 'structure.fourActs', 'structure.mainLine', 'structure.name', 'structure.positionLine', 'structure.rangeLine',
    'structure.romanceLine', 'structure.stats', 'structure.subLine', 'structure.threeLines', 'structure.timeline', 'structure.totalWords',
    'structure.type', 'structure.volumes', 'style.avgParagraph', 'style.avgSentence', 'style.balance', 'style.base',
    'style.colloquial', 'style.confidence', 'style.descriptionRatio', 'style.dialogueRatio', 'style.dominantSense', 'style.idiomDensity',
    'style.length.long', 'style.length.medium', 'style.length.short', 'style.levelValue', 'style.mainStyle', 'style.name',
    'style.overall', 'style.paraLength.long', 'style.paraLength.medium', 'style.paraLength.short', 'style.paraLength.veryLong', 'style.paragraphLength',
    'style.paragraphLengthTitle', 'style.perKchars', 'style.radarTitle', 'style.radarTitleFull', 'style.rhetoric', 'style.rhetoricItem.antithesis',
    'style.rhetoricItem.hyperbole', 'style.rhetoricItem.metaphor', 'style.rhetoricItem.parallelism', 'style.rhetoricItem.personification', 'style.rhetoricItem.rhetoricalQuestion', 'style.rhetoricTitle',
    'style.scores', 'style.secondary', 'style.sense', 'style.senseDim.auditory', 'style.senseDim.gustatory', 'style.senseDim.olfactory',
    'style.senseDim.tactile', 'style.senseDim.visual', 'style.senseRadar', 'style.sentenceLengthTitle', 'style.sentenceLengthTitle2', 'style.sentenceType.declarative',
    'style.sentenceType.elliptical', 'style.sentenceType.exclamatory', 'style.sentenceType.interrogative', 'style.sentenceTypeTitle', 'style.sentenceTypes', 'style.vocab',
    'style.vocabSize', 'style.wordCloud', 'style.wordCloudTitle', 'tags.add', 'tags.custom', 'tags.delete',
    'tags.noCustom', 'tags.noTechnique', 'tags.noTheme', 'tags.placeholder', 'tags.technique', 'tags.theme',
    'technique.catCharacter', 'technique.catCoolPoint', 'technique.catDescription', 'technique.catDialogue', 'technique.catDist', 'technique.catDistTitle',
    'technique.catEmotion', 'technique.catSetting', 'technique.catStructure', 'technique.category', 'technique.confidence', 'technique.count',
    'technique.coverage', 'technique.detail', 'technique.diversity', 'technique.genreWeight', 'technique.id', 'technique.name',
    'technique.quality', 'technique.qualityScore', 'technique.top', 'technique.topTitle', 'technique.total', 'tone.high',
    'tone.low', 'tone.medium', 'usedLevel.deep', 'usedLevel.fast', 'usedLevel.standard',
];

const SAMPLES: Record<string, Record<string, string | number>> = {
    'common.basedOn': { wordCount: '123k chars' },
    'common.emptyTitle': { label: 'Style' },
    'common.score': { value: '88' },
    'style.secondary': { value: 'Plain' },
    'style.confidence': { value: '80%' },
    'style.levelValue': { level: 'High', score: '88 pts' },
    'rhythm.chapter': { index: 3 },
    'rhythm.chapterN': { index: 3 },
    'rhythm.eventDist': { count: 4 },
    'rhythm.coolDist': { count: 2 },
    'rhythm.coolLine': { category: 'Payoff', position: '40%' },
    'rhythm.hookRateLine': { value: '62%' },
    'rhythm.noHookLine': { count: 2 },
    'rhythm.avgIntensityLine': { value: '0.72' },
    'rhythm.arcType': { type: 'Steady' },
    'structure.positionLine': { start: '0%', end: '25%' },
    'structure.rangeLine': { start: 1, end: 30 },
    'structure.chapterWords': { count: '3,200' },
    'overview.progress': { value: 40 },
    'overview.elapsed': { value: '2m' },
    'overview.eta': { value: '3m' },
    'character.topRadar': { name: 'Lin' },
    'character.network': { count: 5 },
    'character.all': { count: 9 },
    'character.arcType': { value: 'Growth' },
    'character.arcComplete': { value: 70 },
    'character.goal': { value: 'Revenge' },
    'character.relationCount': { count: 4 },
    'character.weight': { value: '30%' },
    'character.events': { value: 2 },
    'foreshadow.importance': { value: '80%' },
    'foreshadow.appearances': { count: '12' },
    'commercial.level': { value: 'A' },
    'commercial.goldenScore': { value: 82 },
    'commercial.compliance': { value: '90%' },
    'commercial.violations': { count: 1 },
    'commercial.violationLine': { index: 1, type: 'Small payoff', start: 3, end: 5 },
    'commercial.gap': { gap: 2, threshold: 3 },
    'readability.highRiskTell': { count: 1 },
    'readability.confidence': { value: '90%' },
    'readability.aiRate': { value: '32%' },
    'readability.highRiskSection': { count: 1 },
    'readability.riskScore': { value: '80%' },
    'technique.count': { count: '12' },
    'technique.category': { value: 'Emotion' },
    'technique.confidence': { value: '88%' },
    'technique.qualityScore': { value: '90%' },
    'technique.id': { value: 'tech_1' },
    'technique.genreWeight': { value: '1.2x' },
    'tags.delete': { tag: 'Sample' },
    'detail.tier': { value: 'A' },
};

/** 用 ASCII 样本填充插值，便于断言英文资源零 CJK */
function fill(locale: 'zh-CN' | 'en-US', key: string): string {
    const raw = translate(locale, `bookDetail.${key}`);
    const args = SAMPLES[key];
    if (!args) return raw;
    return raw.replace(/\{(\w+)\}/g, (_m, name: string) => String(args[name] ?? name));
}

afterEach(() => setLocale('zh-CN'));

describe('bookDetail 资源完整性', () => {
    it('全部键在两种语言都可解析（不回落键名）', () => {
        for (const locale of ['zh-CN', 'en-US'] as const) {
            for (const key of KEYS) {
                const value = translate(locale, `bookDetail.${key}`);
                expect(value, `${locale} ${key}`).not.toBe(`bookDetail.${key}`);
                expect(value.trim().length, `${locale} ${key}`).toBeGreaterThan(0);
            }
        }
    });

    it('中英占位符集合一致', () => {
        for (const key of KEYS) {
            const zh = [...translate('zh-CN', `bookDetail.${key}`).matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join(',');
            const en = [...translate('en-US', `bookDetail.${key}`).matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join(',');
            expect(zh, key).toBe(en);
        }
    });

    it('英文资源零 CJK', () => {
        const offenders = KEYS.filter(key => CJK.test(fill('en-US', key)));
        expect(offenders).toEqual([]);
    });

    it('中文资源保留原文（抽检各页签）', () => {
        expect(translate('zh-CN', 'bookDetail.style.radarTitle')).toBe('风格雷达图');
        expect(translate('zh-CN', 'bookDetail.rhythm.eventDist', { count: 4 })).toBe('节奏事件分布 (4)');
        expect(translate('zh-CN', 'bookDetail.structure.rangeLine', { start: 1, end: 30 })).toBe('章节范围: 第1-30章');
        expect(translate('zh-CN', 'bookDetail.character.topRadar', { name: '林' })).toBe('主角重要性分析 - 林');
        expect(translate('zh-CN', 'bookDetail.foreshadow.type.item')).toBe('物品伏笔');
        expect(translate('zh-CN', 'bookDetail.commercial.goldenScore', { value: 82 })).toBe('黄金三章总分：82 分');
        expect(translate('zh-CN', 'bookDetail.readability.highRiskSection', { count: 1 })).toBe('高风险段落 (1)');
        expect(translate('zh-CN', 'bookDetail.emotion.arc.ragsToRiches')).toBe('逆袭上升 (Rags to Riches)');
    });

    it('英文插值生效（抽检）', () => {
        expect(translate('en-US', 'bookDetail.common.basedOn', { wordCount: '123k chars' })).toBe('Based on 123k chars of the whole book');
        expect(translate('en-US', 'bookDetail.structure.chapterList')).toBe('Chapter list (first 10)');
        expect(translate('en-US', 'bookDetail.tags.delete', { tag: 'Sample' })).toBe('Delete tag Sample');
        expect(translate('en-US', 'bookDetail.qdim.readability')).toBe('Readability');
    });
});
