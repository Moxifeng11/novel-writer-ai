/**
 * fingerprint-migrator.ts — V1 → V2 写作指纹迁移工具
 *
 * 核心职责：
 * 1. 将 V1（7 维字符串描述）指纹迁移为 V2（12 维结构化）指纹
 * 2. 迁移前自动备份原始 V1 数据（内存 + 文件双备份）
 * 3. 迁移失败自动回滚
 *
 * V1→V2 映射策略：
 * - V1 的 7 个字符串字段映射到 V2 对应维度的 description，标记为 'complete'
 * - V2 新增的 5 维填充默认零值，标记为 'pending'
 * - V1 原始数据保留在 v1Backup 字段中
 *
 * 文件备份策略：
 * - 迁移前写入 `<原路径>.v1.bak` 文件
 * - 迁移成功后保留备份（用于审计/回滚）
 * - 迁移失败时从备份恢复原文件
 *
 * 性能：单次迁移 < 5ms（纯内存操作，无 IO）
 */

import type { FileSystemPort } from '../../shared/file-system-port';
import type {
    V2Fingerprint,
    V1FingerprintBackup,
    StyleFingerprintFeaturesV2,
    StyleDimensionKeyV2,
    RhythmStats,
    SentencePatternStats,
    WordChoiceStats,
    RhetoricStatsV2,
    PerspectiveStats,
    EmotionStats,
    TensionStats,
    InfoDensityStats,
    DialogueStatsV2,
    DescriptionStats,
    NarrationStats,
    LanguageTextureStats,
} from './style-dimensions-v2';
import {
    V1_TO_V2_FIELD_MAP,
    V2_NEW_DIMENSIONS,
} from './style-dimensions-v2';
import { calculateRhythmStats, calculatePerspectiveStats } from './v2-quantitative-extractor';

// ============================================================
// V1 类型定义（本地定义，避免循环依赖）
// ============================================================

/**
 * V1 风格指纹特征（7 维字符串描述）
 * @deprecated V1 类型，仅供迁移使用。新代码应使用 StyleFingerprintFeaturesV2
 */
export interface V1StyleFingerprintFeatures {
    sentenceRhythm: string;
    wordPreference: string;
    narrativeStyle: string;
    rhetoric: string;
    dialogueStyle: string;
    paragraphStructure: string;
    overallTone: string;
}

/**
 * V1 风格指纹（兼容旧数据格式）
 * @deprecated V1 类型，仅供迁移使用。新代码应使用 V2Fingerprint
 */
export interface V1StyleFingerprint {
    id: string;
    name: string;
    source: string;
    scope?: 'template' | 'global' | 'project' | string;
    enabled?: boolean;
    tags?: string[];
    stats: {
        avgSentenceLength: number;
        avgParagraphLength: number;
        dialogueRatio: number;
        descriptionRatio: number;
        wordCount: number;
    };
    features: V1StyleFingerprintFeatures;
    samples: string[];
    extractedAt: number;
    sourceText?: string;
    /** 版本字段：缺失或 'v1' 表示 V1 指纹 */
    version?: 'v1' | 'v2';
}

// ============================================================
// 迁移结果类型
// ============================================================

export interface MigrationResult {
    success: boolean;
    fingerprint?: V2Fingerprint;
    error?: string;
    /** 迁移耗时（毫秒） */
    durationMs: number;
    /** 备份文件路径（如果执行了文件备份） */
    backupPath?: string;
}

// ============================================================
// 默认值工厂（新增 5 维）
// ============================================================

/** 创建新增维度的 pending 默认值 */
function createPendingSentencePattern(): SentencePatternStats {
    return {
        inversionDensity: 0,
        ellipsisDensity: 0,
        parallelismDensity: 0,
        rhetoricalQuestionRatio: 0,
        clauseNestingDepth: 0,
        description: '',
        samples: [],
        status: 'pending',
    };
}

function createPendingEmotion(): EmotionStats {
    return {
        emotionalTone: '',
        emotionalFluctuationFrequency: 0,
        emotionalIntensityDistribution: { low: 0, medium: 0, high: 0 },
        valenceRatio: { positive: 0, negative: 0, neutral: 0 },
        description: '',
        samples: [],
        status: 'pending',
    };
}

function createPendingTension(): TensionStats {
    return {
        suspenseDensity: 0,
        conflictFrequency: 0,
        turningPointDensity: 0,
        foreshadowingMarkerCount: 0,
        climaxDistribution: { early: 0, middle: 0, late: 0 },
        description: '',
        samples: [],
        status: 'pending',
    };
}

function createPendingInfoDensity(): InfoDensityStats {
    return {
        infoDensity: 0,
        properNounDensity: 0,
        settingInjectionFrequency: 0,
        conceptIntroductionRhythm: 0,
        description: '',
        samples: [],
        status: 'pending',
    };
}

function createPendingDescription(): DescriptionStats {
    return {
        environmentDescriptionRatio: 0,
        detailDensity: 0,
        sensoryDistribution: { visual: 0, auditory: 0, tactile: 0, olfactory: 0, gustatory: 0 },
        description: '',
        samples: [],
        status: 'pending',
    };
}

// ============================================================
// V1 字段 → V2 维度构造器
// ============================================================

/** 从 V1 字符串描述创建 V2 维度（标记为 complete） */
function createRhythmFromV1(v1Desc: string): RhythmStats {
    return {
        sentenceLengthDistribution: { short: 0, medium: 0, long: 0 },
        avgSentenceLength: 0,
        shortSentenceRatio: 0,
        punctuationDensity: 0,
        paragraphDensity: 0,
        pauseFrequency: 0,
        description: v1Desc,
        samples: [],
        status: v1Desc ? 'complete' : 'pending',
    };
}

function createWordChoiceFromV1(v1Desc: string): WordChoiceStats {
    return {
        commonWordRatio: 0,
        rareWordRatio: 0,
        functionWordRatio: 0,
        wordLengthDistribution: { len1: 0, len2: 0, len3: 0, len4plus: 0 },
        fourCharIdiomDensity: 0,
        description: v1Desc,
        samples: [],
        status: v1Desc ? 'complete' : 'pending',
    };
}

function createRhetoricFromV1(v1Desc: string): RhetoricStatsV2 {
    return {
        metaphorDensity: 0,
        personificationDensity: 0,
        hyperboleDensity: 0,
        parallelismDensity: 0,
        antithesisDensity: 0,
        synesthesiaDensity: 0,
        description: v1Desc,
        samples: [],
        status: v1Desc ? 'complete' : 'pending',
    };
}

function createPerspectiveFromV1(v1Desc: string): PerspectiveStats {
    return {
        personDistribution: { first: 0, second: 0, third: 0 },
        perspectiveSwitchFrequency: 0,
        narrativeDistance: { far: 0, medium: 0, near: 0 },
        description: v1Desc,
        samples: [],
        status: v1Desc ? 'complete' : 'pending',
    };
}

function createDialogueFromV1(v1Desc: string): DialogueStatsV2 {
    return {
        dialogueRatio: 0,
        dialogueStyleTag: '',
        personalizationLevel: 0,
        subtextRatio: 0,
        description: v1Desc,
        samples: [],
        status: v1Desc ? 'complete' : 'pending',
    };
}

function createNarrationFromV1(v1Desc: string): NarrationStats {
    return {
        narrationSpeed: 0,
        timeJumpFrequency: 0,
        sceneSwitchFrequency: 0,
        description: v1Desc,
        samples: [],
        status: v1Desc ? 'complete' : 'pending',
    };
}

function createLanguageTextureFromV1(v1Desc: string): LanguageTextureStats {
    return {
        writtenLevel: 0,
        colloquialLevel: 0,
        archaismLevel: 0,
        regionalWordDensity: 0,
        description: v1Desc,
        samples: [],
        status: v1Desc ? 'complete' : 'pending',
    };
}

// ============================================================
// 核心迁移函数（纯函数，无副作用）
// ============================================================

/**
 * 将 V1 指纹迁移为 V2 指纹（纯内存操作）
 *
 * @param v1 - V1 风格指纹
 * @param scope - 指纹作用域（V1 可能缺失，需显式指定）
 * @returns V2 指纹（含 V1 备份）
 *
 * @example
 * ```typescript
 * const v2 = migrateV1ToV2(v1Fingerprint, 'global');
 * // v2.features.rhythm.description === v1Fingerprint.features.sentenceRhythm
 * // v2.features.emotion.status === 'pending'
 * // v2.v1Backup.features.sentenceRhythm === v1Fingerprint.features.sentenceRhythm
 * ```
 */
export function migrateV1ToV2(
    v1: V1StyleFingerprint,
    scope: 'template' | 'global' | 'project'
): V2Fingerprint {
    const now = Date.now();

    // 1. 构造 V1 备份
    const v1Backup: V1FingerprintBackup = {
        features: { ...v1.features },
        extractedAt: v1.extractedAt,
        migratedAt: now,
    };

    // 2. 构造 V2 12 维特征
    const features: StyleFingerprintFeaturesV2 = {
        // V1 来源 7 维（标记为 complete）
        rhythm: createRhythmFromV1(v1.features.sentenceRhythm),
        wordChoice: createWordChoiceFromV1(v1.features.wordPreference),
        rhetoric: createRhetoricFromV1(v1.features.rhetoric),
        perspective: createPerspectiveFromV1(v1.features.narrativeStyle),
        dialogue: createDialogueFromV1(v1.features.dialogueStyle),
        narration: createNarrationFromV1(v1.features.paragraphStructure),
        languageTexture: createLanguageTextureFromV1(v1.features.overallTone),
        // 新增 5 维（标记为 pending）
        sentencePattern: createPendingSentencePattern(),
        emotion: createPendingEmotion(),
        tension: createPendingTension(),
        infoDensity: createPendingInfoDensity(),
        description: createPendingDescription(),
    };

    // 2.1 若存在原始文本，用纯统计补齐节奏/视角定量字段（填补迁移零值空缺）
    if (v1.sourceText && v1.sourceText.trim().length > 0) {
        const rhythm = calculateRhythmStats(v1.sourceText);
        const perspective = calculatePerspectiveStats(v1.sourceText);
        features.rhythm = {
            ...rhythm,
            description: v1.features.sentenceRhythm || rhythm.description,
        };
        features.perspective = {
            ...perspective,
            description: v1.features.narrativeStyle || perspective.description,
        };
    }

    // 3. 构造 V2 指纹
    return {
        id: v1.id,
        name: v1.name,
        source: v1.source,
        scope,
        enabled: v1.enabled ?? true,
        tags: v1.tags ?? [],
        version: 'v2',
        stats: { ...v1.stats },
        features,
        samples: [...v1.samples],
        extractedAt: v1.extractedAt,
        sourceText: v1.sourceText,
        migratedAt: now,
        v1Backup,
    };
}

// ============================================================
// 文件级迁移（含备份/回滚）
// ============================================================

/**
 * 检测指纹数据是否需要 V1→V2 迁移
 */
export function needsV1ToV2Migration(data: unknown): boolean {
    if (!data || typeof data !== 'object') return false;
    const obj = data as Record<string, unknown>;
    // 缺失 version 或 version === 'v1' 视为需要迁移
    if (obj.version === 'v2') return false;
    // 检查 features 字段是否为 V1 格式（含 sentenceRhythm 字符串字段）
    const features = obj.features as Record<string, unknown> | undefined;
    if (!features) return false;
    return typeof features.sentenceRhythm === 'string';
}

/**
 * 批量迁移文件中的指纹数据（含备份/回滚）
 *
 * 流程：
 * 1. 读取文件 → 解析为 V1 指纹数组
 * 2. 检测是否需要迁移
 * 3. 写入 .v1.bak 备份文件
 * 4. 执行迁移
 * 5. 写入 V2 格式
 * 6. 失败时从备份恢复
 *
 * @param fs - 文件系统接口
 * @param filePath - 指纹文件路径
 * @param scope - 指纹作用域
 * @returns 迁移结果
 */
export async function migrateFileV1ToV2(
    fs: FileSystemPort,
    filePath: string,
    scope: 'template' | 'global' | 'project'
): Promise<MigrationResult> {
    const startTime = Date.now();
    const backupPath = `${filePath}.v1.bak`;

    try {
        // 1. 读取原文件
        const exists = await fs.exists(filePath);
        if (!exists) {
            return {
                success: false,
                error: `文件不存在: ${filePath}`,
                durationMs: Date.now() - startTime,
            };
        }

        const raw = await fs.read(filePath);
        const parsed = JSON.parse(raw) as unknown;

        // 2. 检测是否需要迁移
        if (Array.isArray(parsed)) {
            // 批量指纹：只要有一个需要迁移，就全部迁移
            const arr = parsed as unknown[];
            if (!arr.some(item => needsV1ToV2Migration(item))) {
                return {
                    success: true,
                    durationMs: Date.now() - startTime,
                };
            }
        } else {
            if (!needsV1ToV2Migration(parsed)) {
                return {
                    success: true,
                    durationMs: Date.now() - startTime,
                };
            }
        }

        // 3. 写入备份文件
        await fs.write(backupPath, raw);

        // 4. 执行迁移
        let migrated: V2Fingerprint | V2Fingerprint[];
        try {
            if (Array.isArray(parsed)) {
                // 逐条判定：混装文件（已有 V2 + 新 V1）里已迁移的条目必须原样保留。
                // 旧实现无条件 map，把 V2 条目当 V1 再迁一次 —— 它的 features 没有
                // sentenceRhythm，于是 12 维结构被覆盖成「全部 pending」的空壳。
                const arr = parsed as unknown[];
                migrated = arr.map(item =>
                    needsV1ToV2Migration(item)
                        ? migrateV1ToV2(item as V1StyleFingerprint, scope)
                        : item as V2Fingerprint
                );
            } else {
                migrated = migrateV1ToV2(parsed as V1StyleFingerprint, scope);
            }
        } catch (migrationError) {
            // 迁移失败：从备份恢复
            await fs.write(filePath, raw);
            return {
                success: false,
                error: `迁移失败已回滚: ${migrationError instanceof Error ? migrationError.message : String(migrationError)}`,
                durationMs: Date.now() - startTime,
                backupPath,
            };
        }

        // 5. 写入 V2 格式
        try {
            await fs.write(filePath, JSON.stringify(migrated, null, 2));
        } catch (writeError) {
            // 写入失败：从备份恢复
            await fs.write(filePath, raw);
            return {
                success: false,
                error: `V2 写入失败已回滚: ${writeError instanceof Error ? writeError.message : String(writeError)}`,
                durationMs: Date.now() - startTime,
                backupPath,
            };
        }

        return {
            success: true,
            fingerprint: Array.isArray(migrated) ? undefined : migrated,
            durationMs: Date.now() - startTime,
            backupPath,
        };
    } catch (error) {
        // 整体失败：尝试从备份恢复
        try {
            const backupExists = await fs.exists(backupPath);
            if (backupExists) {
                const backupRaw = await fs.read(backupPath);
                await fs.write(filePath, backupRaw);
            }
        } catch {
            // 回滚也失败，记录但不抛出
        }
        return {
            success: false,
            error: `迁移异常: ${error instanceof Error ? error.message : String(error)}`,
            durationMs: Date.now() - startTime,
            backupPath,
        };
    }
}

/**
 * 从备份回滚 V2 → V1
 *
 * @param fs - 文件系统接口
 * @param filePath - V2 文件路径
 * @param backupPath - V1 备份路径（默认为 `${filePath}.v1.bak`）
 * @returns 是否回滚成功
 */
export async function rollbackV2ToV1(
    fs: FileSystemPort,
    filePath: string,
    backupPath?: string
): Promise<boolean> {
    const bp = backupPath ?? `${filePath}.v1.bak`;
    try {
        const backupExists = await fs.exists(bp);
        if (!backupExists) return false;
        const backupRaw = await fs.read(bp);
        await fs.write(filePath, backupRaw);
        return true;
    } catch {
        return false;
    }
}

// ============================================================
// 工具函数
// ============================================================

/**
 * 获取 V2 指纹中所有 pending 维度
 */
export function getPendingDimensions(v2: V2Fingerprint): StyleDimensionKeyV2[] {
    const result: StyleDimensionKeyV2[] = [];
    const features = v2.features;
    for (const key of Object.keys(features) as StyleDimensionKeyV2[]) {
        if (features[key].status === 'pending') {
            result.push(key);
        }
    }
    return result;
}

/**
 * 获取 V2 指纹中所有 complete 维度
 */
export function getCompleteDimensions(v2: V2Fingerprint): StyleDimensionKeyV2[] {
    const result: StyleDimensionKeyV2[] = [];
    const features = v2.features;
    for (const key of Object.keys(features) as StyleDimensionKeyV2[]) {
        if (features[key].status === 'complete') {
            result.push(key);
        }
    }
    return result;
}

/**
 * 校验 V2 指纹完整性
 * - 12 维全部存在
 * - 每维有 status 字段
 */
export function validateV2Fingerprint(v2: unknown): v2 is V2Fingerprint {
    if (!v2 || typeof v2 !== 'object') return false;
    const obj = v2 as Record<string, unknown>;
    if (obj.version !== 'v2') return false;
    if (!obj.features || typeof obj.features !== 'object') return false;
    const features = obj.features as Record<string, unknown>;
    // 检查 12 维全部存在且有 status
    const requiredKeys: StyleDimensionKeyV2[] = [
        'rhythm', 'sentencePattern', 'wordChoice', 'rhetoric', 'perspective',
        'emotion', 'tension', 'infoDensity', 'dialogue', 'description',
        'narration', 'languageTexture',
    ];
    for (const key of requiredKeys) {
        const dim = features[key] as { status?: string } | undefined;
        if (!dim || typeof dim.status !== 'string') return false;
        if (!['complete', 'pending', 'partial'].includes(dim.status)) return false;
    }
    return true;
}

/**
 * 统计 V2 指纹维度状态
 */
export function getDimensionStatusSummary(v2: V2Fingerprint): {
    complete: number;
    pending: number;
    partial: number;
    total: number;
} {
    let complete = 0, pending = 0, partial = 0;
    const features = v2.features;
    for (const key of Object.keys(features) as StyleDimensionKeyV2[]) {
        const status = features[key].status;
        if (status === 'complete') complete++;
        else if (status === 'pending') pending++;
        else if (status === 'partial') partial++;
    }
    return { complete, pending, partial, total: 12 };
}

// ============================================================
// V1 字段映射查询（用于调试/审计）
// ============================================================

/**
 * 查询 V1 字段对应的 V2 维度键
 */
export function getV2DimensionForV1Field(v1Field: string): StyleDimensionKeyV2 | undefined {
    return V1_TO_V2_FIELD_MAP[v1Field];
}

/**
 * 判断 V2 维度是否为新增（无 V1 来源）
 */
export function isV2DimensionNew(v2Key: StyleDimensionKeyV2): boolean {
    return V2_NEW_DIMENSIONS.includes(v2Key);
}
