import { App } from 'obsidian';
import { FileSystemPort, ObsidianFileSystem } from '@/shared/file-system-port';
import {
    globalFingerprintVectorsDir,
    projectFingerprintVectorsDir,
} from '@/shared/paths';
import type { VectorStore } from './style-fingerprint-library';
import type { EmbeddingProvider } from './embedding/embedding-provider';
import {
    detectEmbeddingMismatch,
    getEmbeddingDimensionHint,
    getEmbeddingFingerprint,
    getEmbeddingModelName,
    type EmbeddingMismatchReason,
} from './embedding/embedding-fingerprint';
import { filterRetrievalResults } from '@/shared/retrieval-filter';
import { createLogger } from '@/shared/logger';


const log = createLogger('LocalVectorStore');

/**
 * 向量范数缓存：检索会对同一条参考向量反复计算余弦，
 * 范数在向量生命周期内不变，按数组对象缓存避免每次查询重复 O(dim) 平方和。
 */
const vectorNormCache = new WeakMap<number[], number>();

function vectorNorm(vector: number[]): number {
    const cached = vectorNormCache.get(vector);
    if (cached !== undefined) return cached;
    let sum = 0;
    for (let i = 0; i < vector.length; i++) sum += vector[i] * vector[i];
    vectorNormCache.set(vector, sum);
    return sum;
}

/**
 * cosineSimilarity 函数。
 * @param a - 参与比较的值
 * @param b - 参与比较的值
 * @returns 数值结果
 */
export function cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
        throw new Error(`Vector dimension mismatch: ${a.length} vs ${b.length}`);
    }

    // 范数走缓存，循环只算点积；同一批样本多次检索不再重复平方和。
    const normA = vectorNorm(a);
    const normB = vectorNorm(b);
    if (normA === 0 || normB === 0) {
        return 0;
    }

    let dotProduct = 0;
    for (let i = 0; i < a.length; i++) {
        dotProduct += a[i] * b[i];
    }

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

interface VectorSample {
    sample: string;
    vector: number[];
}

interface FingerprintVectorFile {
    fingerprintId: string;
    /** 生成向量时使用的 embedding 模型指纹；旧文件可能没有（纯模型名） */
    modelId?: string;
    /** 向量维度（诊断用） */
    dimensionCount?: number;
    samples: VectorSample[];
}

/** 因更换 embedding 模型被跳过的指纹向量文件 */
export interface FingerprintVectorModelMismatch {
    fingerprintId: string;
    storedModelId: string;
    currentModelId: string;
    reason?: EmbeddingMismatchReason;
}

/**
 * LocalVectorStore 类。
 */
export class LocalVectorStore implements VectorStore {
    private app: App;
    private scope: 'global' | 'project';
    private project?: string;
    private embeddingProvider: EmbeddingProvider;
    private fs: FileSystemPort | null = null;
    private vectors: Map<string, VectorSample[]> = new Map();
    private loaded = false;
    /** 上次加载时的向量文件签名（路径 + mtime + size），用于感知其他实例的新增/重建 */
    private loadedSignature: string | null = null;
    /** 因 embedding 模型不一致被跳过的指纹 */
    private modelMismatches: FingerprintVectorModelMismatch[] = [];

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

    private getVectorFilePath(fingerprintId: string): string {
        return `${this.getVectorsDir()}/fp-${fingerprintId}.json`;
    }

    /** 当前 embedding 指纹（provider:model@baseUrlHash） */
    private getCurrentModelId(): string {
        return getEmbeddingFingerprint(this.embeddingProvider);
    }

    /** 当前 embedding 判定上下文（维度只取 provider 已声明值，不发探测请求） */
    private getCurrentEmbeddingContext(): { fingerprint: string; modelName: string; dimension: number | null } {
        return {
            fingerprint: this.getCurrentModelId(),
            modelName: getEmbeddingModelName(this.embeddingProvider),
            dimension: getEmbeddingDimensionHint(this.embeddingProvider),
        };
    }

    /**
     * 向量文件是否与当前 embedding 不一致（模型指纹或维度）。
     * 旧文件没有 modelId/dimensionCount：无法判断，按兼容策略加载（重新提取后补齐）。
     */
    private detectMismatch(
        data: FingerprintVectorFile,
        current: { fingerprint: string; modelName: string; dimension: number | null },
    ): EmbeddingMismatchReason | null {
        return detectEmbeddingMismatch(data, current);
    }

    /**
     * 因换 embedding 模型被跳过的指纹向量（文件保留，重新提取即可按当前模型重建）
     *
     * @returns 结果数组
     */
    getModelMismatches(): FingerprintVectorModelMismatch[] {
        return [...this.modelMismatches];
    }

    private async ensureLoaded(): Promise<void> {
        const signature = await this.computeSignature();
        // 指纹库 UI 会用自己的 LocalVectorStore 实例写入向量文件；只认一次 loaded
        // 会让协同引擎实例永远检索不到新指纹/重建后的样本，直到重启。
        if (this.loaded && (signature === null || signature === this.loadedSignature)) return;
        const ok = await this.loadAllFromDisk();
        if (ok) {
            this.loadedSignature = signature;
            this.loaded = true;
        }
    }

    /** 向量文件签名；目录不可读时返回 null（保留内存中的旧向量） */
    private async computeSignature(): Promise<string | null> {
        try {
            const files = await this.getFS().listFiles(this.getVectorsDir());
            const fileSignature = files
                .filter(f => f.name.startsWith('fp-') && f.name.endsWith('.json'))
                .map(f => `${f.path}@${f.stat?.mtime ?? 0}:${f.stat?.size ?? 0}`)
                .sort()
                .join('|');
            // B2：签名包含 embedding 指纹，切换模型/端点后同会话也能重新加载
            return `${this.getCurrentModelId()}::${fileSignature}`;
        } catch {
            return null;
        }
    }

    private async loadAllFromDisk(): Promise<boolean> {
        const fs = this.getFS();
        const dir = this.getVectorsDir();

        const files = await fs.listFiles(dir).catch(() => null);
        if (!files) return false;

        this.vectors.clear();
        this.modelMismatches = [];
        const current = this.getCurrentEmbeddingContext();
        for (const file of files) {
            if (!file.name.startsWith('fp-') || !file.name.endsWith('.json')) continue;
            try {
                const content = await fs.read(file.path);
                const data = JSON.parse(content) as FingerprintVectorFile;
                if (data.fingerprintId && Array.isArray(data.samples)) {
                    // 换 embedding 模型后旧向量不能再参与检索：维度不同会让 cosineSimilarity
                    // 抛错（整段指纹注入被 catch 成空），同维度也会混算出假相似度。
                    // 向量可从指纹特征重新提取，因此只跳过、不删文件。
                    const mismatchReason = this.detectMismatch(data, current);
                    if (mismatchReason) {
                        this.modelMismatches.push({
                            fingerprintId: data.fingerprintId,
                            storedModelId: data.modelId || '',
                            currentModelId: current.fingerprint,
                            reason: mismatchReason,
                        });
                        continue;
                    }
                    this.vectors.set(data.fingerprintId, data.samples);
                }
            } catch (e) {
                log.warn(`[LocalVectorStore] 加载向量文件失败: ${file.path}`, e);
            }
        }
        if (this.modelMismatches.length > 0) {
            log.info(`[LocalVectorStore] 跳过 ${this.modelMismatches.length} 个 embedding 模型不一致的指纹向量，重新提取指纹即可按当前模型重建`);
        }
        return true;
    }

    private async saveToDisk(fingerprintId: string): Promise<void> {
        const fs = this.getFS();
        const dir = this.getVectorsDir();
        const filePath = this.getVectorFilePath(fingerprintId);

        const samples = this.vectors.get(fingerprintId);
        if (!samples || samples.length === 0) {
            try {
                await fs.delete(filePath);
            } catch {
                // 文件不存在时忽略
            }
            return;
        }

        const currentModelId = this.getCurrentModelId();
        const data: FingerprintVectorFile = {
            fingerprintId,
            // 模型未知时不落 'unknown'：否则以后模型可识别时会被误判成「不一致」
            ...(currentModelId !== 'unknown' ? { modelId: currentModelId } : {}),
            dimensionCount: samples[0]?.vector?.length ?? 0,
            samples,
        };

        try {
            await fs.mkdir(dir);
            await fs.write(filePath, JSON.stringify(data, null, 2));
            // 重新提取后该指纹已按当前模型写入，不再算作不一致
            this.modelMismatches = this.modelMismatches.filter(m => m.fingerprintId !== fingerprintId);
        } catch (e) {
            log.warn(`[LocalVectorStore] 保存向量文件失败: ${filePath}`, e);
        }
    }

    /**
     * 添加。
     * @param fingerprintId - 指纹ID
     * @param samples - 样本
     */
    async add(fingerprintId: string, samples: string[]): Promise<void> {
        await this.ensureLoaded();

        const existingSamples = this.vectors.get(fingerprintId) || [];
        const newSamples: VectorSample[] = [];

        for (const sample of samples) {
            const vector = await this.embeddingProvider.embed(sample);
            newSamples.push({ sample, vector });
        }

        const allSamples = [...existingSamples, ...newSamples];
        this.vectors.set(fingerprintId, allSamples);

        await this.saveToDisk(fingerprintId);
    }

    /**
     * search 方法。
     * @param query - 查询串
     * @param topN - 顶部编号
      * @returns string }>> 结果
     */
    async search(query: string, topN: number = 3): Promise<Array<{ sample: string; score: number; fingerprintId?: string }>> {
        await this.ensureLoaded();

        const queryVector = await this.embeddingProvider.embed(query);
        const results: Array<{ sample: string; score: number; fingerprintId?: string }> = [];
        let skippedByDimension = 0;

        for (const [fingerprintId, samples] of this.vectors) {
            for (const item of samples) {
                // 旧文件没有 modelId，模型治理拦不住；维度不同直接跳过，
                // 否则 cosineSimilarity 抛错会让上游把整段指纹注入 catch 成空。
                if (item.vector.length !== queryVector.length) {
                    skippedByDimension++;
                    continue;
                }
                const score = cosineSimilarity(queryVector, item.vector);
                results.push({ sample: item.sample, score, fingerprintId });
            }
        }

        if (skippedByDimension > 0) {
            log.warn(`[LocalVectorStore] 跳过 ${skippedByDimension} 个维度与当前 embedding 模型不一致的样本，请重新提取对应指纹`);
        }

        results.sort((a, b) => b.score - a.score);
        return filterRetrievalResults(results).slice(0, topN);
    }

    /**
     * 删除。
     * @param fingerprintId - 指纹ID
     */
    async delete(fingerprintId: string): Promise<void> {
        await this.ensureLoaded();

        this.vectors.delete(fingerprintId);
        await this.saveToDisk(fingerprintId);
    }
}
