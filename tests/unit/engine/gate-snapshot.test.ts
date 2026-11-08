import { describe, it, expect } from 'vitest';
import { buildGateSnapshotFromVars } from '../../../engine/quality/gate-snapshot';

/**
 * QualityGate 的章节快照装配（审计维度④ C-6）。
 *
 * 该纯函数此前 0% 覆盖；误判会直接导致门禁假通过/假失败。这里锁住：
 * - 字段缺失时给安全默认值，而不是抛错；
 * - 人物状态最多 12 条、必做节点最多 8 条且前 3 条 required；
 * - 冲突/地点/时间线/上一章结尾的提取口径。
 */

describe('buildGateSnapshotFromVars', () => {
    it('全空输入：安全默认值，不抛错', () => {
        const snapshot = buildGateSnapshotFromVars({ chapterNum: 1, vars: {} });

        expect(snapshot.chapterNumber).toBe(1);
        expect(snapshot.timeline).toEqual({ time: '未标注', location: '未标注' });
        expect(snapshot.povCharacter).toBe('主角');
        expect(snapshot.mainGoal).toContain('信息规划缺失');
        expect(snapshot.requiredBeats).toEqual([]);
        expect(snapshot.characterStates).toEqual([]);
        expect(snapshot.previousEnding.mustContinue).toBe('');
        expect(snapshot.acceptanceCriteria).toEqual([
            '字数 ≥ 3000',
            '每个场景情绪有变化',
            '无未解释的逻辑跳跃',
        ]);
    });

    it('完整变量：提取冲突/地点/时间线/上一章结尾', () => {
        const snapshot = buildGateSnapshotFromVars({
            chapterNum: 12,
            vars: {
                infoPlan: '核心冲突：林玄与王虎在演武台正面冲突',
                protagonistName: '林玄',
                sceneCardDigest: '地点：演武台｜人物：林玄、王虎',
                timelineEvents: '| 清晨 | 演武台 | 考核开始 |\n| 午后 | 藏经阁 | 长老召见 |',
                prevChapEnding: '他抬头看向山门，钟声还没停。',
                baseWords: '4000',
            },
        });

        expect(snapshot.mainGoal).toBe('林玄与王虎在演武台正面冲突');
        expect(snapshot.coreConflict).toBe(snapshot.mainGoal);
        expect(snapshot.timeline.time).toBe('清晨');
        expect(snapshot.timeline.location).toBe('演武台');
        expect(snapshot.previousEnding.action).toBe('他抬头看向山门，钟声还没停。');
        expect(snapshot.previousEnding.mustContinue).toContain('衔接上一章');
        expect(snapshot.acceptanceCriteria[0]).toBe('字数 ≥ 4000');
    });

    it('人物状态：解析字段并最多保留 12 条', () => {
        const lines = Array.from({ length: 15 }, (_, i) =>
            `- 角色${String(i + 1).padStart(2, '0')}：当前情绪 紧张｜伤势 轻伤${i}｜核心动机 活下去`,
        ).join('\n');
        const snapshot = buildGateSnapshotFromVars({
            chapterNum: 2,
            vars: { allChars: `${lines}\n- 无分隔符的行应被忽略` },
        });

        expect(snapshot.characterStates).toHaveLength(12);
        expect(snapshot.characterStates[0]).toEqual({
            name: '角色01',
            emotion: '紧张',
            injury: '轻伤0',
            goal: '活下去',
            secret: '',
            relationships: '',
        });
        expect(snapshot.characterStates[11].name).toBe('角色12');
    });

    it('必做节点：前 3 条 required，最多 8 条', () => {
        const distilled = Array.from({ length: 10 }, (_, i) =>
            `- 节点${i + 1}：这是第 ${i + 1} 个必须完成的情节点描述`,
        ).join('\n');
        const snapshot = buildGateSnapshotFromVars({ chapterNum: 2, vars: { distilledContent: distilled } });

        expect(snapshot.requiredBeats).toHaveLength(8);
        expect(snapshot.requiredBeats[0]).toBe('这是第 1 个必须完成的情节点描述');
        expect(snapshot.requiredBeats[2]).toBe('这是第 3 个必须完成的情节点描述');
        expect(snapshot.requiredBeats[7]).toBe('这是第 8 个必须完成的情节点描述');
    });

    it('无 infoPlan 时回退 chapterHook；无章节号也按传入值保留', () => {
        const snapshot = buildGateSnapshotFromVars({
            chapterNum: 0,
            vars: { chapterHook: '一封没有署名的信' },
        });

        expect(snapshot.chapterNumber).toBe(0);
        expect(snapshot.mainGoal).toBe('一封没有署名的信');
    });
});
