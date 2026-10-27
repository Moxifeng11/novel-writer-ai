import { describe, expect, it } from 'vitest';
import { formatSceneCardDigest, parseSceneCardFields } from '../../../shared/scene-card';

describe('scene-card — 场景卡数据层', () => {
    it('解析 snake_case 字段并映射到 camelCase', () => {
        const card = parseSceneCardFields(`
pov: 林晚
time: 亥时
location: 书房外
objective: 找到密信
entry_state: 警惕，左手握刀
conflict: 父亲在门内
turn: 听见咳血
exit_state: 决定破门
emotion_arc: 警惕(5) → 恐惧(8)
sensory_hook: 血腥味；门板冰凉
`, { num: 1, name: '夜探' });

        expect(card.pov).toBe('林晚');
        expect(card.time).toBe('亥时');
        expect(card.location).toBe('书房外');
        expect(card.entryState).toBe('警惕，左手握刀');
        expect(card.turn).toBe('听见咳血');
        expect(card.exitState).toBe('决定破门');
        expect(card.emotionArc).toContain('→');
    });

    it('旧场景缺少新字段时返回空串，不抛异常', () => {
        const card = parseSceneCardFields('objective: 活着\nconflict: 饥饿', { num: 2, name: '旧场景' });
        expect(card.pov).toBe('');
        expect(card.turn).toBe('');
        expect(card.exitState).toBe('');
    });

    it('生成紧凑场景卡摘要，包含硬约束字段', () => {
        const digest = formatSceneCardDigest([
            {
                num: 1,
                name: '夜探',
                pov: '林晚',
                time: '亥时',
                location: '书房外',
                objective: '找到密信',
                entryState: '警惕',
                conflict: '父亲在门内',
                turn: '听见咳血',
                exitState: '决定破门',
            },
        ]);

        expect(digest).toContain('【场景卡（硬约束）】');
        expect(digest).toContain('POV:林晚');
        expect(digest).toContain('入场:警惕');
        expect(digest).toContain('转折:听见咳血');
        expect(digest).toContain('离场:决定破门');
    });

    it('空场景返回空串，避免 prompt 出现空标题', () => {
        expect(formatSceneCardDigest([{ num: 1, name: '' }])).toBe('');
    });
});
