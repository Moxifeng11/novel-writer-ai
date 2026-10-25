/**
 * style/style-vector-store-v2.ts — 写作指纹 V2 多维独立向量空间（Task 3）
 *
 * 设计要点：
 *   - 12 维独立 embedding 向量（与 StyleFingerprintFeaturesV2 对齐）
 *   - 每维度用 description + samples 拼接成文本 → embedding
 *   - V1 向量兼容：加载时检测 V1 文件并自动迁移，缺失维度用 overallVector 近似
 *   - 检索模式：单维度检索 / 加权整体检索 / 指纹对指纹检索
 *   - 性能：单维度检索 < 200ms，全维度 < 500ms（依赖 EmbeddingProvider 速度）
 *   - 降级：单维度 embedding 失败 → 用 overallVector 近似并标记 approximated
 *
 * 设计原则：
 *   - 零外部依赖（仅复用 EmbeddingProvider + FileSystemPort + cosineSimilarity）
 *   - 向后兼容：V1 StyleVectorStore 完全保留，本类独立
 *   - 外科手术式：不修改 style-vector-store.ts
 *   - V1 数据备份：迁移前写 .v1.bak
 */

import { App } from 'obsidian';
import { FileSystemPort, ObsidianFileSystem } from '../../shared/file-system-port';
import {
    globalFingerprintVectorsDir,
    projectFingerprintVectorsDir,
} from '../../shared/paths';
import type { EmbeddingProvider } from '../embedding/embedding-provider';
import {
    detectEmbeddingMismatch,
    getEmbeddingDimensionHint,
    getEmbeddingFingerprint,
    getEmbeddingModelName,
    type EmbeddingMismatchReason,
} from '../embedding/embedding-fingerprint';
import { cosineSimilarity } from '../local-vector-store';
import { createLogger } from '../../shared/logger';

const log = createLogger('StyleVectorStoreV2');
import {
    StyleFingerprintFeaturesV2,
    StyleDimensionKeyV2,
    STYLE_DIMENSION_KEYS_V2,
    STYLE_DIMENSION_LABELS_V2,
    STYLE_DIMENSION_WEIGHTS_V2,
    STYLE_DIMENSIONS_V2,
    V1_TO_V2_FIELD_MAP,
    V2_NEW_DIMENSIONS,
} from './style-dimensions-v2';

// ============================================================
// 一、V2 向量数据结构
// ============================================================

/** 单维度向量条目 */
export interface StyleDimensionVectorV2 {
    dimension: StyleDimensionKeyV2;
    /** 该维度的 embedding 向量 */
    vector: number[];
    /** 用于生成向量的源文本（description + samples 拼接） */
    sourceText: string;
    /** 是否为近似向量（V1 迁移 / embedding 失败降级时为 true） */
    approximated: boolean;
}

/** V2 指纹向量集合 */
export interface StyleFingerprintVectorsV2 {
    fingerprintId: string;
    /** V2 版本标记 */
    version: 'v2';
    /** 12 维向量映射 */
    dimensions: Record<StyleDimensionKeyV2, StyleDimensionVectorV2>;
    /** 整体向量（所有维度拼接后单次 embedding） */
    overallVector: number[];
    /** 生成向量时使用的 embedding 模型 ID（用于换模型后隔离旧向量） */
    modelId: string;
    /** 向量维度（overallVector 长度），用于识别不同 embedding 输出的文件 */
    dimensionCount: number;
    /** V1 数据备份（迁移时保留，非迁移场景为 undefined） */
    v1Backup?: unknown;
    /** 最后更新时间 */
    updatedAt: number;
}

/** 换 embedding 模型后被隔离的向量文件 */
export interface StyleVectorModelMismatch {
    fingerprintId: string;
    storedModelId: string;
    currentModelId: string;
    /** 不一致原因：模型指纹变化或维度变化 */
    reason?: EmbeddingMismatchReason;
    /** 隔离备份文件路径 */
    backupPath: string;
}

/** 检索结果 */
export interface StyleSimilarityResultV2 {
    fingerprintId: string;
    fingerprintName: string;
    /** 整体相似度（加权计算） */
    overallScore: number;
    /** 12 维各自相似度 */
    dimensionScores: Record<StyleDimensionKeyV2, number>;
    /** 数据来源 scope */
    scope: 'template' | 'global' | 'project';
    /** 是否包含近似维度 */
    hasApproximated: boolean;
}

/** 检索选项 */
export interface SearchOptionsV2 {
    topN?: number;
    minScore?: number;
    /** 维度权重（缺省时使用 STYLE_DIMENSION_WEIGHTS_V2 均匀分布） */
    dimensionWeights?: Partial<Record<StyleDimensionKeyV2, number>>;
    /** 仅检索指定维度（不传则检索全部 12 维） */
    onlyDimensions?: StyleDimensionKeyV2[];
}

/** V1 向量数据格式（用于兼容读取，结构宽松） */
interface V1VectorsFile {
    fingerprintId: string;
    dimensions?: Record<string, { dimension: string; vector: number[]; description: string }>;
    overallVector?: number[];
    updatedAt?: number;
}

// ============================================================
// 二、StyleVectorStoreV2 主类
// ============================================================

export class StyleVectorStoreV2 {
    private app: App;
    private scope: 'global' | 'project';
    private project?: string;
    private embeddingProvider: EmbeddingProvider;
    private fs: FileSystemPort | null = null;

    /** 内存向量缓存（按 fingerprintId 索引） */
    private vectors: Map<string, StyleFingerprintVectorsV2> = new Map();
    /** 已加载标记 */
    private loaded = false;
    /** 加载时使用的签名（文件 + embedding 指纹），用于切换模型后自动重载 */
    private loadedSignature: string | null = null;
    /** 加载中标记（防止并发加载） */
    private loadingPromise: Promise<void> | null = null;
    /** 因 embedding 模型不一致被隔离的文件 */
    private modelMismatches: StyleVectorModelMismatch[] = [];

    constructor(
        app: App,
        scope: 'global' | 'project',
        embeddingProvider: EmbeddingProvider,
        project?: string,
        /** 可选注入：测试时使用 MockFileSystem */
        fs?: FileSystemPort
    ) {
        this.app = app;
        this.scope = scope;
        this.embeddingProvider = embeddingProvider;
        this.project = project;
        if (fs) {
            this.fs = fs;
        }
    }

    // ----------------------------------------------------------
    // 文件系统辅助
    // ----------------------------------------------------------

    private getFS(): FileSystemPort {
        if (!this.fs) {
            this.fs = new ObsidianFileSystem(this.app);
        }
        return this.fs;
    }

    /** V2 向量目录（在原目录下增加 v2 子目录，与 V1 文件隔离） */
    private getVectorsDir(): string {
        const baseDir = this.scope === 'global'
            ? globalFingerprintVectorsDir()
            : (this.project ? projectFingerprintVectorsDir(this.project) : '');
        if (!baseDir) {
            throw new Error('Project name is required for project scope');
        }
        return `${baseDir}/v2`;
    }

    private getVectorsFilePath(fingerprintId: string): string {
        return `${this.getVectorsDir()}/style-${fingerprintId}.json`;
    }

    /** V1 向量文件路径（用于兼容读取） */
    private getV1VectorsFilePath(fingerprintId: string): string {
        const baseDir = this.scope === 'global'
            ? globalFingerprintVectorsDir()
            : (this.project ? projectFingerprintVectorsDir(this.project) : '');
        return `${baseDir}/style-${fingerprintId}.json`;
    }

    /** V1 备份文件路径 */
    private getV1BackupFilePath(fingerprintId: string): string {
        return `${this.getVectorsDir()}/style-${fingerprintId}.v1.bak`;
    }

    // ----------------------------------------------------------
    // 加载与持久化
    // ----------------------------------------------------------

    private async ensureLoaded(): Promise<void> {
        const signature = await this.computeSignature();
        if (this.loaded && (signature === null || signature === this.loadedSignature)) return;
        if (this.loadingPromise) {
            await this.loadingPromise;
            return;
        }
        this.loadingPromise = this.loadAllFromDisk();
        try {
            await this.loadingPromise;
        } finally {
            this.loadingPromise = null;
        }
        this.loaded = true;
        // 加载过程会隔离/删除模型不一致的文件，必须按加载后的磁盘状态重新取签名：
        // 否则下次 ensureLoaded 因签名不同重复加载，并清空 modelMismatches 报告。
        this.loadedSignature = (await this.computeSignature()) ?? signature;
    }

    /** B2：签名包含 embedding 指纹，切换模型/端点后同会话即可重新隔离旧向量 */
    private async computeSignature(): Promise<string | null> {
        try {
            const files = await this.getFS().listFiles(this.getVectorsDir());
            const fileSignature = files
                .filter(f => f.name.startsWith('style-') && f.name.endsWith('.json'))
                .map(f => `${f.path}@${f.stat?.mtime ?? 0}:${f.stat?.size ?? 0}`)
                .sort()
                .join('|');
            return `${this.getCurrentModelId()}::${fileSignature}`;
        } catch {
            return null;
        }
    }

    private async loadAllFromDisk(): Promise<void> {
        const fs = this.getFS();
        const dir = this.getVectorsDir();
        const current = {
            fingerprint: this.getCurrentModelId(),
            modelName: getEmbeddingModelName(this.embeddingProvider),
            dimension: getEmbeddingDimensionHint(this.embeddingProvider),
        };
        this.modelMismatches = [];
        // 签名变化后的重载必须丢弃旧内存，避免已隔离/删除的向量继续参与检索
        this.vectors.clear();

        try {
            const files = await fs.listFiles(dir);
            for (const file of files) {
                if (!file.name.startsWith('style-') || !file.name.endsWith('.json')) continue;
                if (file.name.endsWith('.v1.bak')) continue;
                try {
                    const content = await fs.read(file.path);
                    const data = JSON.parse(content) as StyleFingerprintVectorsV2;
                    if (!data.fingerprintId || data.version !== 'v2' || !data.dimensions) continue;

                    // 维度治理：文件记录的模型/维度与当前 embedding 不一致时隔离，
                    // 避免把不同模型的向量混算成「高相似度」。
                    // 旧文件没有 modelId 字段：无法判断，按兼容策略加载（下次重建后补齐）。
                    const mismatchReason = detectEmbeddingMismatch(data, current);
                    if (mismatchReason) {
                        const backupPath = `${file.path}.mismatch.bak`;
                        try {
                            await fs.write(backupPath, content);
                            await fs.delete(file.path);
                        } catch (e) {
                            log.warn(`[StyleVectorStoreV2] 隔离模型不一致向量失败: ${file.path}`, e);
                        }
                        this.modelMismatches.push({
                            fingerprintId: data.fingerprintId,
                            storedModelId: data.modelId,
                            currentModelId: current.fingerprint,
                            reason: mismatchReason,
                            backupPath,
                        });
                        log.warn(
                            `[StyleVectorStoreV2] 向量模型/维度不一致，已隔离并需重建: ${data.fingerprintId}`,
                            { storedModelId: data.modelId, currentModelId: current.fingerprint, reason: mismatchReason },
                        );
                        continue;
                    }

                    this.vectors.set(data.fingerprintId, data);
                } catch (e) {
                    log.warn(`[StyleVectorStoreV2] 加载 V2 向量文件失败: ${file.path}`, e);
                }
            }
        } catch {
            // 目录不存在是正常情况，不报错
        }
    }

    /** 当前 embedding 指纹（provider:model@baseUrlHash） */
    private getCurrentModelId(): string {
        return getEmbeddingFingerprint(this.embeddingProvider);
    }

    /** 因换 embedding 模型被隔离、需要重建的向量 */
    getModelMismatches(): StyleVectorModelMismatch[] {
        return [...this.modelMismatches];
    }

    /** 指定指纹是否因模型不一致被隔离 */
    hasModelMismatch(fingerprintId: string): boolean {
        return this.modelMismatches.some(m => m.fingerprintId === fingerprintId);
    }

    /** 触发磁盘加载后返回模型不一致的隔离报告 */
    async reportModelMismatches(): Promise<StyleVectorModelMismatch[]> {
        await this.ensureLoaded();
        return this.getModelMismatches();
    }

    private async saveToDisk(fingerprintId: string): Promise<void> {
        const fs = this.getFS();
        const dir = this.getVectorsDir();
        const filePath = this.getVectorsFilePath(fingerprintId);

        const data = this.vectors.get(fingerprintId);
        if (!data) {
            try { await fs.delete(filePath); } catch { /* ignore */ }
            await this.refreshLoadedSignature();
            return;
        }

        try {
            await fs.mkdir(dir);
            await fs.write(filePath, JSON.stringify(data, null, 2));
            // 自身写入后同步签名：否则下一次 ensureLoaded 会把刚写的文件当成外部变更，
            // 重载后替换内存对象（调用方拿到的引用失效，也存在无谓 IO）。
            await this.refreshLoadedSignature();
        } catch (e) {
            log.warn(`[StyleVectorStoreV2] 保存 V2 向量文件失败: ${filePath}`, e);
            throw e;
        }
    }

    private async refreshLoadedSignature(): Promise<void> {
        const signature = await this.computeSignature();
        if (signature !== null) this.loadedSignature = signature;
    }

    // ----------------------------------------------------------
    // 向量生成
    // ----------------------------------------------------------

    /**
     * 构建单个维度的源文本：description + samples 拼接
     */
    private buildDimensionSourceText(
        dimension: StyleDimensionKeyV2,
        features: StyleFingerprintFeaturesV2
    ): string {
        const stats = features[dimension];
        if (!stats) return '';

        const parts: string[] = [];
        if (stats.description) {
            parts.push(stats.description);
        }
        if (Array.isArray(stats.samples) && stats.samples.length > 0) {
            parts.push(stats.samples.join('\n'));
        }
        return parts.join('\n\n');
    }

    /**
     * 构建整体向量源文本：所有维度 description 拼接
     */
    private buildOverallSourceText(features: StyleFingerprintFeaturesV2): string {
        const parts: string[] = [];
        for (const key of STYLE_DIMENSION_KEYS_V2) {
            const stats = features[key];
            if (stats?.description) {
                parts.push(`${STYLE_DIMENSION_LABELS_V2[key]}：${stats.description}`);
            }
        }
        return parts.join('\n');
    }

    /**
     * 单维度 embedding（带降级）
     * - 失败时返回空数组 + approximated=true
     */
    private async embedDimension(
        dimension: StyleDimensionKeyV2,
        sourceText: string,
        overallVector: number[]
    ): Promise<{ vector: number[]; approximated: boolean }> {
        if (!sourceText) {
            // 空文本 → 用整体向量近似
            return { vector: overallVector, approximated: overallVector.length > 0 };
        }
        try {
            const vector = await this.embeddingProvider.embed(sourceText);
            if (vector.length === 0) {
                return { vector: overallVector, approximated: overallVector.length > 0 };
            }
            return { vector, approximated: false };
        } catch (e) {
            log.warn(`[StyleVectorStoreV2] 维度 ${dimension} embedding 失败，使用整体向量近似`, e);
            return { vector: overallVector, approximated: overallVector.length > 0 };
        }
    }

    /**
     * 为指纹生成 V2 12 维向量
     */
    async buildV2Vectors(
        fingerprintId: string,
        features: StyleFingerprintFeaturesV2
    ): Promise<StyleFingerprintVectorsV2> {
        // 先生成整体向量（用于降级近似）
        const overallText = this.buildOverallSourceText(features);
        let overallVector: number[] = [];
        if (overallText) {
            try {
                overallVector = await this.embeddingProvider.embed(overallText);
            } catch (e) {
                log.warn('[StyleVectorStoreV2] 整体向量 embedding 失败', e);
            }
        }

        // 逐维度生成向量
        const dimensions = {} as Record<StyleDimensionKeyV2, StyleDimensionVectorV2>;
        for (const key of STYLE_DIMENSION_KEYS_V2) {
            const sourceText = this.buildDimensionSourceText(key, features);
            const { vector, approximated } = await this.embedDimension(key, sourceText, overallVector);
            dimensions[key] = {
                dimension: key,
                vector,
                sourceText,
                approximated,
            };
        }

        return {
            fingerprintId,
            version: 'v2',
            dimensions,
            overallVector,
            modelId: this.getCurrentModelId(),
            dimensionCount: overallVector.length,
            updatedAt: Date.now(),
        };
    }

    /**
     * 添加或更新指纹 V2 向量
     */
    async addOrUpdateVectors(
        fingerprintId: string,
        features: StyleFingerprintFeaturesV2
    ): Promise<StyleFingerprintVectorsV2> {
        await this.ensureLoaded();
        const vectors = await this.buildV2Vectors(fingerprintId, features);
        this.vectors.set(fingerprintId, vectors);
        await this.saveToDisk(fingerprintId);
        return vectors;
    }

    /**
     * 删除指纹向量
     */
    async deleteVectors(fingerprintId: string): Promise<void> {
        await this.ensureLoaded();
        if (!this.vectors.has(fingerprintId)) return;
        this.vectors.delete(fingerprintId);
        await this.saveToDisk(fingerprintId);
    }

    /**
     * 获取向量（仅内存）
     */
    getVectors(fingerprintId: string): StyleFingerprintVectorsV2 | undefined {
        return this.vectors.get(fingerprintId);
    }

    /**
     * 获取或构建向量（不存在时构建）
     */
    async getOrBuildVectors(
        fingerprintId: string,
        features: StyleFingerprintFeaturesV2,
        extractedAt?: number
    ): Promise<StyleFingerprintVectorsV2 | undefined> {
        await this.ensureLoaded();

        const existing = this.vectors.get(fingerprintId);
        if (existing && extractedAt && existing.updatedAt >= extractedAt) {
            return existing;
        }
        if (existing && !extractedAt) {
            return existing;
        }

        try {
            return await this.addOrUpdateVectors(fingerprintId, features);
        } catch (e) {
            log.warn('[StyleVectorStoreV2] 构建向量失败:', e);
            return undefined;
        }
    }

    // ----------------------------------------------------------
    // V1 兼容与迁移
    // ----------------------------------------------------------

    /**
     * 检测 V1 向量文件是否存在
     */
    async hasV1Vectors(fingerprintId: string): Promise<boolean> {
        const fs = this.getFS();
        try {
            const v1Path = this.getV1VectorsFilePath(fingerprintId);
            const content = await fs.read(v1Path);
            if (!content) return false;
            const data = JSON.parse(content) as V1VectorsFile;
            return data?.fingerprintId === fingerprintId && !!data.dimensions;
        } catch {
            return false;
        }
    }

    /**
     * 从 V1 向量文件迁移到 V2（缺失维度用 overallVector 近似）
     * - 迁移前会备份 V1 原始数据到 .v1.bak
     * - 若已存在 V2 向量则跳过
     */
    async migrateFromV1(
        fingerprintId: string,
        options?: { overwrite?: boolean }
    ): Promise<StyleFingerprintVectorsV2 | undefined> {
        await this.ensureLoaded();

        // 已存在 V2 且不覆盖
        if (!options?.overwrite && this.vectors.has(fingerprintId)) {
            return this.vectors.get(fingerprintId);
        }

        const fs = this.getFS();
        const v1Path = this.getV1VectorsFilePath(fingerprintId);

        // 读取 V1 文件
        let v1Data: V1VectorsFile;
        try {
            const content = await fs.read(v1Path);
            v1Data = JSON.parse(content) as V1VectorsFile;
        } catch {
            return undefined;
        }

        if (!v1Data?.fingerprintId || !v1Data.dimensions) {
            return undefined;
        }

        // 备份 V1 数据
        const backupPath = this.getV1BackupFilePath(fingerprintId);
        try {
            await fs.mkdir(this.getVectorsDir());
            await fs.write(backupPath, JSON.stringify(v1Data, null, 2));
        } catch (e) {
            log.warn(`[StyleVectorStoreV2] 备份 V1 向量失败: ${backupPath}`, e);
            // 备份失败不阻塞迁移
        }

        // 构造 V2 维度（V1 字段映射 + 缺失维度用 overallVector 近似）
        const overallVector = v1Data.overallVector ?? [];
        const dimensions = {} as Record<StyleDimensionKeyV2, StyleDimensionVectorV2>;

        for (const key of STYLE_DIMENSION_KEYS_V2) {
            // 查找 V1 对应字段
            const v1Key = Object.keys(V1_TO_V2_FIELD_MAP).find(k => V1_TO_V2_FIELD_MAP[k] === key);
            const v1Entry = v1Key ? v1Data.dimensions[v1Key] : undefined;

            if (v1Entry && v1Entry.vector && v1Entry.vector.length > 0) {
                dimensions[key] = {
                    dimension: key,
                    vector: v1Entry.vector,
                    sourceText: v1Entry.description || '',
                    approximated: false,
                };
            } else {
                // V1 没有此维度 → 用整体向量近似
                dimensions[key] = {
                    dimension: key,
                    vector: overallVector,
                    sourceText: '',
                    approximated: overallVector.length > 0,
                };
            }
        }

        const v2Vectors: StyleFingerprintVectorsV2 = {
            fingerprintId,
            version: 'v2',
            dimensions,
            overallVector,
            // V1 迁移数据无法确认原 embedding 模型，留空表示「未知」：
            // 加载时不做模型一致性隔离，等用户重建后自动补齐。
            modelId: '',
            dimensionCount: overallVector.length,
            v1Backup: v1Data,
            updatedAt: Date.now(),
        };

        this.vectors.set(fingerprintId, v2Vectors);
        await this.saveToDisk(fingerprintId);
        return v2Vectors;
    }

    /**
     * 回滚 V2 → V1（从 .v1.bak 恢复）
     */
    async rollbackToV1(fingerprintId: string): Promise<boolean> {
        await this.ensureLoaded();
        const fs = this.getFS();
        const backupPath = this.getV1BackupFilePath(fingerprintId);

        let v1Data: V1VectorsFile;
        try {
            const content = await fs.read(backupPath);
            v1Data = JSON.parse(content) as V1VectorsFile;
        } catch {
            return false;
        }

        // 写回 V1 路径
        const v1Path = this.getV1VectorsFilePath(fingerprintId);
        try {
            await fs.write(v1Path, JSON.stringify(v1Data, null, 2));
        } catch {
            return false;
        }

        // 删除 V2 文件
        try {
            const v2Path = this.getVectorsFilePath(fingerprintId);
            await fs.delete(v2Path);
        } catch { /* ignore */ }

        // 内存移除 V2
        this.vectors.delete(fingerprintId);
        return true;
    }

    /**
     * 批量迁移所有 V1 指纹向量到 V2
     */
    async migrateAllFromV1(options?: { overwrite?: boolean }): Promise<{
        migrated: string[];
        failed: { id: string; reason: string }[];
    }> {
        await this.ensureLoaded();
        const fs = this.getFS();
        const baseDir = this.scope === 'global'
            ? globalFingerprintVectorsDir()
            : (this.project ? projectFingerprintVectorsDir(this.project) : '');

        let files: { name: string; path: string }[] = [];
        try {
            files = await fs.listFiles(baseDir);
        } catch {
            return { migrated: [], failed: [] };
        }

        const migrated: string[] = [];
        const failed: { id: string; reason: string }[] = [];

        for (const file of files) {
            if (!file.name.startsWith('style-') || !file.name.endsWith('.json')) continue;
            const match = file.name.match(/^style-(.+)\.json$/);
            if (!match) continue;
            const fingerprintId = match[1];

            try {
                const result = await this.migrateFromV1(fingerprintId, options);
                if (result) {
                    migrated.push(fingerprintId);
                }
            } catch (e) {
                failed.push({ id: fingerprintId, reason: String(e) });
            }
        }

        return { migrated, failed };
    }

    /**
     * 重建指定指纹的 V2 向量（基于新 features 重新生成）
     */
    async rebuildVectors(
        fingerprintId: string,
        features: StyleFingerprintFeaturesV2
    ): Promise<StyleFingerprintVectorsV2> {
        return this.addOrUpdateVectors(fingerprintId, features);
    }

    /**
     * 批量重建所有已加载指纹的 V2 向量
     * @param featuresProvider 提供 fingerprintId → features 的回调
     */
    async rebuildAllVectors(
        featuresProvider: (fingerprintId: string) => Promise<StyleFingerprintFeaturesV2 | undefined>
    ): Promise<{ rebuilt: string[]; failed: { id: string; reason: string }[] }> {
        await this.ensureLoaded();
        const rebuilt: string[] = [];
        const failed: { id: string; reason: string }[] = [];

        for (const fingerprintId of Array.from(this.vectors.keys())) {
            try {
                const features = await featuresProvider(fingerprintId);
                if (!features) {
                    failed.push({ id: fingerprintId, reason: 'features not found' });
                    continue;
                }
                await this.addOrUpdateVectors(fingerprintId, features);
                rebuilt.push(fingerprintId);
            } catch (e) {
                failed.push({ id: fingerprintId, reason: String(e) });
            }
        }

        return { rebuilt, failed };
    }

    // ----------------------------------------------------------
    // 检索
    // ----------------------------------------------------------

    /**
     * 计算两个向量的余弦相似度（容错）
     */
    private safeSimilarity(a: number[], b: number[]): number {
        if (!a || !b) return 0;
        if (a.length === 0 || b.length === 0) return 0;
        if (a.length !== b.length) return 0;
        return cosineSimilarity(a, b);
    }

    /**
     * 按单维度检索：返回在该维度上与查询文本最相似的指纹
     */
    async searchByDimension(
        queryText: string,
        fingerprints: Array<{
            id: string;
            name: string;
            scope: 'template' | 'global' | 'project';
            features: StyleFingerprintFeaturesV2;
            extractedAt?: number;
        }>,
        dimension: StyleDimensionKeyV2,
        options?: { topN?: number; minScore?: number }
    ): Promise<StyleSimilarityResultV2[]> {
        await this.ensureLoaded();

        const topN = options?.topN ?? 10;
        const minScore = options?.minScore ?? 0;

        // 查询文本 embedding
        let queryVector: number[] = [];
        try {
            queryVector = await this.embeddingProvider.embed(queryText);
        } catch (e) {
            log.warn('[StyleVectorStoreV2] 查询 embedding 失败', e);
            return [];
        }
        if (queryVector.length === 0) return [];

        const results: StyleSimilarityResultV2[] = [];

        for (const fp of fingerprints) {
            const fpVectors = await this.getOrBuildVectors(fp.id, fp.features, fp.extractedAt);
            if (!fpVectors) continue;

            const dimVec = fpVectors.dimensions[dimension];
            if (!dimVec) continue;

            const dimScore = this.safeSimilarity(queryVector, dimVec.vector);

            // 构造完整 dimensionScores（仅当前维度有分数，其他为 0）
            const dimensionScores = {} as Record<StyleDimensionKeyV2, number>;
            for (const key of STYLE_DIMENSION_KEYS_V2) {
                dimensionScores[key] = key === dimension ? dimScore : 0;
            }

            if (dimScore >= minScore) {
                results.push({
                    fingerprintId: fp.id,
                    fingerprintName: fp.name,
                    overallScore: dimScore,
                    dimensionScores,
                    scope: fp.scope,
                    hasApproximated: dimVec.approximated,
                });
            }
        }

        results.sort((a, b) => b.overallScore - a.overallScore);
        return results.slice(0, topN);
    }

    /**
     * 加权检索：按维度权重计算整体相似度
     */
    async searchWeighted(
        queryText: string,
        fingerprints: Array<{
            id: string;
            name: string;
            scope: 'template' | 'global' | 'project';
            features: StyleFingerprintFeaturesV2;
            extractedAt?: number;
        }>,
        options?: SearchOptionsV2
    ): Promise<StyleSimilarityResultV2[]> {
        await this.ensureLoaded();

        const topN = options?.topN ?? 10;
        const minScore = options?.minScore ?? 0;
        const weights = options?.dimensionWeights ?? STYLE_DIMENSION_WEIGHTS_V2;
        const onlyDims = options?.onlyDimensions ?? STYLE_DIMENSION_KEYS_V2;

        // 权重归一化
        let weightTotal = 0;
        for (const key of onlyDims) {
            weightTotal += weights[key] ?? 0;
        }
        if (weightTotal === 0) return [];

        // 查询 embedding
        let queryVector: number[] = [];
        try {
            queryVector = await this.embeddingProvider.embed(queryText);
        } catch (e) {
            log.warn('[StyleVectorStoreV2] 查询 embedding 失败', e);
            return [];
        }
        if (queryVector.length === 0) return [];

        const results: StyleSimilarityResultV2[] = [];

        for (const fp of fingerprints) {
            const fpVectors = await this.getOrBuildVectors(fp.id, fp.features, fp.extractedAt);
            if (!fpVectors) continue;

            const dimensionScores = {} as Record<StyleDimensionKeyV2, number>;
            let weightedSum = 0;
            let hasApproximated = false;

            // 仅计算指定维度
            for (const key of onlyDims) {
                const dimVec = fpVectors.dimensions[key];
                const dimScore = dimVec ? this.safeSimilarity(queryVector, dimVec.vector) : 0;
                dimensionScores[key] = dimScore;
                if (dimVec?.approximated) hasApproximated = true;
                weightedSum += dimScore * (weights[key] ?? 0);
            }
            // 未计算的维度填 0
            for (const key of STYLE_DIMENSION_KEYS_V2) {
                if (!(key in dimensionScores)) {
                    dimensionScores[key] = 0;
                }
            }

            const overallScore = weightedSum / weightTotal;

            if (overallScore >= minScore) {
                results.push({
                    fingerprintId: fp.id,
                    fingerprintName: fp.name,
                    overallScore,
                    dimensionScores,
                    scope: fp.scope,
                    hasApproximated,
                });
            }
        }

        results.sort((a, b) => b.overallScore - a.overallScore);
        return results.slice(0, topN);
    }

    /**
     * 指纹对指纹检索：基于已有指纹找相似指纹
     */
    async searchSimilarByFingerprint(
        sourceFingerprintId: string,
        fingerprints: Array<{
            id: string;
            name: string;
            scope: 'template' | 'global' | 'project';
            features: StyleFingerprintFeaturesV2;
            extractedAt?: number;
        }>,
        options?: SearchOptionsV2
    ): Promise<StyleSimilarityResultV2[]> {
        await this.ensureLoaded();

        const topN = options?.topN ?? 10;
        const minScore = options?.minScore ?? 0;
        const weights = options?.dimensionWeights ?? STYLE_DIMENSION_WEIGHTS_V2;
        const onlyDims = options?.onlyDimensions ?? STYLE_DIMENSION_KEYS_V2;

        const sourceVectors = this.vectors.get(sourceFingerprintId);
        if (!sourceVectors) return [];

        // 权重归一化
        let weightTotal = 0;
        for (const key of onlyDims) {
            weightTotal += weights[key] ?? 0;
        }
        if (weightTotal === 0) return [];

        const results: StyleSimilarityResultV2[] = [];

        for (const fp of fingerprints) {
            if (fp.id === sourceFingerprintId) continue;

            const fpVectors = await this.getOrBuildVectors(fp.id, fp.features, fp.extractedAt);
            if (!fpVectors) continue;

            const dimensionScores = {} as Record<StyleDimensionKeyV2, number>;
            let weightedSum = 0;
            let hasApproximated = false;

            for (const key of onlyDims) {
                const sourceVec = sourceVectors.dimensions[key]?.vector ?? [];
                const targetVec = fpVectors.dimensions[key]?.vector ?? [];
                const dimScore = this.safeSimilarity(sourceVec, targetVec);
                dimensionScores[key] = dimScore;
                if (fpVectors.dimensions[key]?.approximated) hasApproximated = true;
                weightedSum += dimScore * (weights[key] ?? 0);
            }
            for (const key of STYLE_DIMENSION_KEYS_V2) {
                if (!(key in dimensionScores)) {
                    dimensionScores[key] = 0;
                }
            }

            const overallScore = weightedSum / weightTotal;

            if (overallScore >= minScore) {
                results.push({
                    fingerprintId: fp.id,
                    fingerprintName: fp.name,
                    overallScore,
                    dimensionScores,
                    scope: fp.scope,
                    hasApproximated,
                });
            }
        }

        results.sort((a, b) => b.overallScore - a.overallScore);
        return results.slice(0, topN);
    }

    // ----------------------------------------------------------
    // 状态查询
    // ----------------------------------------------------------

    /** 获取所有已加载的指纹 ID */
    listLoadedFingerprintIds(): string[] {
        return Array.from(this.vectors.keys());
    }

    /** 检查指定维度是否为近似 */
    isDimensionApproximated(fingerprintId: string, dimension: StyleDimensionKeyV2): boolean {
        const vectors = this.vectors.get(fingerprintId);
        if (!vectors) return true;
        return vectors.dimensions[dimension]?.approximated ?? true;
    }

    /** 统计近似维度数量 */
    countApproximatedDimensions(fingerprintId: string): number {
        const vectors = this.vectors.get(fingerprintId);
        if (!vectors) return STYLE_DIMENSION_KEYS_V2.length;
        let count = 0;
        for (const key of STYLE_DIMENSION_KEYS_V2) {
            if (vectors.dimensions[key]?.approximated) count++;
        }
        return count;
    }

    /** 重新加载（清除内存缓存） */
    async reload(): Promise<void> {
        this.vectors.clear();
        this.loaded = false;
        this.loadingPromise = null;
        this.modelMismatches = [];
        await this.ensureLoaded();
    }
}

// ============================================================
// 三、便捷导出
// ============================================================

export {
    STYLE_DIMENSIONS_V2,
    STYLE_DIMENSION_KEYS_V2,
    STYLE_DIMENSION_LABELS_V2,
    STYLE_DIMENSION_WEIGHTS_V2,
    V1_TO_V2_FIELD_MAP,
    V2_NEW_DIMENSIONS,
};
