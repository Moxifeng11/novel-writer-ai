import { createLogger } from '@/shared/logger';

const log = createLogger('GenrePreferenceMemory');
/**
 * GenreCorrectionRecord 类型定义。
 */
export interface GenreCorrectionRecord {
    bookId: string;
    bookTitle: string;
    originalChannel?: 'male' | 'female' | 'neutral';
    correctedChannel?: 'male' | 'female' | 'neutral';
    originalGenre?: string;
    correctedGenre?: string;
    originalSubGenre?: string;
    correctedSubGenre?: string;
    timestamp: number;
    bookKeywords?: string[];
}

/**
 * GenrePreferenceData 类型定义。
 */
export interface GenrePreferenceData {
    corrections: GenreCorrectionRecord[];
    genreBias: Record<string, number>;
    subGenreBias: Record<string, number>;
    channelBias: Record<string, number>;
    autoClassifyCount: number;
    manualCorrectionCount: number;
    lastUpdated: number;
}

/**
 * 生成一份全新的默认偏好数据。
 *
 * 每次构造/reset 都新建嵌套对象，避免多实例共享同一份引用而互相污染。
 * @returns 默认偏好数据
 */
function createDefaultPreferenceData(): GenrePreferenceData {
    return {
        corrections: [],
        genreBias: {},
        subGenreBias: {},
        channelBias: {},
        autoClassifyCount: 0,
        manualCorrectionCount: 0,
        lastUpdated: 0,
    };
}

const MAX_CORRECTIONS = 200;
const BIAS_DECAY = 0.95;
const CORRECTION_WEIGHT = 0.15;

/**
 * GenrePreferenceMemory 类。
 */
export class GenrePreferenceMemory {
    private data: GenrePreferenceData;
    private saveCallback?: (data: GenrePreferenceData) => Promise<void>;
    private dirty: boolean = false;
    private saveTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(
        savedData?: GenrePreferenceData | null,
        saveCallback?: (data: GenrePreferenceData) => Promise<void>
    ) {
        this.data = savedData
            ? {
                ...createDefaultPreferenceData(),
                ...savedData,
                corrections: savedData.corrections ? [...savedData.corrections] : [],
                genreBias: savedData.genreBias ? { ...savedData.genreBias } : {},
                subGenreBias: savedData.subGenreBias ? { ...savedData.subGenreBias } : {},
                channelBias: savedData.channelBias ? { ...savedData.channelBias } : {},
            }
            : createDefaultPreferenceData();
        this.saveCallback = saveCallback;
    }

    /**
     * 读取偏好数据。
     * @returns 数据
     */
    getData(): GenrePreferenceData {
        return { ...this.data };
    }

    /**
     * 写入偏好数据。
     *
     * @param data - 数据
     */
    async setData(data: GenrePreferenceData): Promise<void> {
        this.data = { ...data };
        this.markDirty();
        await this.scheduleSave();
    }

    /**
     * 记录一次自动分类。
     */
    recordAutoClassify(): void {
        this.data.autoClassifyCount++;
        this.markDirty();
        this.scheduleSave().catch((e: unknown) => log.warn('[GenrePreferenceMemory] 保存失败:', e));
    }

    /**
     * 记录一次用户纠正。
     *
     * @param record - 记录
     */
    recordCorrection(record: Omit<GenreCorrectionRecord, 'timestamp'>): void {
        const correctionRecord: GenreCorrectionRecord = {
            ...record,
            timestamp: Date.now(),
        };

        this.data.corrections.unshift(correctionRecord);
        if (this.data.corrections.length > MAX_CORRECTIONS) {
            this.data.corrections = this.data.corrections.slice(0, MAX_CORRECTIONS);
        }

        this.data.manualCorrectionCount++;
        this.data.lastUpdated = Date.now();

        if (record.correctedGenre) {
            this.updateGenreBias(record.correctedGenre, record.originalGenre);
        }
        if (record.correctedSubGenre && record.correctedGenre) {
            this.updateSubGenreBias(record.correctedGenre, record.correctedSubGenre);
        }
        if (record.correctedChannel) {
            this.updateChannelBias(record.correctedChannel, record.originalChannel);
        }

        this.markDirty();
        this.scheduleSave().catch((e: unknown) => log.warn('[GenrePreferenceMemory] 保存失败:', e));
    }

    private updateGenreBias(corrected: string, original?: string): void {
        const current = this.data.genreBias[corrected] || 0;
        this.data.genreBias[corrected] = Math.min(1, current + CORRECTION_WEIGHT);

        if (original && original !== corrected) {
            const orig = this.data.genreBias[original] || 0;
            this.data.genreBias[original] = Math.max(0, orig - CORRECTION_WEIGHT * 0.5);
        }

        this.decayBiases(this.data.genreBias);
    }

    private updateSubGenreBias(genreId: string, subGenreId: string): void {
        const key = `${genreId}:${subGenreId}`;
        const current = this.data.subGenreBias[key] || 0;
        this.data.subGenreBias[key] = Math.min(1, current + CORRECTION_WEIGHT);
        this.decayBiases(this.data.subGenreBias);
    }

    private updateChannelBias(corrected: string, original?: string): void {
        const current = this.data.channelBias[corrected] || 0;
        this.data.channelBias[corrected] = Math.min(1, current + CORRECTION_WEIGHT);

        if (original && original !== corrected) {
            const orig = this.data.channelBias[original] || 0;
            this.data.channelBias[original] = Math.max(0, orig - CORRECTION_WEIGHT * 0.5);
        }

        this.decayBiases(this.data.channelBias);
    }

    private decayBiases(biases: Record<string, number>): void {
        for (const key of Object.keys(biases)) {
            biases[key] = biases[key] * BIAS_DECAY;
            if (biases[key] < 0.01) {
                delete biases[key];
            }
        }
    }

    /**
     * 题材偏置。
     *
     * @param genreId - 题材 ID
     * @returns 偏置值
     */
    getGenreBias(genreId: string): number {
        return this.data.genreBias[genreId] || 0;
    }

    /**
     * 子题材偏置。
     *
     * @param genreId - 题材 ID
     * @param subGenreId - 子题材 ID
     * @returns 偏置值
     */
    getSubGenreBias(genreId: string, subGenreId: string): number {
        const key = `${genreId}:${subGenreId}`;
        return this.data.subGenreBias[key] || 0;
    }

    /**
     * 频道偏置。
     *
     * @param channel - 通道
     * @returns 偏置值
     */
    getChannelBias(channel: 'male' | 'female' | 'neutral'): number {
        return this.data.channelBias[channel] || 0;
    }

    /**
     * 分类准确率。
     * @returns 准确率
     */
    getAccuracy(): number {
        if (this.data.autoClassifyCount === 0) return 1;
        const correctCount = this.data.autoClassifyCount - this.data.manualCorrectionCount;
        return Math.max(0, Math.min(1, correctCount / this.data.autoClassifyCount));
    }

    /**
     * 读取统计。
     * @returns 统计对象
     */
    getStats(): {
        autoClassifyCount: number;
        manualCorrectionCount: number;
        accuracy: number;
        topCorrectedGenres: { genreId: string; count: number }[];
        lastUpdated: number;
    } {
        const genreCorrectionCounts: Record<string, number> = {};
        for (const corr of this.data.corrections) {
            if (corr.correctedGenre) {
                genreCorrectionCounts[corr.correctedGenre] = (genreCorrectionCounts[corr.correctedGenre] || 0) + 1;
            }
        }

        const topCorrectedGenres = Object.entries(genreCorrectionCounts)
            .map(([genreId, count]) => ({ genreId, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 10);

        return {
            autoClassifyCount: this.data.autoClassifyCount,
            manualCorrectionCount: this.data.manualCorrectionCount,
            accuracy: this.getAccuracy(),
            topCorrectedGenres,
            lastUpdated: this.data.lastUpdated,
        };
    }

    /**
     * findSimilarCorrections 方法。
     * @param keywords - 参数值
     * @param limit - 上限
     * @returns 结果数组
     */
    findSimilarCorrections(
        keywords: string[],
        limit: number = 5
    ): GenreCorrectionRecord[] {
        if (keywords.length === 0 || this.data.corrections.length === 0) {
            return [];
        }

        const keywordSet = new Set(keywords.map(k => k.toLowerCase()));
        const scored = this.data.corrections.map(corr => {
            const bookKeywords = (corr.bookKeywords || []).map(k => k.toLowerCase());
            let score = 0;
            for (const kw of bookKeywords) {
                if (keywordSet.has(kw)) {
                    score++;
                }
            }
            return { corr, score };
        });

        scored.sort((a, b) => b.score - a.score);
        return scored
            .filter(s => s.score > 0)
            .slice(0, limit)
            .map(s => s.corr);
    }

    /**
     * 导出偏好 JSON。
     * @returns JSON 文本
     */
    exportConfig(): string {
        return JSON.stringify(this.data, null, 2);
    }

    /**
     * 导入偏好 JSON。
     *
     * @param jsonStr - JSON 字符串
     * @returns 是否成功
     */
    async importConfig(jsonStr: string): Promise<boolean> {
        try {
            const data = JSON.parse(jsonStr) as GenrePreferenceData;
            if (!data || typeof data !== 'object') return false;
            this.data = {
                corrections: data.corrections || [],
                genreBias: data.genreBias || {},
                subGenreBias: data.subGenreBias || {},
                channelBias: data.channelBias || {},
                autoClassifyCount: data.autoClassifyCount || 0,
                manualCorrectionCount: data.manualCorrectionCount || 0,
                lastUpdated: data.lastUpdated || Date.now(),
            };
            this.markDirty();
            await this.scheduleSave();
            return true;
        } catch {
            return false;
        }
    }

    /**
     * 重置偏好。
     */
    reset(): void {
        this.data = createDefaultPreferenceData();
        this.markDirty();
        this.scheduleSave().catch((e: unknown) => log.warn('[GenrePreferenceMemory] 保存失败:', e));
    }

    private markDirty(): void {
        this.dirty = true;
    }

    private async scheduleSave(): Promise<void> {
        if (!this.saveCallback) return;

        if (this.saveTimer) {
            clearTimeout(this.saveTimer);
        }

        return new Promise((resolve) => {
            this.saveTimer = setTimeout(async () => {
                if (this.dirty && this.saveCallback) {
                    try {
                        await this.saveCallback(this.data);
                        this.dirty = false;
                    } catch (e) {
                        log.warn('[GenrePreferenceMemory] 保存失败:', e);
                    }
                }
                resolve();
            }, 500);
        });
    }

    /**
     * 刷盘。
     */
    async flush(): Promise<void> {
        if (this.saveTimer) {
            clearTimeout(this.saveTimer);
            this.saveTimer = null;
        }
        if (this.dirty && this.saveCallback) {
            try {
                await this.saveCallback(this.data);
                this.dirty = false;
            } catch (e) {
                log.warn('[GenrePreferenceMemory] flush 保存失败:', e);
            }
        }
    }
}
