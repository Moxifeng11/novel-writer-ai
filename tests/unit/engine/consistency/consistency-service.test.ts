/**
 * 审核服务编排单测（S2 收口）
 *
 * 用**假依赖**跑完整链路（读取→抽取→合并→配对→定位→落盘），
 * 不需要 Obsidian 也不联网。重点锁：
 *  1. 跨批次矛盾能抓到（用「落盘后的全量断言」而非仅本次新增）；
 *  2. 断言库读失败时历史不被覆盖，且结果里明确报告；
 *  3. 未启用 LLM 时零调用。
 */

import { describe, expect, it, vi } from 'vitest';
import { MockFileSystem } from '../../../../shared/file-system-port';
import { pjContradictionsFile } from '../../../../shared/paths';
import type { ChapterDigest } from '../../../../engine/memory/chapter-digest';
import {
    runProjectConsistencyAudit,
    type ConsistencyAuditDeps,
} from '../../../../engine/consistency/consistency-service';

const PROJECT = '测试项目';
const NOW = () => new Date('2026-11-13T00:00:00.000Z');

/** 造章节摘要 */
function digest(chapterNum: number, facts: string[], extras: Partial<ChapterDigest> = {}): ChapterDigest {
    return {
        chapterKey: `第${chapterNum}章`,
        chapterNum,
        title: `第${chapterNum}章`,
        involved: [],
        events: [],
        unresolved: [],
        facts,
        promises: [],
        endingHook: '',
        timeSpan: '',
        generatedAt: '2026-11-13T00:00:00.000Z',
        ...extras,
    };
}

/** 造假依赖 */
function makeDeps(overrides: Partial<ConsistencyAuditDeps> = {}): ConsistencyAuditDeps {
    return {
        listDigests: async () => [],
        listCharacters: async () => [],
        listLedgerEvents: async () => [],
        listConfirmedFacts: async () => [],
        loadChapterBody: async () => '',
        fs: new MockFileSystem(),
        ...overrides,
    };
}

describe('runProjectConsistencyAudit · 全链路', () => {
    it('年龄倒退：从摘要抽断言 → 配对 → 产出矛盾', async () => {
        const deps = makeDeps({
            listDigests: async () => [
                digest(1, ['张三今年二十岁']),
                digest(40, ['张三今年十八岁']),
            ],
        });
        const result = await runProjectConsistencyAudit(PROJECT, deps, {}, NOW);
        expect(result.report.contradictions.length).toBeGreaterThan(0);
        expect(result.report.contradictions[0].kind).toBe('quantitative');
        expect(result.assertionsSaved).toBe(true);
        expect(result.assertionTotal).toBeGreaterThan(0);
    });

    it('无矛盾时报告为空且落盘成功', async () => {
        const deps = makeDeps({
            listDigests: async () => [digest(1, ['张三今年十八岁']), digest(40, ['张三今年二十岁'])],
        });
        const result = await runProjectConsistencyAudit(PROJECT, deps, {}, NOW);
        expect(result.report.contradictions).toHaveLength(0);
        expect(result.reportSaved).toBe(true);
        expect(await deps.fs.exists(pjContradictionsFile(PROJECT))).toBe(true);
    });

    it('用章节正文把 offset 补上', async () => {
        const deps = makeDeps({
            listDigests: async () => [digest(1, ['张三今年二十岁']), digest(40, ['张三今年十八岁'])],
            loadChapterBody: async (key: string) => (key === '第1章'
                ? '开场。张三今年二十岁。'
                : '多年后。张三今年十八岁。'),
        });
        const result = await runProjectConsistencyAudit(PROJECT, deps, {}, NOW);
        const c = result.report.contradictions[0];
        expect(c.evidenceA.offset).toBe('开场。'.length);
    });

    it('**跨批次**：第二次只跑新章也能抓到与历史的矛盾', async () => {
        const fs = new MockFileSystem();
        // 第一批：只有第 1 章
        const first = makeDeps({ listDigests: async () => [digest(1, ['张三今年二十岁'])], fs });
        await runProjectConsistencyAudit(PROJECT, first, {}, NOW);
        // 第二批：只给第 40 章
        const second = makeDeps({ listDigests: async () => [digest(40, ['张三今年十八岁'])], fs });
        const result = await runProjectConsistencyAudit(PROJECT, second, {}, NOW);
        expect(result.report.contradictions.length).toBeGreaterThan(0);
        expect(result.assertionAdded).toBeGreaterThan(0);
    });

    it('断言库损坏 → 不覆盖历史，且结果里报告原因', async () => {
        const fs = new MockFileSystem();
        const { pjAssertionsFile } = await import('../../../../shared/paths');
        await fs.mkdir(`${PROJECT}/04-项目总控/一致性审核`).catch(() => undefined);
        await fs.write(pjAssertionsFile(PROJECT), '{损坏');

        const deps = makeDeps({ listDigests: async () => [digest(1, ['张三今年十八岁'])], fs });
        const result = await runProjectConsistencyAudit(PROJECT, deps, {}, NOW);

        expect(result.assertionsSaved).toBe(false);
        expect(result.assertionsError).toContain('解析失败');
        expect(await fs.read(pjAssertionsFile(PROJECT))).toBe('{损坏');
    });

    it('未启用 LLM 时零调用', async () => {
        const callLLM = vi.fn();
        const deps = makeDeps({
            listDigests: async () => [digest(1, ['张三今年二十岁']), digest(40, ['张三今年十八岁'])],
            callLLM,
        });
        const result = await runProjectConsistencyAudit(PROJECT, deps, { useLlm: false }, NOW);
        expect(callLLM).not.toHaveBeenCalled();
        expect(result.report.ruleOnly).toBe(true);
    });

    it('启用 LLM 且无疑似配对时也不调用', async () => {
        const callLLM = vi.fn();
        const deps = makeDeps({
            listDigests: async () => [digest(1, ['张三今年二十岁']), digest(40, ['张三今年十八岁'])],
            callLLM,
        });
        await runProjectConsistencyAudit(PROJECT, deps, { useLlm: true }, NOW);
        expect(callLLM).not.toHaveBeenCalled();
    });

    it('人物档案参与断言（年龄来自 frontmatter）', async () => {
        const deps = makeDeps({
            listDigests: async () => [digest(40, ['张三今年十八岁'])],
            listCharacters: async () => [{ name: '张三', frontmatter: { 年龄: '二十岁' } }],
        });
        const result = await runProjectConsistencyAudit(PROJECT, deps, {}, NOW);
        // frontmatter 断言 chapterNum=null 不参与年龄倒退规则，但断言应被抽到
        expect(result.assertionTotal).toBeGreaterThan(0);
    });

    it('已确认事实作为命名基准进入断言库', async () => {
        const deps = makeDeps({
            listConfirmedFacts: async () => [{ name: '张三', category: 'character' }],
        });
        const result = await runProjectConsistencyAudit(PROJECT, deps, {}, NOW);
        expect(result.assertionTotal).toBeGreaterThan(0);
    });

    it('依赖抛错时向上传播（不吞）', async () => {
        const deps = makeDeps({
            listDigests: async () => {
                throw new Error('摘要目录不可读');
            },
        });
        await expect(runProjectConsistencyAudit(PROJECT, deps, {}, NOW)).rejects.toThrow('摘要目录不可读');
    });
});
