import { describe, it, expect } from 'vitest';
import { analyzeLogicConsistency } from '../../../engine/logic-consistency-checker';

describe('analyzeLogicConsistency — 时间线一致性', () => {
    it('同段同时出现清晨与深夜词触发 time_conflict', () => {
        const body = '清晨天刚亮，他却已在深夜的月光下独坐。';
        const r = analyzeLogicConsistency(body);
        expect(r.issues.some(i => i.type === 'time_conflict')).toBe(true);
        const issue = r.issues.find(i => i.type === 'time_conflict');
        expect(issue!.severity).toBe('medium');
    });

    it('仅出现单一时段词不触发 time_conflict', () => {
        const body = '清晨，他立于祠堂之前，长剑出鞘。';
        const r = analyzeLogicConsistency(body);
        expect(r.issues.some(i => i.type === 'time_conflict')).toBe(false);
    });
});

describe('analyzeLogicConsistency — 角色行为一致性', () => {
    it('同段出现重伤与高强度动作触发 injury_action_conflict', () => {
        const body = '他虽已重伤吐血，却仍能飞奔跑向山门，挥剑厮杀。';
        const r = analyzeLogicConsistency(body);
        expect(r.issues.some(i => i.type === 'injury_action_conflict')).toBe(true);
        const issue = r.issues.find(i => i.type === 'injury_action_conflict');
        expect(issue!.severity).toBe('high');
    });

    it('仅出现伤势词不触发行为冲突', () => {
        const body = '他重伤未愈，静坐调息。';
        const r = analyzeLogicConsistency(body);
        expect(r.issues.some(i => i.type === 'injury_action_conflict')).toBe(false);
    });

    it('仅出现动作词不触发行为冲突', () => {
        const body = '他飞奔跑向山门，纵身跃起。';
        const r = analyzeLogicConsistency(body);
        expect(r.issues.some(i => i.type === 'injury_action_conflict')).toBe(false);
    });
});

describe('analyzeLogicConsistency — 知识边界（现代词）', () => {
    it('出现现代词触发 knowledge_boundary', () => {
        const body = '他从口袋里掏出手机，拨通了网络电话。';
        const r = analyzeLogicConsistency(body);
        expect(r.issues.some(i => i.type === 'knowledge_boundary')).toBe(true);
        const issue = r.issues.find(i => i.type === 'knowledge_boundary');
        expect(issue!.severity).toBe('medium');
    });

    it('正常古代文风不触发 knowledge_boundary', () => {
        const body = '他取出传讯玉符，注入灵力。';
        const r = analyzeLogicConsistency(body);
        expect(r.issues.some(i => i.type === 'knowledge_boundary')).toBe(false);
    });
});

describe('analyzeLogicConsistency — 地点跳变', () => {
    it('多地点连续出现且无转场词触发 location_jump', () => {
        const body = '他站在京城街头，望向山门，又转身去了皇宫与客栈。';
        const r = analyzeLogicConsistency(body);
        expect(r.issues.some(i => i.type === 'location_jump')).toBe(true);
    });

    it('含转场词时不触发 location_jump', () => {
        const body = '他从京城赶到山门，片刻后回到皇宫。';
        const r = analyzeLogicConsistency(body);
        expect(r.issues.some(i => i.type === 'location_jump')).toBe(false);
    });
});

describe('analyzeLogicConsistency — 身份认知冲突', () => {
    it('同段出现"从未见过"与"认出"触发 identity_conflict', () => {
        const body = '他从未见过此人，却一眼认出了对方的面容。';
        const r = analyzeLogicConsistency(body);
        expect(r.issues.some(i => i.type === 'identity_conflict')).toBe(true);
        const issue = r.issues.find(i => i.type === 'identity_conflict');
        expect(issue!.severity).toBe('medium');
    });

    it('同段出现"陌生人"与"故人"触发 identity_conflict', () => {
        const body = '明明是陌生人，此刻却如故人般相视。';
        const r = analyzeLogicConsistency(body);
        expect(r.issues.some(i => i.type === 'identity_conflict')).toBe(true);
    });
});

describe('analyzeLogicConsistency — 边界情况与结构', () => {
    it('空字符串返回空 issues 与 0 段落', () => {
        const r = analyzeLogicConsistency('');
        expect(r.issues).toEqual([]);
        expect(r.paragraphCount).toBe(0);
        expect(typeof r.checkedAt).toBe('number');
    });

    it('正常文本不产生任何 issue', () => {
        const body = '清晨，林惊鸿立于祠堂之前，长剑出鞘，剑光如水。\n\n他望向远山，心中默念亡妹之名，久久不语。';
        const r = analyzeLogicConsistency(body);
        expect(r.issues).toEqual([]);
        expect(r.paragraphCount).toBe(2);
    });

    it('issues 数量不超过上限 8', () => {
        // 每段都触发 knowledge_boundary
        const para = '他掏出手机与电脑。';
        const body = Array.from({ length: 20 }, () => para).join('\n\n');
        const r = analyzeLogicConsistency(body);
        expect(r.issues.length).toBeLessThanOrEqual(8);
    });

    it('只检查最后 18 段', () => {
        // 前 20 段为正常，最后 1 段有问题
        const normal = '他立于祠堂，望向远山。';
        const bad = '他掏出手机拨号。';
        const paras = Array.from({ length: 20 }, () => normal);
        paras.push(bad);
        const body = paras.join('\n\n');
        const r = analyzeLogicConsistency(body);
        // 最后一段在 18 段窗口内，应被检测
        expect(r.issues.some(i => i.type === 'knowledge_boundary')).toBe(true);
        // paragraphCount 为窗口内段落数
        expect(r.paragraphCount).toBeLessThanOrEqual(18);
    });

    it('每个 issue 含 message/sample/suggestion 非空', () => {
        const body = '他掏出手机。';
        const r = analyzeLogicConsistency(body);
        for (const issue of r.issues) {
            expect(issue.message.length).toBeGreaterThan(0);
            expect(issue.sample.length).toBeGreaterThan(0);
            expect(issue.suggestion.length).toBeGreaterThan(0);
        }
    });
});
