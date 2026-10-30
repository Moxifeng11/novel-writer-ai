import { App } from 'obsidian';
import type { WritingProfile } from './writing-profile';
import { WritingProfileManager } from './writing-profile';
import type { ChapterStateSnapshot, StoryBeat } from './story-state-types';
import type { StyleFingerprintLibrary, StyleFingerprint, StyleFingerprintFeatures } from './style-fingerprint-library';
import type { ForeshadowManager, ForeshadowItem } from '../services/foreshadow-manager';
import type { VectorEnhancer } from './vector-enhancer';
import type { KnowledgeBaseManager, BookBasicInfo } from '../services/knowledge-base-manager';
import type { KnowledgeVectorStore, KnowledgeSearchResult } from './knowledge-vector-store';
import { assemblePromptWithinBudget } from '../shared/prompt-budget';
import { recordBudgetSnapshot } from '../shared/budget-telemetry';
import { formatKnowledgeChunkLabel, dedupeAdjacentChunks } from '../shared/knowledge-position';
import { StyleIntensityEngine } from './style/style-intensity-engine';
import {
    MAX_INJECTED_STYLE_FINGERPRINTS,
    selectFingerprintsForInjection,
} from './style/fingerprint-selection';
import { getDegradationNotifier } from '../shared/degradation-notifier';
import { createLogger } from '../shared/logger';
import { retrieve, type RetrievalTelemetry } from './rag/retrieval-service';

/** 强度映射是纯函数，模块级共享一个实例即可 */
const intensityEngine = new StyleIntensityEngine();

/** 指纹特征单字段字符上限（多个指纹合并后尤其容易膨胀） */
const FINGERPRINT_FIELD_CHAR_LIMIT = 200;


const log = createLogger('KnowledgeInjector');
export interface InjectionContext {
    projectPath: string;
    chapterIndex?: number;
    totalChapters?: number;
    sceneType?: string;
    characterNames?: string[];
    outline?: string;
    emotionPlan?: string;
    currentText?: string;
    /** Task 6 必须层：当前场景目标 */
    sceneObjective?: string;
    /** Task 6 必须层：上一场景结尾 */
    previousSceneEnding?: string;
}

/** ==== Task 6: 分层上下文注入契约（story-quality spec TR-6.1~6.4） ==== */

/** 注入层级：必须 / 按需 / 低频 */
export type InjectionLayer = 'required' | 'onDemand' | 'lowFrequency';

/** 分层注入契约——显式声明每个上下文项的层级归属（契约化为代码，而非散落注释） */
export const INJECTION_LAYER_CONTRACT: Record<string, InjectionLayer> = {
    // 必须层：每次场景生成无条件注入
    chapterBeats: 'required',         // 本章任务卡
    sceneObjective: 'required',      // 当前场景目标
    previousSceneEnding: 'required', // 上一场景结尾
    characterStates: 'required',     // 当前人物状态
    timeline: 'required',            // 时间地点
    forbiddenReveals: 'required',    // 本章禁止事项
    // 按需层：相关性命中才注入
    characterFullProfile: 'onDemand', // 涉及人物完整设定
    factionSetting: 'onDemand',       // 势力设定
    locationSetting: 'onDemand',      // 地点设定
    relatedForeshadows: 'onDemand',   // 相关伏笔
    propsSetting: 'onDemand',         // 相关道具
    // 低频层：不进入每次场景 prompt
    fullWorldview: 'lowFrequency',    // 完整世界观
    allArchives: 'lowFrequency',      // 全部档案
    chronicle: 'lowFrequency',       // 大事记
    allChapters: 'lowFrequency',     // 全部章节
    allReports: 'lowFrequency',      // 全部报告
};

/** 按需层实体类别白名单：仅这些 kind 的候选可进入场景 prompt */
export const ON_DEMAND_KINDS: ReadonlySet<string> = new Set([
    'character', 'faction', 'location', 'foreshadow', 'prop',
]);

/** 低频层实体类别：契约拒绝注入场景 prompt */
export const LOW_FREQUENCY_KINDS: ReadonlySet<string> = new Set([
    'worldview', 'archive', 'chronicle', 'chapter', 'report',
]);

/** 按需层候选实体（调用方从实体库筛出候选，相关性过滤由本类完成） */
export interface OnDemandCandidate {
    id: string;
    name: string;
    content: string;
    /** 实体类别；不在 ON_DEMAND_KINDS 内的一律按低频层契约拒绝 */
    kind?: string;
}

/** injectForSceneBody 选项 */
export interface LayeredInjectionOptions {
    /** 章节状态快照（Task 1）：人物状态/时间地点/禁止事项数据源 */
    snapshot?: ChapterStateSnapshot;
    /** 本章任务卡（Task 2） */
    beats?: StoryBeat[];
    /** 当前场景目标（必须层；也可经 context.sceneObjective 提供） */
    sceneObjective?: string;
    /** 上一场景结尾（必须层；也可经 context.previousSceneEnding 提供） */
    previousSceneEnding?: string;
    /** 按需层候选实体 */
    candidates?: OnDemandCandidate[];
    /** 相关性判断（可注入 mock）；默认：名字出现在 outline/场景目标/出场人物中 */
    relevanceMatcher?: (candidate: OnDemandCandidate, context: InjectionContext) => boolean;
    /** 知识注入段可用的 token 预算；不传则不做预算裁剪（保持旧行为） */
    maxInputTokens?: number;
    /** 预算估算使用的模型（可选，用于 token 估算口径） */
    modelId?: string;
}

/** 默认相关性判断：候选名出现在大纲/场景目标/出场人物任一文本中即相关 */
function defaultRelevanceMatcher(candidate: OnDemandCandidate, context: InjectionContext): boolean {
    const haystack = [
        context.outline || '',
        context.sceneObjective || '',
        (context.characterNames || []).join('、'),
    ].filter(Boolean).join('\n');
    if (!haystack) return false;
    return haystack.includes(candidate.name);
}

export interface InjectionSwitches {
    style: boolean;
    rhythm: boolean;
    technique: boolean;
    character: boolean;
    foreshadow: boolean;
    rules: boolean;
    kbCharacter: boolean;
    kbWorldview: boolean;
    kbTechnique: boolean;
    kbStyle: boolean;
    kbRhythm: boolean;
}

const DEFAULT_SWITCHES: InjectionSwitches = {
    style: true,
    rhythm: true,
    technique: true,
    character: true,
    foreshadow: true,
    rules: true,
    kbCharacter: true,
    kbWorldview: true,
    kbTechnique: true,
    kbStyle: true,
    kbRhythm: true,
};

export interface ReferenceBookConfig {
    bookId: string;
    bookName: string;
    weight: number;
    isPrimary: boolean;
}

export interface KnowledgeDimensionWeights {
    character: number;
    worldview: number;
    technique: number;
    style: number;
    rhythm: number;
}

export const DEFAULT_DIMENSION_WEIGHTS: KnowledgeDimensionWeights = {
    character: 0.8,
    worldview: 0.6,
    technique: 0.7,
    style: 0.9,
    rhythm: 0.5,
};

export type SceneCategory = 'battle' | 'daily' | 'emotion' | 'suspense' | 'transition' | 'climax' | 'unknown';

const SCENE_TYPE_KEYWORDS: Record<SceneCategory, string[]> = {
    battle: ['战斗', '打斗', '交手', '对战', '厮杀', '激战', '对决', '攻击', '防御', '功法', '武技'],
    daily: ['日常', '生活', '休息', '聊天', '吃饭', '逛街', '修炼', '打坐', '练功'],
    emotion: ['情感', '表白', '伤心', '感动', '愤怒', '恐惧', '喜悦', '悲伤', '思念', '回忆'],
    suspense: ['悬疑', '谜团', '阴谋', '秘密', '调查', '追踪', '发现', '真相', '伏笔', '暗示'],
    transition: ['过渡', '赶路', '出发', '到达', '转场', '交代', '铺垫', '准备'],
    climax: ['高潮', '决战', '爆发', '真相大白', '生死', '绝境', '逆袭', '反转'],
    unknown: [],
};

const TECHNIQUE_LIBRARY: Record<string, string> = {
    '伏笔': '在叙述中提前埋下看似不起眼的细节，后续揭示其重要意义',
    '铺垫': '通过环境描写、人物状态等为后续情节做准备',
    '悬念': '故意隐藏部分信息，激发读者好奇心',
    '反转': '让剧情朝读者预期的反方向发展',
    '衬托': '用次要人物或环境来突出主要人物或主题',
    '对比': '通过两个事物的对照突出各自特点',
    '象征': '用具体事物代表抽象概念或思想感情',
    '暗示': '不直接说出，通过细节间接表达意思',
    '节奏控制': '通过句式长短、段落疏密控制叙事节奏',
    '视角切换': '在不同人物视角间切换以展现多面性',
    '内心独白': '直接展现人物内心想法和感受',
    '对话推进': '通过人物对话推动情节发展',
    '环境烘托': '用环境描写渲染气氛、衬托人物心情',
    '细节描写': '通过具体细节增强真实感和代入感',
    '冲突升级': '逐步加大矛盾冲突的烈度',
    '欲扬先抑': '先贬低后赞扬，形成强烈反差',
    '侧面描写': '不直接描写对象，通过其他事物间接表现',
    '白描': '用简练文字勾勒形象，不加修饰',
    '意识流': '自由展现人物意识流动',
    '蒙太奇': '将不同时空的画面组合在一起',
};

const PERSPECTIVE_LABELS: Record<string, string> = {
    first_person: '第一人称',
    third_person_omniscient: '第三人称全知视角',
    third_person_limited: '第三人称限知视角',
};

export class KnowledgeInjector {
    private app: App;
    private vectorEnhancer?: VectorEnhancer;
    private profileManager: WritingProfileManager;
    private fingerprintLibrary?: StyleFingerprintLibrary;
    /** v4.20 RAG 检索遥测：本次调用累计（查询/命中/去重/邻块/丢弃/缓存） */
    private retrievalTelemetry: {
        calls: number; queries: number; hits: number; deduped: number; neighborMerged: number;
        dropped: number; chars: number; cacheHits: number; cacheMisses: number; errors: number;
    } = { calls: 0, queries: 0, hits: 0, deduped: 0, neighborMerged: 0, dropped: 0, chars: 0, cacheHits: 0, cacheMisses: 0, errors: 0 };
    /** v4.20 注入溯源：最近一次 formatInjection 的分段字符统计（prompt-ledger 消费） */
    lastInjectionMeta?: {
        sections: Array<{ title: string; chars: number }>;
        totalChars: number;
        strength?: number;
        retrieval?: {
            calls: number; queries: number; hits: number; deduped: number; neighborMerged: number;
            dropped: number; chars: number; cacheHits: number; cacheMisses: number; errors: number;
        };
    };
    private foreshadowManager?: ForeshadowManager;
    private enabled: boolean;
    private switches: InjectionSwitches;
    private knowledgeManager?: KnowledgeBaseManager;
    private knowledgeVectorStore?: KnowledgeVectorStore;
    private referenceBooks: ReferenceBookConfig[] = [];
    private dimensionWeights: KnowledgeDimensionWeights = { ...DEFAULT_DIMENSION_WEIGHTS };
    private maxReferenceBooks = 3;

    constructor(
        app: App,
        options?: {
            vectorEnhancer?: VectorEnhancer;
            fingerprintLibrary?: StyleFingerprintLibrary;
            foreshadowManager?: ForeshadowManager;
            knowledgeManager?: KnowledgeBaseManager;
            knowledgeVectorStore?: KnowledgeVectorStore;
            /** 写作配置管理器；若不提供将内部 new 一个（向后兼容，建议由 EngineRegistry 传入） */
            profileManager?: WritingProfileManager;
        }
    ) {
        this.app = app;
        this.vectorEnhancer = options?.vectorEnhancer;
        this.fingerprintLibrary = options?.fingerprintLibrary;
        this.foreshadowManager = options?.foreshadowManager;
        this.knowledgeManager = options?.knowledgeManager;
        this.knowledgeVectorStore = options?.knowledgeVectorStore;
        this.enabled = true;
        this.switches = { ...DEFAULT_SWITCHES };
        this.profileManager = options?.profileManager
            ?? (null as unknown as WritingProfileManager);
    }

    setKnowledgeBase(manager?: KnowledgeBaseManager, vectorStore?: KnowledgeVectorStore): void {
        this.knowledgeManager = manager;
        this.knowledgeVectorStore = vectorStore;
    }

    setReferenceBooks(books: ReferenceBookConfig[]): void {
        this.referenceBooks = books.slice(0, this.maxReferenceBooks);
    }

    getReferenceBooks(): ReferenceBookConfig[] {
        return [...this.referenceBooks];
    }

    addReferenceBook(bookId: string, bookName: string, weight: number = 0.5, isPrimary: boolean = false): boolean {
        if (this.referenceBooks.length >= this.maxReferenceBooks) return false;
        if (this.referenceBooks.some(b => b.bookId === bookId)) return false;
        this.referenceBooks.push({ bookId, bookName, weight, isPrimary });
        if (isPrimary) {
            this.referenceBooks.forEach(b => { if (b.bookId !== bookId) b.isPrimary = false; });
        }
        return true;
    }

    removeReferenceBook(bookId: string): void {
        this.referenceBooks = this.referenceBooks.filter(b => b.bookId !== bookId);
    }

    setPrimaryReferenceBook(bookId: string): void {
        this.referenceBooks.forEach(b => {
            b.isPrimary = b.bookId === bookId;
        });
    }

    setDimensionWeights(weights: Partial<KnowledgeDimensionWeights>): void {
        this.dimensionWeights = { ...this.dimensionWeights, ...weights };
    }

    getDimensionWeights(): KnowledgeDimensionWeights {
        return { ...this.dimensionWeights };
    }

    getReferenceBookIds(): string[] {
        return this.referenceBooks.map(b => b.bookId);
    }

    private detectSceneCategory(text: string): SceneCategory {
        if (!text || text.trim().length === 0) return 'unknown';
        const lowerText = text.toLowerCase();
        let bestCategory: SceneCategory = 'unknown';
        let bestScore = 0;
        for (const [category, keywords] of Object.entries(SCENE_TYPE_KEYWORDS)) {
            let score = 0;
            for (const kw of keywords) {
                const count = (lowerText.match(new RegExp(kw, 'g')) || []).length;
                score += count;
            }
            if (score > bestScore) {
                bestScore = score;
                bestCategory = category as SceneCategory;
            }
        }
        return bestScore >= 2 ? bestCategory : 'unknown';
    }

    private getSceneDimensionAdjustments(category: SceneCategory): Partial<KnowledgeDimensionWeights> {
        const adjustments: Record<SceneCategory, Partial<KnowledgeDimensionWeights>> = {
            battle: { character: 1.2, technique: 1.3, rhythm: 1.2, worldview: 1.1, style: 1.0 },
            daily: { character: 1.1, style: 1.2, worldview: 0.8, technique: 0.7, rhythm: 0.9 },
            emotion: { character: 1.3, style: 1.2, rhythm: 0.8, technique: 0.8, worldview: 0.7 },
            suspense: { technique: 1.3, worldview: 1.1, character: 1.0, rhythm: 1.1, style: 1.0 },
            transition: { rhythm: 1.2, worldview: 1.1, character: 0.8, technique: 0.9, style: 0.9 },
            climax: { character: 1.1, technique: 1.2, rhythm: 1.3, style: 1.1, worldview: 1.0 },
            unknown: {},
        };
        return adjustments[category] || {};
    }

    setEnabled(enabled: boolean): void {
        this.enabled = enabled;
    }

    isEnabled(): boolean {
        return this.enabled;
    }

    setSwitches(switches: Partial<InjectionSwitches>): void {
        this.switches = { ...this.switches, ...switches };
    }

    getSwitches(): InjectionSwitches {
        return { ...this.switches };
    }

    async injectForOutline(profile: WritingProfile, context: InjectionContext): Promise<string> {
        if (!this.enabled) return '';

        const sections: Array<{ title: string; content: string }> = [];
        const strength = profile.fingerprint.injectionStrength;

        try {
            if (this.switches.style) {
                const content = await this.buildStyleInjection(
                    profile,
                    Math.min(strength, 0.5),
                    this.buildFingerprintQuery(context),
                );
                if (content) sections.push({ title: '风格要求', content });
            }
        } catch (e) {
            log.warn('[KnowledgeInjector] 风格注入失败:', e);
        }

        try {
            if (this.switches.rhythm) {
                const content = this.buildRhythmInjection(profile, context, Math.min(strength, 0.6));
                if (content) sections.push({ title: '节奏要求', content });
            }
        } catch (e) {
            log.warn('[KnowledgeInjector] 节奏注入失败:', e);
        }

        try {
            if (this.switches.technique) {
                const content = await this.buildTechniqueInjection(profile, context, Math.min(strength, 0.4));
                if (content) sections.push({ title: '技巧参考', content });
            }
        } catch (e) {
            log.warn('[KnowledgeInjector] 技巧注入失败:', e);
        }

        return this.formatInjection(sections, strength);
    }

    async injectForEmotionPlan(profile: WritingProfile, context: InjectionContext): Promise<string> {
        if (!this.enabled) return '';

        const sections: Array<{ title: string; content: string }> = [];
        const strength = profile.fingerprint.injectionStrength;

        try {
            if (this.switches.rhythm) {
                const content = this.buildRhythmInjection(profile, context, Math.min(strength, 0.7));
                if (content) sections.push({ title: '节奏模式', content });
            }
        } catch (e) {
            log.warn('[KnowledgeInjector] 节奏注入失败:', e);
        }

        try {
            if (this.switches.style) {
                const content = await this.buildStyleInjection(
                    profile,
                    Math.min(strength, 0.4),
                    this.buildFingerprintQuery(context),
                );
                if (content) sections.push({ title: '风格基调', content });
            }
        } catch (e) {
            log.warn('[KnowledgeInjector] 风格注入失败:', e);
        }

        return this.formatInjection(sections, strength);
    }

    async injectForSceneExpand(profile: WritingProfile, context: InjectionContext): Promise<string> {
        if (!this.enabled) return '';

        const sections: Array<{ title: string; content: string }> = [];
        const strength = profile.fingerprint.injectionStrength;

        try {
            if (this.switches.technique) {
                const content = await this.buildTechniqueInjection(profile, context, strength);
                if (content) sections.push({ title: '写作技巧', content });
            }
        } catch (e) {
            log.warn('[KnowledgeInjector] 技巧注入失败:', e);
        }

        try {
            if (this.switches.character) {
                const content = this.buildCharacterInjection(profile, context, Math.min(strength, 0.7));
                if (content) sections.push({ title: '人物要点', content });
            }
        } catch (e) {
            log.warn('[KnowledgeInjector] 人设注入失败:', e);
        }

        try {
            if (this.switches.foreshadow) {
                const content = await this.buildForeshadowInjection(profile, context, Math.min(strength, 0.6));
                if (content) sections.push({ title: '伏笔提醒', content });
            }
        } catch (e) {
            log.warn('[KnowledgeInjector] 伏笔注入失败:', e);
        }

        let kbSceneInjection = '';
        try {
            if (this.knowledgeVectorStore && this.referenceBooks.length > 0) {
                const kbStrength = strength * 0.7;
                kbSceneInjection = await this.buildKbSceneInjection(context, kbStrength);
            }
        } catch (e) {
            log.warn('[KnowledgeInjector] 知识库场景注入失败:', e);
        }

        const baseInjection = this.formatInjection(sections);
        
        if (kbSceneInjection) {
            return baseInjection + '\n' + kbSceneInjection;
        }
        return baseInjection;
    }

    private async buildKbSceneInjection(context: InjectionContext, strength: number): Promise<string> {
        if (!this.knowledgeVectorStore || strength < 0.2) return '';
        const bookIds = this.getReferenceBookIds();
        if (bookIds.length === 0) return '';

        const sceneCategory = context.sceneType 
            ? this.detectSceneCategory(context.sceneType)
            : context.outline 
                ? this.detectSceneCategory(context.outline)
                : 'unknown';

        const kbSections: Array<{ title: string; content: string }> = [];

        try {
            if (this.switches.kbCharacter && this.dimensionWeights.character > 0.2) {
                const content = await this.buildSceneCharacterInjection(context, strength * this.dimensionWeights.character);
                if (content) kbSections.push({ title: '参考人设（场景角色）', content });
            }
        } catch (e) {
            log.warn('[KnowledgeInjector] 场景人设注入失败:', e);
        }

        try {
            if (this.switches.kbWorldview && this.dimensionWeights.worldview > 0.2) {
                const content = await this.buildSceneWorldviewInjection(context, strength * this.dimensionWeights.worldview);
                if (content) kbSections.push({ title: '参考设定（结构拆解）', content });
            }
        } catch (e) {
            log.warn('[KnowledgeInjector] 场景世界观注入失败:', e);
        }

        try {
            if (this.switches.kbTechnique && this.dimensionWeights.technique > 0.2) {
                const content = await this.buildSceneTechniqueInjection(context, strength * this.dimensionWeights.technique, sceneCategory);
                if (content) kbSections.push({ title: '参考技巧（场景手法）', content });
            }
        } catch (e) {
            log.warn('[KnowledgeInjector] 场景技巧注入失败:', e);
        }

        try {
            if (this.switches.kbRhythm && this.dimensionWeights.rhythm > 0.2) {
                const content = await this.buildSceneRhythmInjection(context, strength * this.dimensionWeights.rhythm, sceneCategory);
                if (content) kbSections.push({ title: '参考节奏（场景节奏）', content });
            }
        } catch (e) {
            log.warn('[KnowledgeInjector] 场景节奏注入失败:', e);
        }

        if (kbSections.length === 0) return '';

        const bookNames = this.referenceBooks.map(b => b.isPrimary ? `${b.bookName}（主）` : b.bookName).join('、');
        const header = `参考书籍：${bookNames}\n场景类型：${this.getSceneCategoryLabel(sceneCategory)}`;

        return this.formatSceneInjection(header, kbSections);
    }

    /**
     * v4.20 统一 RAG 检索：多查询计划 → 邻块扩展 → MMR → 预算打包。
     * 9 处注入点共用，遥测累计到 retrievalTelemetry，随 lastInjectionMeta 进注入账本。
     */
    private async retrieveKb(
        context: InjectionContext,
        dimensions: string[],
        topN: number,
        maxChars: number,
    ): Promise<{ hits: Array<{ sample: string; bookId: string; bookName: string; dimension: string; category?: string; score: number; position?: number }>; error?: string }> {
        const outcome = await retrieve(this.knowledgeVectorStore, {
            dimensions,
            bookIds: this.getReferenceBookIds(),
            topN,
            maxChars,
            source: {
                outline: context.outline,
                emotionPlan: context.emotionPlan,
                sceneObjective: context.sceneObjective,
                previousSceneEnding: context.previousSceneEnding,
                characterNames: context.characterNames,
                currentText: context.currentText,
            },
        });
        const telemetry: RetrievalTelemetry = outcome.telemetry;
        this.retrievalTelemetry.calls++;
        this.retrievalTelemetry.queries += telemetry.queries;
        this.retrievalTelemetry.hits += telemetry.hits;
        this.retrievalTelemetry.deduped += telemetry.deduped;
        this.retrievalTelemetry.neighborMerged += telemetry.neighborMerged;
        this.retrievalTelemetry.dropped += telemetry.dropped;
        this.retrievalTelemetry.chars += telemetry.chars;
        this.retrievalTelemetry.cacheHits += telemetry.cacheHits;
        this.retrievalTelemetry.cacheMisses += telemetry.cacheMisses;
        if (outcome.error) {
            this.retrievalTelemetry.errors++;
            log.warn('[KnowledgeInjector] 知识检索降级:', outcome.error);
        }
        return { hits: outcome.hits, error: outcome.error };
    }

    private async buildSceneCharacterInjection(context: InjectionContext, strength: number): Promise<string> {
        if (!this.knowledgeVectorStore || strength < 0.2) return '';
        const bookIds = this.getReferenceBookIds();
        if (bookIds.length === 0) return '';

        try {
            const results = (await this.retrieveKb(context, ['character'], Math.max(3, Math.round(strength * 5)), 900)).hits;
            if (results.length === 0) return '';

            const lines: string[] = [];
            const byBook = this.groupResultsByBook(results);

            for (const [bookName, bookResults] of Object.entries(byBook)) {
                lines.push(`【${bookName}】同类场景角色表现：`);
                for (let i = 0; i < Math.min(bookResults.length, 2); i++) {
                    const r = bookResults[i];
                    lines.push(`  ${i + 1}. ${r.sample.slice(0, 150)}`);
                }
            }
            return lines.join('\n');
        } catch {
            return '';
        }
    }

    private async buildSceneWorldviewInjection(context: InjectionContext, strength: number): Promise<string> {
        if (!this.knowledgeVectorStore || strength < 0.2) return '';
        const bookIds = this.getReferenceBookIds();
        if (bookIds.length === 0) return '';

        try {
            // 知识库拆解没有 worldview 维度（只有 style/rhythm/technique/structure/
            // character/foreshadow/original），结构拆解是唯一可用的设定类数据源。
            // 旧实现按 'worldview' 检索，永远返回空，导致该段静默失效。
            const results = (await this.retrieveKb(context, ['structure'], Math.max(2, Math.round(strength * 3)), 700)).hits;
            if (results.length === 0) return '';

            const lines: string[] = [];
            const byBook = this.groupResultsByBook(results);

            for (const [bookName, bookResults] of Object.entries(byBook)) {
                lines.push(`【${bookName}】世界观设定参考：`);
                for (let i = 0; i < Math.min(bookResults.length, 2); i++) {
                    const r = bookResults[i];
                    lines.push(`  ${i + 1}. ${r.sample.slice(0, 120)}`);
                }
            }
            return lines.join('\n');
        } catch {
            return '';
        }
    }

    private async buildSceneTechniqueInjection(context: InjectionContext, strength: number, sceneCategory: SceneCategory): Promise<string> {
        if (!this.knowledgeVectorStore || strength < 0.2) return '';
        const bookIds = this.getReferenceBookIds();
        if (bookIds.length === 0) return '';

        try {
            const results = (await this.retrieveKb(context, ['technique'], Math.max(3, Math.round(strength * 4)), 800)).hits;

            const lines: string[] = [];
            const sceneLabel = this.getSceneCategoryLabel(sceneCategory);
            
            if (sceneCategory !== 'unknown') {
                const sceneTips = this.getSceneTypeTips(sceneCategory);
                if (sceneTips.length > 0) {
                    lines.push(`${sceneLabel}场景常用技巧：`);
                    sceneTips.forEach((tip, i) => {
                        lines.push(`  ${i + 1}. ${tip}`);
                    });
                }
            }

            if (results.length > 0) {
                const byBook = this.groupResultsByBook(results);
                for (const [bookName, bookResults] of Object.entries(byBook)) {
                    lines.push('');
                    lines.push(`【${bookName}】类似场景手法：`);
                    for (let i = 0; i < Math.min(bookResults.length, 2); i++) {
                        const r = bookResults[i];
                        lines.push(`  ${i + 1}. ${r.sample.slice(0, 120)}`);
                    }
                }
            }

            return lines.join('\n');
        } catch {
            return '';
        }
    }

    private async buildSceneRhythmInjection(context: InjectionContext, strength: number, sceneCategory: SceneCategory): Promise<string> {
        if (!this.knowledgeVectorStore || strength < 0.2) return '';
        const bookIds = this.getReferenceBookIds();
        if (bookIds.length === 0) return '';

        try {
            const lines: string[] = [];

            const rhythmPatterns = this.getSceneRhythmPatterns(sceneCategory);
            if (rhythmPatterns.length > 0) {
                lines.push('场景节奏参考模式：');
                rhythmPatterns.forEach((pattern, i) => {
                    lines.push(`  ${i + 1}. ${pattern}`);
                });
            }

            // 此前 knowledgeVectorStore / bookIds 只用于早退，节奏维度（拆解产物）从未被消费。
            // 这里补上 rhythm 检索，硬编码模式保留为兜底，避免无向量数据时行为回退。
            {
                const results = (await this.retrieveKb(context, ['rhythm'], Math.max(2, Math.round(strength * 4)), 700)).hits;
                const samples: string[] = [];
                const seen = new Set<string>();
                for (const result of results) {
                    const sample = (result.sample || '').trim();
                    if (!sample || seen.has(sample)) continue;
                    seen.add(sample);
                    samples.push(sample.length > 160 ? `${sample.slice(0, 160)}…` : sample);
                    if (samples.length >= 3) break;
                }
                if (samples.length > 0) {
                    lines.push('');
                    lines.push('参考节奏片段：');
                    samples.forEach((sample, i) => {
                        lines.push(`  ${i + 1}. ${sample}`);
                    });
                }
            }

            const scenePace = this.getScenePaceSuggestion(sceneCategory);
            if (scenePace) {
                lines.push('');
                lines.push(`节奏建议：${scenePace}`);
            }

            return lines.join('\n');
        } catch {
            return '';
        }
    }

    private getSceneTypeTips(sceneCategory: SceneCategory): string[] {
        const tips: Record<SceneCategory, string[]> = {
            battle: [
                '先写环境再写动作，营造紧张感',
                '战斗中穿插心理活动，增加代入感',
                '设置战斗转折点，避免平铺直叙',
                '用感官细节强化战斗冲击力'
            ],
            daily: [
                '用生活化细节展现人物性格',
                '日常中暗藏伏笔和信息',
                '对话推动关系发展',
                '小事件引发大变化'
            ],
            emotion: [
                '先抑后扬，情绪要有层次',
                '用环境烘托内心感受',
                '通过动作细节而非直接描写情绪',
                '设置情绪爆发点'
            ],
            suspense: [
                '逐步揭露信息，保持悬念',
                '用反常现象引起注意',
                '设置误导项增加复杂度',
                '关键线索藏在细节中'
            ],
            transition: [
                '简洁明快，不拖泥带水',
                '为下一个场景做铺垫',
                '用景色变化暗示时间流逝',
                '对话中交代必要信息'
            ],
            climax: [
                '多线汇聚，冲突最大化',
                '节奏由慢到快再到爆发',
                '设置关键反转',
                '情感和动作同时达到顶点'
            ],
            unknown: []
        };
        return tips[sceneCategory] || [];
    }

    private getSceneRhythmPatterns(sceneCategory: SceneCategory): string[] {
        const patterns: Record<SceneCategory, string[]> = {
            battle: [
                '慢（起势）→ 快（交锋）→ 慢（转折）→ 快（决战）→ 收（收尾）',
                '铺垫 → 第一次交锋 → 升级 → 高潮 → 结果'
            ],
            daily: [
                '平缓开场 → 小事件 → 人物互动 → 温馨收尾',
                '日常节奏 → 小意外 → 化解 → 关系推进'
            ],
            emotion: [
                '平静 → 触发 → 压抑 → 爆发 → 余韵',
                '铺垫情绪 → 积累 → 临界点 → 释放 → 回味'
            ],
            suspense: [
                '发现异常 → 调查 → 线索 → 误导 → 真相',
                '悬念抛出 → 层层深入 → 假答案 → 反转 → 真答案'
            ],
            transition: [
                '当前状态 → 过渡事件 → 新状态确立',
                '离开 → 路途 → 到达（为下一场景铺垫）'
            ],
            climax: [
                '平静前 → 冲突升级 → 白热化 → 反转 → 结局',
                '多方汇聚 → 矛盾爆发 → 关键抉择 → 高潮 → 余波'
            ],
            unknown: []
        };
        return patterns[sceneCategory] || [];
    }

    private getScenePaceSuggestion(sceneCategory: SceneCategory): string {
        const paces: Record<SceneCategory, string> = {
            battle: '节奏要快，多用短句；战斗间隙可稍慢，用于心理描写和战术思考',
            daily: '节奏舒缓，用细腻的生活描写增加代入感；不宜有太大的剧情波动',
            emotion: '前慢后快，前期铺垫要足，爆发时要有力；结尾留有回味空间',
            suspense: '节奏由慢到快，逐步拉紧读者神经；每个线索都有其作用',
            transition: '节奏明快，不要拖沓；重点是承上启下，为后续做准备',
            climax: '节奏最快，信息量最大；但关键时刻要放慢，让读者感受冲击力',
            unknown: ''
        };
        return paces[sceneCategory] || '';
    }

    private formatSceneInjection(header: string, sections: Array<{ title: string; content: string }>): string {
        if (sections.length === 0) return '';

        const parts: string[] = ['【参考书籍场景知识】', '', header, ''];

        for (const section of sections) {
            if (!section.content.trim()) continue;
            parts.push(`◆ ${section.title}`);
            parts.push(section.content);
            parts.push('');
        }

        parts.push('请在场景设计中适当参考以上内容，保持场景的合理性和吸引力。');

        return parts.join('\n').trim() + '\n';
    }

    async injectForBodyGeneration(profile: WritingProfile, context: InjectionContext): Promise<string> {
        if (!this.enabled) return '';

        const sections: Array<{ title: string; content: string }> = [];
        const strength = profile.fingerprint.injectionStrength;

        try {
            if (this.switches.style) {
                const content = await this.buildStyleInjection(
                    profile,
                    strength,
                    this.buildFingerprintQuery(context),
                );
                if (content) sections.push({ title: '风格要求', content });
            }
        } catch (e) {
            log.warn('[KnowledgeInjector] 风格注入失败:', e);
        }

        try {
            if (this.switches.rhythm) {
                const content = this.buildRhythmInjection(profile, context, strength);
                if (content) sections.push({ title: '节奏要求', content });
            }
        } catch (e) {
            log.warn('[KnowledgeInjector] 节奏注入失败:', e);
        }

        try {
            if (this.switches.technique) {
                const content = await this.buildTechniqueInjection(profile, context, strength);
                if (content) sections.push({ title: '技巧参考', content });
            }
        } catch (e) {
            log.warn('[KnowledgeInjector] 技巧注入失败:', e);
        }

        try {
            if (this.switches.character) {
                const content = this.buildCharacterInjection(profile, context, strength);
                if (content) sections.push({ title: '人物要点', content });
            }
        } catch (e) {
            log.warn('[KnowledgeInjector] 人设注入失败:', e);
        }

        try {
            if (this.switches.foreshadow) {
                const content = await this.buildForeshadowInjection(profile, context, strength);
                if (content) sections.push({ title: '伏笔提醒', content });
            }
        } catch (e) {
            log.warn('[KnowledgeInjector] 伏笔注入失败:', e);
        }

        try {
            if (this.switches.rules) {
                const content = this.buildRulesInjection(profile);
                if (content) sections.push({ title: '写作规则', content });
            }
        } catch (e) {
            log.warn('[KnowledgeInjector] 规则注入失败:', e);
        }

        return this.formatInjection(sections, strength);
    }

    async injectForPolish(profile: WritingProfile, context: InjectionContext): Promise<string> {
        if (!this.enabled) return '';

        const sections: Array<{ title: string; content: string }> = [];
        const strength = profile.fingerprint.injectionStrength;

        try {
            if (this.switches.style) {
                const content = await this.buildStyleInjection(
                    profile,
                    strength,
                    this.buildFingerprintQuery(context),
                );
                if (content) sections.push({ title: '风格要求', content });
            }
        } catch (e) {
            log.warn('[KnowledgeInjector] 风格注入失败:', e);
        }

        try {
            if (this.switches.rules) {
                const content = this.buildRulesInjection(profile);
                if (content) sections.push({ title: '写作规则', content });
            }
        } catch (e) {
            log.warn('[KnowledgeInjector] 规则注入失败:', e);
        }

        return this.formatInjection(sections, strength);
    }

    /**
     * Task 6: 场景正文分层上下文注入（必须/按需/低频三层契约）
     *
     * 区别于 injectForSceneExpand（场景展开设计的写作指引）：
     * 本方法输出"故事约束上下文"——任务卡/场景目标/上一场景结尾/人物状态/时间地点/禁止事项，
     * 与写作指引由调用方分别拼接。低频层（完整世界观/全部档案/大事记等）契约拒绝，不进场景 prompt。
     */
    async injectForSceneBody(context: InjectionContext, options: LayeredInjectionOptions = {}): Promise<string> {
        const layers = await this.injectForSceneBodyLayers(context, options);
        const merged = `${layers.system}\n${layers.user}`.trim();
        return merged ? `${merged}\n` : '';
    }

    /**
     * 分层输出：必须层进 system，按需层进 user（可裁剪）。
     *
     * 旧实现把两层拼成一个字符串交回调用方，最终整体塞进 user：
     * 窗口不足时 `callAI` 从尾部截断，最先丢掉的正是必须层里的禁止事项。
     */
    async injectForSceneBodyLayers(
        context: InjectionContext,
        options: LayeredInjectionOptions = {},
    ): Promise<{ system: string; user: string }> {
        if (!this.enabled) return { system: '', user: '' };

        const required = this.buildRequiredLayer(context, options);
        const onDemand = this.buildOnDemandLayer(context, options);

        // 必须层放进 system：不参与裁剪，任务卡/人物状态/禁止事项缺失会直接写错
        const fixedHeader = required
            ? `## 写作指引\n\n### 本章必须遵循\n${required}\n`
            : '## 写作指引\n';

        if (!onDemand) return { system: fixedHeader.trim(), user: '' };

        // 未指定预算时保持旧行为（不裁剪）
        if (!options.maxInputTokens || options.maxInputTokens <= 0) {
            return {
                system: fixedHeader.trim(),
                user: `### 相关设定（按需注入）\n${onDemand}\n`.trim(),
            };
        }

        const result = assemblePromptWithinBudget({
            systemPrompt: fixedHeader,
            sections: [{
                key: 'knowledge.onDemand',
                text: `### 相关设定（按需注入）\n${onDemand}\n`,
                priority: 50,
                shrinkable: true,
            }],
            tailParts: [],
            maxInputTokens: options.maxInputTokens,
            modelId: options.modelId,
        });
        recordBudgetSnapshot({
            source: 'scene',
            model: options.modelId,
            inputTokens: result.estimatedTokens,
            maxInputTokens: options.maxInputTokens,
            droppedSections: result.droppedSections,
            trimmedSections: result.trimmedSections,
            overBudget: result.overBudget,
        });

        if (result.droppedSections.length > 0 || result.trimmedSections.length > 0 || result.overBudget) {
            log.info('[KnowledgeInjector] 知识注入按预算裁剪', {
                estimatedTokens: result.estimatedTokens,
                maxInputTokens: options.maxInputTokens,
                dropped: result.droppedSections,
                trimmed: result.trimmedSections,
                overBudget: result.overBudget,
            });
        }

        return { system: result.system.trim(), user: result.user.trim() };
    }

    /** 必须层：每次场景生成无条件注入；缺失项静默跳过（不阻塞） */
    private buildRequiredLayer(context: InjectionContext, options: LayeredInjectionOptions): string {
        const lines: string[] = [];

        const beats = options.beats || [];
        if (beats.length > 0) {
            lines.push('本章任务卡：');
            for (const b of beats) {
                lines.push(`- [${b.required ? '必做' : '可选'}] ${b.description}`);
            }
        }

        const objective = options.sceneObjective ?? context.sceneObjective;
        if (objective) lines.push(`当前场景目标：${objective}`);

        const prevEnding = options.previousSceneEnding ?? context.previousSceneEnding;
        if (prevEnding) lines.push(`上一场景结尾：${prevEnding}`);

        const snapshot = options.snapshot;
        if (snapshot) {
            if (snapshot.characterStates.length > 0) {
                lines.push('当前人物状态：');
                for (const c of snapshot.characterStates) {
                    const parts = [
                        c.emotion ? `情绪:${c.emotion}` : '',
                        c.injury ? `伤势:${c.injury}` : '',
                        c.goal ? `当前目标:${c.goal}` : '',
                    ].filter(Boolean);
                    lines.push(`- ${c.name}${parts.length ? `（${parts.join('，')}）` : ''}`);
                }
            }
            if (snapshot.timeline.time || snapshot.timeline.location) {
                lines.push(`时间地点：${snapshot.timeline.time}，${snapshot.timeline.location}`);
            }
            if (snapshot.forbiddenReveals.length > 0) {
                lines.push('本章禁止事项：');
                for (const f of snapshot.forbiddenReveals) {
                    lines.push(`- 禁止提前揭示：${f}`);
                }
            }
        }

        return lines.join('\n');
    }

    /** 按需层：候选经 kind 白名单 + 相关性双重过滤后注入完整设定 */
    private buildOnDemandLayer(context: InjectionContext, options: LayeredInjectionOptions): string {
        const candidates = options.candidates || [];
        if (candidates.length === 0) return '';

        const matcher = options.relevanceMatcher || defaultRelevanceMatcher;
        const lines: string[] = [];
        for (const c of candidates) {
            // 低频层契约：类别不在按需白名单的一律拒绝（即使相关性命中）
            const kind = c.kind || 'character';
            if (!ON_DEMAND_KINDS.has(kind)) continue;
            if (!matcher(c, context)) continue;
            lines.push(`【${c.name}】`);
            lines.push(c.content);
            lines.push('');
        }
        return lines.join('\n').trim();
    }

    private async buildStyleInjection(
        profile: WritingProfile,
        strength: number,
        fingerprintQuery = '',
    ): Promise<string> {
        const style = profile.style;
        const lines: string[] = [];

        if (strength < 0.3) {
            const styleDesc = style.secondaryStyle
                ? `${style.primaryStyle}，融合${style.secondaryStyle}元素`
                : style.primaryStyle;
            lines.push(`整体风格：${styleDesc}`);
        } else if (strength < 0.7) {
            const styleDesc = style.secondaryStyle
                ? `${style.primaryStyle}，融合${style.secondaryStyle}元素`
                : style.primaryStyle;
            lines.push(`整体风格：${styleDesc}`);
            lines.push(`叙事视角：${PERSPECTIVE_LABELS[style.perspective] || style.perspective}`);

            if (style.sentenceRhythm) {
                lines.push(`句式节奏：${style.sentenceRhythm}`);
            }

            const formalityDesc = style.formalityLevel < 0.3
                ? '口语化、轻松随意'
                : style.formalityLevel < 0.7
                    ? '自然平实、亦庄亦谐'
                    : '正式严谨、书面化';
            lines.push(`用词倾向：${formalityDesc}（正式度 ${Math.round(style.formalityLevel * 100)}%）`);
        } else {
            const styleDesc = style.secondaryStyle
                ? `${style.primaryStyle}，融合${style.secondaryStyle}元素`
                : style.primaryStyle;
            lines.push(`整体风格：${styleDesc}`);
            lines.push(`叙事视角：${PERSPECTIVE_LABELS[style.perspective] || style.perspective}`);

            if (style.sentenceRhythm) {
                lines.push(`句式节奏：${style.sentenceRhythm}`);
            }

            const formalityDesc = style.formalityLevel < 0.3
                ? '口语化、轻松随意'
                : style.formalityLevel < 0.7
                    ? '自然平实、亦庄亦谐'
                    : '正式严谨、书面化';
            lines.push(`用词倾向：${formalityDesc}（正式度 ${Math.round(style.formalityLevel * 100)}%）`);
        }

        // 指纹参考与「风格描述详略」无关：injectionStrength 默认 0.5 落在中间分支，
        // 旧实现把它写死在 >=0.7 分支里，等于默认配置下永远不注入。
        lines.push(...await this.buildFingerprintLines(fingerprintQuery));

        return lines.join('\n');
    }

    /** 指纹相关性检索的查询文本：优先当前正文，其次大纲/场景目标 */
    private buildFingerprintQuery(context: InjectionContext): string {
        return (context.currentText || context.outline || context.sceneObjective || '').trim();
    }

    /** 指纹风格参考（独立于风格描述详略；强度 0 已在取列表时过滤） */
    private async buildFingerprintLines(query: string): Promise<string[]> {
        if (!this.fingerprintLibrary) return [];

        const enabledFingerprints = await this.getEnabledFingerprintsFromLibrary(query);
        if (enabledFingerprints.length === 0) return [];

        const lines: string[] = [];
        lines.push('');
        lines.push('【写作指纹风格参考】');
        lines.push(`参考 ${enabledFingerprints.length} 个启用的写作指纹，尽量贴合以下风格特征：`);

        const mergedFeatures = this.mergeFingerprintFeatures(enabledFingerprints);

        if (mergedFeatures.sentenceRhythm) {
            lines.push(`- 句式节奏：${mergedFeatures.sentenceRhythm}`);
        }
        if (mergedFeatures.wordPreference) {
            lines.push(`- 用词偏好：${mergedFeatures.wordPreference}`);
        }
        if (mergedFeatures.narrativeStyle) {
            lines.push(`- 叙事风格：${mergedFeatures.narrativeStyle}`);
        }
        if (mergedFeatures.rhetoric) {
            lines.push(`- 修辞特点：${mergedFeatures.rhetoric}`);
        }
        if (mergedFeatures.dialogueStyle) {
            lines.push(`- 对话风格：${mergedFeatures.dialogueStyle}`);
        }
        if (mergedFeatures.paragraphStructure) {
            lines.push(`- 段落结构：${mergedFeatures.paragraphStructure}`);
        }
        if (mergedFeatures.overallTone) {
            lines.push(`- 整体基调：${mergedFeatures.overallTone}`);
        }

        if (enabledFingerprints.length <= 2) {
            lines.push('');
            lines.push('参考指纹来源：');
            enabledFingerprints.forEach(fp => {
                lines.push(`  · ${fp.name}（${fp.source || '未知来源'}）`);
            });
        }

        return lines;
    }

    /**
     * 取「当前项目实际生效」的指纹，唯一真相源是指纹库的启用状态。
     *
     * 旧实现只读 `profile.fingerprint.enabledProject/enabledGlobal`，而这两个数组
     * 在全仓没有任何写入方（默认空、只能手改画像文件）：11 步正文生成的
     * 「写作指纹风格参考」因此永远为空，指纹只对协同写作生效。
     * 口径与 `PromptBuilder#getFingerprintPromptParts` 对齐：强度 0（界面「完全禁用」）一并跳过。
     */
    private async getEnabledFingerprintsFromLibrary(query = ''): Promise<StyleFingerprint[]> {
        if (!this.fingerprintLibrary) return [];

        // 强度配置必须先读盘：getIntensityConfig 只查内存 map，不 load 一律回落到默认强度
        await this.fingerprintLibrary.loadIntensityConfigs();

        const candidates = [
            ...this.fingerprintLibrary.listProject().filter(fp => fp.enabled),
            ...this.fingerprintLibrary.listGlobal()
                .filter(fp => this.fingerprintLibrary!.isGlobalEnabledForProject(fp.id)),
        ];

        const active = candidates.filter(fp => {
            const config = this.fingerprintLibrary!.getIntensityConfig(fp.id);
            return !intensityEngine.previewIntensity(config).disabled;
        });

        // B4：11 步与协同共用同一选择器，避免启用 10 个指纹时 system 线性膨胀。
        // 检索失败回退「前 N 个」而不是全量：这里没有协同那样的宽松预算。
        const library = this.fingerprintLibrary;
        const searcher = library.searchSimilarStylesV2;
        return selectFingerprintsForInjection(active, {
            query,
            searchV2: typeof searcher === 'function'
                ? (q, opts) => searcher.call(library, q, opts)
                : undefined,
            fallback: 'firstN',
            onFallback: reason => getDegradationNotifier().notify({
                source: 'vector',
                dimension: 'style',
                from: 'v2_ranking',
                to: 'first_n_enabled',
                reason: `11 步指纹注入回退前 ${MAX_INJECTED_STYLE_FINGERPRINTS} 个：${reason}`,
                severity: 'warning',
                recoverable: true,
            }),
        });
    }

    private mergeFingerprintFeatures(fingerprints: StyleFingerprint[]): Partial<StyleFingerprintFeatures> {
        if (fingerprints.length === 0) return {};
        if (fingerprints.length === 1) return this.truncateFeatureFields(fingerprints[0].features);

        const featureKeys: Array<keyof StyleFingerprintFeatures> = [
            'sentenceRhythm', 'wordPreference', 'narrativeStyle',
            'rhetoric', 'dialogueStyle', 'paragraphStructure', 'overallTone'
        ];

        const result: Partial<StyleFingerprintFeatures> = {};

        featureKeys.forEach(key => {
            const values = fingerprints
                .map(fp => fp.features[key])
                .filter(v => v && v.trim().length > 0);
            
            if (values.length > 0) {
                const uniqueValues = [...new Set(values)];
                const merged = uniqueValues.length === 1
                    ? uniqueValues[0]
                    : uniqueValues.slice(0, 2).join('；');
                // B4：每字段硬上限，避免多个指纹拼接后把 system 撑爆
                result[key] = merged.length > FINGERPRINT_FIELD_CHAR_LIMIT
                    ? `${merged.slice(0, FINGERPRINT_FIELD_CHAR_LIMIT)}…（已合并 ${uniqueValues.length} 个指纹）`
                    : merged;
            }
        });

        return result;
    }

    /** 单指纹直通也要截断：单个指纹的特征字段本身可能超长 */
    private truncateFeatureFields(features: StyleFingerprintFeatures): Partial<StyleFingerprintFeatures> {
        const result: Partial<StyleFingerprintFeatures> = {};
        for (const [key, value] of Object.entries(features || {})) {
            if (typeof value !== 'string' || value.length <= FINGERPRINT_FIELD_CHAR_LIMIT) {
                (result as Record<string, unknown>)[key] = value;
                continue;
            }
            (result as Record<string, unknown>)[key] = `${value.slice(0, FINGERPRINT_FIELD_CHAR_LIMIT)}…`;
        }
        return result;
    }

    private buildRhythmInjection(profile: WritingProfile, context: InjectionContext, strength: number): string {
        const rhythm = profile.rhythm;
        const lines: string[] = [];

        const paceDesc = rhythm.pace === 'fast' ? '快节奏' : rhythm.pace === 'slow' ? '慢节奏' : '中等节奏';
        lines.push(`整体节奏：${paceDesc}`);
        lines.push(`节奏模式：${rhythm.pacingPattern}`);

        if (strength >= 0.3) {
            lines.push(`目标字数：每章约 ${rhythm.chapterTargetWords} 字`);
            lines.push(`高潮频率：${rhythm.climaxFrequency}`);
        }

        if (strength >= 0.5 && context.chapterIndex !== undefined && context.totalChapters) {
            const position = context.chapterIndex / context.totalChapters;
            let positionAdvice = '';

            if (position < 0.2) {
                positionAdvice = '本章处于故事开篇阶段，应注重背景铺垫和人物引入，节奏可稍缓以建立读者代入感';
            } else if (position < 0.5) {
                positionAdvice = '本章处于故事发展阶段，应逐步提升节奏，推进主线剧情，设置小悬念吸引读者';
            } else if (position < 0.8) {
                positionAdvice = '本章处于故事中段，节奏应加快，冲突升级，为高潮做充分铺垫';
            } else {
                positionAdvice = '本章接近故事结尾，节奏应推向高潮，然后适度收束，给读者留下回味空间';
            }

            lines.push('');
            lines.push(`章节位置建议：${positionAdvice}`);
        }

        if (context.sceneType && strength >= 0.4) {
            const sceneRhythmAdvice = this.getSceneRhythmAdvice(context.sceneType);
            if (sceneRhythmAdvice) {
                lines.push('');
                lines.push(`场景节奏建议：${sceneRhythmAdvice}`);
            }
        }

        return lines.join('\n');
    }

    private getSceneRhythmAdvice(sceneType: string): string {
        const adviceMap: Record<string, string> = {
            '战斗': '战斗场景节奏要快，多用短句，动作描写要紧凑，让读者有身临其境的紧张感',
            '对话': '对话场景节奏可中等偏快，通过对话推进剧情，注意人物语言风格的一致性',
            '描写': '环境描写节奏可稍缓，用细腻的笔触营造氛围，但不要拖沓，要服务于情节或人物',
            '过渡': '过渡场景节奏要适中，承上启下，不要停留太久，快速推进到下一个重要场景',
            '高潮': '高潮场景节奏要最快，短句密集，冲突激烈，情绪张力拉满',
            '铺垫': '铺垫场景节奏可稍缓，看似不经意地埋下伏笔，为后续剧情做准备',
            '情感': '情感场景节奏可放慢，给人物和读者留出感受的空间，注重细节描写',
        };

        return adviceMap[sceneType] || '';
    }

    private async buildTechniqueInjection(profile: WritingProfile, context: InjectionContext, strength: number): Promise<string> {
        const enabledTechniques = profile.techniques.enabled;
        if (enabledTechniques.length === 0) return '';

        const lines: string[] = [];
        let selectedTechniques: string[] = [];

        if (this.vectorEnhancer && context.outline && strength >= 0.6) {
            try {
                const available = Object.keys(TECHNIQUE_LIBRARY).filter(t => enabledTechniques.includes(t));
                if (available.length > 0) {
                    const matches = await this.vectorEnhancer.semanticMatch(
                        context.outline,
                        available,
                        3
                    );
                    selectedTechniques = matches.map(m => m.item);
                }
            } catch {
                selectedTechniques = enabledTechniques.slice(0, 3);
            }
        } else {
            selectedTechniques = enabledTechniques.slice(0, 3);
        }

        if (selectedTechniques.length === 0) return '';

        for (let i = 0; i < selectedTechniques.length; i++) {
            const tech = selectedTechniques[i];
            const desc = TECHNIQUE_LIBRARY[tech] || '写作技巧';
            if (strength >= 0.5) {
                lines.push(`${i + 1}. ${tech}：${desc}`);
            } else {
                lines.push(`- ${tech}`);
            }
        }

        return lines.join('\n');
    }

    private buildCharacterInjection(profile: WritingProfile, context: InjectionContext, strength: number): string {
        const characterNames = context.characterNames || [];
        if (characterNames.length === 0) return '';

        const lines: string[] = [];

        if (strength < 0.3) {
            lines.push(`出场人物：${characterNames.join('、')}`);
        } else {
            lines.push('出场人物核心特征：');
            for (const name of characterNames.slice(0, 5)) {
                if (strength >= 0.7) {
                    lines.push(`- ${name}：请参考该角色的完整人物小传，确保言行符合其性格设定`);
                } else {
                    lines.push(`- ${name}：注意保持人物性格和语言风格的一致性`);
                }
            }
            if (characterNames.length > 5) {
                lines.push(`- 以及其他 ${characterNames.length - 5} 位人物`);
            }
        }

        return lines.join('\n');
    }

    private async buildForeshadowInjection(profile: WritingProfile, context: InjectionContext, strength: number): Promise<string> {
        if (!this.foreshadowManager) return '';

        try {
            const projectPath = context.projectPath;
            const { items } = await this.foreshadowManager.getUnrevealedForeshadows(projectPath);

            if (items.length === 0) return '';

            const lines: string[] = [];
            const currentChapter = context.chapterIndex;

            let dueItems: ForeshadowItem[] = [];
            let upcomingItems: ForeshadowItem[] = [];

            for (const item of items) {
                const plannedMatch = (item.plannedReveal || '').match(/第(\d+)章/);
                if (plannedMatch && currentChapter !== undefined) {
                    const plannedChap = parseInt(plannedMatch[1], 10);
                    if (plannedChap <= currentChapter) {
                        dueItems.push(item);
                    } else if (plannedChap - currentChapter <= 3) {
                        upcomingItems.push(item);
                    }
                }
            }

            if (dueItems.length > 0) {
                lines.push('【需回收的伏笔】');
                for (let i = 0; i < Math.min(dueItems.length, 5); i++) {
                    const item = dueItems[i];
                    lines.push(`${i + 1}. ${item.name}（重要度：${item.importance || '中'}，计划回收：${item.plannedReveal || '待定'}）`);
                }
                if (dueItems.length > 5) {
                    lines.push(`... 还有 ${dueItems.length - 5} 个待回收伏笔`);
                }
            }

            if (upcomingItems.length > 0 && strength >= 0.5) {
                if (dueItems.length > 0) lines.push('');
                lines.push('【即将到期的伏笔】');
                for (let i = 0; i < Math.min(upcomingItems.length, 3); i++) {
                    const item = upcomingItems[i];
                    lines.push(`${i + 1}. ${item.name}（计划回收：${item.plannedReveal}）—— 可适当铺垫`);
                }
            }

            if (dueItems.length === 0 && upcomingItems.length === 0) {
                if (strength >= 0.3) {
                    lines.push('当前无紧急待回收伏笔，可根据需要埋设新伏笔');
                } else {
                    return '';
                }
            }

            return lines.join('\n');
        } catch {
            return '';
        }
    }

    private buildRulesInjection(profile: WritingProfile): string {
        const rules = profile.customRules;
        if (rules.length === 0) return '';

        const lines: string[] = [];
        for (let i = 0; i < rules.length; i++) {
            lines.push(`${i + 1}. ${rules[i]}`);
        }

        return lines.join('\n');
    }

    async injectKnowledgeBase(context: InjectionContext, baseStrength: number = 0.7): Promise<string> {
        if (!this.enabled) return '';
        if (!this.knowledgeVectorStore || this.referenceBooks.length === 0) return '';

        const sections: Array<{ title: string; content: string }> = [];
        const sceneCategory = context.sceneType 
            ? this.detectSceneCategory(context.sceneType)
            : context.currentText 
                ? this.detectSceneCategory(context.currentText)
                : 'unknown';
        const adjustments = this.getSceneDimensionAdjustments(sceneCategory);
        const adjustedWeights = { ...this.dimensionWeights };
        for (const [key, value] of Object.entries(adjustments)) {
            if (value !== undefined) {
                adjustedWeights[key as keyof KnowledgeDimensionWeights] *= value;
            }
        }

        try {
            if (this.switches.kbCharacter && adjustedWeights.character > 0.1) {
                const content = await this.buildKbCharacterInjection(context, baseStrength * adjustedWeights.character);
                if (content) sections.push({ title: '参考人设', content });
            }
        } catch (e) {
            log.warn('[KnowledgeInjector] 知识库人设注入失败:', e);
        }

        try {
            if (this.switches.kbWorldview && adjustedWeights.worldview > 0.1) {
                const content = await this.buildKbWorldviewInjection(context, baseStrength * adjustedWeights.worldview);
                if (content) sections.push({ title: '参考设定（结构拆解）', content });
            }
        } catch (e) {
            log.warn('[KnowledgeInjector] 知识库世界观注入失败:', e);
        }

        try {
            if (this.switches.kbTechnique && adjustedWeights.technique > 0.1) {
                const content = await this.buildKbTechniqueInjection(context, baseStrength * adjustedWeights.technique);
                if (content) sections.push({ title: '参考写作技巧', content });
            }
        } catch (e) {
            log.warn('[KnowledgeInjector] 知识库技巧注入失败:', e);
        }

        try {
            if (this.switches.kbStyle && adjustedWeights.style > 0.1) {
                const content = await this.buildKbStyleInjection(context, baseStrength * adjustedWeights.style);
                if (content) sections.push({ title: '参考文风风格', content });
            }
        } catch (e) {
            log.warn('[KnowledgeInjector] 知识库风格注入失败:', e);
        }

        try {
            if (this.switches.kbRhythm && adjustedWeights.rhythm > 0.1) {
                const content = await this.buildKbRhythmInjection(context, baseStrength * adjustedWeights.rhythm);
                if (content) sections.push({ title: '参考节奏模式', content });
            }
        } catch (e) {
            log.warn('[KnowledgeInjector] 知识库节奏注入失败:', e);
        }

        if (sections.length === 0) return '';

        const bookNames = this.referenceBooks.map(b => `《${b.bookName}》${b.isPrimary ? '（主参考）' : ''}`).join('、');
        const header = `参考书籍：${bookNames}\n当前场景类型：${sceneCategory === 'unknown' ? '自动检测中' : this.getSceneCategoryLabel(sceneCategory)}`;

        return this.formatKnowledgeInjection(header, sections);
    }

    private getSceneCategoryLabel(category: SceneCategory): string {
        const labels: Record<SceneCategory, string> = {
            battle: '战斗场景',
            daily: '日常场景',
            emotion: '情感场景',
            suspense: '悬疑场景',
            transition: '过渡场景',
            climax: '高潮场景',
            unknown: '通用',
        };
        return labels[category] || '通用';
    }

    private async buildKbCharacterInjection(context: InjectionContext, strength: number): Promise<string> {
        if (!this.knowledgeVectorStore || strength < 0.2) return '';

        const bookIds = this.getReferenceBookIds();
        if (bookIds.length === 0) return '';

        try {
            const results = (await this.retrieveKb(context, ['character'], Math.max(2, Math.round(strength * 5)), 900)).hits;

            if (results.length === 0) return '';

            const lines: string[] = [];
            const byBook = this.groupResultsByBook(results);

            const sortedBooks = Object.entries(byBook).sort((a, b) => {
                const aConfig = this.referenceBooks.find(rb => rb.bookName === a[0]);
                const bConfig = this.referenceBooks.find(rb => rb.bookName === b[0]);
                const aWeight = aConfig?.weight ?? 0.5;
                const bWeight = bConfig?.weight ?? 0.5;
                return bWeight - aWeight;
            });

            for (const [bookName, bookResults] of sortedBooks) {
                const bookConfig = this.referenceBooks.find(rb => rb.bookName === bookName);
                const weightLabel = bookConfig?.isPrimary ? '主参考' : `权重${Math.round((bookConfig?.weight ?? 0.5) * 100)}%`;
                
                if (strength >= 0.5) {
                    lines.push(`【${bookName}】（${weightLabel}）：`);
                    for (let i = 0; i < Math.min(bookResults.length, 3); i++) {
                        const r = bookResults[i];
                        const sample = r.sample.slice(0, 150);
                        const category = r.category ? ` [${r.category}]` : '';
                        lines.push(`  ${i + 1}. ${sample}${category}`);
                    }
                } else {
                    const top = bookResults[0];
                    if (top) {
                        const sample = top.sample.slice(0, 100);
                        lines.push(`- 《${bookName}》：${sample}`);
                    }
                }
            }

            return lines.join('\n');
        } catch {
            return '';
        }
    }

    private async buildKbWorldviewInjection(context: InjectionContext, strength: number): Promise<string> {
        if (!this.knowledgeVectorStore || strength < 0.2) return '';

        const bookIds = this.getReferenceBookIds();
        if (bookIds.length === 0) return '';

        try {
            const results = (await this.retrieveKb(context, ['structure'], Math.max(2, Math.round(strength * 4)), 700)).hits;

            if (results.length === 0) return '';

            const lines: string[] = [];
            const byBook = this.groupResultsByBook(results);

            for (const [bookName, bookResults] of Object.entries(byBook)) {
                const bookConfig = this.referenceBooks.find(rb => rb.bookName === bookName);
                if (strength >= 0.5) {
                    lines.push(`【${bookName}】设定参考（结构拆解）：`);
                    for (let i = 0; i < Math.min(bookResults.length, 2); i++) {
                        const r = bookResults[i];
                        const sample = r.sample.slice(0, 180);
                        lines.push(`  ${i + 1}. ${sample}`);
                    }
                } else {
                    const top = bookResults[0];
                    if (top) {
                        const sample = top.sample.slice(0, 120);
                        lines.push(`- 《${bookName}》：${sample}`);
                    }
                }
            }

            return lines.join('\n');
        } catch {
            return '';
        }
    }

    private async buildKbTechniqueInjection(context: InjectionContext, strength: number): Promise<string> {
        if (!this.knowledgeVectorStore || strength < 0.2) return '';

        const bookIds = this.getReferenceBookIds();
        if (bookIds.length === 0) return '';

        try {
            // structure 由「设定」段单独注入：混在这里会以「起/承/转/合」占满
            // 技巧的 5 个类别名额，并让同一段结构文本重复进入 prompt。
            const results = (await this.retrieveKb(context, ['technique'], Math.max(3, Math.round(strength * 6)), 800)).hits;

            if (results.length === 0) return '';

            const lines: string[] = [];
            const uniqueTechniques = new Set<string>();
            const techniqueExamples: Array<{ name: string; example: string; book: string; score: number }> = [];

            for (const r of results) {
                const category = r.category || '通用技巧';
                // 每个技巧类别只保留最高分示例：旧条件 `|| techniqueExamples.length < 5`
                // 会让前 5 条即使同类别也全部加入，同一技巧重复占满预算
                if (uniqueTechniques.has(category)) continue;
                uniqueTechniques.add(category);
                techniqueExamples.push({
                    name: category,
                    example: r.sample.slice(0, 120),
                    book: r.bookName,
                    score: r.score,
                });
                if (techniqueExamples.length >= 5) break;
            }

            if (techniqueExamples.length === 0) return '';

            if (strength >= 0.6) {
                lines.push('推荐使用以下写作技巧（附参考示例）：');
                for (let i = 0; i < Math.min(techniqueExamples.length, 5); i++) {
                    const t = techniqueExamples[i];
                    lines.push(`${i + 1}. ${t.name}——《${t.book}》参考：`);
                    lines.push(`   "${t.example}"`);
                }
            } else {
                const topTechs = Array.from(uniqueTechniques).slice(0, 3);
                lines.push(`可借鉴的技巧：${topTechs.join('、')}`);
            }

            return lines.join('\n');
        } catch {
            return '';
        }
    }

    private async buildKbStyleInjection(context: InjectionContext, strength: number): Promise<string> {
        if (!this.knowledgeVectorStore || strength < 0.2) return '';

        const bookIds = this.getReferenceBookIds();
        if (bookIds.length === 0) return '';

        const queryText = context.currentText || context.outline || '';
        if (!queryText) return '';

        try {
            const topN = Math.max(3, Math.round(strength * 5));
            // style 每本书约 5 条，原文分块每本最多 120 条：同一次 topN 检索里原文几乎必然把
            // 风格分析样本挤光（「文风参考」只剩原文片段）。按维度分别检索，给风格留固定配额，
            // 原文侧仍按 40 字重叠做相邻去重；风格侧不足时用风格剩余结果补齐总条数。
            // 原文侧不足时不做反向补位：渲染端每本书最多展示 3 条，单本情况下补位不可见。
            const styleQuota = Math.max(1, Math.round(topN / 3));
            const originalQuota = Math.max(1, topN - styleQuota);
            // style 与 original 两维度配额不同（风格分析 vs 原文片段），
            // 走统一检索会共用一份预算、互相挤占；这里保留分开检索，
            // 但仍复用向量库的查询向量缓存（同一 queryText 只 embed 一次）。
            const [styleResults, originalCandidates] = await Promise.all([
                this.knowledgeVectorStore.search(queryText, {
                    topN,
                    bookIds,
                    dimensions: ['style'],
                }),
                this.knowledgeVectorStore.search(queryText, {
                    // 多取一倍再相邻去重，避免去重后条数不足
                    topN: originalQuota * 2,
                    bookIds,
                    dimensions: ['original'],
                }),
            ]);

            const stylePicked = styleResults.slice(0, styleQuota);
            const originalPicked = dedupeAdjacentChunks(originalCandidates).slice(0, originalQuota);
            const remaining = Math.max(0, topN - stylePicked.length - originalPicked.length);
            const results = [
                ...stylePicked,
                ...originalPicked,
                ...styleResults.slice(styleQuota, styleQuota + remaining),
            ]
                .sort((a, b) => b.score - a.score)
                .slice(0, topN);

            if (results.length === 0) return '';

            const lines: string[] = [];
            const byBook = this.groupResultsByBook(results);

            const sortedBooks = Object.entries(byBook).sort((a, b) => {
                const aConfig = this.referenceBooks.find(rb => rb.bookName === a[0]);
                const bConfig = this.referenceBooks.find(rb => rb.bookName === b[0]);
                const aWeight = aConfig?.weight ?? 0.5;
                const bWeight = bConfig?.weight ?? 0.5;
                return bWeight - aWeight;
            });

            if (strength >= 0.7) {
                lines.push('请参考以下风格片段，在文风上尽量贴近：');
                for (const [bookName, bookResults] of sortedBooks) {
                    const bookConfig = this.referenceBooks.find(rb => rb.bookName === bookName);
                    const isPrimary = bookConfig?.isPrimary ? '（主参考）' : '';
                    lines.push('');
                    lines.push(`【${bookName}】${isPrimary}文风参考：`);
                    for (let i = 0; i < Math.min(bookResults.length, 3); i++) {
                        const r = bookResults[i];
                        const sample = r.sample.slice(0, 200);
                        lines.push(`${i + 1}. "${sample}"`);
                    }
                }
            } else {
                lines.push('文风参考来源：');
                for (const [bookName] of sortedBooks) {
                    const top = byBook[bookName][0];
                    if (top) {
                        const sample = top.sample.slice(0, 80);
                        lines.push(`- 《${bookName}》："${sample}..."`);
                    }
                }
            }

            return lines.join('\n');
        } catch {
            return '';
        }
    }

    private async buildKbRhythmInjection(context: InjectionContext, strength: number): Promise<string> {
        if (!this.knowledgeVectorStore || strength < 0.2) return '';

        const bookIds = this.getReferenceBookIds();
        if (bookIds.length === 0) return '';

        try {
            const results = (await this.retrieveKb(context, ['rhythm'], Math.max(2, Math.round(strength * 4)), 600)).hits;

            if (results.length === 0) return '';

            const lines: string[] = [];
            const byBook = this.groupResultsByBook(results);

            if (strength >= 0.5) {
                lines.push('参考书籍的节奏特点：');
                for (const [bookName, bookResults] of Object.entries(byBook)) {
                    lines.push('');
                    lines.push(`【${bookName}】：`);
                    for (let i = 0; i < Math.min(bookResults.length, 2); i++) {
                        const r = bookResults[i];
                        const sample = r.sample.slice(0, 150);
                        // position 是分块下标，不是比例；交给统一格式化，避免出现「位置4500%」
                        const chunkLabel = formatKnowledgeChunkLabel(r.position);
                        const position = chunkLabel ? `（${chunkLabel}）` : '';
                        lines.push(`  ${i + 1}. ${sample}${position}`);
                    }
                }
            } else {
                const bookNames = Object.keys(byBook).join('、');
                lines.push(`节奏模式参考${bookNames ? `《${bookNames}》` : ''}`);
            }

            return lines.join('\n');
        } catch {
            return '';
        }
    }

    private groupResultsByBook(results: KnowledgeSearchResult[]): Record<string, KnowledgeSearchResult[]> {
        const byBook: Record<string, KnowledgeSearchResult[]> = {};
        for (const r of results) {
            if (!byBook[r.bookName]) {
                byBook[r.bookName] = [];
            }
            byBook[r.bookName].push(r);
        }
        return byBook;
    }

    private formatKnowledgeInjection(header: string, sections: Array<{ title: string; content: string }>): string {
        if (sections.length === 0) return '';

        const parts: string[] = ['## 知识库参考', '', header, ''];

        for (const section of sections) {
            if (!section.content.trim()) continue;
            parts.push(`### ${section.title}`);
            parts.push(section.content);
            parts.push('');
        }

        return parts.join('\n').trim() + '\n';
    }

    getKnowledgeMatchScore(text: string): Array<{ bookName: string; score: number; dimensions: string[] }> {
        const results: Array<{ bookName: string; score: number; dimensions: string[] }> = [];
        if (!text || this.referenceBooks.length === 0) return results;

        for (const book of this.referenceBooks) {
            const dimensions: string[] = [];
            let baseScore = book.weight * 50;

            if (this.switches.kbStyle) { dimensions.push('风格'); baseScore += 10; }
            if (this.switches.kbCharacter) { dimensions.push('人设'); baseScore += 10; }
            if (this.switches.kbTechnique) { dimensions.push('技巧'); baseScore += 10; }
            if (this.switches.kbWorldview) { dimensions.push('结构设定'); baseScore += 5; }
            if (this.switches.kbRhythm) { dimensions.push('节奏'); baseScore += 5; }

            results.push({
                bookName: book.bookName,
                score: Math.min(95, Math.round(baseScore)),
                dimensions,
            });
        }

        return results.sort((a, b) => b.score - a.score);
    }

    async getBookDimensionSummary(bookId: string): Promise<Record<string, string> | null> {
        if (!this.knowledgeManager) return null;

        try {
            const book = await this.knowledgeManager.getBook(bookId);
            if (!book) return null;

            const summary: Record<string, string> = {
                name: book.name,
                author: book.author || '未知',
                wordCount: book.wordCount ? `${(book.wordCount / 10000).toFixed(0)}万字` : '未知',
                genre: book.primaryGenre || '未分类',
                quality: book.qualityScores ? `${book.qualityScores.overall.toFixed(0)}分` : '未评分',
            };

            const status = await this.knowledgeManager.getDimensionStatus(bookId);
            summary.dimensions = Object.entries(status)
                .filter(([, s]) => s === 'completed')
                .map(([d]) => d)
                .join('、') || '无';

            return summary;
        } catch {
            return null;
        }
    }

    private formatInjection(sections: Array<{ title: string; content: string }>, strength?: number): string {
        // v4.20 注入溯源：即使为空也记录（空 = 该指引线本次未生效）
        this.lastInjectionMeta = {
            sections: sections.map((section) => ({ title: section.title, chars: section.content.trim().length })),
            totalChars: sections.reduce((sum, section) => sum + section.content.trim().length, 0),
            strength,
            // v4.20 RAG 遥测：随注入账本展示「知识注入」段到底检索到什么
            retrieval: { ...this.retrievalTelemetry },
        };
        // 每次注入完成后清零，下一次注入拿到的是本轮自己的数字
        this.retrievalTelemetry = { calls: 0, queries: 0, hits: 0, deduped: 0, neighborMerged: 0, dropped: 0, chars: 0, cacheHits: 0, cacheMisses: 0, errors: 0 };
        if (sections.length === 0) return '';

        const parts: string[] = ['## 写作指引', ''];

        for (const section of sections) {
            if (!section.content.trim()) continue;
            parts.push(`### ${section.title}`);
            parts.push(section.content);
            parts.push('');
        }

        return parts.join('\n').trim() + '\n';
    }
}
