import { describe, expect, it } from 'vitest';
import { assignLedgerIds, planLedgerMigration } from '@/shared/ledger-migration-model';

const TIMELINE = `| 时间 | 事件 | 章节 |
|---|---|---|
| 0012-03-05 | 入门大典 | 第3章 |
| 0012-03-06 | 断剑异动 | 第4章 |
`;
const FORESHADOW = `## 未回收
| 伏笔 | 埋设章节 |
|---|---|
| 断剑来历 | 第4章 |
`;

describe('planLedgerMigration', () => {
    it('解析卡片并统计需分配 ID 数', () => {
        const plan = planLedgerMigration({ timelineText: TIMELINE, foreshadowText: FORESHADOW });
        expect(plan.timelineCards).toHaveLength(2);
        expect(plan.foreshadowCards).toHaveLength(1);
        expect(plan.needsId).toEqual({ timeline: 2, foreshadow: 1 });
        expect(plan.summary).toContain('时间线事件 2 条');
    });

    it('生成派生视图', () => {
        const plan = planLedgerMigration({ timelineText: TIMELINE });
        expect(plan.derived.timeline).toContain('时间线看板');
        expect(plan.derived.foreshadow).toBe('');
    });

    it('空输入返回空计划', () => {
        const plan = planLedgerMigration({});
        expect(plan.timelineCards).toEqual([]);
        expect(plan.summary).toContain('没有可迁移');
    });
});

describe('assignLedgerIds', () => {
    it('替换临时 ID 并重算派生视图', () => {
        const plan = planLedgerMigration({ timelineText: TIMELINE, foreshadowText: FORESHADOW });
        const assigned = assignLedgerIds(plan, { timeline: ['EVT-0001', 'EVT-0002'], foreshadow: ['FSH-0001'] });
        expect(assigned.timelineCards[0].id).toBe('EVT-0001');
        expect(assigned.foreshadowCards[0].id).toBe('FSH-0001');
        expect(assigned.needsId).toEqual({ timeline: 0, foreshadow: 0 });
        expect(assigned.derived.timeline).toContain('EVT-0001');
    });

    it('已存在的正式 ID 不被覆盖', () => {
        const plan = planLedgerMigration({ timelineText: '| ID | 时间 | 事件 |\n|---|---|---|\n| EVT-0009 | 0012 | 旧事件 |\n' });
        const assigned = assignLedgerIds(plan, { timeline: ['EVT-0001'], foreshadow: [] });
        expect(assigned.timelineCards[0].id).toBe('EVT-0009');
    });
});
