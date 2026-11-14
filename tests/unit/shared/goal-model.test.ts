import { describe, expect, it } from 'vitest';
import { appendProgress, blockGoal, completeGoal, createGoal, GOAL_MAX_PROGRESS, parseGoal, renderGoal } from '@/shared/goal-model';

describe('goal 模型', () => {
    it('创建目标默认进行中', () => {
        const goal = createGoal('重构工具面', '完成 P1-P7', 1000);
        expect(goal.status).toBe('active');
        expect(goal.progress).toEqual([]);
        expect(goal.title).toBe('重构工具面');
    });

    it('追加进度不修改原对象', () => {
        const goal = createGoal('t', 'o', 1);
        const next = appendProgress(goal, '完成 P1', 'commit abc', 2);
        expect(goal.progress).toHaveLength(0);
        expect(next.progress).toHaveLength(1);
        expect(next.progress[0].evidence).toBe('commit abc');
    });

    it('进度条数有上限', () => {
        let goal = createGoal('t', 'o');
        for (let i = 0; i < GOAL_MAX_PROGRESS + 5; i++) goal = appendProgress(goal, `s${i}`);
        expect(goal.progress).toHaveLength(GOAL_MAX_PROGRESS);
    });

    it('完成必须有证据', () => {
        const goal = createGoal('t', 'o');
        expect(completeGoal(goal, '  ').error).toContain('证据');
        const done = completeGoal(goal, 'commit abc', 5);
        expect(done.goal?.status).toBe('completed');
        expect(done.goal?.completedAt).toBe(5);
    });

    it('已完成不能再完成', () => {
        const done = completeGoal(createGoal('t', 'o'), 'x').goal!;
        expect(completeGoal(done, 'y').error).toContain('已完成');
    });

    it('标记阻塞记录原因', () => {
        const blocked = blockGoal(createGoal('t', 'o'), '等待用户确认');
        expect(blocked.status).toBe('blocked');
        expect(blocked.blockedReason).toBe('等待用户确认');
    });

    it('解析往返一致', () => {
        const goal = appendProgress(createGoal('t', 'o', 1), '进度', 'ev', 2);
        const parsed = parseGoal(JSON.stringify(goal));
        expect(parsed?.id).toBe(goal.id);
        expect(parsed?.progress).toHaveLength(1);
    });

    it('损坏 JSON 返回 null', () => {
        expect(parseGoal('{oops')).toBeNull();
        expect(parseGoal(JSON.stringify({ version: 0 }))).toBeNull();
    });

    it('渲染摘要含状态与进度', () => {
        const text = renderGoal(appendProgress(createGoal('t', 'o', 1), '完成 P1', 'abc', 2));
        expect(text).toContain('进行中');
        expect(text).toContain('完成 P1');
        expect(text).toContain('abc');
    });
});
