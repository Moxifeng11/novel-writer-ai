/**
 * style/fingerprint-blender-v2.ts — 写作指纹 V2 多指纹加权融合引擎（Task 4）
 *
 * 设计要点：
 *   - 支持 1-3 个 V2 指纹加权融合（超出自动按权重取前 3）
 *   - 四种融合策略：
 *     1. 统计指标：数值字段加权平均（自动归一化权重）
 *     2. 语义描述：句号切分 + 去重 + 按权重比例重组（零 AI 依赖）
 *     3. 向量空间：各维度向量加权平均（可选，依赖调用方提供 vectors）
 *     4. 示例片段：按权重比例从各指纹选取代表性示例（最多 3 段）
 *   - 支持维度独立加权：每个指纹在不同维度可有不同权重
 *   - BlendedFingerprint 继承 V2Fingerprint，增加 blendSource 来源信息
 *   - 融合指纹可通过 StyleFingerprintLibrary 保存为独立指纹模板
 *
 * 设计原则：
 *   - 零外部依赖（不调用 AI、不依赖网络、不修改磁盘）
 *   - 纯函数式：FingerprintBlenderV2 无状态，每次 blend 独立
 *   - 外科手术式：不修改现有 StyleFingerprintLibrary / StyleVectorStoreV2
 *   - 向后兼容：V1 blendStyles() 不变
 *   - 性能：单次融合计算 < 100ms（不含 embedding，纯算术）
 */

import {
    StyleFingerprintFeaturesV2,
    StyleDimensionKeyV2,
    STYLE_DIMENSION_KEYS_V2,
    STYLE_DIMENSION_LABELS_V2,
    DimensionStatus,
    V2Fingerprint,
} from './style-dimensions-v2';
import type { StyleFingerprintVectorsV2 } from './style-vector-store-v2';

// ============================================================
// 一、融合输入与输出类型
// ============================================================

/** 单个融合来源 */
export interface BlendSource {
    /** 来源指纹（V2 完整结构） */
    fingerprint: V2Fingerprint;
    /** 全局权重（>0，自动归一化） */
    weight: number;
    /** 可选：维度独立权重（缺省维度回退到全局 weight） */
    dimensionWeights?: Partial<Record<StyleDimensionKeyV2, number>>;
    /** 可选：该指纹的向量数据（提供时才做向量融合） */
    vectors?: StyleFingerprintVectorsV2;
}

/** 融合选项 */
export interface BlendOptions {
    /** 最大来源数（默认 3，超出按权重降序取前 N） */
    maxSources?: number;
    /** 每维度保留的最大示例数（默认 3） */
    maxSamplesPerDimension?: number;
    /** 融合指纹名称（默认自动生成） */
    name?: string;
    /** 融合指纹 ID（默认自动生成 blend_<timestamp>_<random>） */
    id?: string;
}

/** 融合后的向量集合（仅在调用方提供 vectors 时存在） */
export interface BlendedVectors {
    /** 12 维融合向量 */
    dimensions: Record<StyleDimensionKeyV2, number[]>;
    /** 整体融合向量 */
    overallVector: number[];
}

/** 融合结果 */
export interface BlendResult {
    /** 融合后的指纹（可保存为独立指纹） */
    fingerprint: BlendedFingerprint;
    /** 融合后的向量（仅在 sources 提供了 vectors 时存在） */
    vectors?: BlendedVectors;
}

/** 融合指纹：V2Fingerprint + 来源信息 */
export interface BlendedFingerprint extends V2Fingerprint {
    /** 融合来源信息 */
    blendSource: {
        /** 来源指纹列表（含权重） */
        fingerprints: Array<{
            id: string;
            name: string;
            scope: 'template' | 'global' | 'project';
            weight: number;
            dimensionWeights?: Partial<Record<StyleDimensionKeyV2, number>>;
        }>;
        /** 融合时间戳 */
        blendedAt: number;
        /** 是否完成了向量融合 */
        vectorsBlended: boolean;
    };
}

// ============================================================
// 二、FingerprintBlenderV2 主类
// ============================================================

/**
 * 多指纹加权融合引擎
 *
 * 使用方式：
 *   const blender = new FingerprintBlenderV2();
 *   const result = blender.blend([
 *     { fingerprint: fpA, weight: 0.5 },
 *     { fingerprint: fpB, weight: 0.3 },
 *     { fingerprint: fpC, weight: 0.2 },
 *   ]);
 *   // result.fingerprint → BlendedFingerprint
 *   // result.vectors → BlendedVectors（如果提供了 vectors）
 *
 * 维度独立加权：
 *   const result = blender.blend([
 *     { fingerprint: fpA, weight: 0.5, dimensionWeights: { rhythm: 0.8, emotion: 0.2 } },
 *     { fingerprint: fpB, weight: 0.5, dimensionWeights: { rhythm: 0.2, emotion: 0.8 } },
 *   ]);
 *   // rhythm 维度按 0.8:0.2 加权，emotion 按 0.2:0.8 加权
 */
export class FingerprintBlenderV2 {
    /**
     * 执行多指纹加权融合
     * @param sources 融合来源列表（1-3 个，超出按权重取前 3）
     * @param options 融合选项
     * @returns 融合结果（含指纹和可选向量）
     * @throws {Error} 当 sources 为空或权重非法时
     */
    blend(sources: BlendSource[], options: BlendOptions = {}): BlendResult {
        // ── 输入校验 ──
        if (!Array.isArray(sources) || sources.length === 0) {
            throw new Error('[FingerprintBlenderV2] sources 不能为空');
        }

        // 过滤无效来源（weight <= 0 或 fingerprint 缺失）
        const validSources = sources.filter(
            s => s && s.fingerprint && typeof s.weight === 'number' && s.weight > 0
        );
        if (validSources.length === 0) {
            throw new Error('[FingerprintBlenderV2] 无有效来源（所有权重必须 > 0）');
        }

        // 限制最大来源数
        const maxSources = options.maxSources ?? 3;
        const limited = validSources.length > maxSources
            ? this.takeTopByWeight(validSources, maxSources)
            : validSources;

        // ── 准备融合上下文 ──
        const hasVectors = limited.some(s => s.vectors);
        const blendedAt = Date.now();
        const blendedId = options.id ?? this.generateBlendId();
        const blendedName = options.name ?? this.generateBlendName(limited);

        // ── 逐维度融合 ──
        const blendedFeatures: Record<StyleDimensionKeyV2, Record<string, unknown>> = {} as Record<StyleDimensionKeyV2, Record<string, unknown>>;
        const blendedDimVectors = {} as Record<StyleDimensionKeyV2, number[]>;

        for (const key of STYLE_DIMENSION_KEYS_V2) {
            const dimSources = this.collectDimensionSources(limited, key);
            const normalizedWeights = this.normalizeWeights(dimSources.map(s => s.weight));

            // 融合该维度的 stats
            blendedFeatures[key] = this.blendDimensionStats(
                dimSources.map(s => ({
                    stats: s.fingerprint.features[key] as unknown as Record<string, unknown>,
                    weight: normalizedWeights[dimSources.indexOf(s)],
                })),
                key
            );

            // 融合该维度的向量
            if (hasVectors) {
                const dimVecSources = dimSources
                    .map(s => ({
                        vector: s.vectors?.dimensions[key]?.vector ?? [],
                        weight: normalizedWeights[dimSources.indexOf(s)],
                    }))
                    .filter(v => v.vector.length > 0);

                if (dimVecSources.length > 0) {
                    blendedDimVectors[key] = this.blendNumericArrays(dimVecSources);
                }
            }
        }

        // ── 融合整体向量 ──
        let blendedOverall: number[] = [];
        if (hasVectors) {
            const overallSources = limited
                .map(s => ({
                    vector: s.vectors?.overallVector ?? [],
                    weight: this.normalizeWeights(
                        limited.map(x => x.weight)
                    )[limited.indexOf(s)],
                }))
                .filter(v => v.vector.length > 0);

            if (overallSources.length > 0) {
                blendedOverall = this.blendNumericArrays(overallSources);
            }
        }

        // ── 融合 samples（指纹级，跨维度选取代表性示例） ──
        const blendedSamples = this.blendFingerprintSamples(limited);

        // ── 融合基础 stats ──
        const blendedStats = this.blendFingerprintStats(limited);

        // ── 构造 BlendedFingerprint ──
        const fingerprint: BlendedFingerprint = {
            id: blendedId,
            name: blendedName,
            source: `blend:${limited.map(s => s.fingerprint.name).join('|')}`,
            scope: 'template', // 默认保存到 template 层，调用方可修改
            enabled: true,
            tags: this.collectBlendedTags(limited),
            version: 'v2',
            stats: blendedStats,
            features: blendedFeatures as unknown as StyleFingerprintFeaturesV2,
            samples: blendedSamples,
            extractedAt: blendedAt,
            sourceText: undefined,
            blendSource: {
                fingerprints: limited.map(s => ({
                    id: s.fingerprint.id,
                    name: s.fingerprint.name,
                    scope: s.fingerprint.scope,
                    weight: s.weight,
                    dimensionWeights: s.dimensionWeights,
                })),
                blendedAt,
                vectorsBlended: hasVectors,
            },
        };

        // ── 构造向量结果 ──
        const vectors: BlendedVectors | undefined = hasVectors
            ? {
                  dimensions: blendedDimVectors,
                  overallVector: blendedOverall,
              }
            : undefined;

        return { fingerprint, vectors };
    }

    // ============================================================
    // 三、私有方法 - 权重处理
    // ============================================================

    /** 按权重降序取前 N 个 */
    private takeTopByWeight(sources: BlendSource[], n: number): BlendSource[] {
        return [...sources]
            .sort((a, b) => b.weight - a.weight)
            .slice(0, n);
    }

    /** 权重归一化（和为 1） */
    private normalizeWeights(weights: number[]): number[] {
        const sum = weights.reduce((a, b) => a + b, 0);
        if (sum <= 0) {
            // 全部为 0 时均匀分布
            const uniform = 1 / weights.length;
            return weights.map(() => uniform);
        }
        return weights.map(w => w / sum);
    }

    /**
     * 收集指定维度的来源及权重
     * - 若 source.dimensionWeights 提供了该维度权重，使用之
     * - 否则回退到全局 source.weight
     */
    private collectDimensionSources(
        sources: BlendSource[],
        dimension: StyleDimensionKeyV2
    ): Array<{ fingerprint: V2Fingerprint; weight: number; vectors?: StyleFingerprintVectorsV2 }> {
        return sources.map(s => ({
            fingerprint: s.fingerprint,
            weight: s.dimensionWeights?.[dimension] ?? s.weight,
            vectors: s.vectors,
        }));
    }

    /** 生成融合指纹 ID */
    private generateBlendId(): string {
        return `blend_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    }

    /** 生成融合指纹名称 */
    private generateBlendName(sources: BlendSource[]): string {
        const names = sources.map(s => s.fingerprint.name).slice(0, 3);
        return `融合(${names.join('+')})`;
    }

    /** 收集融合指纹的 tags */
    private collectBlendedTags(sources: BlendSource[]): string[] {
        const tags = new Set<string>(['blended']);
        for (const s of sources) {
            for (const tag of s.fingerprint.tags ?? []) {
                tags.add(tag);
            }
        }
        return Array.from(tags);
    }

    // ============================================================
    // 四、私有方法 - 单维度融合
    // ============================================================

    /**
     * 融合单维度 stats
     * 字段类型分发：
     *   - number → 加权平均
     *   - { [k]: number } → 递归加权平均
     *   - description: string → 智能融合（句号切分 + 去重 + 重组）
     *   - samples: string[] → 按权重比例选取
     *   - status: DimensionStatus → 取最差状态
     *   - 其他 string → 取权重最大的来源值
     */
    private blendDimensionStats(
        sources: Array<{ stats: Record<string, unknown>; weight: number }>,
        _dimension: StyleDimensionKeyV2
    ): Record<string, unknown> {
        if (sources.length === 0) {
            return {};
        }
        if (sources.length === 1) {
            return { ...sources[0].stats };
        }

        const result: Record<string, unknown> = {};
        const template = sources[0].stats;

        for (const key of Object.keys(template)) {
            const fieldValues: unknown[] = sources.map(s => s.stats[key]);
            const weights = sources.map(s => s.weight);

            if (key === 'description') {
                result[key] = this.blendDescription(
                    fieldValues.filter((v): v is string => typeof v === 'string'),
                    weights
                );
            } else if (key === 'samples') {
                result[key] = this.blendSamples(
                    fieldValues.filter((v): v is string[] => Array.isArray(v)),
                    weights,
                    3
                );
            } else if (key === 'status') {
                result[key] = this.blendStatus(
                    fieldValues.filter((v): v is DimensionStatus =>
                        v === 'complete' || v === 'pending' || v === 'partial'
                    )
                );
            } else if (typeof template[key] === 'number') {
                result[key] = this.blendNumber(
                    fieldValues.filter((v): v is number => typeof v === 'number'),
                    weights
                );
            } else if (this.isNumericObject(template[key])) {
                result[key] = this.blendNumericObject(
                    fieldValues.filter((v): v is Record<string, number> => this.isNumericObject(v)),
                    weights
                );
            } else if (typeof template[key] === 'string') {
                // 其他字符串字段（如 emotionalTone, dialogueStyleTag）→ 取权重最大的
                result[key] = this.pickByWeight(
                    fieldValues.filter((v): v is string => typeof v === 'string'),
                    weights
                );
            } else {
                // 未知类型 → 取权重最大的
                result[key] = this.pickByWeightRaw(fieldValues, weights);
            }
        }

        return result;
    }

    /** 数值加权平均 */
    private blendNumber(values: number[], weights: number[]): number {
        if (values.length === 0) return 0;
        const normalized = this.normalizeWeights(weights.slice(0, values.length));
        let sum = 0;
        for (let i = 0; i < values.length; i++) {
            sum += values[i] * normalized[i];
        }
        return sum;
    }

    /** 数值对象加权平均（递归每个数值字段） */
    private blendNumericObject(
        objects: Record<string, number>[],
        weights: number[]
    ): Record<string, number> {
        if (objects.length === 0) return {};
        const result: Record<string, number> = {};
        const template = objects[0];
        for (const key of Object.keys(template)) {
            const values = objects.map(o => o[key]).filter((v): v is number => typeof v === 'number');
            result[key] = this.blendNumber(values, weights);
        }
        return result;
    }

    /** 数组加权平均（用于向量融合，按元素位置加权平均） */
    private blendNumericArrays(arrays: Array<{ vector: number[]; weight: number }>): number[] {
        if (arrays.length === 0) return [];
        const len = Math.min(...arrays.map(a => a.vector.length));
        if (len === 0) return [];
        const normalized = this.normalizeWeights(arrays.map(a => a.weight));
        const result: number[] = new Array(len).fill(0);
        for (let i = 0; i < len; i++) {
            for (let j = 0; j < arrays.length; j++) {
                result[i] += arrays[j].vector[i] * normalized[j];
            }
        }
        return result;
    }

    /** 判断是否为数值对象（所有值都是 number） */
    private isNumericObject(value: unknown): value is Record<string, number> {
        if (typeof value !== 'object' || value === null || Array.isArray(value)) {
            return false;
        }
        const obj = value as Record<string, unknown>;
        const values = Object.values(obj);
        if (values.length === 0) return false;
        return values.every(v => typeof v === 'number');
    }

    /**
     * 描述智能融合（句号切分 + 去重 + 按权重比例重组）
     * 零 AI 依赖，纯文本处理
     */
    private blendDescription(descriptions: string[], weights: number[]): string {
        if (descriptions.length === 0) return '';
        if (descriptions.length === 1) return descriptions[0];

        const normalized = this.normalizeWeights(weights.slice(0, descriptions.length));

        // 1. 句号切分（。！？.!?）
        const sentencesWithWeight: Array<{ sentence: string; weight: number }> = [];
        for (let i = 0; i < descriptions.length; i++) {
            const sentences = this.splitSentences(descriptions[i]);
            for (const s of sentences) {
                sentencesWithWeight.push({ sentence: s, weight: normalized[i] });
            }
        }

        if (sentencesWithWeight.length === 0) return '';

        // 2. 去重（保留权重高的版本）
        const seen = new Map<string, { sentence: string; weight: number }>();
        for (const item of sentencesWithWeight) {
            const key = this.normalizeSentence(item.sentence);
            if (!key) continue;
            const existing = seen.get(key);
            if (!existing || item.weight > existing.weight) {
                seen.set(key, item);
            }
        }

        // 3. 按权重降序排序
        const unique = Array.from(seen.values()).sort((a, b) => b.weight - a.weight);

        // 4. 按权重比例选取句子（总权重和 ~ 1.0）
        //    选取前 N 句使累积权重达到 ~80%
        const targetWeight = 0.8;
        let cumWeight = 0;
        const selected: string[] = [];
        for (const item of unique) {
            selected.push(item.sentence);
            cumWeight += item.weight;
            if (cumWeight >= targetWeight && selected.length >= 2) break;
        }

        // 5. 限制总字数 50-100 字（V2 spec 要求）
        const maxChars = 100;
        let result = selected.join('。');
        if (result.length > maxChars) {
            const cut = result.slice(0, maxChars);
            const lastStop = Math.max(
                cut.lastIndexOf('。'),
                cut.lastIndexOf('！'),
                cut.lastIndexOf('？'),
            );
            // 单句超过 100 字时 cut 里没有任何句末标点：
            // 旧实现用 /[^。！？]*$/ 把整句都当「残句」删掉，最后只剩一个「。」
            result = lastStop >= 0 ? cut.slice(0, lastStop + 1) : `${cut}。`;
        }

        return result || descriptions[0]; // 兜底：返回第一个描述
    }

    /** 句号切分 */
    private splitSentences(text: string): string[] {
        return text
            .split(/[。！？.!?]/)
            .map(s => s.trim())
            .filter(s => s.length > 0);
    }

    /** 句子归一化（用于去重比较，去掉标点和空格） */
    private normalizeSentence(s: string): string {
        return s.replace(/[\s，。！？、,.!?;:""''（）()【】\[\]]/g, '').toLowerCase();
    }

    /**
     * 示例片段按权重比例选取
     * - 各来源按权重比例分配选取数量
     * - 总数限制为 maxSamples
     */
    private blendSamples(
        sampleLists: string[][],
        weights: number[],
        maxSamples: number
    ): string[] {
        if (sampleLists.length === 0) return [];
        if (sampleLists.length === 1) {
            return sampleLists[0].slice(0, maxSamples);
        }

        const normalized = this.normalizeWeights(weights.slice(0, sampleLists.length));

        // 按权重比例分配选取数量
        const counts = normalized.map(w => Math.max(1, Math.round(w * maxSamples)));
        // 修正总数
        let total = counts.reduce((a, b) => a + b, 0);
        while (total > maxSamples) {
            // 找最大的减 1
            let maxIdx = 0;
            for (let i = 1; i < counts.length; i++) {
                if (counts[i] > counts[maxIdx]) maxIdx = i;
            }
            counts[maxIdx]--;
            total--;
        }
        while (total < maxSamples && total < sampleLists.reduce((a, b) => a + b.length, 0)) {
            // 找权重最大的可增加的来源加 1
            let maxIdx = -1;
            let maxWeight = -1;
            for (let i = 0; i < sampleLists.length; i++) {
                if (counts[i] < sampleLists[i].length && normalized[i] > maxWeight) {
                    maxWeight = normalized[i];
                    maxIdx = i;
                }
            }
            if (maxIdx === -1) break;
            counts[maxIdx]++;
            total++;
        }

        // 从各来源选取
        const result: string[] = [];
        const seen = new Set<string>();
        for (let i = 0; i < sampleLists.length; i++) {
            for (let j = 0; j < counts[i] && j < sampleLists[i].length; j++) {
                const sample = sampleLists[i][j];
                // 去重
                const key = sample.trim().slice(0, 50);
                if (!seen.has(key)) {
                    seen.add(key);
                    result.push(sample);
                }
            }
        }

        return result.slice(0, maxSamples);
    }

    /** 状态融合：取最差状态（pending > partial > complete） */
    private blendStatus(statuses: DimensionStatus[]): DimensionStatus {
        if (statuses.length === 0) return 'pending';
        if (statuses.includes('pending')) return 'pending';
        if (statuses.includes('partial')) return 'partial';
        return 'complete';
    }

    /** 按权重选取字符串（取权重最大的） */
    private pickByWeight(values: string[], weights: number[]): string {
        if (values.length === 0) return '';
        let maxIdx = 0;
        let maxWeight = weights[0] ?? 0;
        for (let i = 1; i < values.length; i++) {
            const w = weights[i] ?? 0;
            if (w > maxWeight) {
                maxWeight = w;
                maxIdx = i;
            }
        }
        return values[maxIdx];
    }

    /** 按权重选取任意值（取权重最大的） */
    private pickByWeightRaw<T>(values: T[], weights: number[]): T | undefined {
        if (values.length === 0) return undefined;
        let maxIdx = 0;
        let maxWeight = weights[0] ?? 0;
        for (let i = 1; i < values.length; i++) {
            const w = weights[i] ?? 0;
            if (w > maxWeight) {
                maxWeight = w;
                maxIdx = i;
            }
        }
        return values[maxIdx];
    }

    // ============================================================
    // 五、私有方法 - 指纹级融合
    // ============================================================

    /** 融合指纹级 samples（跨维度选取代表性示例） */
    private blendFingerprintSamples(sources: BlendSource[]): string[] {
        const normalized = this.normalizeWeights(sources.map(s => s.weight));
        const sampleLists = sources.map(s => s.fingerprint.samples ?? []);
        return this.blendSamples(sampleLists, normalized, 3);
    }

    /** 融合指纹级基础 stats（数值字段加权平均） */
    private blendFingerprintStats(sources: BlendSource[]): V2Fingerprint['stats'] {
        const stats = sources.map(s => s.fingerprint.stats);
        const weights = sources.map(s => s.weight);
        const normalized = this.normalizeWeights(weights);

        return {
            avgSentenceLength: this.blendNumber(
                stats.map(s => s.avgSentenceLength),
                normalized
            ),
            avgParagraphLength: this.blendNumber(
                stats.map(s => s.avgParagraphLength),
                normalized
            ),
            dialogueRatio: this.blendNumber(
                stats.map(s => s.dialogueRatio),
                normalized
            ),
            descriptionRatio: this.blendNumber(
                stats.map(s => s.descriptionRatio),
                normalized
            ),
            wordCount: this.blendNumber(
                stats.map(s => s.wordCount),
                normalized
            ),
        };
    }
}
