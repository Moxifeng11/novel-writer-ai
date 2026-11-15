/**
 * B4：质量面板（聚合 + 记录）
 */

import { describe, expect, it } from 'vitest';
import { App, Vault } from 'obsidian';
import { QualityPanelService } from '@/services/quality-panel-service';
import { renderQualityPanel, summarizeQualityPanel, toQualityRecord } from '@/shared/quality-panel-model';
import { buildCheckReport } from '@/shared/post-generation-check-model';

const PROJECT = '长篇小说/甲';

const make = () => {
    const vault = new Vault() as Vault & { _seedFile(path: string, content: string): unknown };
    const app = new App();
    app.vault = vault;
    // 真实项目一定有作品信息（project-catalog 身份标志）；服务入口会校验
    vault._seedFile(`${PROJECT}/作品信息.md`, '# 作品');
    return { service: new QualityPanelService(app), vault };
};

const recordOf = (chapter: string, opts: { error?: boolean; rounds?: number; pending?: boolean } = {}) => toQualityRecord(
    buildCheckReport(PROJECT, chapter, opts.error
        ? [{ kind: 'coverage', severity: 'error', message: '缺人物', refs: ['甲'] }]
        : [{ kind: 'rhythm', severity: 'warn', message: '节奏平' }]),
    opts.rounds ?? 0,
    { pendingHuman: opts.pending },
);

describe('质量面板模型', () => {
    it('聚合通过率/类型分布/平均轮次', () => {
        const summary = summarizeQualityPanel([
            recordOf('第1章', { rounds: 1 }),
            recordOf('第2章', { error: true, rounds: 2 }),
            recordOf('第3章', { error: true, rounds: 0, pending: true }),
        ]);
        expect(summary.total).toBe(3);
        expect(summary.passed).toBe(1);
        expect(summary.passRate).toBe(33.3);
        expect(summary.pendingHuman).toBe(1);
        expect(summary.kindRanking[0]).toEqual({ kind: 'coverage', count: 2 });
        expect(summary.avgRevisionRounds).toBe(1);
    });

    it('空历史不除零', () => {
        const summary = summarizeQualityPanel([]);
        expect(summary.passRate).toBe(0);
        expect(summary.avgRevisionRounds).toBe(0);
        expect(renderQualityPanel(summary)).toContain('校验次数：0');
    });

    it('最近记录倒序且最多 10 条', () => {
        const records = Array.from({ length: 12 }, (_, i) => ({ ...recordOf(`第${i + 1}章`), checkedAt: i }));
        const summary = summarizeQualityPanel(records);
        expect(summary.recent).toHaveLength(10);
        expect(summary.recent[0].chapterName).toBe('第12章');
    });
});

describe('QualityPanelService', () => {
    it('记录后读回并聚合', async () => {
        const { service } = make();
        await service.record(PROJECT, recordOf('第1章', { rounds: 1 }));
        await service.record(PROJECT, recordOf('第2章', { error: true, rounds: 2, pending: true }));
        const view = await service.view(PROJECT);
        expect(view.total).toBe(2);
        expect(view.pendingHuman).toBe(1);
        expect(view.report).toContain('质量面板');
        expect(view.path).toContain('校验历史.json');
    });

    it('历史文件损坏时按空处理并继续可写', async () => {
        const { service, vault } = make();
        vault._seedFile(`${PROJECT}/04-项目总控/质量面板/校验历史.json`, '{坏掉');
        await service.record(PROJECT, recordOf('第1章'));
        const view = await service.view(PROJECT);
        expect(view.total).toBe(1);
    });
});

describe('项目存在性校验（对抗审查：防垃圾目录/假通过）', () => {
    it('不存在的项目：view/record 抛错且不写文件', async () => {
        const vault = new Vault() as Vault & { _seedFile(path: string, content: string): unknown };
        const app = new App();
        app.vault = vault;
        const service = new QualityPanelService(app);
        const ghost = '不存在/项目';

        await expect(service.view(ghost)).rejects.toThrow(/项目不存在/);
        await expect(service.record(ghost, recordOf('第1章'))).rejects.toThrow(/项目不存在/);
        expect(vault.getAbstractFileByPath(`${ghost}/04-项目总控/质量面板/校验历史.json`)).toBeNull();
    });
});
