/**
 * 知识库能力横幅：嵌入模型未配置提示（v4.83.1）
 *
 * 用户反馈：拆解功能「用不起来」。排查发现默认 embedding provider 是本地 Ollama，
 * 没装/没启动时向量化必然失败，但界面只显示「待处理/失败 N」这个数字，
 * 用户不知道问题出在没配嵌入模型。
 *
 * 本文件锁定：嵌入不可用时，能力横幅必须把原因和「去哪里配」说清楚。
 */

import { describe, expect, it } from 'vitest';
import type { BookBasicInfo } from '../../../services/knowledge-base-manager';
import {
    computeKnowledgeCapability,
    type EmbeddingAvailabilitySnapshot,
} from '../../../ui/views/knowledge-capability';

/** 构造书籍 */
function book(partial: Partial<BookBasicInfo> = {}): BookBasicInfo {
    return {
        id: partial.id ?? 'b',
        name: partial.name ?? '书',
        breakdownStatus: partial.breakdownStatus ?? 'completed',
        customTags: [],
        themeTags: [],
        ...partial,
    } as BookBasicInfo;
}

const UNAVAILABLE: EmbeddingAvailabilitySnapshot = {
    available: false,
    reason: 'connect ECONNREFUSED 127.0.0.1:11434',
    providerLabel: 'ollama · nomic-embed-text',
};

const AVAILABLE: EmbeddingAvailabilitySnapshot = {
    available: true,
    providerLabel: 'openai · text-embedding-3-small',
};

describe('嵌入不可用 → 横幅提示', () => {
    it('说明里包含「未检测到可用的嵌入模型」与原因', () => {
        const cap = computeKnowledgeCapability([book()], UNAVAILABLE);
        const text = cap.notes.join('\n');
        expect(text).toContain('未检测到可用的嵌入模型');
        expect(text).toContain('ECONNREFUSED');
        expect(text).toContain('ollama · nomic-embed-text');
    });

    it('明确告知「去哪里配置」', () => {
        const cap = computeKnowledgeCapability([book()], UNAVAILABLE);
        const text = cap.notes.join('\n');
        expect(text).toContain('设置');
        expect(text).toContain('Ollama');
        expect(text).toContain('OpenAI');
    });

    it('说明关键词兜底的存在（不让人以为完全不可用）', () => {
        const cap = computeKnowledgeCapability([book()], UNAVAILABLE);
        expect(cap.notes.join('\n')).toContain('关键词');
    });

    it('提示排在业务说明之前（先讲环境问题）', () => {
        const cap = computeKnowledgeCapability([book({ vectorStatus: 'done' })], UNAVAILABLE);
        expect(cap.notes[0]).toContain('未检测到可用的嵌入模型');
    });

    it('每个阶段分支都会带上嵌入提示（empty / accumulating / degraded / ready）', () => {
        const cases: BookBasicInfo[][] = [
            [],                                                              // empty
            [book({ breakdownStatus: 'processing' })],                       // accumulating
            [book({ vectorStatus: 'failed' })],                              // degraded
            [book({ vectorStatus: 'done' })],                                // ready
        ];
        for (const books of cases) {
            const cap = computeKnowledgeCapability(books, UNAVAILABLE);
            expect(cap.notes.join('\n')).toContain('未检测到可用的嵌入模型');
        }
    });
});

describe('嵌入可用 → 不打扰', () => {
    it('可用时不出现嵌入提示', () => {
        const cap = computeKnowledgeCapability([book({ vectorStatus: 'done' })], AVAILABLE);
        expect(cap.notes.join('\n')).not.toContain('未检测到可用的嵌入模型');
    });

    it('未探测（undefined）时不出现嵌入提示', () => {
        const cap = computeKnowledgeCapability([book({ vectorStatus: 'done' })]);
        expect(cap.notes.join('\n')).not.toContain('未检测到可用的嵌入模型');
    });
});

describe('原有能力阶段判定不受影响', () => {
    it('空库仍是 empty', () => {
        expect(computeKnowledgeCapability([], AVAILABLE).stage).toBe('empty');
    });

    it('全部向量就绪仍是 ready', () => {
        expect(computeKnowledgeCapability([book({ vectorStatus: 'done' })], AVAILABLE).stage).toBe('ready');
    });

    it('有完成书但无向量仍是 degraded', () => {
        expect(computeKnowledgeCapability([book({ vectorStatus: 'failed' })], AVAILABLE).stage).toBe('degraded');
    });

    it('指标口径不变', () => {
        const cap = computeKnowledgeCapability([
            book({ id: 'a', vectorStatus: 'done' }),
            book({ id: 'b', vectorStatus: 'failed' }),
        ], AVAILABLE);
        expect(cap.metrics.map(m => m.label)).toEqual(['书籍', '已拆解', '向量就绪', '待处理/失败']);
        expect(cap.metrics.map(m => m.value)).toEqual([2, 2, 1, 1]);
    });
});
