
import type { SuggestionRecord, SuggestionDirection } from '../../shared/types';

export interface ParallelSuggestionOptions {
    timeoutMs?: number;
    maxRetries?: number;
    count?: number;
}

export interface SuggestionStreamHandle {
    id: string;
    direction: SuggestionDirection;
    style: 'default' | 'creative' | 'conservative';
    iterator: AsyncGenerator<string, SuggestionRecord | null, unknown>;
    currentText: string;
    status: 'pending' | 'streaming' | 'completed' | 'failed';
    error?: string;
    qualityScore?: number;
    completedAt?: number;
}

export interface ParallelSuggestionResult {
    handles: SuggestionStreamHandle[];
    allCompleted: Promise<SuggestionRecord[]>;
    cancel: () => void;
}

export interface QualityScoreResult {
    score: number;
    details: {
        lengthScore: number;
        diversityScore: number;
        coherenceScore: number;
    };
}

const DEFAULT_OPTIONS: Required<ParallelSuggestionOptions> = {
    timeoutMs: 30000,
    maxRetries: 1,
    count: 3,
};

export function scoreSuggestionQuality(
    text: string,
    precedingText: string = '',
): QualityScoreResult {
    const cleanText = text.trim();
    const length = cleanText.length;

    let lengthScore = 50;
    if (length >= 200 && length <= 500) {
        lengthScore = 100;
    } else if (length >= 100 && length < 200) {
        lengthScore = 70 + (length - 100) * 0.3;
    } else if (length > 500 && length <= 800) {
        lengthScore = 100 - (length - 500) * 0.1;
    } else if (length < 100) {
        lengthScore = Math.max(20, length * 0.5);
    } else {
        lengthScore = Math.max(30, 70 - (length - 800) * 0.1);
    }

    let diversityScore = 50;
    const dialogueCount = (cleanText.match(/[「"'"].*?[」"'"]/g) || []).length;
    const actionKeywords = ['转身', '迈步', '抬手', '握拳', '脚步', '身形', '挥', '拍', '击', '挡', '躲', '闪'];
    const descKeywords = ['阳光', '月光', '风', '雨', '声音', '气味', '温度', '感觉', '目光', '表情'];
    let actionCount = 0;
    let descCount = 0;
    for (const kw of actionKeywords) if (cleanText.includes(kw)) actionCount++;
    for (const kw of descKeywords) if (cleanText.includes(kw)) descCount++;

    const hasDialogue = dialogueCount > 0;
    const hasAction = actionCount > 0;
    const hasDescription = descCount > 0;

    const diversityTypes = [hasDialogue, hasAction, hasDescription].filter(Boolean).length;
    diversityScore = 40 + diversityTypes * 20;
    diversityScore = Math.min(100, diversityScore + Math.min(dialogueCount, 3) * 5);

    let coherenceScore = 50;
    if (precedingText && precedingText.length > 0) {
        const precedingTail = precedingText.slice(-100);
        const firstSentence = cleanText.split(/[。！？.!?]/)[0] || '';
        let overlapChars = 0;
        for (let i = 0; i < Math.min(firstSentence.length, 20); i++) {
            if (precedingTail.includes(firstSentence[i])) overlapChars++;
        }
        coherenceScore = 50 + Math.min(50, overlapChars * 3);
    } else {
        coherenceScore = 70;
    }

    const sentences = cleanText.split(/[。！？.!?]+/).filter(s => s.trim().length > 0);
    if (sentences.length >= 2) {
        coherenceScore = Math.min(100, coherenceScore + 10);
    }

    const score = Math.round(
        lengthScore * 0.35 +
        diversityScore * 0.35 +
        coherenceScore * 0.3
    );

    return {
        score: Math.max(0, Math.min(100, score)),
        details: {
            lengthScore: Math.round(lengthScore),
            diversityScore: Math.round(diversityScore),
            coherenceScore: Math.round(coherenceScore),
        },
    };
}

export function sortSuggestionsByQuality(suggestions: SuggestionRecord[]): SuggestionRecord[] {
    return [...suggestions].sort((a, b) => {
        const scoreA = scoreSuggestionQuality(a.text).score;
        const scoreB = scoreSuggestionQuality(b.text).score;
        return scoreB - scoreA;
    });
}

export type StreamGeneratorFactory = (
    direction: SuggestionDirection,
    directionIndex: number,
    signal: AbortSignal
) => AsyncGenerator<string, SuggestionRecord | null, unknown>;

export class ParallelSuggestionGenerator {
    private options: Required<ParallelSuggestionOptions>;
    private abortController: AbortController | null = null;
    private directions: SuggestionDirection[];
    private factory: StreamGeneratorFactory;

    constructor(
        factory: StreamGeneratorFactory,
        directions: SuggestionDirection[],
        options?: ParallelSuggestionOptions
    ) {
        this.factory = factory;
        this.directions = directions;
        this.options = { ...DEFAULT_OPTIONS, ...options };
    }

    generate(precedingText: string = ''): ParallelSuggestionResult {
        this.abortController = new AbortController();
        const signal = this.abortController.signal;
        const count = Math.min(this.options.count, this.directions.length);
        const handles: SuggestionStreamHandle[] = [];

        for (let i = 0; i < count; i++) {
            const direction = this.directions[i];
            const id = `para_sug_${Date.now()}_${i}`;
            const style: 'default' | 'creative' | 'conservative' =
                i === 0 ? 'default' : i === 1 ? 'creative' : 'conservative';

            const iterator = this.createSingleSuggestionStream(
                direction,
                i,
                style,
                precedingText,
                signal
            );

            handles.push({
                id,
                direction,
                style,
                iterator,
                currentText: '',
                status: 'pending',
            });
        }

        const allCompleted = this.waitForAll(handles, signal);

        return {
            handles,
            allCompleted,
            cancel: () => this.cancel(),
        };
    }

    private async *createSingleSuggestionStream(
        direction: SuggestionDirection,
        directionIndex: number,
        style: 'default' | 'creative' | 'conservative',
        precedingText: string,
        parentSignal: AbortSignal
    ): AsyncGenerator<string, SuggestionRecord | null, unknown> {
        let attempts = 0;
        let lastError: string | undefined;

        while (attempts <= this.options.maxRetries) {
            if (parentSignal.aborted) {
                return null;
            }

            const attemptController = new AbortController();
            const timeoutId = setTimeout(() => {
                attemptController.abort();
            }, this.options.timeoutMs);

            const onParentAbort = () => attemptController.abort();
            parentSignal.addEventListener('abort', onParentAbort, { once: true });

            try {
                const iterator = this.factory(direction, directionIndex, attemptController.signal);
                let accumulated = '';
                let finalResult: SuggestionRecord | null = null;

                while (true) {
                    const { value, done } = await iterator.next();
                    if (done) {
                        finalResult = value as SuggestionRecord | null;
                        break;
                    }
                    accumulated += value;
                    yield value;
                }

                clearTimeout(timeoutId);
                parentSignal.removeEventListener('abort', onParentAbort);

                if (finalResult && finalResult.text) {
                    const quality = scoreSuggestionQuality(finalResult.text, precedingText);
                    finalResult = {
                        ...finalResult,
                        style,
                    };
                    (finalResult as any).qualityScore = quality.score;
                    return finalResult;
                }

                if (attempts < this.options.maxRetries) {
                    attempts++;
                    continue;
                }

                return null;
            } catch (e: unknown) {
                clearTimeout(timeoutId);
                parentSignal.removeEventListener('abort', onParentAbort);

                const errMsg = e instanceof Error ? e.message : String(e);

                if (parentSignal.aborted) {
                    return null;
                }

                lastError = errMsg;

                if (attempts < this.options.maxRetries) {
                    attempts++;
                    await new Promise(r => setTimeout(r, 500 * attempts));
                    continue;
                }

                throw new Error(lastError || '生成失败');
            }
        }

        return null;
    }

    private async waitForAll(
        handles: SuggestionStreamHandle[],
        signal: AbortSignal
    ): Promise<SuggestionRecord[]> {
        const results: SuggestionRecord[] = [];
        const promises: Promise<void>[] = [];

        for (const handle of handles) {
            const promise = (async () => {
                try {
                    handle.status = 'streaming';
                    let finalResult: SuggestionRecord | null = null;
                    let accumulated = '';

                    while (true) {
                        if (signal.aborted) {
                            handle.status = 'failed';
                            handle.error = '已取消';
                            return;
                        }

                        const { value, done } = await handle.iterator.next();
                        if (done) {
                            finalResult = value as SuggestionRecord | null;
                            break;
                        }
                        accumulated += value;
                        handle.currentText = accumulated;
                    }

                    if (finalResult && finalResult.text) {
                        handle.status = 'completed';
                        handle.currentText = finalResult.text;
                        handle.completedAt = Date.now();
                        handle.qualityScore = (finalResult as any).qualityScore;
                        results.push(finalResult);
                    } else {
                        handle.status = 'failed';
                        handle.error = '生成结果为空';
                    }
                } catch (e: unknown) {
                    handle.status = 'failed';
                    handle.error = e instanceof Error ? e.message : String(e);
                }
            })();

            promises.push(promise);
        }

        await Promise.allSettled(promises);

        const sorted = sortSuggestionsByQuality(results);
        return sorted;
    }

    cancel(): void {
        if (this.abortController) {
            this.abortController.abort();
            this.abortController = null;
        }
    }
}
