import { describe, expect, it, vi } from 'vitest';
import {
    buildRevisionPlan,
    mergeQualityIssues,
    parseQualityControlReport,
} from '../../../engine/revision/quality-issue-parser';
import {
    runTargetedRevision,
    selectRevisionTarget,
} from '../../../engine/revision/targeted-revision';

describe('quality-issue-parser — 质量报告结构化', () => {
    const report = `# 质量控制

## 写作技法
❌ 对话生硬：大量使用“愤怒地说道”这类副词标签。
⚠️ 节奏拖沓：第2段连续三段都在解释背景。

## 连贯性
❌ 设定冲突：主角上一章在城外，本章却在城内。

## 总结
整体合格，建议加强结尾钩子。
`;

    it('只收 ❌/⚠️ 行并推断维度', () => {
        const issues = parseQualityControlReport(report);
        expect(issues.length).toBe(3);
        expect(issues[0].dimension).toBe('dialogue');
        expect(issues[0].severity).toBe('high');
        expect(issues[1].dimension).toBe('rhythm');
        expect(issues[2].dimension).toBe('continuity');
    });

    it('提取位置线索', () => {
        const issues = parseQualityControlReport(report);
        expect(issues[1].location).toBe('第2段');
    });

    it('合并 QSE issues 并去重', () => {
        const merged = mergeQualityIssues(
            [{ dimension: 'dialogue', severity: 'high', evidence: '对话生硬' }],
            [{ dimension: 'dialogue', severity: 'high', evidence: '对话生硬' }],
        );
        expect(merged).toHaveLength(1);
    });

    it('按严重度选 pass，最多 3 个', () => {
        const issues = parseQualityControlReport(report);
        const plan = buildRevisionPlan(issues, 3);
        expect(plan.passes).toHaveLength(3);
        expect(plan.passes[0]).toBe('dialogue');
    });

    it('无问题时不生成计划', () => {
        expect(buildRevisionPlan([]).passes).toEqual([]);
    });
});

describe('targeted-revision — 局部替换', () => {
    const body = `第一段，林晚站在门外，雨声很大。

第二段，他愤怒地说道：“你走。”

第三段，父亲没有回答。`;

    it('按场景/段落定位到问题段落', () => {
        const target = selectRevisionTarget(body, 'dialogue', [{
            dimension: 'dialogue',
            severity: 'high',
            evidence: '对话生硬',
            location: '第2段',
        }]);
        expect(target?.excerpt).toContain('愤怒地说道');
    });

    it('只替换目标段落，保留前后文', async () => {
        const callAI = vi.fn(async () => ({ content: '第二段，他把杯子放回桌面，杯底磕出一声轻响。“你走。”' }));
        const result = await runTargetedRevision({
            body,
            issues: [{
                dimension: 'dialogue',
                severity: 'high',
                evidence: '对话生硬',
                location: '第2段',
            }],
            callAI,
        });

        expect(result.changed).toBe(true);
        expect(result.body).toContain('第一段');
        expect(result.body).toContain('第三段');
        expect(result.body).not.toContain('愤怒地说道');
        expect(callAI).toHaveBeenCalledTimes(1);
    });

    it('AI 返回空/说明文本时回滚该 pass', async () => {
        const callAI = vi.fn(async () => ({ content: '修改说明：我把对话改好了。' }));
        const result = await runTargetedRevision({
            body,
            issues: [{
                dimension: 'dialogue',
                severity: 'high',
                evidence: '对话生硬',
                location: '第2段',
            }],
            callAI,
        });

        expect(result.changed).toBe(false);
        expect(result.body).toBe(body);
        expect(result.passes[0].error).toContain('说明');
    });

    it('分数下降超过阈值时回滚', async () => {
        const callAI = vi.fn(async () => ({ content: '第二段，他把杯子放回桌面，杯底磕出一声轻响。“你走。”' }));
        const scores = [80, 60];
        const result = await runTargetedRevision({
            body,
            issues: [{
                dimension: 'dialogue',
                severity: 'high',
                evidence: '对话生硬',
                location: '第2段',
            }],
            callAI,
            context: { score: () => scores.shift() ?? 60 },
        });

        expect(result.changed).toBe(false);
        expect(result.passes[0].notes).toContain('已回滚');
    });
});
