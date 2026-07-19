/**
 * structure-deconstructor.ts — 结构拆解器
 *
 * 功能：基于纯统计方法分析小说结构，提供起承转合段落划分、
 *       节奏单元识别（卷/章/节）、三线结构初步分析等多维度结构信息
 * 性能：10万字取样 + async 协作式让出，避免长文本阻塞主线程
 */

import { kbBookStructureBreakdownFile } from '../../shared/paths';
import { VectorEnhancer } from '../vector-enhancer';
import { yieldToUI } from '../../shared/yield';
import { NARRATIVE_TEMPORALITY_WORDS, SHOW_TELL_WORDS } from '../dimension-keywords';
import { createLogger } from '../../shared/logger';


const log = createLogger('StructureDeconstructor');
export interface QCCHSegment {
    type: '起' | '承' | '转' | '合';
    startPosition: number;
    endPosition: number;
    chapterRange?: [number, number];
    description: string;
}

export interface RhythmUnit {
    level: 'volume' | 'chapter' | 'section';
    index: number;
    title: string;
    startPosition: number;
    endPosition: number;
    wordCount: number;
}

export interface ThreeLineStructure {
    mainLine: {
        description: string;
        keyNodes: Array<{ position: number; description: string }>;
    };
    subLine: {
        description: string;
        keyNodes: Array<{ position: number; description: string }>;
    };
    romanceLine: {
        description: string;
        keyNodes: Array<{ position: number; description: string }>;
    };
}

export type NarrativeOrder = 'chronological' | 'analeptic' | 'proleptic' | 'mixed';
export type NarrativeDuration = 'scene' | 'summary' | 'pause' | 'ellipsis' | 'stretch';
export type NarrativeFrequency = 'singulative' | 'repeating' | 'iterative';

export interface NarrativeTemporalityResult {
    order: {
        type: NarrativeOrder;
        flashbacks: Array<{
            position: number;
            targetPosition: number;
            description: string;
        }>;
        flashforwards: Array<{
            position: number;
            targetPosition: number;
            description: string;
        }>;
        confidence: number;
    };
    duration: {
        distribution: Record<NarrativeDuration, number>;
        dominantType: NarrativeDuration;
        description: string;
    };
    frequency: {
        type: NarrativeFrequency;
        repetitiveEvents: Array<{
            description: string;
            count: number;
            position: number;
        }>;
        description: string;
    };
    description: string;
}

export type StructureTemplateType =
    | 'three_act'
    | 'hero_journey'
    | 'kishotenketsu'
    | 'save_the_cat'
    | 'webnovel_formula'
    | 'custom';

export interface StructureTemplateMatch {
    template: StructureTemplateType;
    matchScore: number;
    matchedNodes: Array<{
        nodeName: string;
        position: number;
        confidence: number;
        description: string;
    }>;
    missingNodes: string[];
    description: string;
}

export interface StructureTemplateResult {
    bestMatch: StructureTemplateMatch;
    allMatches: StructureTemplateMatch[];
    description: string;
}

export interface StructureAnalysisResult {
    qcchSegments: QCCHSegment[];
    rhythmUnits: RhythmUnit[];
    threeLineStructure: ThreeLineStructure;
    structureType: string;
    stats: {
        volumeCount: number;
        chapterCount: number;
        avgChapterWordCount: number;
        totalWordCount: number;
    };
    narrativeTemporality?: NarrativeTemporalityResult;
    templateMatch?: StructureTemplateResult;
}

const MAIN_LINE_KEYWORDS = [
    '主角', '他', '她', '自己', '我',
    '决定', '踏上', '开始', '终于', '最终',
    '突破', '成功', '失败', '挑战', '战斗',
    '发现', '得知', '明白', '领悟', '觉醒'
];

const SUB_LINE_KEYWORDS = [
    '配角', '朋友', '兄弟', '姐妹', '师父', '徒弟',
    '家族', '门派', '势力', '国家', '组织',
    '秘密', '阴谋', '计划', '任务', '使命'
];

const ROMANCE_KEYWORDS = [
    '喜欢', '爱', '心动', '心跳', '害羞', '脸红',
    '拥抱', '牵手', '亲吻', '吻', '温暖', '温柔',
    '思念', '想念', '牵挂', '担心', '吃醋', '嫉妒',
    '告白', '表白', '在一起', '分手', '重逢', '相遇'
];

const MAIN_LINE_REFERENCE = '主角成长 个人奋斗 主线剧情 核心目标 最终使命 冒险旅程 成长蜕变 战胜强敌';
const SUB_LINE_REFERENCE = '配角故事 势力斗争 家族恩怨 门派纷争 阴谋诡计 秘密揭露 团队合作 友情羁绊';
const ROMANCE_LINE_REFERENCE = '爱情发展 情感纠葛 甜蜜互动 心动瞬间 表白告白 深情陪伴 爱恨情仇';

const QCCH_REFERENCES = [
    { type: '起', text: '开篇 世界观建立 人物登场 背景交代 初始冲突 引子 序幕 开端' },
    { type: '承', text: '剧情发展 矛盾升级 人物关系推进 线索展开 铺垫蓄势 循序渐进' },
    { type: '转', text: '高潮转折 剧情反转 冲突爆发 危机降临 命运转折 重大变故' },
    { type: '合', text: '结局收尾 冲突解决 人物归宿 真相大白 余韵悠长 圆满落幕' }
];

const STRUCTURE_TYPE_REFERENCES = [
    { type: '长篇多卷结构', text: '宏大叙事 多卷展开 复杂世界观 多条线索交织 史诗级故事' },
    { type: '中长篇结构', text: '完整故事 有明确主线 人物成长弧线完整 适度复杂' },
    { type: '中篇结构', text: '集中叙事 单一主线 紧凑情节 中等篇幅' },
    { type: '短篇分章结构', text: '分章节但篇幅较短 故事完整但精炼' },
    { type: '短篇单篇结构', text: '单一场景 单一事件 篇幅短小 精炼集中' }
];

const ANALEPTIC_MARKERS = [
    '回忆', '往昔', '从前', '曾经', '那时', '当年', '多年前', '记忆中',
    '想起', '回想', '追溯', '追忆', '追思', '追念', '追怀', '追想',
    '追述', '追记', '记忆犹新', '历历在目', '恍如昨日', '想当年',
    '曾几何时', '想当初', '遥想当年', '忆往昔', '忆当年', '前世',
    '前生', '上辈子', '往事', '当年'
];

const PROLEPTIC_MARKERS = [
    '后来', '多年后', '日后', '将来', '未来', '最终', '结局', '终将',
    '终究', '终会', '终有一天', '迟早', '总有一天', '不久的将来',
    '不远的将来', '预言', '预示', '预兆', '命中注定', '注定',
    '宿命', '天命', '往后', '今后', '此后', '从此以后', '终于',
    '结局', '结局是', '最终结局'
];

const ITERATIVE_FREQUENCY_MARKERS = [
    '每天', '每日', '天天', '每次', '每当', '常常', '经常', '总是',
    '时常', '往往', '日复一日', '年复一年', '周而复始', '循环往复',
    '时时', '每每', '一向', '一直', '一贯', '素来', '从来', '向来',
    '历来', '日日', '逐日'
];

const REPETITIVE_FREQUENCY_MARKERS = [
    '又一次', '再一次', '再次', '又', '再', '重复', '屡次', '屡屡',
    '再三', '一再', '频频', '频繁'
];

const DIALOGUE_CHARS = new Set(['"', '"', '「', '」', '『', '』', '“', '”']);

const DESCRIPTION_WORDS = [
    '看到', '听到', '闻到', '尝到', '摸到', '感觉', '仿佛', '似乎',
    '好像', '犹如', '宛如', '如同', '映入眼帘', '尽收眼底', '眺望',
    '凝视', '注视', '环视', '打量', '端详', '审视', '观察'
];

interface StructureTemplateDef {
    type: StructureTemplateType;
    name: string;
    nodes: Array<{
        name: string;
        position: number;
        tolerance: number;
        keywords: string[];
    }>;
}

const STRUCTURE_TEMPLATES: StructureTemplateDef[] = [
    {
        type: 'three_act',
        name: '三幕式',
        nodes: [
            {
                name: '建置',
                position: 0.12,
                tolerance: 0.12,
                keywords: ['开篇', '世界观', '登场', '背景', '初始', '开始', '介绍', '出生', '起源']
            },
            {
                name: '对抗',
                position: 0.5,
                tolerance: 0.25,
                keywords: ['冲突', '对抗', '战斗', '挑战', '危机', '斗争', '矛盾', '对决', '敌人', '困难']
            },
            {
                name: '解决',
                position: 0.9,
                tolerance: 0.1,
                keywords: ['解决', '收束', '结局', '圆满', '落幕', '结束', '最终', '胜利', '收尾']
            }
        ]
    },
    {
        type: 'hero_journey',
        name: '英雄之旅',
        nodes: [
            { name: '日常世界', position: 0.05, tolerance: 0.05, keywords: ['日常', '平凡', '生活', '家乡', '故乡'] },
            { name: '冒险召唤', position: 0.1, tolerance: 0.05, keywords: ['冒险', '召唤', '使命', '任务', '出发'] },
            { name: '拒绝召唤', position: 0.15, tolerance: 0.05, keywords: ['拒绝', '犹豫', '不愿', '害怕', '迟疑'] },
            { name: '导师相遇', position: 0.2, tolerance: 0.05, keywords: ['导师', '师父', '师傅', '老师', '前辈', '传授'] },
            { name: '跨越门槛', position: 0.25, tolerance: 0.05, keywords: ['出发', '启程', '踏入', '进入', '离开', '踏上'] },
            { name: '考验盟友敌人', position: 0.35, tolerance: 0.08, keywords: ['考验', '盟友', '朋友', '敌人', '伙伴', '队友'] },
            { name: '接近深处', position: 0.5, tolerance: 0.08, keywords: ['深入', '深处', '秘境', '洞穴', '黑暗', '危险'] },
            { name: '严峻考验', position: 0.65, tolerance: 0.08, keywords: ['考验', '危机', '生死', '险境', '绝境', '苦战'] },
            { name: '获得奖赏', position: 0.75, tolerance: 0.05, keywords: ['奖赏', '奖励', '获得', '收获', '得到', '宝物'] },
            { name: '回归之路', position: 0.85, tolerance: 0.05, keywords: ['回归', '回去', '返程', '返回', '回头'] },
            { name: '复活', position: 0.92, tolerance: 0.04, keywords: ['复活', '重生', '蜕变', '觉醒', '突破', '涅槃'] },
            { name: '携万能药回归', position: 0.97, tolerance: 0.03, keywords: ['回归', '带回', '万能药', '拯救', '救赎', '解药'] }
        ]
    },
    {
        type: 'kishotenketsu',
        name: '起承转合',
        nodes: [
            { name: '起', position: 0.12, tolerance: 0.12, keywords: ['开篇', '登场', '背景', '初始', '开始', '介绍'] },
            { name: '承', position: 0.37, tolerance: 0.12, keywords: ['发展', '推进', '升级', '展开', '延续', '深入'] },
            { name: '转', position: 0.62, tolerance: 0.12, keywords: ['转折', '高潮', '反转', '变故', '爆发', '危机'] },
            { name: '合', position: 0.87, tolerance: 0.12, keywords: ['结局', '收尾', '落幕', '结束', '圆满', '解决'] }
        ]
    },
    {
        type: 'save_the_cat',
        name: '救猫咪',
        nodes: [
            { name: '开场画面', position: 0.02, tolerance: 0.04, keywords: ['画面', '场景', '开篇', '开头', '序幕'] },
            { name: '主题陈述', position: 0.05, tolerance: 0.03, keywords: ['主题', '道理', '意义', '价值', '信念'] },
            { name: '布局', position: 0.1, tolerance: 0.05, keywords: ['布局', '铺垫', '设定', '背景', '环境'] },
            { name: '触发事件', position: 0.15, tolerance: 0.05, keywords: ['触发', '突然', '变故', '意外', '发生', '出现'] },
            { name: '犹豫', position: 0.2, tolerance: 0.04, keywords: ['犹豫', '迟疑', '纠结', '挣扎', '不愿'] },
            { name: '第二幕开始', position: 0.25, tolerance: 0.05, keywords: ['进入', '踏上', '开始', '启程', '出发'] },
            { name: 'B故事', position: 0.3, tolerance: 0.05, keywords: ['感情', '友情', '爱情', '副线', '另一条'] },
            { name: '乐趣游戏', position: 0.4, tolerance: 0.08, keywords: ['乐趣', '冒险', '探索', '体验', '奇遇'] },
            { name: '中点', position: 0.5, tolerance: 0.05, keywords: ['中点', '转折', '变化', '升级', '提升'] },
            { name: '坏人逼近', position: 0.6, tolerance: 0.06, keywords: ['坏人', '敌人', '反派', '对手', '逼近', '威胁'] },
            { name: '一无所有', position: 0.7, tolerance: 0.05, keywords: ['失去', '一无所有', '失败', '绝望', '崩溃', '跌入谷底'] },
            { name: '灵魂黑夜', position: 0.75, tolerance: 0.04, keywords: ['黑夜', '黑暗', '反思', '绝望', '痛苦', '挣扎'] },
            { name: '第三幕开始', position: 0.8, tolerance: 0.04, keywords: ['觉醒', '觉悟', '重新', '振作'] },
            { name: '高潮', position: 0.9, tolerance: 0.05, keywords: ['高潮', '对决', '决战', '最终', '巅峰', '胜负'] },
            { name: '终场画面', position: 0.97, tolerance: 0.03, keywords: ['终场', '结局', '落幕', '圆满', '结束', '尾声'] }
        ]
    },
    {
        type: 'webnovel_formula',
        name: '网文公式',
        nodes: [
            { name: '穿越/重生', position: 0.03, tolerance: 0.04, keywords: ['穿越', '重生', '转世', '降生', '醒来', '异世界'] },
            { name: '金手指激活', position: 0.07, tolerance: 0.04, keywords: ['系统', '金手指', '觉醒', '激活', '解锁', '开启', '外挂', '签到'] },
            { name: '初次冲突', position: 0.15, tolerance: 0.05, keywords: ['冲突', '挑衅', '敌人', '对手', '羞辱', '为难'] },
            { name: '打脸', position: 0.25, tolerance: 0.05, keywords: ['打脸', '震惊', '不可思议', '难以置信', '出乎意料', '反转'] },
            { name: '升级', position: 0.4, tolerance: 0.1, keywords: ['升级', '突破', '进阶', '提升', '变强', '修炼', '境界'] },
            { name: '大高潮', position: 0.6, tolerance: 0.1, keywords: ['高潮', '决战', '对决', '巅峰', '激战', '大战'] },
            { name: '转折', position: 0.75, tolerance: 0.05, keywords: ['转折', '变故', '反转', '意外', '转折点'] },
            { name: '终极对决', position: 0.9, tolerance: 0.08, keywords: ['终极', '最终', '最后', '决战', '最强', '终战'] }
        ]
    }
];

export class StructureDeconstructor {
    private mainLineSet: Set<string>;
    private subLineSet: Set<string>;
    private romanceSet: Set<string>;
    private vectorEnhancer?: VectorEnhancer;
    private readonly vectorThreshold = 0.3;
    private readonly keywordWeight = 0.5;
    private readonly vectorWeight = 0.5;

    constructor(vectorEnhancer?: VectorEnhancer) {
        this.mainLineSet = new Set(MAIN_LINE_KEYWORDS);
        this.subLineSet = new Set(SUB_LINE_KEYWORDS);
        this.romanceSet = new Set(ROMANCE_KEYWORDS);
        this.vectorEnhancer = vectorEnhancer;
    }

    async analyze(text: string): Promise<StructureAnalysisResult> {
        if (!text || text.length === 0) {
            return this.getEmptyResult();
        }

        const totalLength = text.length;
        const rhythmUnits = this.detectRhythmUnits(text, totalLength);
        const chapters = rhythmUnits.filter(u => u.level === 'chapter');
        const volumes = rhythmUnits.filter(u => u.level === 'volume');
        await yieldToUI();

        const qcchSegments = this.detectQCCHSegments(text, totalLength, chapters);
        const threeLineStructure = this.analyzeThreeLineStructure(text, totalLength, chapters);
        await yieldToUI();

        const narrativeTemporality = this.analyzeNarrativeTemporality(text, totalLength);
        await yieldToUI();

        const templateMatch = this.matchStructureTemplates(text, totalLength, qcchSegments);
        await yieldToUI();

        const structureType = this.determineStructureType(qcchSegments, rhythmUnits);

        const totalWordCount = this.countWords(text);
        const chapterCount = chapters.length;
        const avgChapterWordCount = chapterCount > 0
            ? Math.round(chapters.reduce((sum, c) => sum + c.wordCount, 0) / chapterCount)
            : 0;

        return {
            qcchSegments,
            rhythmUnits,
            threeLineStructure,
            structureType,
            stats: {
                volumeCount: volumes.length,
                chapterCount,
                avgChapterWordCount,
                totalWordCount
            },
            narrativeTemporality,
            templateMatch
        };
    }

    async analyzeWithVector(text: string): Promise<StructureAnalysisResult> {
        const baseResult = await this.analyze(text);
        await yieldToUI();

        if (!this.vectorEnhancer || !text || text.length === 0) {
            return baseResult;
        }

        try {
            const available = await this.vectorEnhancer.isAvailable();
            if (!available) {
                log.warn('[StructureDeconstructor] 向量模型不可用，返回纯统计结果');
                return baseResult;
            }
        } catch (e) {
            log.warn('[StructureDeconstructor] 向量增强不可用，降级为纯统计', e);
            return baseResult;
        }

        let enhancedResult = { ...baseResult };

        try {
            await yieldToUI();
            enhancedResult.threeLineStructure = await this.enhanceThreeLineStructure(text, baseResult);
        } catch (e) {
            log.warn('[StructureDeconstructor] 三线结构向量增强失败', e);
        }

        try {
            await yieldToUI();
            enhancedResult.qcchSegments = await this.enhanceQCCHSegments(text, baseResult);
        } catch (e) {
            log.warn('[StructureDeconstructor] 起承转合向量增强失败', e);
        }

        try {
            await yieldToUI();
            enhancedResult.structureType = await this.enhanceStructureType(text, baseResult);
        } catch (e) {
            log.warn('[StructureDeconstructor] 结构类型向量增强失败', e);
        }

        return enhancedResult;
    }

    private async enhanceThreeLineStructure(
        text: string,
        baseResult: StructureAnalysisResult
    ): Promise<ThreeLineStructure> {
        const paragraphs = this.splitParagraphs(text);
        if (paragraphs.length < 5) return baseResult.threeLineStructure;

        const MAX_SEGMENTS = 50;
        const MAX_SEGMENT_CHARS = 2000;
        const segmentSize = Math.max(1, Math.floor(paragraphs.length / 15));
        let segments: string[] = [];
        let positions: number[] = [];

        for (let i = 0; i < paragraphs.length; i += segmentSize) {
            const endIdx = Math.min(i + segmentSize, paragraphs.length);
            let segmentText = paragraphs.slice(i, endIdx).join(' ');
            if (segmentText.length > MAX_SEGMENT_CHARS) {
                segmentText = segmentText.slice(0, MAX_SEGMENT_CHARS);
            }
            if (segmentText.length > 0) {
                segments.push(segmentText);
                positions.push(i / paragraphs.length);
            }
        }

        // 分段数硬上限 50，超出时均匀采样
        if (segments.length > MAX_SEGMENTS) {
            const sampledSegments: string[] = [];
            const sampledPositions: number[] = [];
            const step = segments.length / MAX_SEGMENTS;
            for (let i = 0; i < MAX_SEGMENTS; i++) {
                const idx = Math.min(segments.length - 1, Math.floor(i * step));
                sampledSegments.push(segments[idx]);
                sampledPositions.push(positions[idx]);
            }
            segments = sampledSegments;
            positions = sampledPositions;
        }

        if (segments.length === 0) return baseResult.threeLineStructure;

        const allTexts = [MAIN_LINE_REFERENCE, SUB_LINE_REFERENCE, ROMANCE_LINE_REFERENCE, ...segments];
        const allVectors = await this.vectorEnhancer!.embedTexts(allTexts);

        const mainRefVec = allVectors[0];
        const subRefVec = allVectors[1];
        const romanceRefVec = allVectors[2];
        const segmentVectors = allVectors.slice(3);

        const mainLineScores: Array<{ position: number; score: number }> = [];
        const subLineScores: Array<{ position: number; score: number }> = [];
        const romanceLineScores: Array<{ position: number; score: number }> = [];

        for (let i = 0; i < segments.length; i++) {
            const segVec = segmentVectors[i];
            const mainSim = this.vectorEnhancer!.cosineSimilarity(segVec, mainRefVec);
            const subSim = this.vectorEnhancer!.cosineSimilarity(segVec, subRefVec);
            const romanceSim = this.vectorEnhancer!.cosineSimilarity(segVec, romanceRefVec);

            const maxSim = Math.max(mainSim, subSim, romanceSim);
            const normMain = maxSim > 0 ? mainSim / maxSim : 0;
            const normSub = maxSim > 0 ? subSim / maxSim : 0;
            const normRomance = maxSim > 0 ? romanceSim / maxSim : 0;

            mainLineScores.push({ position: positions[i], score: this.clamp01(normMain) });
            subLineScores.push({ position: positions[i], score: this.clamp01(normSub) });
            romanceLineScores.push({ position: positions[i], score: this.clamp01(normRomance) });
        }

        const mainKeyNodes = this.extractKeyNodes(mainLineScores, '主线（语义增强）');
        const subKeyNodes = this.extractKeyNodes(subLineScores, '副线（语义增强）');
        const romanceKeyNodes = this.extractKeyNodes(romanceLineScores, '感情线（语义增强）');

        const mainAvg = mainLineScores.reduce((a, b) => a + b.score, 0) / mainLineScores.length;
        const subAvg = subLineScores.reduce((a, b) => a + b.score, 0) / subLineScores.length;
        const romanceAvg = romanceLineScores.reduce((a, b) => a + b.score, 0) / romanceLineScores.length;

        return {
            mainLine: {
                description: `主线强度：${(mainAvg * 100).toFixed(1)}%，共 ${mainKeyNodes.length} 个关键节点（语义增强）`,
                keyNodes: mainKeyNodes
            },
            subLine: {
                description: `副线强度：${(subAvg * 100).toFixed(1)}%，共 ${subKeyNodes.length} 个关键节点（语义增强）`,
                keyNodes: subKeyNodes
            },
            romanceLine: {
                description: `感情线强度：${(romanceAvg * 100).toFixed(1)}%，共 ${romanceKeyNodes.length} 个关键节点（语义增强）`,
                keyNodes: romanceKeyNodes
            }
        };
    }

    private async enhanceQCCHSegments(
        text: string,
        baseResult: StructureAnalysisResult
    ): Promise<QCCHSegment[]> {
        if (baseResult.qcchSegments.length === 0) return baseResult.qcchSegments;

        const chapters = baseResult.rhythmUnits.filter(u => u.level === 'chapter');
        if (chapters.length === 0) return baseResult.qcchSegments;

        const MAX_CHAPTERS = 50;
        const MAX_CHAPTER_CHARS = 2000;
        let chapterTexts: string[] = [];
        let chapterPositions: number[] = [];

        for (const chapter of chapters) {
            const startIdx = Math.floor(chapter.startPosition * text.length);
            const endIdx = Math.floor(chapter.endPosition * text.length);
            let chapterText = text.substring(startIdx, endIdx);
            if (chapterText.length > MAX_CHAPTER_CHARS) {
                chapterText = chapterText.slice(0, MAX_CHAPTER_CHARS);
            }
            if (chapterText.length > 0) {
                chapterTexts.push(chapterText);
                chapterPositions.push(chapter.startPosition);
            }
        }

        // 章节数硬上限 50，超出时均匀采样
        if (chapterTexts.length > MAX_CHAPTERS) {
            const sampledTexts: string[] = [];
            const sampledPositions: number[] = [];
            const step = chapterTexts.length / MAX_CHAPTERS;
            for (let i = 0; i < MAX_CHAPTERS; i++) {
                const idx = Math.min(chapterTexts.length - 1, Math.floor(i * step));
                sampledTexts.push(chapterTexts[idx]);
                sampledPositions.push(chapterPositions[idx]);
            }
            chapterTexts = sampledTexts;
            chapterPositions = sampledPositions;
        }

        if (chapterTexts.length === 0) return baseResult.qcchSegments;

        const refTexts = QCCH_REFERENCES.map(r => r.text);
        const allTexts = [...refTexts, ...chapterTexts];
        const allVectors = await this.vectorEnhancer!.embedTexts(allTexts);

        const refVectors = allVectors.slice(0, refTexts.length);
        const chapterVectors = allVectors.slice(refTexts.length);

        const chapterQCCHScores: Array<{ position: number; scores: number[] }> = [];
        for (let i = 0; i < chapterTexts.length; i++) {
            const scores: number[] = [];
            for (let j = 0; j < refVectors.length; j++) {
                scores.push(this.vectorEnhancer!.cosineSimilarity(chapterVectors[i], refVectors[j]));
            }
            chapterQCCHScores.push({ position: chapterPositions[i], scores });
        }

        chapterQCCHScores.sort((a, b) => a.position - b.position);

        const qiThreshold = 0.3;
        const chengThreshold = 0.3;
        const zhuanThreshold = 0.35;

        let qiEnd = baseResult.qcchSegments[0].endPosition;
        let chengEnd = baseResult.qcchSegments[1].endPosition;
        let zhuanEnd = baseResult.qcchSegments[2].endPosition;

        const qiScores = chapterQCCHScores.map(c => c.scores[0]);
        const chengScores = chapterQCCHScores.map(c => c.scores[1]);
        const zhuanScores = chapterQCCHScores.map(c => c.scores[2]);
        const heScores = chapterQCCHScores.map(c => c.scores[3]);

        const qiChengCrossing = this.findScoreCrossing(qiScores, chengScores, chapterQCCHScores);
        if (qiChengCrossing !== null && qiChengCrossing > 0.05 && qiChengCrossing < 0.4) {
            qiEnd = qiChengCrossing;
        }

        const chengZhuanCrossing = this.findScoreCrossing(chengScores, zhuanScores, chapterQCCHScores);
        if (chengZhuanCrossing !== null && chengZhuanCrossing > qiEnd + 0.1 && chengZhuanCrossing < 0.7) {
            chengEnd = chengZhuanCrossing;
        }

        const zhuanHeCrossing = this.findScoreCrossing(zhuanScores, heScores, chapterQCCHScores);
        if (zhuanHeCrossing !== null && zhuanHeCrossing > chengEnd + 0.1 && zhuanHeCrossing < 0.95) {
            zhuanEnd = zhuanHeCrossing;
        }

        qiEnd = this.clamp01(qiEnd);
        chengEnd = this.clamp01(Math.max(qiEnd + 0.05, chengEnd));
        zhuanEnd = this.clamp01(Math.max(chengEnd + 0.05, zhuanEnd));

        const qiChapterRange = this.findChapterRange(0, qiEnd, chapters);
        const chengChapterRange = this.findChapterRange(qiEnd, chengEnd, chapters);
        const zhuanChapterRange = this.findChapterRange(chengEnd, zhuanEnd, chapters);
        const heChapterRange = this.findChapterRange(zhuanEnd, 1, chapters);

        return [
            {
                type: '起',
                startPosition: 0,
                endPosition: qiEnd,
                chapterRange: qiChapterRange,
                description: '起：开篇铺垫，世界观建立，人物登场，初始冲突引入（语义增强）'
            },
            {
                type: '承',
                startPosition: qiEnd,
                endPosition: chengEnd,
                chapterRange: chengChapterRange,
                description: '承：剧情发展，主线推进，矛盾升级，人物关系展开（语义增强）'
            },
            {
                type: '转',
                startPosition: chengEnd,
                endPosition: zhuanEnd,
                chapterRange: zhuanChapterRange,
                description: '转：高潮转折，核心冲突爆发，剧情反转，全书最高潮（语义增强）'
            },
            {
                type: '合',
                startPosition: zhuanEnd,
                endPosition: 1,
                chapterRange: heChapterRange,
                description: '合：结局收尾，冲突解决，人物归宿，余韵悠长（语义增强）'
            }
        ];
    }

    private findScoreCrossing(
        scoresA: number[],
        scoresB: number[],
        positions: Array<{ position: number; scores: number[] }>
    ): number | null {
        if (scoresA.length !== scoresB.length || scoresA.length < 3) return null;

        for (let i = 1; i < scoresA.length; i++) {
            if (scoresA[i - 1] >= scoresB[i - 1] && scoresA[i] < scoresB[i]) {
                const t = (scoresB[i - 1] - scoresA[i - 1]) / ((scoresA[i] - scoresA[i - 1]) - (scoresB[i] - scoresB[i - 1]) + 1e-10);
                const pos = positions[i - 1].position + t * (positions[i].position - positions[i - 1].position);
                return this.clamp01(pos);
            }
        }
        return null;
    }

    private async enhanceStructureType(
        text: string,
        baseResult: StructureAnalysisResult
    ): Promise<string> {
        const sampleText = text.slice(0, Math.min(3000, text.length));
        if (sampleText.length < 100) return baseResult.structureType;

        const refTexts = STRUCTURE_TYPE_REFERENCES.map(r => r.text);
        const allTexts = [...refTexts, sampleText];
        const allVectors = await this.vectorEnhancer!.embedTexts(allTexts);

        const refVectors = allVectors.slice(0, refTexts.length);
        const sampleVec = allVectors[allVectors.length - 1];

        let bestType = baseResult.structureType;
        let bestScore = -1;

        for (let i = 0; i < STRUCTURE_TYPE_REFERENCES.length; i++) {
            const score = this.vectorEnhancer!.cosineSimilarity(sampleVec, refVectors[i]);
            if (score > bestScore) {
                bestScore = score;
                bestType = STRUCTURE_TYPE_REFERENCES[i].type;
            }
        }

        if (bestScore >= this.vectorThreshold) {
            return `${bestType}（语义确认）`;
        }
        return baseResult.structureType;
    }

    async saveToMarkdown(
        app: { vault: { adapter: { exists: (p: string) => Promise<boolean>; mkdir: (p: string) => Promise<void>; write: (p: string, d: string) => Promise<void> } } },
        bookName: string,
        baseDir?: string
    ): Promise<void> {
        const filePath = kbBookStructureBreakdownFile(bookName, baseDir);
        const result = await this.analyze('');

        const frontmatter = this.buildFrontmatter(result);
        const body = this.buildMarkdownBody(result, bookName);
        const content = `---\n${frontmatter}\n---\n\n${body}`;

        const dirPath = filePath.substring(0, filePath.lastIndexOf('/'));
        if (!(await app.vault.adapter.exists(dirPath))) {
            await app.vault.adapter.mkdir(dirPath);
        }

        await app.vault.adapter.write(filePath, content);
    }

    async saveAnalysisToMarkdown(
        app: { vault: { adapter: { exists: (p: string) => Promise<boolean>; mkdir: (p: string) => Promise<void>; write: (p: string, d: string) => Promise<void> } } },
        bookName: string,
        result: StructureAnalysisResult,
        baseDir?: string
    ): Promise<void> {
        const filePath = kbBookStructureBreakdownFile(bookName, baseDir);

        const frontmatter = this.buildFrontmatter(result);
        const body = this.buildMarkdownBody(result, bookName);
        const content = `---\n${frontmatter}\n---\n\n${body}`;

        const dirPath = filePath.substring(0, filePath.lastIndexOf('/'));
        if (!(await app.vault.adapter.exists(dirPath))) {
            await app.vault.adapter.mkdir(dirPath);
        }

        await app.vault.adapter.write(filePath, content);
    }

    private getEmptyResult(): StructureAnalysisResult {
        return {
            qcchSegments: [],
            rhythmUnits: [],
            threeLineStructure: {
                mainLine: { description: '', keyNodes: [] },
                subLine: { description: '', keyNodes: [] },
                romanceLine: { description: '', keyNodes: [] }
            },
            structureType: '未知结构',
            stats: {
                volumeCount: 0,
                chapterCount: 0,
                avgChapterWordCount: 0,
                totalWordCount: 0
            },
            narrativeTemporality: {
                order: {
                    type: 'chronological',
                    flashbacks: [],
                    flashforwards: [],
                    confidence: 0
                },
                duration: {
                    distribution: { scene: 0, summary: 0, pause: 0, ellipsis: 0, stretch: 0 },
                    dominantType: 'summary',
                    description: '文本为空，无法分析时长分布'
                },
                frequency: {
                    type: 'singulative',
                    repetitiveEvents: [],
                    description: '文本为空，无法分析频率'
                },
                description: '文本为空，无法分析叙事时序'
            },
            templateMatch: {
                bestMatch: {
                    template: 'custom',
                    matchScore: 0,
                    matchedNodes: [],
                    missingNodes: [],
                    description: '文本为空，无法匹配模板'
                },
                allMatches: [],
                description: '文本为空，无法匹配模板'
            }
        };
    }

    private detectRhythmUnits(text: string, totalLength: number): RhythmUnit[] {
        const units: RhythmUnit[] = [];

        const volumePattern = /第[一二三四五六七八九十百千零\d]+卷[^\n\r]*/g;
        const chapterPattern = /第[一二三四五六七八九十百千零\d]+章[^\n\r]*/g;
        const sectionPattern = /第[一二三四五六七八九十百千零\d]+节[^\n\r]*/g;

        const volumes = this.extractUnits(text, volumePattern, 'volume', totalLength);
        const chapters = this.extractUnits(text, chapterPattern, 'chapter', totalLength);
        const sections = this.extractUnits(text, sectionPattern, 'section', totalLength);

        units.push(...volumes, ...chapters, ...sections);
        units.sort((a, b) => a.startPosition - b.startPosition);

        return units;
    }

    private extractUnits(
        text: string,
        pattern: RegExp,
        level: 'volume' | 'chapter' | 'section',
        totalLength: number
    ): RhythmUnit[] {
        const units: RhythmUnit[] = [];
        let match;
        let index = 0;
        let lastEndIndex = 0;

        const matches: { startIndex: number; endIndex: number; title: string }[] = [];
        while ((match = pattern.exec(text)) !== null) {
            matches.push({
                startIndex: match.index,
                endIndex: match.index + match[0].length,
                title: match[0].trim()
            });
        }

        for (let i = 0; i < matches.length; i++) {
            const m = matches[i];
            const startPos = totalLength > 0 ? m.startIndex / totalLength : 0;
            const endPos = i < matches.length - 1
                ? (totalLength > 0 ? matches[i + 1].startIndex / totalLength : 0)
                : 1;

            const unitStart = m.startIndex;
            const unitEnd = i < matches.length - 1 ? matches[i + 1].startIndex : text.length;
            const unitText = text.substring(unitStart, unitEnd);
            const wordCount = this.countWords(unitText);

            units.push({
                level,
                index: index++,
                title: m.title,
                startPosition: this.clamp01(startPos),
                endPosition: this.clamp01(endPos),
                wordCount
            });
        }

        return units;
    }

    private detectQCCHSegments(
        text: string,
        totalLength: number,
        chapters: RhythmUnit[]
    ): QCCHSegment[] {
        const segments: QCCHSegment[] = [];
        const paragraphs = this.splitParagraphs(text);

        const rhythmCurve = this.calculateSimpleRhythmCurve(paragraphs, text, totalLength);

        if (rhythmCurve.length < 10) {
            return this.getDefaultQCCHSegments(chapters);
        }

        const rhythmValues = rhythmCurve.map(p => p.intensity);
        const mean = rhythmValues.reduce((a, b) => a + b, 0) / rhythmValues.length;
        const std = Math.sqrt(rhythmValues.reduce((a, b) => a + (b - mean) ** 2, 0) / rhythmValues.length);

        let qiEnd = 0.2;
        let chengEnd = 0.5;
        let zhuanEnd = 0.8;

        const firstQuarterAvg = rhythmValues.slice(0, Math.floor(rhythmValues.length * 0.25))
            .reduce((a, b) => a + b, 0) / Math.floor(rhythmValues.length * 0.25);
        const midAvg = rhythmValues.slice(Math.floor(rhythmValues.length * 0.25), Math.floor(rhythmValues.length * 0.5))
            .reduce((a, b) => a + b, 0) / Math.floor(rhythmValues.length * 0.25);
        const thirdQuarterAvg = rhythmValues.slice(Math.floor(rhythmValues.length * 0.5), Math.floor(rhythmValues.length * 0.75))
            .reduce((a, b) => a + b, 0) / Math.floor(rhythmValues.length * 0.25);

        const peakThreshold = mean + std * 0.5;
        const peakPoints = rhythmCurve.filter(p => p.intensity > peakThreshold);
        let peakPos = 0.75;
        if (peakPoints.length > 0) {
            const topPeaks = peakPoints.sort((a, b) => b.intensity - a.intensity)
                .slice(0, Math.max(1, Math.floor(peakPoints.length * 0.3)));
            peakPos = topPeaks.reduce((a, b) => a + b.position, 0) / topPeaks.length;
            peakPos = Math.max(0.5, Math.min(0.95, peakPos));
        }

        if (firstQuarterAvg < mean - std * 0.3) {
            qiEnd = 0.25;
        } else if (firstQuarterAvg > mean + std * 0.3) {
            qiEnd = 0.15;
        }

        if (midAvg > mean) {
            chengEnd = Math.min(0.45, peakPos - 0.2);
        } else {
            chengEnd = Math.min(0.55, peakPos - 0.15);
        }

        zhuanEnd = Math.min(0.95, peakPos + 0.1);

        const qiChapterRange = this.findChapterRange(0, qiEnd, chapters);
        const chengChapterRange = this.findChapterRange(qiEnd, chengEnd, chapters);
        const zhuanChapterRange = this.findChapterRange(chengEnd, zhuanEnd, chapters);
        const heChapterRange = this.findChapterRange(zhuanEnd, 1, chapters);

        segments.push({
            type: '起',
            startPosition: 0,
            endPosition: qiEnd,
            chapterRange: qiChapterRange,
            description: '起：开篇铺垫，世界观建立，人物登场，初始冲突引入'
        });

        segments.push({
            type: '承',
            startPosition: qiEnd,
            endPosition: chengEnd,
            chapterRange: chengChapterRange,
            description: '承：剧情发展，主线推进，矛盾升级，人物关系展开'
        });

        segments.push({
            type: '转',
            startPosition: chengEnd,
            endPosition: zhuanEnd,
            chapterRange: zhuanChapterRange,
            description: '转：高潮转折，核心冲突爆发，剧情反转，全书最高潮'
        });

        segments.push({
            type: '合',
            startPosition: zhuanEnd,
            endPosition: 1,
            chapterRange: heChapterRange,
            description: '合：结局收尾，冲突解决，人物归宿，余韵悠长'
        });

        return segments;
    }

    private getDefaultQCCHSegments(chapters: RhythmUnit[]): QCCHSegment[] {
        const total = chapters.length;
        return [
            {
                type: '起',
                startPosition: 0,
                endPosition: 0.2,
                chapterRange: total > 0 ? [0, Math.floor(total * 0.2)] : undefined,
                description: '起：开篇铺垫，世界观建立，人物登场，初始冲突引入'
            },
            {
                type: '承',
                startPosition: 0.2,
                endPosition: 0.5,
                chapterRange: total > 0 ? [Math.floor(total * 0.2), Math.floor(total * 0.5)] : undefined,
                description: '承：剧情发展，主线推进，矛盾升级，人物关系展开'
            },
            {
                type: '转',
                startPosition: 0.5,
                endPosition: 0.8,
                chapterRange: total > 0 ? [Math.floor(total * 0.5), Math.floor(total * 0.8)] : undefined,
                description: '转：高潮转折，核心冲突爆发，剧情反转，全书最高潮'
            },
            {
                type: '合',
                startPosition: 0.8,
                endPosition: 1,
                chapterRange: total > 0 ? [Math.floor(total * 0.8), total - 1] : undefined,
                description: '合：结局收尾，冲突解决，人物归宿，余韵悠长'
            }
        ];
    }

    private findChapterRange(
        startPos: number,
        endPos: number,
        chapters: RhythmUnit[]
    ): [number, number] | undefined {
        if (chapters.length === 0) return undefined;

        let startIdx = 0;
        let endIdx = chapters.length - 1;

        for (let i = 0; i < chapters.length; i++) {
            if (chapters[i].startPosition >= startPos) {
                startIdx = i;
                break;
            }
        }

        for (let i = chapters.length - 1; i >= 0; i--) {
            if (chapters[i].endPosition <= endPos) {
                endIdx = i;
                break;
            }
        }

        return [startIdx, endIdx];
    }

    private calculateSimpleRhythmCurve(
        paragraphs: string[],
        fullText: string,
        totalLength: number
    ): Array<{ position: number; intensity: number }> {
        const curve: Array<{ position: number; intensity: number }> = [];
        let charOffset = 0;

        for (let i = 0; i < paragraphs.length; i++) {
            const para = paragraphs[i];
            const paraStart = fullText.indexOf(para, charOffset);
            const position = totalLength > 0 ? paraStart / totalLength : 0;
            const wordCount = this.countWords(para);

            const emotionIntensity = this.calculateEmotionIntensity(para, wordCount);
            const actionDensity = this.calculateActionDensity(para, wordCount);
            const intensity = 0.6 * emotionIntensity + 0.4 * actionDensity;

            curve.push({
                position: this.clamp01(position),
                intensity: this.clamp01(intensity)
            });

            charOffset = paraStart + para.length;
        }

        return this.smoothSimpleCurve(curve);
    }

    private smoothSimpleCurve(
        curve: Array<{ position: number; intensity: number }>
    ): Array<{ position: number; intensity: number }> {
        if (curve.length < 3) return curve;

        const smoothed: Array<{ position: number; intensity: number }> = [];
        const windowSize = Math.min(5, Math.floor(curve.length / 10));

        for (let i = 0; i < curve.length; i++) {
            let sumIntensity = 0;
            let count = 0;

            for (let j = Math.max(0, i - windowSize); j <= Math.min(curve.length - 1, i + windowSize); j++) {
                const weight = 1 - Math.abs(j - i) / (windowSize + 1);
                sumIntensity += curve[j].intensity * weight;
                count += weight;
            }

            smoothed.push({
                position: curve[i].position,
                intensity: sumIntensity / count
            });
        }

        return smoothed;
    }

    private analyzeThreeLineStructure(
        text: string,
        totalLength: number,
        chapters: RhythmUnit[]
    ): ThreeLineStructure {
        const paragraphs = this.splitParagraphs(text);
        const segmentCount = Math.max(10, Math.floor(paragraphs.length / 20));

        const mainLineScores: Array<{ position: number; score: number }> = [];
        const subLineScores: Array<{ position: number; score: number }> = [];
        const romanceLineScores: Array<{ position: number; score: number }> = [];

        const segmentSize = Math.max(1, Math.floor(paragraphs.length / segmentCount));

        for (let i = 0; i < segmentCount; i++) {
            const startIdx = i * segmentSize;
            const endIdx = Math.min(startIdx + segmentSize, paragraphs.length);
            const segmentParas = paragraphs.slice(startIdx, endIdx);
            const segmentText = segmentParas.join(' ');
            const wordCount = this.countWords(segmentText);

            const position = ((startIdx + endIdx) / 2) / paragraphs.length;

            const mainScore = this.countWordOccurrences(segmentText, this.mainLineSet) / Math.max(wordCount * 0.02, 1);
            const subScore = this.countWordOccurrences(segmentText, this.subLineSet) / Math.max(wordCount * 0.02, 1);
            const romanceScore = this.countWordOccurrences(segmentText, this.romanceSet) / Math.max(wordCount * 0.02, 1);

            mainLineScores.push({ position, score: this.clamp01(mainScore) });
            subLineScores.push({ position, score: this.clamp01(subScore) });
            romanceLineScores.push({ position, score: this.clamp01(romanceScore) });
        }

        const mainKeyNodes = this.extractKeyNodes(mainLineScores, '主线');
        const subKeyNodes = this.extractKeyNodes(subLineScores, '副线');
        const romanceKeyNodes = this.extractKeyNodes(romanceLineScores, '感情线');

        const mainAvg = mainLineScores.reduce((a, b) => a + b.score, 0) / mainLineScores.length;
        const subAvg = subLineScores.reduce((a, b) => a + b.score, 0) / subLineScores.length;
        const romanceAvg = romanceLineScores.reduce((a, b) => a + b.score, 0) / romanceLineScores.length;

        return {
            mainLine: {
                description: `主线强度：${(mainAvg * 100).toFixed(1)}%，共 ${mainKeyNodes.length} 个关键节点`,
                keyNodes: mainKeyNodes
            },
            subLine: {
                description: `副线强度：${(subAvg * 100).toFixed(1)}%，共 ${subKeyNodes.length} 个关键节点`,
                keyNodes: subKeyNodes
            },
            romanceLine: {
                description: `感情线强度：${(romanceAvg * 100).toFixed(1)}%，共 ${romanceKeyNodes.length} 个关键节点`,
                keyNodes: romanceKeyNodes
            }
        };
    }

    private extractKeyNodes(
        scores: Array<{ position: number; score: number }>,
        lineType: string
    ): Array<{ position: number; description: string }> {
        if (scores.length < 3) return [];

        const nodes: Array<{ position: number; description: string }> = [];
        const values = scores.map(s => s.score);
        const mean = values.reduce((a, b) => a + b, 0) / values.length;
        const std = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length);

        nodes.push({
            position: scores[0].position,
            description: `${lineType}起点`
        });

        const peakThreshold = mean + std * 0.5;
        let lastPeakPos = -1;

        for (let i = 1; i < scores.length - 1; i++) {
            const prev = scores[i - 1].score;
            const curr = scores[i].score;
            const next = scores[i + 1].score;

            if (curr > prev && curr > next && curr > peakThreshold) {
                if (lastPeakPos < 0 || scores[i].position - lastPeakPos > 0.15) {
                    nodes.push({
                        position: scores[i].position,
                        description: `${lineType}高潮点（强度：${(curr * 100).toFixed(0)}%）`
                    });
                    lastPeakPos = scores[i].position;
                }
            }
        }

        nodes.push({
            position: scores[scores.length - 1].position,
            description: `${lineType}终点`
        });

        return nodes;
    }

    private determineStructureType(
        qcchSegments: QCCHSegment[],
        rhythmUnits: RhythmUnit[]
    ): string {
        const volumes = rhythmUnits.filter(u => u.level === 'volume');
        const chapters = rhythmUnits.filter(u => u.level === 'chapter');

        if (volumes.length >= 3 && chapters.length >= 50) {
            return '长篇多卷结构';
        } else if (volumes.length >= 2 || chapters.length >= 30) {
            return '中长篇结构';
        } else if (chapters.length >= 10) {
            return '中篇结构';
        } else if (chapters.length >= 3) {
            return '短篇分章结构';
        } else {
            return '短篇单篇结构';
        }
    }

    private analyzeNarrativeTemporality(text: string, totalLength: number): NarrativeTemporalityResult {
        const paragraphs = this.splitParagraphs(text);
        const analepticSet = new Set(ANALEPTIC_MARKERS);
        const prolepticSet = new Set(PROLEPTIC_MARKERS);

        const flashbacks: Array<{ position: number; targetPosition: number; description: string }> = [];
        const flashforwards: Array<{ position: number; targetPosition: number; description: string }> = [];

        let analepticCount = 0;
        let prolepticCount = 0;

        let charOffset = 0;
        for (const para of paragraphs) {
            const paraStart = charOffset === 0 ? text.indexOf(para, 0) : text.indexOf(para, Math.max(0, charOffset - 1));
            const safeStart = paraStart === -1 ? charOffset : paraStart;
            const position = totalLength > 0 ? safeStart / totalLength : 0;

            const analepticHits = this.countWordOccurrences(para, analepticSet);
            const prolepticHits = this.countWordOccurrences(para, prolepticSet);

            if (analepticHits > 0) {
                analepticCount += analepticHits;
                const matchedWord = this.findFirstMatch(para, ANALEPTIC_MARKERS);
                const targetPosition = this.clamp01(position * 0.5);
                flashbacks.push({
                    position: this.clamp01(position),
                    targetPosition,
                    description: `倒叙：${matchedWord || '回忆性叙述'}`
                });
            }

            if (prolepticHits > 0) {
                prolepticCount += prolepticHits;
                const matchedWord = this.findFirstMatch(para, PROLEPTIC_MARKERS);
                const targetPosition = this.clamp01((position + 1) / 2);
                flashforwards.push({
                    position: this.clamp01(position),
                    targetPosition,
                    description: `预叙：${matchedWord || '前瞻性叙述'}`
                });
            }

            charOffset = safeStart + para.length;
        }

        let orderType: NarrativeOrder;
        if (analepticCount > 0 && prolepticCount > 0) {
            orderType = 'mixed';
        } else if (analepticCount > 0) {
            orderType = 'analeptic';
        } else if (prolepticCount > 0) {
            orderType = 'proleptic';
        } else {
            orderType = 'chronological';
        }

        const totalMarkers = analepticCount + prolepticCount;
        const orderConfidence = totalMarkers > 0
            ? this.clamp01(Math.min(1, totalMarkers / 20))
            : 0.5;

        const durationDistribution: Record<NarrativeDuration, number> = {
            scene: 0,
            summary: 0,
            pause: 0,
            ellipsis: 0,
            stretch: 0
        };

        const timeJumpWords = SHOW_TELL_WORDS.tell.timeJump;
        const timeJumpSet = new Set(timeJumpWords);
        const descriptionSet = new Set(DESCRIPTION_WORDS);
        const stretchSet = new Set(NARRATIVE_TEMPORALITY_WORDS.duration);

        for (const para of paragraphs) {
            const wordCount = this.countWords(para);
            const dialogueDensity = this.calculateDialogueDensity(para);
            const descriptionDensity = this.countWordOccurrences(para, descriptionSet) / Math.max(wordCount, 1);
            const timeJumpDensity = this.countWordOccurrences(para, timeJumpSet) / Math.max(wordCount, 1);
            const stretchDensity = this.countWordOccurrences(para, stretchSet) / Math.max(wordCount, 1);

            let type: NarrativeDuration;
            if (timeJumpDensity > 0.005) {
                type = 'ellipsis';
            } else if (dialogueDensity > 0.04) {
                type = 'scene';
            } else if (descriptionDensity > 0.03) {
                type = 'pause';
            } else if (stretchDensity > 0.01) {
                type = 'stretch';
            } else if (dialogueDensity < 0.005 && descriptionDensity < 0.01) {
                type = 'summary';
            } else {
                type = 'stretch';
            }
            durationDistribution[type]++;
        }

        const totalParagraphs = paragraphs.length;
        if (totalParagraphs > 0) {
            for (const key of Object.keys(durationDistribution) as NarrativeDuration[]) {
                durationDistribution[key] = durationDistribution[key] / totalParagraphs;
            }
        }

        let dominantType: NarrativeDuration = 'scene';
        let maxRatio = -1;
        for (const key of Object.keys(durationDistribution) as NarrativeDuration[]) {
            if (durationDistribution[key] > maxRatio) {
                maxRatio = durationDistribution[key];
                dominantType = key;
            }
        }

        const iterativeSet = new Set(ITERATIVE_FREQUENCY_MARKERS);
        const repetitiveSet = new Set(REPETITIVE_FREQUENCY_MARKERS);

        const repetitiveEvents: Array<{ description: string; count: number; position: number }> = [];
        let iterativeCount = 0;
        let repetitiveCount = 0;

        charOffset = 0;
        for (const para of paragraphs) {
            const paraStart = charOffset === 0 ? text.indexOf(para, 0) : text.indexOf(para, Math.max(0, charOffset - 1));
            const safeStart = paraStart === -1 ? charOffset : paraStart;
            const position = totalLength > 0 ? safeStart / totalLength : 0;

            const iterHits = this.countWordOccurrences(para, iterativeSet);
            const repHits = this.countWordOccurrences(para, repetitiveSet);

            iterativeCount += iterHits;
            repetitiveCount += repHits;

            if (repHits > 0) {
                const matchedWord = this.findFirstMatch(para, REPETITIVE_FREQUENCY_MARKERS);
                repetitiveEvents.push({
                    description: matchedWord || '重复叙述',
                    count: repHits,
                    position: this.clamp01(position)
                });
            }

            charOffset = safeStart + para.length;
        }

        let frequencyType: NarrativeFrequency;
        if (repetitiveCount > 0 && repetitiveCount >= iterativeCount) {
            frequencyType = 'repeating';
        } else if (iterativeCount > 0 && iterativeCount > repetitiveCount) {
            frequencyType = 'iterative';
        } else {
            frequencyType = 'singulative';
        }

        const description = `时序类型：${orderType}，时长主导：${dominantType}，频率：${frequencyType}`;

        return {
            order: {
                type: orderType,
                flashbacks,
                flashforwards,
                confidence: orderConfidence
            },
            duration: {
                distribution: durationDistribution,
                dominantType,
                description: `段落时长分布：场景 ${(durationDistribution.scene * 100).toFixed(1)}%，概述 ${(durationDistribution.summary * 100).toFixed(1)}%，停顿 ${(durationDistribution.pause * 100).toFixed(1)}%，省略 ${(durationDistribution.ellipsis * 100).toFixed(1)}%，拉伸 ${(durationDistribution.stretch * 100).toFixed(1)}%`
            },
            frequency: {
                type: frequencyType,
                repetitiveEvents: repetitiveEvents.slice(0, 20),
                description: `迭代标记：${iterativeCount}次，重复标记：${repetitiveCount}次`
            },
            description
        };
    }

    private matchStructureTemplates(
        text: string,
        totalLength: number,
        qcchSegments: QCCHSegment[]
    ): StructureTemplateResult {
        void qcchSegments;
        const allMatches: StructureTemplateMatch[] = [];

        for (const template of STRUCTURE_TEMPLATES) {
            const match = this.matchSingleTemplate(text, totalLength, template);
            allMatches.push(match);
        }

        allMatches.sort((a, b) => b.matchScore - a.matchScore);
        const bestMatch = allMatches[0];

        return {
            bestMatch,
            allMatches,
            description: `最佳匹配：${this.getTemplateLabel(bestMatch.template)}（${bestMatch.matchScore}分）`
        };
    }

    private matchSingleTemplate(
        text: string,
        totalLength: number,
        template: StructureTemplateDef
    ): StructureTemplateMatch {
        const matchedNodes: Array<{ nodeName: string; position: number; confidence: number; description: string }> = [];
        const missingNodes: string[] = [];
        let confidenceSum = 0;

        for (const node of template.nodes) {
            const startPos = Math.max(0, Math.floor((node.position - node.tolerance) * totalLength));
            const endPos = Math.min(totalLength, Math.floor((node.position + node.tolerance) * totalLength));
            const windowText = text.substring(startPos, endPos);
            const wordCount = this.countWords(windowText);

            const keywordSet = new Set(node.keywords);
            const hitCount = this.countWordOccurrences(windowText, keywordSet);
            const density = hitCount / Math.max(wordCount * 0.01, 1);
            const confidence = this.clamp01(density);

            if (confidence > 0.1) {
                matchedNodes.push({
                    nodeName: node.name,
                    position: node.position,
                    confidence,
                    description: `${node.name}（关键词命中：${hitCount}）`
                });
                confidenceSum += confidence;
            } else {
                missingNodes.push(node.name);
            }
        }

        const avgConfidence = matchedNodes.length > 0 ? confidenceSum / matchedNodes.length : 0;
        const totalNodes = template.nodes.length;
        const rawScore = 100 * matchedNodes.length / totalNodes * avgConfidence;
        const matchScore = Math.max(0, Math.min(100, Math.round(rawScore)));

        return {
            template: template.type,
            matchScore,
            matchedNodes,
            missingNodes,
            description: `${template.name}：${matchedNodes.length}/${totalNodes} 节点匹配`
        };
    }

    private getTemplateLabel(type: StructureTemplateType): string {
        const labels: Record<StructureTemplateType, string> = {
            three_act: '三幕式',
            hero_journey: '英雄之旅',
            kishotenketsu: '起承转合',
            save_the_cat: '救猫咪',
            webnovel_formula: '网文公式',
            custom: '自定义'
        };
        return labels[type];
    }

    private calculateDialogueDensity(text: string): number {
        let count = 0;
        for (const char of text) {
            if (DIALOGUE_CHARS.has(char)) count++;
        }
        return text.length > 0 ? count / text.length : 0;
    }

    private findFirstMatch(text: string, words: string[]): string | null {
        let firstMatch: string | null = null;
        let firstPos = text.length;
        for (const word of words) {
            const idx = text.indexOf(word);
            if (idx !== -1 && idx < firstPos) {
                firstPos = idx;
                firstMatch = word;
            }
        }
        return firstMatch;
    }

    private splitParagraphs(text: string): string[] {
        return text
            .split(/\r?\n\r?\n/)
            .map(p => p.trim())
            .filter(p => p.length > 0);
    }

    private countWords(text: string): number {
        let count = 0;
        let i = 0;

        while (i < text.length) {
            const char = text[i];
            if (this.isChineseChar(char)) {
                count++;
                i++;
            } else if (this.isEnglishLetter(char)) {
                let j = i;
                while (j < text.length && (this.isEnglishLetter(text[j]) || text[j] === "'" || text[j] === '-')) {
                    j++;
                }
                if (j > i) count++;
                i = j;
            } else if (this.isDigit(char)) {
                let j = i;
                while (j < text.length && (this.isDigit(text[j]) || text[j] === '.' || text[j] === ',')) {
                    j++;
                }
                if (j > i) count++;
                i = j;
            } else {
                i++;
            }
        }

        return Math.max(count, 1);
    }

    private isChineseChar(char: string): boolean {
        const code = char.charCodeAt(0);
        return code >= 0x4E00 && code <= 0x9FFF;
    }

    private isEnglishLetter(char: string): boolean {
        const code = char.charCodeAt(0);
        return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
    }

    private isDigit(char: string): boolean {
        const code = char.charCodeAt(0);
        return code >= 48 && code <= 57;
    }

    private countWordOccurrences(text: string, wordSet: Set<string>): number {
        let count = 0;
        const lowerText = text.toLowerCase();

        for (const word of wordSet) {
            const lowerWord = word.toLowerCase();
            if (lowerWord.length === 1) {
                for (let i = 0; i < lowerText.length; i++) {
                    if (lowerText[i] === lowerWord) count++;
                }
            } else {
                let idx = 0;
                while ((idx = lowerText.indexOf(lowerWord, idx)) !== -1) {
                    count++;
                    idx += lowerWord.length;
                }
            }
        }

        return count;
    }

    private calculateEmotionIntensity(text: string, wordCount: number): number {
        const positiveWords = ['开心', '高兴', '兴奋', '激动', '成功', '胜利', '突破', '惊喜'];
        const negativeWords = ['难过', '悲伤', '愤怒', '害怕', '失败', '绝望', '痛苦', '紧张'];

        let positiveCount = 0;
        let negativeCount = 0;

        for (const word of positiveWords) {
            positiveCount += (text.match(new RegExp(word, 'g')) || []).length;
        }
        for (const word of negativeWords) {
            negativeCount += (text.match(new RegExp(word, 'g')) || []).length;
        }

        const rawIntensity = Math.abs(positiveCount - negativeCount);
        return Math.min(1, rawIntensity / Math.max(wordCount * 0.05, 1));
    }

    private calculateActionDensity(text: string, wordCount: number): number {
        const actionWords = ['冲', '打', '杀', '砍', '跳', '跑', '追', '逃', '攻', '击', '突破', '战斗'];

        let actionCount = 0;
        for (const word of actionWords) {
            actionCount += (text.match(new RegExp(word, 'g')) || []).length;
        }

        return Math.min(1, actionCount / Math.max(wordCount * 0.05, 1));
    }

    private buildFrontmatter(result: StructureAnalysisResult): string {
        const data = {
            qcchSegments: result.qcchSegments.map(s => ({
                type: s.type,
                startPosition: s.startPosition,
                endPosition: s.endPosition,
                chapterRange: s.chapterRange
            })),
            rhythmUnits: result.rhythmUnits.map(u => ({
                level: u.level,
                index: u.index,
                title: u.title,
                startPosition: u.startPosition,
                endPosition: u.endPosition,
                wordCount: u.wordCount
            })),
            threeLineStructure: {
                mainLine: {
                    description: result.threeLineStructure.mainLine.description,
                    keyNodes: result.threeLineStructure.mainLine.keyNodes
                },
                subLine: {
                    description: result.threeLineStructure.subLine.description,
                    keyNodes: result.threeLineStructure.subLine.keyNodes
                },
                romanceLine: {
                    description: result.threeLineStructure.romanceLine.description,
                    keyNodes: result.threeLineStructure.romanceLine.keyNodes
                }
            },
            structureType: result.structureType,
            stats: result.stats,
            narrativeTemporality: result.narrativeTemporality,
            templateMatch: result.templateMatch
        };
        return JSON.stringify(data, null, 2);
    }

    private buildMarkdownBody(result: StructureAnalysisResult, bookName: string): string {
        const lines: string[] = [];

        lines.push(`# ${bookName} - 结构拆解报告`);
        lines.push('');

        lines.push('## 基本信息');
        lines.push('');
        lines.push(`- 结构类型：**${result.structureType}**`);
        lines.push(`- 总字数：**${result.stats.totalWordCount.toLocaleString()}**`);
        lines.push(`- 卷数：**${result.stats.volumeCount}**`);
        lines.push(`- 章节数：**${result.stats.chapterCount}**`);
        lines.push(`- 平均章节字数：**${result.stats.avgChapterWordCount.toLocaleString()}**`);
        lines.push('');

        lines.push('## 起承转合结构');
        lines.push('');
        if (result.qcchSegments.length === 0) {
            lines.push('文本过短，无法划分起承转合');
        } else {
            lines.push('| 段落 | 起始位置 | 结束位置 | 章节范围 | 描述 |');
            lines.push('|------|----------|----------|----------|------|');
            for (const s of result.qcchSegments) {
                const chapterRange = s.chapterRange
                    ? `第${s.chapterRange[0] + 1}-${s.chapterRange[1] + 1}章`
                    : '-';
                lines.push(`| ${s.type} | ${(s.startPosition * 100).toFixed(0)}% | ${(s.endPosition * 100).toFixed(0)}% | ${chapterRange} | ${s.description} |`);
            }
        }
        lines.push('');

        lines.push('## 节奏单元（卷/章/节）');
        lines.push('');
        if (result.rhythmUnits.length === 0) {
            lines.push('未检测到明显的卷/章/节结构');
        } else {
            const volumes = result.rhythmUnits.filter(u => u.level === 'volume');
            const chapters = result.rhythmUnits.filter(u => u.level === 'chapter');
            const sections = result.rhythmUnits.filter(u => u.level === 'section');

            if (volumes.length > 0) {
                lines.push('### 卷列表');
                lines.push('');
                lines.push('| 序号 | 标题 | 起始位置 | 结束位置 | 字数 |');
                lines.push('|------|------|----------|----------|------|');
                for (const v of volumes) {
                    lines.push(`| ${v.index + 1} | ${v.title} | ${(v.startPosition * 100).toFixed(1)}% | ${(v.endPosition * 100).toFixed(1)}% | ${v.wordCount.toLocaleString()} |`);
                }
                lines.push('');
            }

            if (chapters.length > 0) {
                lines.push('### 章列表（前20章）');
                lines.push('');
                lines.push('| 序号 | 标题 | 起始位置 | 字数 |');
                lines.push('|------|------|----------|------|');
                const displayChapters = chapters.slice(0, 20);
                for (const c of displayChapters) {
                    lines.push(`| ${c.index + 1} | ${c.title} | ${(c.startPosition * 100).toFixed(1)}% | ${c.wordCount.toLocaleString()} |`);
                }
                if (chapters.length > 20) {
                    lines.push(`| ... | 共 ${chapters.length} 章 | ... | ... |`);
                }
                lines.push('');
            }

            if (sections.length > 0) {
                lines.push('### 节列表（前10节）');
                lines.push('');
                lines.push('| 序号 | 标题 | 起始位置 | 字数 |');
                lines.push('|------|------|----------|------|');
                const displaySections = sections.slice(0, 10);
                for (const s of displaySections) {
                    lines.push(`| ${s.index + 1} | ${s.title} | ${(s.startPosition * 100).toFixed(1)}% | ${s.wordCount.toLocaleString()} |`);
                }
                if (sections.length > 10) {
                    lines.push(`| ... | 共 ${sections.length} 节 | ... | ... |`);
                }
                lines.push('');
            }
        }

        lines.push('## 三线结构分析');
        lines.push('');

        lines.push('### 主线');
        lines.push('');
        lines.push(result.threeLineStructure.mainLine.description);
        lines.push('');
        if (result.threeLineStructure.mainLine.keyNodes.length > 0) {
            lines.push('| 位置 | 描述 |');
            lines.push('|------|------|');
            for (const n of result.threeLineStructure.mainLine.keyNodes) {
                lines.push(`| ${(n.position * 100).toFixed(1)}% | ${n.description} |`);
            }
        }
        lines.push('');

        lines.push('### 副线');
        lines.push('');
        lines.push(result.threeLineStructure.subLine.description);
        lines.push('');
        if (result.threeLineStructure.subLine.keyNodes.length > 0) {
            lines.push('| 位置 | 描述 |');
            lines.push('|------|------|');
            for (const n of result.threeLineStructure.subLine.keyNodes) {
                lines.push(`| ${(n.position * 100).toFixed(1)}% | ${n.description} |`);
            }
        }
        lines.push('');

        lines.push('### 感情线');
        lines.push('');
        lines.push(result.threeLineStructure.romanceLine.description);
        lines.push('');
        if (result.threeLineStructure.romanceLine.keyNodes.length > 0) {
            lines.push('| 位置 | 描述 |');
            lines.push('|------|------|');
            for (const n of result.threeLineStructure.romanceLine.keyNodes) {
                lines.push(`| ${(n.position * 100).toFixed(1)}% | ${n.description} |`);
            }
        }
        lines.push('');

        if (result.narrativeTemporality) {
            const nt = result.narrativeTemporality;
            lines.push('## 叙事时序分析（Genette 框架）');
            lines.push('');
            lines.push(nt.description);
            lines.push('');

            lines.push('### 时序（Order）');
            lines.push('');
            lines.push(`- 时序类型：**${nt.order.type}**`);
            lines.push(`- 置信度：${(nt.order.confidence * 100).toFixed(1)}%`);
            lines.push('');

            if (nt.order.flashbacks.length > 0) {
                lines.push('#### 倒叙（Flashbacks）');
                lines.push('');
                lines.push('| 位置 | 目标位置 | 描述 |');
                lines.push('|------|----------|------|');
                for (const fb of nt.order.flashbacks.slice(0, 10)) {
                    lines.push(`| ${(fb.position * 100).toFixed(1)}% | ${(fb.targetPosition * 100).toFixed(1)}% | ${fb.description} |`);
                }
                if (nt.order.flashbacks.length > 10) {
                    lines.push(`| ... | ... | 共 ${nt.order.flashbacks.length} 处倒叙 |`);
                }
                lines.push('');
            }

            if (nt.order.flashforwards.length > 0) {
                lines.push('#### 预叙（Flashforwards）');
                lines.push('');
                lines.push('| 位置 | 目标位置 | 描述 |');
                lines.push('|------|----------|------|');
                for (const ff of nt.order.flashforwards.slice(0, 10)) {
                    lines.push(`| ${(ff.position * 100).toFixed(1)}% | ${(ff.targetPosition * 100).toFixed(1)}% | ${ff.description} |`);
                }
                if (nt.order.flashforwards.length > 10) {
                    lines.push(`| ... | ... | 共 ${nt.order.flashforwards.length} 处预叙 |`);
                }
                lines.push('');
            }

            lines.push('### 时长（Duration）');
            lines.push('');
            lines.push(nt.duration.description);
            lines.push('');
            lines.push('| 时长类型 | 占比 |');
            lines.push('|----------|------|');
            const durationLabels: Record<NarrativeDuration, string> = {
                scene: '场景（Scene）',
                summary: '概述（Summary）',
                pause: '停顿（Pause）',
                ellipsis: '省略（Ellipsis）',
                stretch: '拉伸（Stretch）'
            };
            for (const key of Object.keys(nt.duration.distribution) as NarrativeDuration[]) {
                const ratio = nt.duration.distribution[key];
                const barLen = Math.round(ratio * 20);
                const bar = '█'.repeat(barLen) + '░'.repeat(Math.max(0, 20 - barLen));
                lines.push(`| ${durationLabels[key]} | ${bar} ${(ratio * 100).toFixed(1)}% |`);
            }
            lines.push(`| **主导类型** | **${durationLabels[nt.duration.dominantType]}** |`);
            lines.push('');

            lines.push('### 频率（Frequency）');
            lines.push('');
            lines.push(`- 频率类型：**${nt.frequency.type}**`);
            lines.push(nt.frequency.description);
            lines.push('');

            if (nt.frequency.repetitiveEvents.length > 0) {
                lines.push('#### 重复事件');
                lines.push('');
                lines.push('| 位置 | 描述 | 次数 |');
                lines.push('|------|------|------|');
                for (const re of nt.frequency.repetitiveEvents.slice(0, 10)) {
                    lines.push(`| ${(re.position * 100).toFixed(1)}% | ${re.description} | ${re.count} |`);
                }
                lines.push('');
            }
        }

        if (result.templateMatch) {
            const tm = result.templateMatch;
            lines.push('## 结构模板匹配');
            lines.push('');
            lines.push(tm.description);
            lines.push('');

            lines.push('### 所有模板评分对比');
            lines.push('');
            lines.push('| 模板 | 得分 | 匹配节点 | 缺失节点 | 描述 |');
            lines.push('|------|------|----------|----------|------|');
            for (const m of tm.allMatches) {
                const matched = m.matchedNodes.length;
                const total = matched + m.missingNodes.length;
                lines.push(`| ${this.getTemplateLabel(m.template)} | ${m.matchScore} | ${matched}/${total} | ${m.missingNodes.length} | ${m.description} |`);
            }
            lines.push('');

            lines.push('### 最佳匹配详情');
            lines.push('');
            lines.push(`- 模板：**${this.getTemplateLabel(tm.bestMatch.template)}**`);
            lines.push(`- 得分：**${tm.bestMatch.matchScore}**`);
            lines.push(`- 描述：${tm.bestMatch.description}`);
            lines.push('');

            if (tm.bestMatch.matchedNodes.length > 0) {
                lines.push('#### 匹配节点');
                lines.push('');
                lines.push('| 节点 | 位置 | 置信度 | 描述 |');
                lines.push('|------|------|--------|------|');
                for (const n of tm.bestMatch.matchedNodes) {
                    lines.push(`| ${n.nodeName} | ${(n.position * 100).toFixed(1)}% | ${(n.confidence * 100).toFixed(0)}% | ${n.description} |`);
                }
                lines.push('');
            }

            if (tm.bestMatch.missingNodes.length > 0) {
                lines.push('#### 缺失节点');
                lines.push('');
                for (const name of tm.bestMatch.missingNodes) {
                    lines.push(`- ${name}`);
                }
                lines.push('');
            }
        }

        return lines.join('\n');
    }

    private clamp01(v: number): number {
        return Math.max(0, Math.min(1, v));
    }

    private round2(n: number): number {
        return Math.round(n * 100) / 100;
    }
}
