/**
 * mode-injection.ts — 短篇/剧本单元写作的知识库 + 指纹注入
 *
 * 长篇 11 步已经通过 KnowledgeInjector 注入；短篇/剧本此前完全没有。
 * 这里走最轻的路径：RAG 检索（retrieve + formatRetrievalHits）+ 指纹
 * （selectFingerprintsForInjection，上限 3）。失败一律降级为空串，不阻塞写作。
 */
import { retrieve, formatRetrievalHits } from './rag/retrieval-service';
import type { KnowledgeVectorStore } from './knowledge-vector-store';
import {
    StyleFingerprintLibrary,
    type StyleFingerprint,
    type StyleFingerprintFeatures,
} from './style-fingerprint-library';
import { selectFingerprintsForInjection } from './style/fingerprint-selection';
import { createLogger } from '@/shared/logger';

const log = createLogger('ModeInjection');

/** 注入结果（两块都可能为空）。 */
export interface ModeInjectionResult {
    /** 知识库 RAG 命中（已格式化） */
    knowledge: string;
    /** 文笔指纹要点（已格式化） */
    fingerprints: string;
}

/** 注入依赖。 */
export interface ModeInjectionDeps {
    /** 知识向量库；为空时跳过 RAG */
    vectorStore?: KnowledgeVectorStore | null;
    /** 指纹库；为空时跳过指纹 */
    fingerprintLibrary?: StyleFingerprintLibrary | null;
    /** 项目 ID（项目级指纹启用状态用） */
    project?: string;
}

function clip(text: string, max: number): string {
    const value = String(text || '').replace(/\s+/g, ' ').trim();
    return value.length > max ? `${value.slice(0, max)}…` : value;
}

const FEATURE_LINES: Array<{ key: keyof StyleFingerprintFeatures; label: string }> = [
    { key: 'sentenceRhythm', label: '句式' },
    { key: 'wordPreference', label: '用词' },
    { key: 'narrativeStyle', label: '叙事' },
    { key: 'dialogueStyle', label: '对白' },
    { key: 'overallTone', label: '基调' },
];

function formatFingerprints(fingerprints: StyleFingerprint[]): string {
    if (fingerprints.length === 0) return '';
    const lines: string[] = [];
    for (const fp of fingerprints) {
        const parts = FEATURE_LINES
            .map(({ key, label }) => {
                const value = fp.features?.[key];
                return value ? `${label} ${clip(value, 90)}` : '';
            })
            .filter(Boolean);
        lines.push(`- ${fp.name}：${parts.join('；') || '（无可用特征）'}`);
    }
    return lines.join('\n');
}

/**
 * 收集模式写作的注入文本。
 *
 * @param deps - 向量库与指纹库
 * @param query - 检索查询（大纲段落 / 故事核）
 * @returns 注入文本
 *
 * @example
 * ```ts
 * const injection = await collectModeInjection({ vectorStore, fingerprintLibrary, project }, outline);
 * console.log(injection.knowledge);
 * ```
 */
export async function collectModeInjection(deps: ModeInjectionDeps, query: string): Promise<ModeInjectionResult> {
    const cleanQuery = String(query || '').trim();
    let knowledge = '';
    if (deps.vectorStore && cleanQuery) {
        try {
            const result = await retrieve(deps.vectorStore, {
                queryText: cleanQuery.slice(0, 1200),
                topN: 4,
                maxChars: 900,
            });
            knowledge = formatRetrievalHits(result.hits, { header: '参考知识', perItemChars: 220 });
        } catch (error) {
            log.warn('知识库检索失败（降级为空）:', error);
        }
    }

    let fingerprints = '';
    const library = deps.fingerprintLibrary;
    if (library && deps.project) {
        try {
            const enabled = await library.getEnabledFingerprints(deps.project);
            const selected = await selectFingerprintsForInjection(enabled, {
                query: cleanQuery,
                searchV2: (text, options) => library.searchSimilarStylesV2(text, {
                    topN: options.topN,
                    fingerprintIds: options.fingerprintIds,
                    minScore: options.minScore,
                }),
                fallback: 'firstN',
            });
            fingerprints = formatFingerprints(selected);
        } catch (error) {
            log.warn('指纹注入失败（降级为空）:', error);
        }
    }

    return { knowledge, fingerprints };
}
