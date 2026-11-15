/**
 * B2：定向修订闭环（纯模型 + 服务守卫）
 */

import { describe, expect, it } from 'vitest';
import { App, Vault } from 'obsidian';
import { TargetedRevisionService } from '@/services/targeted-revision-service';
import { buildCheckReport } from '@/shared/post-generation-check-model';
import { buildRevisionPrompt, buildRevisionTasks } from '@/shared/targeted-revision-model';
import type { PostGenerationCheckReport } from '@/shared/post-generation-check-model';

const PROJECT = '长篇小说/甲';
const CHAPTER = '第1章';
const BODY_PATH = `${PROJECT}/03-大纲与章节/正文/第1卷/第1章_初入山门_正文.md`;
const ORIGINAL = '林玄走上测灵台。'.repeat(40);

const make = (opts: { ai?: string; checks?: PostGenerationCheckReport[] } = {}) => {
    const vault = new Vault() as Vault & { _seedFile(path: string, content: string): unknown };
    const app = new App();
    app.vault = vault;
    vault._seedFile(BODY_PATH, ORIGINAL);
    const reports = opts.checks ?? [
        buildCheckReport(PROJECT, CHAPTER, [{ kind: 'foreshadow', severity: 'warn', message: '伏笔逾期', refs: ['断剑'] }]),
        buildCheckReport(PROJECT, CHAPTER, []),
    ];
    let idx = 0;
    const written: string[] = [];
    const service = new TargetedRevisionService(app, {
        callAI: async () => opts.ai ?? ('修订后林玄走上测灵台。'.repeat(40)),
        check: async () => reports[Math.min(idx++, reports.length - 1)],
        writeBody: async (_p, _c, body) => { written.push(body); },
    });
    return { service, written };
};

describe('buildRevisionTasks', () => {
    it('error 优先并带指令', () => {
        const report = buildCheckReport('p', '第1章', [
            { kind: 'rhythm', severity: 'warn', message: '节奏平' },
            { kind: 'coverage', severity: 'error', message: '缺人物', refs: ['路人甲'] },
        ]);
        const tasks = buildRevisionTasks(report);
        expect(tasks[0].kind).toBe('coverage');
        expect(tasks[0].instruction).toContain('路人甲');
        expect(tasks).toHaveLength(2);
    });

    it('最多任务数限制', () => {
        const items = Array.from({ length: 8 }, (_, i) => ({ kind: 'rhythm' as const, severity: 'warn' as const, message: `问题${i}` }));
        expect(buildRevisionTasks(buildCheckReport('p', '第1章', items), 3)).toHaveLength(3);
    });

    it('提示词含清单与原文', () => {
        const tasks = buildRevisionTasks(buildCheckReport('p', '第1章', [{ kind: 'foreshadow', severity: 'warn', message: 'x', refs: ['断剑'] }]));
        const prompt = buildRevisionPrompt('原文内容', tasks);
        expect(prompt).toContain('【修订清单】');
        expect(prompt).toContain('原文内容');
    });
});

describe('TargetedRevisionService', () => {
    it('一轮修订后通过', async () => {
        const { service, written } = make();
        const result = await service.revise(PROJECT, CHAPTER);
        expect(result.passed).toBe(true);
        expect(result.attempts).toBe(1);
        expect(result.wrote).toBe(true);
        expect(written).toHaveLength(1);
        expect(result.pending).toHaveLength(0);
    });

    it('已通过时不调 AI', async () => {
        const { service } = make({ checks: [buildCheckReport(PROJECT, CHAPTER, [])] });
        const result = await service.revise(PROJECT, CHAPTER);
        expect(result.attempts).toBe(0);
        expect(result.wrote).toBe(false);
    });

    it('模型回显提示词被守卫拦截', async () => {
        const { service } = make({ ai: '【修订清单】1. xxx\n【硬性要求】' });
        const result = await service.revise(PROJECT, CHAPTER);
        expect(result.wrote).toBe(false);
        expect(result.abortedReason).toContain('回显');
        expect(result.pending.length).toBeGreaterThan(0);
    });

    it('修订后过短被拦截', async () => {
        const { service } = make({ ai: '太短了' });
        const result = await service.revise(PROJECT, CHAPTER);
        expect(result.wrote).toBe(false);
        expect(result.abortedReason).toContain('过短');
    });

    it('两轮仍未通过则标记待人工', async () => {
        const bad = buildCheckReport(PROJECT, CHAPTER, [{ kind: 'coverage', severity: 'error', message: '缺人物', refs: ['路人甲'] }]);
        const { service } = make({ checks: [bad, bad, bad] });
        const result = await service.revise(PROJECT, CHAPTER, { maxRounds: 2 });
        expect(result.passed).toBe(false);
        expect(result.attempts).toBe(2);
        expect(result.pending).toHaveLength(1);
    });

    it('模型报错时中止并保留原稿', async () => {
        const { service } = make();
        // 覆盖 callAI 抛错
        (service as unknown as { deps: { callAI: () => Promise<string> } }).deps.callAI = async () => { throw new Error('超时'); };
        const result = await service.revise(PROJECT, CHAPTER);
        expect(result.wrote).toBe(false);
        expect(result.abortedReason).toContain('超时');
    });
});
