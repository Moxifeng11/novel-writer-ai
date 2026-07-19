import { App } from 'obsidian';
import { FileSystemPort, ObsidianFileSystem } from '../shared/file-system-port';
import {
    globalFingerprintVectorsDir,
    projectFingerprintVectorsDir,
} from '../shared/paths';
import type { VectorStore } from './style-fingerprint-library';
import type { EmbeddingProvider } from './embedding/embedding-provider';
import { createLogger } from '../shared/logger';


const log = createLogger('LocalVectorStore');
export function cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
        throw new Error(`Vector dimension mismatch: ${a.length} vs ${b.length}`);
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
        dotProduct += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }

    if (normA === 0 || normB === 0) {
        return 0;
    }

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

interface VectorSample {
    sample: string;
    vector: number[];
}

interface FingerprintVectorFile {
    fingerprintId: string;
    samples: VectorSample[];
}

export class LocalVectorStore implements VectorStore {
    private app: App;
    private scope: 'global' | 'project';
    private project?: string;
    private embeddingProvider: EmbeddingProvider;
    private fs: FileSystemPort | null = null;
    private vectors: Map<string, VectorSample[]> = new Map();
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

    private getVectorFilePath(fingerprintId: string): string {
        return `${this.getVectorsDir()}/fp-${fingerprintId}.json`;
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
                if (!file.name.startsWith('fp-') || !file.name.endsWith('.json')) continue;
                try {
                    const content = await fs.read(file.path);
                    const data = JSON.parse(content) as FingerprintVectorFile;
                    if (data.fingerprintId && Array.isArray(data.samples)) {
                        this.vectors.set(data.fingerprintId, data.samples);
                    }
                } catch (e) {
                    log.warn(`[LocalVectorStore] 加载向量文件失败: ${file.path}`, e);
                }
            }
        } catch {
            // 目录不存在时静默处理
        }
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

        const data: FingerprintVectorFile = {
            fingerprintId,
            samples,
        };

        try {
            await fs.mkdir(dir);
            await fs.write(filePath, JSON.stringify(data, null, 2));
        } catch (e) {
            log.warn(`[LocalVectorStore] 保存向量文件失败: ${filePath}`, e);
        }
    }

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

    async search(query: string, topN: number = 3): Promise<Array<{ sample: string; score: number }>> {
        await this.ensureLoaded();

        const queryVector = await this.embeddingProvider.embed(query);
        const results: Array<{ sample: string; score: number }> = [];

        for (const [, samples] of this.vectors) {
            for (const item of samples) {
                const score = cosineSimilarity(queryVector, item.vector);
                results.push({ sample: item.sample, score });
            }
        }

        results.sort((a, b) => b.score - a.score);
        return results.slice(0, topN);
    }

    async delete(fingerprintId: string): Promise<void> {
        await this.ensureLoaded();

        this.vectors.delete(fingerprintId);
        await this.saveToDisk(fingerprintId);
    }
}
