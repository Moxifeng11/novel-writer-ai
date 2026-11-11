/**
 * 阶段 B2：状态标记一致性
 *
 * 长期目标阶段 B「静默归零」第二项。核心命题：**状态说 OK 但数据不支持时，
 * 系统必须可诊断，不能静默**。
 *
 * 为什么不是「保证状态一定正确」：状态写入方（调度器/审核）与数据生产方
 * （文件/向量库）是不同模块，跨模块原子性做不到。真正能守住的是——
 * **一旦不一致，下游要能看出来**。
 *
 * 本文件锁四个真实不一致场景的诊断出口：
 * 1. `vectorStatus='done'` 但向量库无该书 → 链路状态断在「检索」
 * 2. `breakdownStatus='completed'` 但风格报告缺失 → 转换器抛错（不静默生成空指纹）
 * 3. `reviewStatus='approved'` 但内容全是占位 → 注入为空（不产生假约束）
 * 4. `breakdownStatus='completed'` 但向量化失败 → 链路状态断在「向量化」
 */

import { describe, expect, it } from 'vitest';
import { Vault } from 'obsidian';
import { computeKnowledgeFlowStatus } from '../../ui/views/link-status';
import { KnowledgeToFingerprintConverter } from '../../engine/knowledge-to-fingerprint-converter';
import { buildFanficSettingsContent } from '../../ui/full-writer/fanfic-settings-utils';
import { applyFanficReviewMeta } from '../../shared/fanfic-audit';
import { formatFanficRulesForPrompt, parseFanficRules } from '../../shared/fanfic-rules';

describe('B2-1：vectorStatus=done 但向量库无该书', () => {
    it('链路状态断在「检索」而不是显示全部就绪', () => {
        const status = computeKnowledgeFlowStatus({
            bookTotal: 1,
            breakdownCompleted: 1,
            // 状态说向量就绪
            vectorDone: 1,
            vectorFailed: 0,
            embeddingReady: true,
            // 但向量库实际没加载任何书
            storeLoadedBooks: 0,
        });
        expect(status.breakpoint).toBe('检索');
        expect(status.stages.find(s => s.name === '检索')?.detail).toContain('向量库里没有数据');
    });

    it('向量库加载了该书时链路才通', () => {
        const status = computeKnowledgeFlowStatus({
            bookTotal: 1,
            breakdownCompleted: 1,
            vectorDone: 1,
            vectorFailed: 0,
            embeddingReady: true,
            storeLoadedBooks: 1,
        });
        expect(status.breakpoint).toBeNull();
    });
});

describe('B2-2：breakdownStatus=completed 但风格报告缺失', () => {
    it('转换器抛错而不是静默生成空指纹', async () => {
        const vault = new Vault();
        await vault.createFolder('写作知识库');
        const converter = new KnowledgeToFingerprintConverter({ vault } as never);
        await expect(converter.convert('book-1', '不存在的书'))
            .rejects.toThrow(/风格维度拆解缺失/);
    });
});

describe('B2-3：reviewStatus=approved 但内容全是占位', () => {
    it('审核状态是 approved，但注入为空（不产生「必须遵守：（空）」假约束）', () => {
        const skeleton = buildFanficSettingsContent({
            workName: '空壳',
            workType: '（待补充）',
            author: '（待补充）',
            worldviewType: '（待补充）',
            powerSystem: '（待补充）',
            coreRules: '（待补充）',
            mustFollow: '（待补充）',
            adaptScope: '（待补充）',
            redlines: '（待补充）',
        });
        const content = applyFanficReviewMeta(skeleton, { '审核状态': 'approved' });
        const rules = parseFanficRules(content, 'x/空壳设定.md');

        // 状态层面确实是「已审核」
        expect(rules.reviewStatus).toBe('approved');
        // 但内容层面没有任何实质约束 —— 两者不一致时，注入必须为空而不是假约束
        expect(formatFanficRulesForPrompt(rules)).toBe('');
    });

    it('有实质内容时注入非空（对照）', () => {
        const skeleton = buildFanficSettingsContent({
            workName: '有内容',
            workType: '长篇',
            author: '某人',
            worldviewType: '修真世界',
            powerSystem: '练气筑基',
            coreRules: '不可越级',
            mustFollow: '主角出身不可改',
            adaptScope: '可加支线',
            redlines: '不得改结局',
        });
        const content = applyFanficReviewMeta(skeleton, { '审核状态': 'approved' });
        const rules = parseFanficRules(content, 'x/有内容设定.md');
        expect(formatFanficRulesForPrompt(rules)).not.toBe('');
    });
});

describe('B2-4：breakdownStatus=completed 但向量化失败', () => {
    it('链路状态断在「向量化」并提示检查嵌入模型', () => {
        const status = computeKnowledgeFlowStatus({
            bookTotal: 1,
            breakdownCompleted: 1,
            vectorDone: 0,
            vectorFailed: 1,
            embeddingReady: false,
            storeLoadedBooks: 0,
        });
        expect(status.breakpoint).toBe('向量化');
        const vectorize = status.stages.find(s => s.name === '向量化');
        expect(vectorize?.detail).toContain('嵌入模型');
    });

    it('部分失败时是 warn 不是断（其余书仍可用）', () => {
        const status = computeKnowledgeFlowStatus({
            bookTotal: 2,
            breakdownCompleted: 2,
            vectorDone: 1,
            vectorFailed: 1,
            embeddingReady: true,
            storeLoadedBooks: 1,
        });
        expect(status.stages.find(s => s.name === '向量化')?.status).toBe('warn');
        expect(status.breakpoint).toBeNull();
    });
});

describe('B2 结论：不一致必须可诊断', () => {
    it('四个场景都能给出明确的断点或降级信号，没有一个静默通过', () => {
        const scenarios = [
            // 1 状态说 done 但库空
            computeKnowledgeFlowStatus({
                bookTotal: 1, breakdownCompleted: 1, vectorDone: 1, vectorFailed: 0,
                embeddingReady: true, storeLoadedBooks: 0,
            }),
            // 4 拆解完成但向量失败
            computeKnowledgeFlowStatus({
                bookTotal: 1, breakdownCompleted: 1, vectorDone: 0, vectorFailed: 1,
                embeddingReady: false, storeLoadedBooks: 0,
            }),
        ];
        for (const status of scenarios) {
            expect(status.breakpoint).not.toBeNull();
        }
    });
});
