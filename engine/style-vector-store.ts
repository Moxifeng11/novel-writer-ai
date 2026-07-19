import { App } from 'obsidian';
import { FileSystemPort, ObsidianFileSystem } from '../shared/file-system-port';
import {
    globalFingerprintVectorsDir,
    projectFingerprintVectorsDir,
} from '../shared/paths';
import type { EmbeddingProvider } from './embedding/embedding-provider';
import { cosineSimilarity } from './local-vector-store';
import type { StyleFingerprint, StyleFingerprintFeatures } from './style-fingerprint-library';
import { createLogger } from '../shared/logger';


const log = createLogger('StyleVectorStore');
export type StyleDimension = 'sentenceRhythm' | 'wordPreference' | 'narrativeStyle' | 'rhetoric' | 'dialogueStyle' | 'paragraphStructure' | 'overallTone';

export const STYLE_DIMENSIONS: StyleDimension[] = [
    'sentenceRhythm',
    'wordPreference',
    'narrativeStyle',
    'rhetoric',
    'dialogueStyle',
    'paragraphStructure',
    'overallTone',
];

export const STYLE_DIMENSION_LABELS: Record<StyleDimension, string> = {
    sentenceRhythm: '句式节奏',
    wordPreference: '用词偏好',
    narrativeStyle: '叙事风格',
    rhetoric: '修辞特点',
    dialogueStyle: '对话风格',
    paragraphStructure: '段落结构',
    overallTone: '整体基调',
};

export const STYLE_DIMENSION_WEIGHTS: Record<StyleDimension, number> = {
    sentenceRhythm: 0.15,
    wordPreference: 0.15,
    narrativeStyle: 0.15,
    rhetoric: 0.1,
    dialogueStyle: 0.15,
    paragraphStructure: 0.1,
    overallTone: 0.2,
};

export interface StyleDimensionVector {
    dimension: StyleDimension;
    vector: number[];
    description: string;
}

export interface StyleFingerprintVectors {
    fingerprintId: string;
    dimensions: Record<StyleDimension, StyleDimensionVector>;
    overallVector: number[];
    updatedAt: number;
}

export interface StyleSimilarityResult {
    fingerprintId: string;
    fingerprintName: string;
    overallScore: number;
    dimensionScores: Record<StyleDimension, number>;
    scope: 'template' | 'global' | 'project';
}

export interface StyleBlendOptions {
    weights?: Record<string, number>;
}

export interface StyleInterpolationOptions {
    ratio?: number;
}

export class StyleVectorStore {
    private app: App;
    private scope: 'global' | 'project';
    private project?: string;
    private embeddingProvider: EmbeddingProvider;
    private fs: FileSystemPort | null = null;
    private vectors: Map<string, StyleFingerprintVectors> = new Map();
    private loaded = false;

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
        if (this.loaded) return;
        await this.loadAllFromDisk();
        this.loaded = true;
    }

    private async loadAllFromDisk(): Promise<void> {
        const fs = this.getFS();
        const dir = this.getVectorsDir();

        try {
            const files = await fs.listFiles(dir);
            for (const file of files) {
                if (!file.name.startsWith('style-') || !file.name.endsWith('.json')) continue;
                try {
                    const content = await fs.read(file.path);
                    const data = JSON.parse(content) as StyleFingerprintVectors;
                    if (data.fingerprintId && data.dimensions) {
                        this.vectors.set(data.fingerprintId, data);
                    }
                } catch (e) {
                    log.warn(`[StyleVectorStore] 加载风格向量文件失败: ${file.path}`, e);
                }
            }
        } catch {
        }
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

    async buildDimensionVector(description: string): Promise<number[]> {
        return await this.embeddingProvider.embed(description);
    }

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

    async updateFingerprintVectors(
        fingerprintId: string,
        features: StyleFingerprintFeatures
    ): Promise<StyleFingerprintVectors> {
        return await this.addFingerprintVectors(fingerprintId, features);
    }

    async deleteFingerprintVectors(fingerprintId: string): Promise<void> {
        await this.ensureLoaded();
        this.vectors.delete(fingerprintId);
        await this.saveToDisk(fingerprintId);
    }

    getFingerprintVectors(fingerprintId: string): StyleFingerprintVectors | undefined {
        return this.vectors.get(fingerprintId);
    }

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

    calculateDimensionSimilarity(
        vecA: number[],
        vecB: number[]
    ): number {
        if (vecA.length === 0 || vecB.length === 0) return 0;
        if (vecA.length !== vecB.length) return 0;
        return cosineSimilarity(vecA, vecB);
    }

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

    async clear(): Promise<void> {
        const ids = Array.from(this.vectors.keys());
        this.vectors.clear();
        for (const id of ids) {
            await this.saveToDisk(id);
        }
    }

    getVectorCount(): number {
        return this.vectors.size;
    }
}
