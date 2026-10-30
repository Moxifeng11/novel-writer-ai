import { describe, expect, it } from 'vitest';
import { dedupeFacts, rankFacts, type RankableFact } from '../../../shared/memory-rank';

function fact(category: string, name: string, content: string, recency = 0): RankableFact {
    return { category, name, content, recency };
}

describe('memory-rank — 长记忆去重与排序', () => {
    describe('dedupeFacts', () => {
        it('同类别同名事实合并，保留内容更长的一条', () => {
            const facts = [
                fact('character', '武昭', '断刃城守将。'),
                fact('character', '武昭', '断刃城守将，左手有旧伤，与沈青有婚约。'),
            ];
            const kept = dedupeFacts(facts);
            expect(kept).toHaveLength(1);
            expect(kept[0].content).toContain('左手有旧伤');
        });

        it('跨类别同名不合并（人物「青云宗」与势力「青云宗」都要保留）', () => {
            const facts = [fact('character', '青云宗', '掌门弟子。'), fact('faction', '青云宗', '北境第一大宗。')];
            expect(dedupeFacts(facts)).toHaveLength(2);
        });

        it('名称不同时不合并：内容同模板的两个角色不能被并成一个', () => {
            const facts = [
                fact('character', '青云宗外门弟子甲', '外门弟子，修为筑基，负责巡山。'),
                fact('character', '青云宗外门弟子乙', '外门弟子，修为筑基，负责巡山。'),
            ];
            expect(dedupeFacts(facts)).toHaveLength(2);
        });

        it('名称相同但内容只多了语气词，仍按相似度合并', () => {
            const facts = [
                fact('item', '轩辕剑', '轩辕剑是断刃城城主信物，可斩妖。'),
                fact('item', '轩辕剑', '轩辕剑是断刃城城主信物，可斩妖。'),
            ];
            expect(dedupeFacts(facts)).toHaveLength(1);
        });

        it('无关事实原样保留且顺序稳定', () => {
            const facts = [
                fact('character', '武昭', '断刃城守将。'),
                fact('location', '断刃城', '北境边城，常年风雪。'),
                fact('faction', '青云宗', '北境第一大宗。'),
            ];
            expect(dedupeFacts(facts).map((item) => item.name)).toEqual(['武昭', '断刃城', '青云宗']);
        });

        it('空数组与单条安全', () => {
            expect(dedupeFacts([])).toEqual([]);
            expect(dedupeFacts([fact('character', '武昭', '守将。')])).toHaveLength(1);
        });
    });

    describe('rankFacts', () => {
        it('有 query 时相关事实排在无关事实之前', () => {
            const facts = [
                fact('location', '青云宗', '北境第一大宗，山门在雪岭。', 10),
                fact('character', '沈青', '断刃城药铺学徒，擅长辨药。', 1),
                fact('character', '武昭', '断刃城守将，与沈青有婚约。', 2),
            ];
            const ranked = rankFacts(facts, { query: '断刃城 沈青 婚约' });
            // 命中全部查询词的是「武昭」那条（它同时含断刃城/沈青/婚约）
            expect(ranked[0].name).toBe('武昭');
            // 完全无关的青云宗必须排最后，即使它新近度最高
            expect(ranked[ranked.length - 1].name).toBe('青云宗');
        });

        it('无 query 时退化为按新近度排序', () => {
            const facts = [
                fact('character', '武昭', '守将。', 2),
                fact('character', '沈青', '学徒。', 9),
                fact('location', '断刃城', '边城。', 5),
            ];
            expect(rankFacts(facts).map((item) => item.name)).toEqual(['沈青', '断刃城', '武昭']);
        });

        it('相关性权重可调；relevanceWeight=0 等价于纯新近度', () => {
            const facts = [
                fact('character', '青云宗弟子', '在青云宗修行。', 1),
                fact('character', '沈青', '断刃城药铺学徒。', 9),
            ];
            const ranked = rankFacts(facts, { query: '青云宗', relevanceWeight: 0 });
            expect(ranked[0].name).toBe('沈青');
        });

        it('不改写输入数组、不改动排序后的候选集合', () => {
            const facts = [fact('character', 'A', '甲乙丙。', 1), fact('character', 'B', '甲乙丙丁。', 2)];
            const snapshot = [...facts];
            const ranked = rankFacts(facts, { query: '甲乙' });
            expect(facts).toEqual(snapshot);
            expect(ranked.map((item) => item.name).sort()).toEqual(['A', 'B']);
        });

        it('空数组与单条不抛错', () => {
            expect(rankFacts([])).toEqual([]);
            expect(rankFacts([fact('character', 'A', 'x')], { query: 'A' }).map((item) => item.name)).toEqual(['A']);
        });

        it('dedupe → rank → 截前 N 的组合保持总量上限不变', () => {
            const facts: RankableFact[] = [];
            for (let i = 0; i < 6; i++) facts.push(fact('character', `角色${i}`, `与主角同行的第${i}人。`, i));
            facts.push(fact('character', '角色5', '与主角同行的第5人，后期叛变。', 5));
            const pipeline = rankFacts(dedupeFacts(facts), { query: '第5人' }).slice(0, 3);
            expect(pipeline).toHaveLength(3);
            expect(pipeline[0].content).toContain('叛变');
        });
    });
});