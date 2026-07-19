/**
 * genre-detector.ts — 题材识别器
 *
 * 基于关键词统计识别小说题材：
 * - 抽样前 5000 字（不足则用全部）
 * - 统计各题材 detectorSignals 的命中频次
 * - 命中频次最高者为主识别结果，confidence = 命中数 / 总命中数
 * - confidence < 0.4 时返回 generic 兜底
 * - 多题材混合：次题材命中数 / 主题材命中数 >= 0.7 时填充 secondary
 *
 * LLM 增强模式（detectWithLLM）：
 * - 当纯统计 detect 返回 generic 时，可调用 LLM 辅助识别
 * - LLM 返回 genreId + detectorSignals + 关键词体系
 * - 识别的新题材配置注册到 GenreConfigRegistry
 *
 * 性能：O(n*m) 算法（n=样本字数，m=detectorSignals 总数），5000 字样本约 50ms。
 */

import type { GenreConfig, GenreDetectionResult } from './types';
import { GenreConfigRegistry } from './genre-config-registry';
import { LLMEnhancer, type LLMCaller } from '../llm-enhancer';
import { createLogger } from '../../shared/logger';


const log = createLogger('GenreDetector');
const SAMPLE_SIZE = 5000;
const CONFIDENCE_THRESHOLD = 0.4;
// 次题材命中数 / 主题材命中数 >= 此比例时视为"confidence 相近"，填充 secondary
const SECONDARY_RATIO_THRESHOLD = 0.7;

export class GenreDetector {
    private registry: GenreConfigRegistry;

    constructor(registry?: GenreConfigRegistry) {
        this.registry = registry ?? GenreConfigRegistry.getInstance();
    }

    /**
     * 识别文本题材。
     */
    detect(text: string): GenreDetectionResult {
        if (!text || text.length === 0) {
            return { genreId: 'generic', confidence: 0 };
        }

        const sample = text.length > SAMPLE_SIZE ? text.slice(0, SAMPLE_SIZE) : text;

        // 统计各题材命中频次（detectorSignals 为空的题材跳过，如 generic）
        const genreHits: Array<{ genreId: string; hits: number }> = [];
        for (const genreId of this.registry.listGenreIds()) {
            const config = this.registry.getGenreConfig(genreId);
            if (!config.detectorSignals || config.detectorSignals.length === 0) {
                continue;
            }
            const hits = this.countKeywordHits(sample, config.detectorSignals);
            if (hits > 0) {
                genreHits.push({ genreId, hits });
            }
        }

        const totalHits = genreHits.reduce((sum, g) => sum + g.hits, 0);
        if (totalHits === 0) {
            return { genreId: 'generic', confidence: 0 };
        }

        // 按命中频次降序
        genreHits.sort((a, b) => b.hits - a.hits);

        const primary = genreHits[0];
        const confidence = primary.hits / totalHits;

        if (confidence < CONFIDENCE_THRESHOLD) {
            return { genreId: 'generic', confidence: 0 };
        }

        // 多题材混合识别：次题材与主题材命中数相近时填充 secondary
        const secondary = this.pickSecondary(genreHits);

        if (secondary) {
            return {
                genreId: primary.genreId,
                confidence,
                primary: primary.genreId,
                secondary,
            };
        }

        return { genreId: primary.genreId, confidence };
    }

    /**
     * 选择次识别题材。规则：次题材命中数 / 主题材命中数 >= 0.7 时返回其 genreId。
     */
    private pickSecondary(genreHits: Array<{ genreId: string; hits: number }>): string | undefined {
        if (genreHits.length < 2) {
            return undefined;
        }
        const primary = genreHits[0];
        const second = genreHits[1];
        if (primary.hits === 0) {
            return undefined;
        }
        if (second.hits / primary.hits >= SECONDARY_RATIO_THRESHOLD) {
            return second.genreId;
        }
        return undefined;
    }

    /**
     * 统计关键词列表在文本中的总命中次数（每个关键词出现 N 次累加 N）。
     */
    private countKeywordHits(text: string, keywords: string[]): number {
        let total = 0;
        for (const kw of keywords) {
            if (!kw) continue;
            total += this.countOccurrences(text, kw);
        }
        return total;
    }

    /**
     * 统计子串在文本中出现次数（非重叠计数）。
     */
    private countOccurrences(text: string, sub: string): number {
        if (!sub) return 0;
        let count = 0;
        let pos = 0;
        // eslint-disable-next-line no-constant-condition
        while (true) {
            const idx = text.indexOf(sub, pos);
            if (idx === -1) break;
            count++;
            pos = idx + sub.length;
        }
        return count;
    }

    /**
     * LLM 辅助题材识别。
     *
     * 使用场景：纯统计 detect 返回 generic（confidence < 0.4 或无命中）时，
     * 调用 LLM 进行语义级题材识别。
     *
     * 流程：
     * 1. 用 LLMEnhancer 调用 genre 维度提示词
     * 2. 解析返回的 { genreId, displayName, detectorSignals, keywords }
     * 3. 如果 genreId 不在 registry 中，构造新 GenreConfig 并注册
     * 4. 返回 GenreDetectionResult（confidence=0.6，标记为 LLM 识别）
     *
     * 降级：LLM 失败时返回 generic 兜底结果。
     *
     * @param text 待识别文本
     * @param caller LLM 调用器（通常传 AIEngine 实例）
     * @param options 可选配置（模型名等）
     */
    async detectWithLLM(
        text: string,
        caller: LLMCaller,
        options?: { llmModel?: string }
    ): Promise<GenreDetectionResult> {
        if (!text || text.length === 0) {
            return { genreId: 'generic', confidence: 0 };
        }

        const sample = text.length > SAMPLE_SIZE ? text.slice(0, SAMPLE_SIZE) : text;
        const enhancer = new LLMEnhancer(caller, { llmModel: options?.llmModel });

        // 最多尝试 2 次（首次 + 1 次重试），应对 LLM 调用网络抖动
        const MAX_RETRIES = 1;
        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
            try {
                if (attempt > 0) {
                    // 重试前等待 500ms 退避
                    await new Promise(resolve => setTimeout(resolve, 500));
                }

                const result = await enhancer.enhanceWithLLM<LLMGenreIdentificationResult>({
                    dimension: 'genre',
                    text: sample,
                });

                if (!result.success || !result.data) {
                    if (attempt < MAX_RETRIES) {
                        log.warn(`[GenreDetector] LLM 题材识别失败（第 ${attempt + 1} 次），500ms 后重试`);
                        continue;
                    }
                    log.warn('[GenreDetector] LLM 题材识别失败，降级到 generic');
                    return { genreId: 'generic', confidence: 0 };
                }

                const identified = result.data;
                const genreId = this.sanitizeGenreId(identified.genreId);
                if (genreId === 'generic') {
                    return { genreId: 'generic', confidence: 0 };
                }

                // 如果是新 genreId，注册到 registry
                if (!this.registry.hasGenreConfig(genreId)) {
                    const newConfig = this.buildGenreConfigFromLLMResult(identified);
                    if (newConfig) {
                        this.registry.registerCustomConfig(newConfig);
                        log.info(`[GenreDetector] LLM 识别新题材并注册: ${genreId} (${newConfig.displayName})`);
                    }
                }

                // confidence 0.6 标记为 LLM 识别（区别于纯统计的 0-1）
                return {
                    genreId,
                    confidence: 0.6,
                };
            } catch (e) {
                if (attempt < MAX_RETRIES) {
                    log.warn(`[GenreDetector] LLM 题材识别异常（第 ${attempt + 1} 次），500ms 后重试:`, e);
                } else {
                    log.warn('[GenreDetector] LLM 题材识别异常，降级到 generic:', e);
                    return { genreId: 'generic', confidence: 0 };
                }
            }
        }

        // 所有尝试均失败，降级到 generic（防御性兜底）
        return { genreId: 'generic', confidence: 0 };
    }

    /**
     * 校验 genreId 是否合法。非内置 genreId 但符合命名规范时也允许。
     */
    private sanitizeGenreId(raw: unknown): string {
        if (typeof raw !== 'string' || !raw) {
            return 'generic';
        }
        const trimmed = raw.trim().toLowerCase();
        // 仅允许字母、数字、下划线，长度 1-32
        if (/^[a-z0-9_]{1,32}$/.test(trimmed)) {
            return trimmed;
        }
        return 'generic';
    }

    /**
     * 从 LLM 返回结果构造 GenreConfig。返回 null 表示数据不完整。
     */
    private buildGenreConfigFromLLMResult(data: LLMGenreIdentificationResult): GenreConfig | null {
        const genreId = this.sanitizeGenreId(data.genreId);
        if (genreId === 'generic') {
            return null;
        }

        const displayName = typeof data.displayName === 'string' && data.displayName.trim()
            ? data.displayName.trim()
            : genreId;

        const detectorSignals = Array.isArray(data.detectorSignals)
            ? data.detectorSignals.filter((s): s is string => typeof s === 'string' && s.trim().length > 0).slice(0, 30)
            : [];

        const keywords = data.keywords ?? {};
        const abilityKeywords = Array.isArray(keywords.abilityKeywords)
            ? keywords.abilityKeywords.filter((s): s is string => typeof s === 'string' && s.trim().length > 0).slice(0, 50)
            : [];
        const styleKeywords = Array.isArray(keywords.styleKeywords)
            ? keywords.styleKeywords.filter((s): s is string => typeof s === 'string' && s.trim().length > 0).slice(0, 50)
            : [];
        const foreshadowTypes = Array.isArray(keywords.foreshadowTypes)
            ? keywords.foreshadowTypes.filter((s): s is string => typeof s === 'string' && s.trim().length > 0).slice(0, 30)
            : [];

        return {
            genreId,
            displayName,
            behaviorTraits: [],
            abilityKeywords,
            techniqueKeywords: [],
            foreshadowTypes,
            conflictKeywords: [],
            showSignalWords: [],
            styleKeywords,
            detectorSignals,
        };
    }
}

/** LLM genre 识别返回结构（与 llm-prompts.ts 中 buildGenrePrompt 一致） */
interface LLMGenreIdentificationResult {
    genreId?: string;
    displayName?: string;
    detectorSignals?: string[];
    keywords?: {
        abilityKeywords?: string[];
        styleKeywords?: string[];
        foreshadowTypes?: string[];
    };
}
