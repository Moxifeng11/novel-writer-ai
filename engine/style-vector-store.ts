import { App } from 'obsidian';
import { FileSystemPort, ObsidianFileSystem } from '../shared/file-system-port';
import {
    globalFingerprintVectorsDir,
    projectFingerprintVectorsDir,
} from '../shared/paths';
import type { EmbeddingProvider } from './embedding/embedding-provider';
import {
    detectEmbeddingMismatch,
    getEmbeddingDimensionHint,
    getEmbeddingFingerprint,
    getEmbeddingModelName,
    type EmbeddingMismatchReason,
} from './embedding/embedding-fingerprint';
import { cosineSimilarity } from './local-vector-store';
import type { StyleFingerprint, StyleFingerprintFeatures } from './style-fingerprint-library';
import { createLogger } from '../shared/logger';


const log = createLogger('StyleVectorStore');
/**
 * 风格维度。
 */
export type StyleDimension = 'sentenceRhythm' | 'wordPreference' | 'narrativeStyle' | 'rhetoric' | 'dialogueStyle' | 'paragraphStructure' | 'overallTone';

/**
 * 全部风格维度。
 */
export const STYLE_DIMENSIONS: StyleDimension[] = [
    'sentenceRhythm',
    'wordPreference',
    'narrativeStyle',
    'rhetoric',
    'dialogueStyle',
    'paragraphStructure',
    'overallTone',
];

/**
 * 风格维度中文名。
 */
export const STYLE_DIMENSION_LABELS: Record<StyleDimension, string> = {
    sentenceRhythm: '句式节奏',
    wordPreference: '用词偏好',
    narrativeStyle: '叙事风格',
    rhetoric: '修辞特点',
    dialogueStyle: '对话风格',
    paragraphStructure: '段落结构',
    overallTone: '整体基调',
};

/**
 * 风格维度权重。
 */
export const STYLE_DIMENSION_WEIGHTS: Record<StyleDimension, number> = {
    sentenceRhythm: 0.15,
    wordPreference: 0.15,
    narrativeStyle: 0.15,
    rhetoric: 0.1,
    dialogueStyle: 0.15,
    paragraphStructure: 0.1,
    overallTone: 0.2,
};

/**
 * 单维度向量。
 */
export interface StyleDimensionVector {
    dimension: StyleDimension;
    vector: number[];
    description: string;
}

/**
 * 指纹向量集合。
 */
export interface StyleFingerprintVectors {
    fingerprintId: string;
    /** 生成向量时使用的 embedding 模型指纹；旧文件可能没有（纯模型名） */
    modelId?: string;
    /** 向量维度（overallVector 长度），用于识别换模型后的维度变化 */
    dimensionCount?: number;
    dimensions: Record<StyleDimension, StyleDimensionVector>;
    overallVector: number[];
    updatedAt: number;
}

/** 因更换 embedding 模型被跳过的 V1 风格向量 */
export interface StyleVectorStoreModelMismatch {
    fingerprintId: string;
    storedModelId: string;
    currentModelId: string;
    reason?: EmbeddingMismatchReason;
}

/**
 * 风格相似度结果。
 */
export interface StyleSimilarityResult {
    fingerprintId: string;
    fingerprintName: string;
    overallScore: number;
    dimensionScores: Record<StyleDimension, number>;
    scope: 'template' | 'global' | 'project';
}

/**
 * 风格混合选项。
 */
export interface StyleBlendOptions {
    weights?: Record<string, number>;
}

/**
 * 风格插值选项。
 */
export interface StyleInterpolationOptions {
    ratio?: number;
}

/**
 * 风格向量库。
 */
export class StyleVectorStore {
    private app: App;
    private scope: 'global' | 'project';
    private project?: string;
    private embeddingProvider: EmbeddingProvider;
    private fs: FileSystemPort | null = null;
    private vectors: Map<string, StyleFingerprintVectors> = new Map();
    private loaded = false;
    /** B2：加载签名（文件 + embedding 指纹），切模型后同会话即可重载 */
    private loadedSignature: string | null = null;
    /** 因 embedding 模型/维度不一致被跳过的 V1 向量 */
    private modelMismatches: StyleVectorStoreModelMismatch[] = [];

    constructor(
        app: App,
        scope: 'global' | 'project',
        embeddingProvider: EmbeddingProvider,
        project?: string
    ) {
        this.app = app;
        this.scope = scope;
        this.embeddingProvider = embeddingProvider;
        this.project = project;
    }

    private getFS(): FileSystemPort {
        if (!this.fs) {
            this.fs = new ObsidianFileSystem(this.app);
        }
        return this.fs;
    }

    private getVectorsDir(): string {
        if (this.scope === 'global') {
            return globalFingerprintVectorsDir();
        }
        if (!this.project) {
            throw new Error('Project name is required for project scope');
        }
        return projectFingerprintVectorsDir(this.project);
    }

    private getStyleVectorsPath(fingerprintId: string): string {
        return `${this.getVectorsDir()}/style-${fingerprintId}.json`;
    }

    private async ensureLoaded(): Promise<void> {
        const signature = await this.computeSignature();
        if (this.loaded && (signature === null || signature === this.loadedSignature)) return;
        await this.loadAllFromDisk();
        this.loaded = true;
        this.loadedSignature = signature;
    }

    /** 签名包含 embedding 指纹，切换模型/端点后同会话也能重新加载 */
    private async computeSignature(): Promise<string | null> {
        try {
            const files = await this.getFS().listFiles(this.getVectorsDir());
            const fileSignature = files
                .filter(f => f.name.startsWith('style-') && f.name.endsWith('.json'))
                .map(f => `${f.path}@${f.stat?.mtime ?? 0}:${f.stat?.size ?? 0}`)
                .sort()
                .join('|');
            return `${getEmbeddingFingerprint(this.embeddingProvider)}::${fileSignature}`;
        } catch {
            return null;
        }
    }

    private async loadAllFromDisk(): Promise<void> {
        const fs = this.getFS();
        const dir = this.getVectorsDir();
        const current = {
            fingerprint: getEmbeddingFingerprint(this.embeddingProvider),
            modelName: getEmbeddingModelName(this.embeddingProvider),
            dimension: getEmbeddingDimensionHint(this.embeddingProvider),
        };
        this.modelMismatches = [];
        // 签名变化后的重载必须丢弃旧内存，避免已跳过的向量继续参与检索
        this.vectors.clear();

        try {
            const files = await fs.listFiles(dir);
            for (const file of files) {
                if (!file.name.startsWith('style-') || !file.name.endsWith('.json')) continue;
                try {
                    const content = await fs.read(file.path);
                    const data = JSON.parse(content) as StyleFingerprintVectors;
                    if (data.fingerprintId && data.dimensions) {
                        // B1：V1 文件同样要治理。旧文件没有 modelId/dimensionCount，
                        // 按兼容策略加载，首次重建写入后会补齐。
                        const mismatchReason = detectEmbeddingMismatch(data, current);
                        if (mismatchReason) {
                            this.modelMismatches.push({
                                fingerprintId: data.fingerprintId,
                                storedModelId: data.modelId || '',
                                currentModelId: current.fingerprint,
                                reason: mismatchReason,
                            });
                            continue;
                        }
                        this.vectors.set(data.fingerprintId, data);
                    }
                } catch (e) {
                    log.warn(`[StyleVectorStore] 加载风格向量文件失败: ${file.path}`, e);
                }
            }
        } catch {
        }
        if (this.modelMismatches.length > 0) {
            log.info(`[StyleVectorStore] 跳过 ${this.modelMismatches.length} 个 embedding 模型/维度不一致的 V1 风格向量，重新提取指纹即可按当前模型重建`);
        }
    }

    /** 因换 embedding 模型/维度被跳过的 V1 向量（文件保留） */
    getModelMismatches(): StyleVectorStoreModelMismatch[] {
        return [...this.modelMismatches];
    }

    private async saveToDisk(fingerprintId: string): Promise<void> {
        const fs = this.getFS();
        const dir = this.getVectorsDir();
        const filePath = this.getStyleVectorsPath(fingerprintId);

        const data = this.vectors.get(fingerprintId);
        if (!data) {
            try {
                await fs.delete(filePath);
            } catch {
            }
            return;
        }

        try {
            await fs.mkdir(dir);
            await fs.write(filePath, JSON.stringify(data, null, 2));
        } catch (e) {
            log.warn(`[StyleVectorStore] 保存风格向量文件失败: ${filePath}`, e);
        }
    }

    /**
     * 把维度描述转为向量。
     *
     * @param description - 描述
     * @returns 向量
     */
    async buildDimensionVector(description: string): Promise<number[]> {
        return await this.embeddingProvider.embed(description);
    }

    /**
     * 构建指纹的维度向量。
     *
     * @param fingerprintId - 指纹 ID
     * @param features - 特征
     * @returns 指纹向量
     */
    async buildFingerprintVectors(
        fingerprintId: string,
        features: StyleFingerprintFeatures
    ): Promise<StyleFingerprintVectors> {
        const dimensions = {} as Record<StyleDimension, StyleDimensionVector>;

        for (const dim of STYLE_DIMENSIONS) {
            const description = features[dim] || '';
            const vector = description ? await this.buildDimensionVector(description) : [];
            dimensions[dim] = {
                dimension: dim,
                vector,
                description,
            };
        }

        const overallDescription = this.buildOverallDescription(features);
        const overallVector = overallDescription ? await this.buildDimensionVector(overallDescription) : [];

        const result: StyleFingerprintVectors = {
            fingerprintId,
            // 模型未知时不落 unknown，避免后续可识别时被误判不一致
            ...(getEmbeddingFingerprint(this.embeddingProvider) !== 'unknown'
                ? { modelId: getEmbeddingFingerprint(this.embeddingProvider) }
                : {}),
            dimensionCount: overallVector.length,
            dimensions,
            overallVector,
            updatedAt: Date.now(),
        };

        return result;
    }

    private buildOverallDescription(features: StyleFingerprintFeatures): string {
        const parts: string[] = [];
        for (const dim of STYLE_DIMENSIONS) {
            const desc = features[dim];
            if (desc) {
                parts.push(`${STYLE_DIMENSION_LABELS[dim]}：${desc}`);
            }
        }
        return parts.join('\n');
    }

    /**
     * 新增指纹向量。
     *
     * @param fingerprintId - 指纹 ID
     * @param features - 特征
     */
    async addFingerprintVectors(
        fingerprintId: string,
        features: StyleFingerprintFeatures
    ): Promise<StyleFingerprintVectors> {
        await this.ensureLoaded();

        const vectors = await this.buildFingerprintVectors(fingerprintId, features);
        this.vectors.set(fingerprintId, vectors);
        await this.saveToDisk(fingerprintId);

        return vectors;
    }

    /**
     * 更新指纹向量。
     *
     * @param fingerprintId - 指纹 ID
     * @param features - 特征
     */
    async updateFingerprintVectors(
        fingerprintId: string,
        features: StyleFingerprintFeatures
    ): Promise<StyleFingerprintVectors> {
        return await this.addFingerprintVectors(fingerprintId, features);
    }

    /**
     * 删除某个指纹的向量。
     *
     * @param fingerprintId - 指纹 ID
     * @returns 无
     */
    async deleteFingerprintVectors(fingerprintId: string): Promise<void> {
        await this.ensureLoaded();
        this.vectors.delete(fingerprintId);
        await this.saveToDisk(fingerprintId);
    }

    /**
     * 读取某个指纹的向量。
     *
     * @param fingerprintId - 指纹 ID
     * @returns 向量或 undefined
     */
    getFingerprintVectors(fingerprintId: string): StyleFingerprintVectors | undefined {
        return this.vectors.get(fingerprintId);
    }

    /**
     * 取指纹向量，缺失则构建。
     *
     * @param fingerprint - 指纹
     * @returns 指纹向量
     */
    async getOrBuildVectors(
        fingerprint: StyleFingerprint
    ): Promise<StyleFingerprintVectors | undefined> {
        await this.ensureLoaded();

        const existing = this.vectors.get(fingerprint.id);
        if (existing && existing.updatedAt >= fingerprint.extractedAt) {
            return existing;
        }

        try {
            return await this.addFingerprintVectors(fingerprint.id, fingerprint.features);
        } catch (e) {
            log.warn('[StyleVectorStore] 构建向量失败:', e);
            return undefined;
        }
    }

    /**
     * 计算两个维度向量的相似度。
     *
     * @param vecA - 向量 A
     * @param vecB - 向量 B
     * @returns 相似度
     */
    calculateDimensionSimilarity(
        vecA: number[],
        vecB: number[]
    ): number {
        if (vecA.length === 0 || vecB.length === 0) return 0;
        if (vecA.length !== vecB.length) return 0;
        return cosineSimilarity(vecA, vecB);
    }

    /**
     * 按文本检索相似风格。
     *
     * @param queryText - 查询文本
     * @param fingerprints - 指纹集合
     * @param options - 参数
     * @returns 检索结果
     */
    async searchSimilarByText(
        queryText: string,
        fingerprints: StyleFingerprint[],
        options?: {
            topN?: number;
            minScore?: number;
            dimensionWeights?: Partial<Record<StyleDimension, number>>;
        }
    ): Promise<StyleSimilarityResult[]> {
        await this.ensureLoaded();

        const topN = options?.topN ?? 10;
        const minScore = options?.minScore ?? 0;
        const weights = options?.dimensionWeights ?? STYLE_DIMENSION_WEIGHTS;

        const queryVector = await this.embeddingProvider.embed(queryText);

        const results: StyleSimilarityResult[] = [];

        for (const fp of fingerprints) {
            const fpVectors = await this.getOrBuildVectors(fp);
            if (!fpVectors) continue;

            const dimensionScores = {} as Record<StyleDimension, number>;
            let weightedSum = 0;
            let weightTotal = 0;

            for (const dim of STYLE_DIMENSIONS) {
                const dimVec = fpVectors.dimensions[dim];
                const dimScore = dimVec?.vector ? this.calculateDimensionSimilarity(queryVector, dimVec.vector) : 0;
                dimensionScores[dim] = dimScore;

                const weight = weights[dim] ?? 0;
                weightedSum += dimScore * weight;
                weightTotal += weight;
            }

            const overallScore = weightTotal > 0 ? weightedSum / weightTotal : 0;

            if (overallScore >= minScore) {
                results.push({
                    fingerprintId: fp.id,
                    fingerprintName: fp.name,
                    overallScore,
                    dimensionScores,
                    scope: fp.scope,
                });
            }
        }

        results.sort((a, b) => b.overallScore - a.overallScore);
        return results.slice(0, topN);
    }

    /**
     * 按指纹检索相似风格。
     *
     * @param fingerprintId - 指纹 ID
     * @param fingerprints - 指纹集合
     * @param options - 参数
     * @returns 检索结果
     */
    async searchSimilarByFingerprint(
        fingerprintId: string,
        fingerprints: StyleFingerprint[],
        options?: {
            topN?: number;
            minScore?: number;
            dimensionWeights?: Partial<Record<StyleDimension, number>>;
        }
    ): Promise<StyleSimilarityResult[]> {
        await this.ensureLoaded();

        const topN = options?.topN ?? 10;
        const minScore = options?.minScore ?? 0;
        const weights = options?.dimensionWeights ?? STYLE_DIMENSION_WEIGHTS;

        const sourceFp = fingerprints.find(f => f.id === fingerprintId);
        if (!sourceFp) return [];

        const sourceVectors = await this.getOrBuildVectors(sourceFp);
        if (!sourceVectors) return [];

        const results: StyleSimilarityResult[] = [];

        for (const fp of fingerprints) {
            if (fp.id === fingerprintId) continue;

            const fpVectors = await this.getOrBuildVectors(fp);
            if (!fpVectors) continue;

            const dimensionScores = {} as Record<StyleDimension, number>;
            let weightedSum = 0;
            let weightTotal = 0;

            for (const dim of STYLE_DIMENSIONS) {
                const sourceVec = sourceVectors.dimensions[dim]?.vector || [];
                const targetVec = fpVectors.dimensions[dim]?.vector || [];
                const dimScore = this.calculateDimensionSimilarity(sourceVec, targetVec);
                dimensionScores[dim] = dimScore;

                const weight = weights[dim] ?? 0;
                weightedSum += dimScore * weight;
                weightTotal += weight;
            }

            const overallScore = weightTotal > 0 ? weightedSum / weightTotal : 0;

            if (overallScore >= minScore) {
                results.push({
                    fingerprintId: fp.id,
                    fingerprintName: fp.name,
                    overallScore,
                    dimensionScores,
                    scope: fp.scope,
                });
            }
        }

        results.sort((a, b) => b.overallScore - a.overallScore);
        return results.slice(0, topN);
    }

    /**
     * 混合多个风格向量。
     *
     * @param fingerprints - 指纹集合
     * @param options - 参数
     * @returns 混合向量
     */
    blendStyles(
        fingerprints: StyleFingerprint[],
        options?: StyleBlendOptions
    ): StyleFingerprintFeatures {
        if (fingerprints.length === 0) {
            return {
                sentenceRhythm: '',
                wordPreference: '',
                narrativeStyle: '',
                rhetoric: '',
                dialogueStyle: '',
                paragraphStructure: '',
                overallTone: '',
            };
        }

        const weights = options?.weights;
        const totalWeight = fingerprints.reduce((sum, fp, idx) => {
            const w = weights?.[fp.id] ?? 1;
            return sum + w;
        }, 0);

        const normalizedWeights = fingerprints.map(fp => {
            const w = weights?.[fp.id] ?? 1;
            return w / totalWeight;
        });

        const blended: Partial<StyleFingerprintFeatures> = {};

        for (const dim of STYLE_DIMENSIONS) {
            const parts: string[] = [];
            fingerprints.forEach((fp, idx) => {
                const desc = fp.features[dim];
                if (desc) {
                    const weight = normalizedWeights[idx];
                    if (weight > 0.1) {
                        parts.push(desc);
                    }
                }
            });
            (blended as any)[dim] = parts.join('；');
        }

        return blended as StyleFingerprintFeatures;
    }

    /**
     * 在两种风格间插值。
     *
     * @param fpA - 指纹 A
     * @param fpB - 指纹 B
     * @param options - 参数
     * @returns 插值向量
     */
    interpolateStyles(
        fpA: StyleFingerprint,
        fpB: StyleFingerprint,
        options?: StyleInterpolationOptions
    ): StyleFingerprintFeatures {
        const ratio = options?.ratio ?? 0.5;
        const weightA = 1 - ratio;
        const weightB = ratio;

        return this.blendStyles([fpA, fpB], {
            weights: {
                [fpA.id]: weightA,
                [fpB.id]: weightB,
            },
        });
    }

    /**
     * 生成风格混合提示词。
     *
     * @param blendedFeatures - 混合后的特征
     * @returns 提示词
     */
    generateBlendPrompt(
        blendedFeatures: StyleFingerprintFeatures
    ): string {
        const lines: string[] = ['【融合风格指南】'];

        for (const dim of STYLE_DIMENSIONS) {
            const desc = blendedFeatures[dim];
            if (desc) {
                lines.push(`${STYLE_DIMENSION_LABELS[dim]}：${desc}`);
            }
        }

        return lines.join('\n');
    }

    /**
     * 重建全部指纹向量。
     *
     * @param fingerprints - 指纹集合
     * @param onProgress - 参数
     * @returns 重建结果
     */
    async rebuildAllVectors(
        fingerprints: StyleFingerprint[],
        onProgress?: (current: number, total: number, fingerprintId: string) => void
    ): Promise<void> {
        await this.ensureLoaded();

        const total = fingerprints.length;
        let current = 0;

        for (const fp of fingerprints) {
            current++;
            onProgress?.(current, total, fp.id);

            try {
                await this.addFingerprintVectors(fp.id, fp.features);
            } catch (e) {
                log.warn(`[StyleVectorStore] 重建向量失败: ${fp.id}`, e);
            }
        }
    }

    /**
     * 清空全部风格向量。
     * @returns 无
     */
    async clear(): Promise<void> {
        const ids = Array.from(this.vectors.keys());
        this.vectors.clear();
        for (const id of ids) {
            await this.saveToDisk(id);
        }
    }

    /**
     * 当前向量数量。
     * @returns 数量
     */
    getVectorCount(): number {
        return this.vectors.size;
    }
}
