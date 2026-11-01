import { createLogger } from '../shared/logger';

const log = createLogger('GenrePreferenceMemory');
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

export interface GenrePreferenceData {
    corrections: GenreCorrectionRecord[];
    genreBias: Record<string, number>;
    subGenreBias: Record<string, number>;
    channelBias: Record<string, number>;
    autoClassifyCount: number;
    manualCorrectionCount: number;
    lastUpdated: number;
}

const DEFAULT_PREFERENCE_DATA: GenrePreferenceData = {
    corrections: [],
    genreBias: {},
    subGenreBias: {},
    channelBias: {},
    autoClassifyCount: 0,
    manualCorrectionCount: 0,
    lastUpdated: 0,
};

const MAX_CORRECTIONS = 200;
const BIAS_DECAY = 0.95;
const CORRECTION_WEIGHT = 0.15;

export class GenrePreferenceMemory {
    private data: GenrePreferenceData;
    private saveCallback?: (data: GenrePreferenceData) => Promise<void>;
    private dirty: boolean = false;
    private saveTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(
        savedData?: GenrePreferenceData | null,
        saveCallback?: (data: GenrePreferenceData) => Promise<void>
    ) {
        this.data = savedData ? { ...DEFAULT_PREFERENCE_DATA, ...savedData } : { ...DEFAULT_PREFERENCE_DATA };
        this.saveCallback = saveCallback;
    }

    getData(): GenrePreferenceData {
        return { ...this.data };
    }

    async setData(data: GenrePreferenceData): Promise<void> {
        this.data = { ...data };
        this.markDirty();
        await this.scheduleSave();
    }

    recordAutoClassify(): void {
        this.data.autoClassifyCount++;
        this.markDirty();
        this.scheduleSave().catch((e: unknown) => log.warn('[GenrePreferenceMemory] 保存失败:', e));
    }

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

    getGenreBias(genreId: string): number {
        return this.data.genreBias[genreId] || 0;
    }

    getSubGenreBias(genreId: string, subGenreId: string): number {
        const key = `${genreId}:${subGenreId}`;
        return this.data.subGenreBias[key] || 0;
    }

    getChannelBias(channel: 'male' | 'female' | 'neutral'): number {
        return this.data.channelBias[channel] || 0;
    }

    getAccuracy(): number {
        if (this.data.autoClassifyCount === 0) return 1;
        const correctCount = this.data.autoClassifyCount - this.data.manualCorrectionCount;
        return Math.max(0, Math.min(1, correctCount / this.data.autoClassifyCount));
    }

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

    exportConfig(): string {
        return JSON.stringify(this.data, null, 2);
    }

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

    reset(): void {
        this.data = { ...DEFAULT_PREFERENCE_DATA };
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
