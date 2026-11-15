/**
 * B1：生成后校验（规则类）
 */

import { describe, expect, it } from 'vitest';
import { App, Vault } from 'obsidian';
import { PostGenerationCheckService } from '@/services/post-generation-check-service';
import { actionableItems, buildCheckReport, renderCheckReport } from '@/shared/post-generation-check-model';

const PROJECT = '长篇小说/甲';

const make = (files: Record<string, string>, resolvable: string[] = ['林玄', '苏婉']) => {
    const vault = new Vault() as Vault & { _seedFile(path: string, content: string): unknown };
    const app = new App();
    app.vault = vault;
    for (const [path, content] of Object.entries(files)) vault._seedFile(path, content);
    const service = new PostGenerationCheckService(app, async (name) => (resolvable.includes(name) ? `CHR-${name}` : null));
    return { service, vault };
};

describe('PostGenerationCheckService', () => {
    it('场景实体全部可解析时不报错', async () => {
        const { service } = make({
            [`${PROJECT}/03-大纲与章节/步骤结果/第1卷/第1章/第1章_Scene展开.md`]: '## 场景1\n- 在场人物：林玄、苏婉\n',
        });
        const report = await service.check(PROJECT, '第1章');
        expect(report.items.filter(i => i.kind === 'coverage')).toHaveLength(0);
        expect(report.passed).toBe(true);
    });

    it('支持 characters 字段（规范场景卡）', async () => {
        const { service } = make({
            [`${PROJECT}/03-大纲与章节/步骤结果/第1卷/第1章/第1章_Scene展开.md`]: '## 场景1\n- characters: 林玄、路人甲\n',
        });
        const report = await service.check(PROJECT, '第1章');
        expect(report.items.filter(i => i.kind === 'coverage')).toHaveLength(1);
    });

    it('场景里出现无法解析的人物报 error', async () => {
        const { service } = make({
            [`${PROJECT}/03-大纲与章节/步骤结果/第1卷/第1章/第1章_Scene展开.md`]: '## 场景1\n- 在场人物：林玄、路人甲\n',
        });
        const report = await service.check(PROJECT, '第1章');
        const coverage = report.items.filter(i => i.kind === 'coverage');
        expect(coverage).toHaveLength(1);
        expect(coverage[0].severity).toBe('error');
        expect(report.passed).toBe(false);
    });

    it('伏笔逾期回收给 warn', async () => {
        const { service } = make({
            [`${PROJECT}/02-时间线与伏笔/伏笔库.md`]: '| 伏笔 | 埋设章节 | 计划回收 | 重要程度 |\n|---|---|---|---|\n| 断剑来历 | 第1章 | 第8章 | 高 |\n',
        });
        const report = await service.check(PROJECT, '第12章');
        const fs = report.items.filter(i => i.kind === 'foreshadow');
        expect(fs.length).toBe(1);
        expect(fs[0].severity).toBe('warn');
        expect(fs[0].message).toContain('断剑来历');
    });

    it('节奏偏离给 warn', async () => {
        const { service } = make({
            [`${PROJECT}/03-大纲与章节/步骤结果/第1卷/第1章/第1章_情绪规划.md`]: '## 场景1\n- 强度：80\n## 场景2\n- 强度：80\n## 场景3\n- 强度：80\n',
        });
        const report = await service.check(PROJECT, '第1章');
        expect(report.items.some(i => i.kind === 'rhythm')).toBe(true);
    });

    it('矛盾.json 损坏时安全跳过', async () => {
        const { service } = make({ [`${PROJECT}/04-项目总控/一致性审核/矛盾.json`]: '{坏的' });
        const report = await service.check(PROJECT, '第1章');
        expect(report.items.filter(i => i.kind === 'consistency')).toHaveLength(0);
    });
});

describe('报告模型', () => {
    it('error 才不通过', () => {
        expect(buildCheckReport('p', '第1章', [{ kind: 'rhythm', severity: 'warn', message: 'x' }]).passed).toBe(true);
        expect(buildCheckReport('p', '第1章', [{ kind: 'coverage', severity: 'error', message: 'y' }]).passed).toBe(false);
    });

    it('渲染与可修订项过滤', () => {
        const report = buildCheckReport('p', '第1章', [
            { kind: 'coverage', severity: 'error', message: '缺人物', refs: ['路人甲'] },
            { kind: 'rhythm', severity: 'info', message: '提示' },
        ]);
        const text = renderCheckReport(report);
        expect(text).toContain('未通过');
        expect(text).toContain('路人甲');
        expect(actionableItems(report)).toHaveLength(1);
    });
});
