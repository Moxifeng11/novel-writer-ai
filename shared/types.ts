/** ==== Frontmatter 类型接口 (v4.0) ====
 * 所有 frontmatter 类型集中定义于此，确保字段名类型安全。
 * 每个接口都保留 [key: string]: any 索引签名，允许运行时扩展字段。
 *
 * v4.0 变更：
 * - 正文 status 改为英文枚举（pending | written | settled）
 * - 步骤文件新增 step_status / step_model / step_timestamp
 * - 实体文件新增 entity_status / entity_created_at / entity_last_changed_at / entity_last_changed_reason
 * - 删除 source 字段依赖
 */

// ============================================================
// 通用通知回调接口 (v4.3.0)
// ============================================================

/** 通用通知回调 — 所有 engine 类统一使用，替代直接 new Notice() */
export interface Notifier {
    /** 普通通知（默认5秒） */
    showNotice(message: string, duration?: number): void;
    /** 成功通知 */
    showSuccess?(message: string, duration?: number): void;
    /** 错误通知 */
    showError?(message: string, duration?: number): void;
    /** 警告通知 */
    showWarning?(message: string, duration?: number): void;
    /** 持久进度通知（返回 hide 函数） */
    showProgress?(message: string): () => void;
}

/** 空实现 Notifier — 用于测试或无 UI 场景 */
export const NOOP_NOTIFIER: Notifier = {
    showNotice: () => {},
    showSuccess: () => {},
    showError: () => {},
    showWarning: () => {},
    showProgress: () => () => {},
};

// ============================================================
// 状态枚举
// ============================================================

/** 正文文件状态 */
export type BodyStatus = 'pending' | 'written' | 'settled';

/** 步骤文件状态 */
export type StepStatus = 'pending' | 'generated' | 'reviewed' | 'stale';

/** 实体状态 */
export type EntityStatus = 'active' | 'inactive' | 'dead' | 'hidden';

/** 写作模式 */
export type WritingMode = 'pipeline' | 'co-writer';

// ============================================================
// 步骤文件公共字段
// ============================================================

/** 所有步骤文件共有字段 */
export interface StepFileMeta {
    step_status: StepStatus;
    step_model?: string;
    step_timestamp?: string;
}

// ============================================================
// 实体文件公共字段
// ============================================================

/** 所有实体文件（人物/地点/势力/物品）共有字段 */
export interface EntityMeta {
    // 读取来源（metadataCache.frontmatter / parseFm 的 Record）不保证存在该字段，
    // 旧文件可能缺失；写入侧（entity-state-manager / settlement-engine）会按需补 'active'。
    entity_status?: EntityStatus;
    entity_created_at?: string;
    entity_last_changed_at?: string;
    entity_last_changed_reason?: string;
}

// ============================================================
// 正文 frontmatter
// ============================================================

export interface ChapterFrontmatter {
    tags?: string | string[];
    卷?: string;
    章?: string;
    标题?: string;
    status?: BodyStatus;              // v4.0: pending | written | settled
    word_count?: number;              // v4.0 新增：自动统计
    writing_mode?: WritingMode;       // v4.0 新增：pipeline | co-writer
    涉及人物?: string[];
    涉及地点?: string[];
    涉及势力?: string[];
    涉及物品功法?: string[];
    审查时间?: string;
    scenes?: SceneNode[];             // v6.0 新增：场景列表
    [key: string]: any;
}

// ============================================================
// 人物 frontmatter
// ============================================================

export interface CharacterFrontmatter extends EntityMeta {
    tags?: string | string[];
    name?: string;
    姓名?: string;
    年龄?: string;
    身份?: string;                    // 主角 | 配角 | 反派 | 路人
    性别?: string;                    // v4.0 新增
    首次出场?: string;                // v4.0 新增
    核心动机?: string;
    核心驱动力_软肋?: string;
    习惯性小动作?: string;
    当前状态?: string;
    当前情绪?: string;
    当前位置?: string;                // v4.0 新增
    性格标签?: string;
    '金手指/特殊能力'?: string;
    '功法/技能树'?: string;
    修为等级?: string;                // v4.0 新增
    所属势力?: string;
    人物背景?: string;
    外貌特征?: string;
    当前目标?: string;
    fileName?: string;
    filePath?: string;
    [key: string]: any;
}

// ============================================================
// 统一角色领域模型 — 聚合 frontmatter + soul + 原始内容
// v6.x: 已迁移至 shared/entity-models.ts，此处重新导出以保持向后兼容
// ============================================================

export type {
    CharacterDomainModel,
    CharacterSoulData,
    PersonalityLayers,
    CharacterArc,
    CharacterRelation,
} from './entity-models';

export { toDomainModel } from './entity-models';

/** 角色原始内容容器（生成器输出） */
export interface CharacterRawData {
    name: string;
    rawContent: string;
}

// ============================================================
// 势力 frontmatter
// ============================================================

export interface FactionFrontmatter extends EntityMeta {
    tags?: string | string[];
    名称?: string;
    别称?: string;
    类型?: string;
    描述?: string;
    领袖?: string;
    '地位/排名'?: string;
    [key: string]: any;
}

// ============================================================
// 地点 frontmatter
// ============================================================

export interface LocationFrontmatter extends EntityMeta {
    tags?: string | string[];
    名称?: string;
    别称?: string;
    类型?: string;
    描述?: string;
    重要程度?: string;
    地理特征?: string;
    '主要居民/势力'?: string;
    '所在世界/区域'?: string;
    [key: string]: any;
}

// ============================================================
// 物品功法 frontmatter
// ============================================================

export interface ItemFrontmatter extends EntityMeta {
    tags?: string | string[];
    名称?: string;
    类型?: string;
    '品阶/等级'?: string;
    描述?: string;
    效果?: string;
    '所属/归属'?: string;
    [key: string]: any;
}

// ============================================================
// 分析报告 frontmatter
// ============================================================

export interface AnalysisFrontmatter extends StepFileMeta {
    tags?: string | string[];
    卷?: string;
    章?: string;
    [key: string]: any;
}

// ============================================================
// 分卷大纲树状预览数据结构
// ============================================================

export interface OutlineTreeChapter {
    num: number;
    conflict: string;
    summary: string;
}

export interface OutlineTreeVolume {
    num: number;
    title: string;
    chapters: OutlineTreeChapter[];
}

// ============================================================
// 场景级细纲数据结构 (v6.0 新增)
// ============================================================

/** 场景状态（v6.0+ 统一定义，兼容所有使用场景） */
export type SceneStatus = 'not_started' | 'writing' | 'in_progress' | 'completed' | 'needs_revision';

/** 场景类型 */
export type SceneType =
    | 'action'              // 动作场面
    | 'dialogue'            // 对话推进
    | 'emotion'             // 情绪/内心描写
    | 'description'         // 环境/感官描写
    | 'transition'          // 场景转换
    | 'climax'              // 高潮戏
    | 'foreshadow'          // 伏笔埋设
    | 'resolution';         // 收束

/** 伏笔引用 */
export interface ForeshadowRef {
    /** 伏笔 ID */
    id: string;
    /** 伏笔名称 */
    name: string;
    /** 类型：埋设/回收 */
    type: 'plant' | 'payoff';
}

/** 场景节点 */
export interface SceneNode {
    /** 场景唯一 ID */
    id: string;
    /** 场景序号 */
    order: number;
    /** 场景标题 */
    title: string;
    /** 场景类型 */
    type: SceneType;
    /** 场景状态 */
    status: SceneStatus;
    /** 场景概要（50-200字） */
    summary: string;
    /** 涉及人物 */
    characters: string[];
    /** 涉及地点 */
    locations: string[];
    /** 涉及势力 */
    factions: string[];
    /** 涉及物品功法 */
    items: string[];
    /** 伏笔引用 */
    foreshadowRefs: ForeshadowRef[];
    /** 预计字数 */
    wordCountPlan: number;
    /** 实际字数 */
    wordCountActual: number;
    /** 关键对话要点 */
    keyDialogues?: string[];
    /** 情绪变化曲线 */
    emotionArc?: string;
    /** 场景目标 */
    objective?: string;
    /** 场景障碍 */
    obstacle?: string;
    /** 场景结果 */
    outcome?: string;
    /** 创建时间 */
    createdAt?: string;
    /** 最后修改时间 */
    lastChangedAt?: string;

    /** 扩展字段（保持与 ExtendedSceneData 兼容） */
    index?: number;
    name?: string;
    conflict?: string;
    sensoryHook?: string;
    memoryTrigger?: string;
    bodyReaction?: string;
    subtext?: string;
    relationshipShift?: string;
    keyScene?: string;
    dialogueFunction?: string;
    cliffhanger?: string;
    isKeyScene?: boolean;
    location?: string;
    timelinePosition?: string;
    conflictType?: ConflictType;
    pleasureType?: PleasureType;
    infoIncrement?: string;
    foreshadowPlant?: string;
    foreshadowRecover?: string;
    wordCountEstimate?: number;
}

/** 场景类型标签 */
export const SCENE_TYPE_LABELS: Record<SceneType, string> = {
    action: '动作场面',
    dialogue: '对话推进',
    emotion: '情绪描写',
    description: '环境描写',
    transition: '场景转换',
    climax: '高潮戏',
    foreshadow: '伏笔埋设',
    resolution: '收束',
};

/** 场景状态标签 */
export const SCENE_STATUS_LABELS: Record<SceneStatus, string> = {
    not_started: '未开始',
    writing: '写作中',
    in_progress: '进行中',
    completed: '已完成',
    needs_revision: '需修改',
};

/** 三级大纲树（卷 → 章 → 场景） */
export interface SceneOutlineTreeChapter extends OutlineTreeChapter {
    scenes: SceneNode[];
}

export interface SceneOutlineTreeVolume extends OutlineTreeVolume {
    chapters: SceneOutlineTreeChapter[];
}

// ============================================================
// 句级协同写作专用类型 (v5.0 新增)
// ============================================================

/** 建议方向 */
export type SuggestionDirection =
    | 'action'        // 动作场面
    | 'emotion'       // 情绪/内心
    | 'dialogue'      // 对话推进
    | 'description'   // 环境/感官描写
    | 'foreshadow'    // 伏笔埋设
    | 'conflict'      // 冲突升级
    | 'resolution'    // 收束/转场
    | 'surprise';     // 意外转折

/** 单条建议记录 */
export interface SuggestionRecord {
    id: string;                              // 唯一标识
    text: string;                            // 建议文本（50-200字）
    direction: SuggestionDirection;          // 建议方向
    style: 'default' | 'creative' | 'conservative';  // 风格标签
    temperature: number;                     // 生成温度
    reasoning?: string;                      // AI 简要解释（可选）
    preview?: string;                        // 预览片段（前30字 + ...）
    riskLevel?: 'low' | 'medium' | 'high';   // C1: 剧透/越界风险等级
    riskWarnings?: string[];                 // C1: 剧透/越界风险提示
}

/** 编辑验证结果 */
export interface EditValidation {
    isValid: boolean;                        // 是否通过验证
    consistencyScore: number;                // 设定一致性 0-100
    styleScore: number;                      // 文风对齐度 0-100
    plotAlignmentScore: number;              // 剧情对齐度 0-100
    overallScore: number;                    // 综合得分 0-100
    warnings: string[];                      // 警告信息
    suggestions: string[];                   // 改进建议
    validatedAt: number;                     // 验证时间戳
    degraded?: boolean;                      // true = 校验未真正完成（AI 返回无法解析）
    degradedReason?: string;                 // 降级原因，供 UI 展示
}

/** 剧情完成度指标 */
export interface PlotCompletionMetrics {
    sceneObjectivesMet: number;              // 场景目标完成度 0-100
    characterArcsAdvanced: number;           // 人物弧推进度 0-100
    foreshadowingSeeded: number;             // 伏笔埋设程度 0-100
    emotionalArcProgress: number;            // 情绪弧进度 0-100
    overallCompletion: number;               // 总体完成度 0-100
    suggestionAdvice: string;                // AI 建议摘要
    nextDirectionHints: SuggestionDirection[]; // 下一步建议方向
    evaluatedAt: number;                     // 评估时间戳
}

/** 单次交互完整记录 */
export interface SentenceEditRecord {
    id: string;                              // 交互唯一标识
    triggerText: string;                     // 触发建议时的前文（光标前200字）
    cursorPosition: number;                  // 光标位置
    suggestions: SuggestionRecord[];         // AI 生成的 3 条建议
    chosenSuggestionId?: string;             // 用户选了哪条（未选则为空）
    humanModifiedText: string;               // 用户修改后的最终文本
    validationResult?: EditValidation;       // 验证结果（如果手动编辑了）
    editDurationMs: number;                  // 编辑耗时（毫秒）
    createdAt: number;                       // 创建时间戳
    acceptedAt?: number;                     // 接受时间戳
}

/** 协同写作会话状态 */
export interface CoWritingSession {
    project: string;                         // 项目名
    chapterName: string;                     // 章节名
    volume: string;                          // 卷名
    chapterNum: number;                      // 章节序号
    startedAt: number;                       // 开始时间
    interactions: SentenceEditRecord[];      // 所有交互记录
    currentMetrics: PlotCompletionMetrics;   // 当前完成度
    totalWordCount: number;                  // 总字数
    lastSavedAt?: number;                    // 上次保存时间
}


// ============================================================
// v6.0 智能分析报告相关类型
// ============================================================

/** 实体变更类型 */
export type EntityChangeType = 'created' | 'status_updated' | 'appeared' | 'mentioned';

/** 单个实体变更记录 */
export interface EntityChange {
    name: string;
    category: 'character' | 'location' | 'faction' | 'item';
    changeType: EntityChangeType;
    oldValue?: string;
    newValue?: string;
    isMajor: boolean;      // 重大变更标记（如角色死亡）
    context?: string;       // 变更发生的上下文摘录
}

/** 伏笔变更类型 */
export type ForeshadowChangeType = 'planted' | 'recovered' | 'mentioned' | 'abandoned';

/** 单个伏笔变更记录 */
export interface ForeshadowChange {
    id?: string;
    name: string;
    changeType: ForeshadowChangeType;
    plantedChapter?: string;
    context?: string;
}

/** 时间线事件 */
export interface TimelineEvent {
    chapter: number;
    order: number;
    time?: string;
    location?: string;
    event: string;
    involvedEntities: string[];
    importance: 'low' | 'medium' | 'high';
}

/** 情绪曲线数据点 */
export interface EmotionCurvePoint {
    segment: number;          // 段落序号
    startIndex: number;       // 正文起始位置
    endIndex: number;         // 正文结束位置
    intensity: number;        // 情绪强度 0-100
    valence: 'positive' | 'neutral' | 'negative';
    dominantEmotion: string;  // 主导情绪：愤怒/悲伤/喜悦/紧张/平静...
    isInflection: boolean;    // 是否拐点
}

/** 实体更新结果 */
export interface EntityUpdateResult {
    total: number;
    created: string[];
    statusUpdated: Array<{name: string; oldStatus?: string; newStatus: string}>;
    appeared: string[];
    majorChanges: EntityChange[];
}

/** 伏笔更新结果 */
export interface ForeshadowUpdateResult {
    total: number;
    planted: string[];
    recovered: string[];
    mentioned: string[];
}

/** 时间线更新结果 */
export interface TimelineUpdateResult {
    eventsAdded: number;
    existingEvents: TimelineEvent[];
}

/** v6.0 完整分析报告 */
export interface AnalysisReport {
    chapterNum: number;
    chapterName: string;
    wordCount: number;
    
    // 各维度分析数据
    entities: EntityChange[];
    foreshadows: ForeshadowChange[];
    timelineEvents: TimelineEvent[];
    emotionCurve: EmotionCurvePoint[];
    
    // 摘要信息
    summary: string;
    majorWarnings: string[];         // 需要用户确认的重大变更（如角色死亡）
}

/** v6.0 章节结算状态 */
export type ChapterFinalStatus = 'locked' | 'published' | 'archived';

/**
 * v6.0 分析报告引擎输出
 * 包含所有从正文中提取的结构化数据
 */
export interface FullAnalysisReport {
    meta: {
        project: string;
        chapterName: string;
        chapterNum: number;
        volume: string;
        wordCount: number;
        timestamp: string;
        aiModel: string;
        processingTimeMs: number;
    };
    
    entities: {
        characters: EntityChange[];
        locations: EntityChange[];
        factions: EntityChange[];
        items: EntityChange[];
        summary: string;
    };
    
    foreshadows: {
        planted: ForeshadowChange[];
        recovered: ForeshadowChange[];
        mentioned: ForeshadowChange[];
        summary: string;
    };
    
    timeline: {
        events: TimelineEvent[];
        summary: string;
    };
    
    emotionCurve: {
        points: EmotionCurvePoint[];
        avgIntensity: number;
        peakIntensity: number;
        valleyIntensity: number;
        inflectionPoints: number;
        summary: string;
    };
    
    characterConsistency?: {
        overallScore: number;
        characterResults: Record<string, {
            score: number;
            inconsistencies: Array<{
                type: 'personality' | 'behavior' | 'ability' | 'appearance';
                severity: 'low' | 'medium' | 'high';
                description: string;
                location?: string;
                suggestion?: string;
                confidence: number;
            }>;
        }>;
        summary: string;
        details: string;
    };
    
    // 用户可见摘要
    summary: string;
    majorChanges: string[];      // 需要用户确认的重大变更列表
    warnings: string[];          // 警告信息
    suggestions: string[];       // 改进建议
}

// ============================================================
// 场景细纲相关类型 (v6.x 新增)
// ============================================================

/** 冲突类型 */
export type ConflictType = 'internal' | 'external' | 'interpersonal' | '';

/** 爽点类型 */
export type PleasureType = 'face_slap' | 'level_up' | 'reveal' | 'gain' | '';

/** 扩展的场景数据结构（含网文特有字段） */
export interface ExtendedSceneData {
    // 基础信息
    index: number;
    name: string;
    /** 视角人物（默认主角） */
    pov: string;
    /** 场景内时间（非章节时间线位置） */
    time: string;
    /** 入场状态：人物位置/情绪/已知信息 */
    entryState: string;
    /** 场景转折：必须发生一次可指认的变化 */
    turn: string;
    /** 离场状态：必须与入场不同 */
    exitState: string;
    objective: string;
    emotionArc: string;
    conflict: string;
    sensoryHook: string;
    memoryTrigger: string;
    bodyReaction: string;
    subtext: string;
    relationshipShift: string;
    keyScene: string;
    dialogueFunction: string;
    cliffhanger: string;
    /** 可选工艺备注：本场景必须避免/必须做到的写作细节 */
    craftNotes: string;
    isKeyScene: boolean;

    // 网文特有扩展字段
    characters: string;          // 出场人物
    location: string;            // 场景地点
    timelinePosition: string;    // 时间线位置
    conflictType: ConflictType;  // 冲突类型
    pleasureType: PleasureType;  // 爽点类型
    infoIncrement: string;       // 信息增量（本章新披露的设定/信息）
    foreshadowPlant: string;     // 伏笔埋设
    foreshadowRecover: string;   // 伏笔回收

    // 状态与统计
    status: SceneStatus;         // 完成度状态
    wordCountEstimate: number;   // 字数预估
}

/** 创建默认空场景 */
export function createDefaultScene(index: number): ExtendedSceneData {
    return {
        index,
        name: '',
        pov: '',
        time: '',
        entryState: '',
        turn: '',
        exitState: '',
        objective: '',
        emotionArc: '',
        conflict: '',
        sensoryHook: '',
        memoryTrigger: '',
        bodyReaction: '',
        subtext: '',
        relationshipShift: '',
        keyScene: '否',
        dialogueFunction: '',
        cliffhanger: '',
        craftNotes: '',
        isKeyScene: false,
        characters: '',
        location: '',
        timelinePosition: '',
        conflictType: '',
        pleasureType: '',
        infoIncrement: '',
        foreshadowPlant: '',
        foreshadowRecover: '',
        status: 'not_started',
        wordCountEstimate: 0,
    };
}
