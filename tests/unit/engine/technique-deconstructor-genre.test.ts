/**
 * technique-deconstructor-genre.test.ts — P5 题材自适应技巧匹配测试
 *
 * 验证 Task 11 的核心目标：
 *   1. 紫川（军事题材）样本不检测到甜宠/虐恋，检测到军事谋略/政治博弈等题材相关技巧
 *   2. 修仙样本仍能正确检测升级/打脸等修仙技巧
 *   3. 所有输出技巧 confidence >= 0.5
 *   4. 所有输出技巧命中数 >= 2
 *
 * 样本构造原则：
 *   - 军事样本：包含 military 独有 detectorSignals（统帅/谋略/厮杀/溃退/军团/统领/战役/战术/战略），
 *     并包含 military.techniqueKeywords 对应技巧的关键词（军事谋略/政治博弈/讽刺幽默/战争场面/热血燃向）
 *   - 修仙样本：包含 cultivation detectorSignals（功法/修为/境界/渡劫/灵根/修真/炼气/筑基/金丹/元婴/化神），
 *     并包含 breakthrough/face_slap/hidden_strength 的 keywords
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { TechniqueDeconstructor } from '../../../engine/deconstructors/technique-deconstructor';
import { GenreConfigRegistry } from '../../../engine/genre/genre-config-registry';

/**
 * 紫川风格军事样本：以《紫川》开篇氛围为蓝本构造的合成文本。
 * - military detectorSignals 命中需占绝对主导（统帅/谋略/厮杀/军团/统领/战役/战术/战略 等）
 * - 同步触发军事谋略/政治博弈/战争场面/讽刺幽默/热血 五类技巧的关键词
 */
const MILITARY_SAMPLE = [
    '第一章 战前部署',
    '统帅站在山头，远望战场。谋略已成，战术已定，战略部署完毕。布阵已毕，调兵遣将完毕。运筹帷幄之中，兵法森严。兵分两路，佯攻诱敌，埋伏已设。',
    '厮杀声起，冲锋号响。激战正酣，溃退已现。围攻之中，血战鏖战。战场之上，硝烟弥漫，战鼓震天，铁骑奔腾。',
    '政治博弈在朝堂上展开。派系林立，权谋深沉。夺权之声此起彼伏。势力角逐，博弈激烈。拉拢旧部，铲除异己。',
    '讽刺与幽默并存。调侃嘲讽，讥讽冷笑话。挖苦戏谑，反讽一针见血。军团统领将军帝国战争战役统帅谋略战术战略厮杀溃退。',
    '热血燃烧，战斗激昂。澎湃不屈，斗志昂扬。统帅号令全军，军团前进，战役战术战略已经确定。',
    '将军下令：冲锋！军团前进！帝国战争开始！统领号令全军。战役战术战略已经确定。谋略布阵运筹兵法森严。'
].join('\n\n');

/**
 * 修仙样本：包含 cultivation detectorSignals 与升级/打脸/扮猪吃虎 的 keywords
 */
const CULTIVATION_SAMPLE = [
    '第一章 觉醒灵根',
    '少年资质普通，但今日终于突破了。晋升炼气期，进阶到筑基境界。达到瓶颈之后，他修为大进，实力暴涨，顿悟天道法则。',
    '众人目瞪口呆，啪啪打脸。不敢相信，傻眼震惊，难以置信。原本看不起他的同门，现在都被打脸。',
    '他看起来普通，没想到竟然深藏不露，隐藏实力，低调不起眼。扮猪吃虎之计已成。',
    '功法修为境界渡劫灵根修真炼气筑基金丹元婴化神。突破晋升升级进阶达到瓶颈修为大进顿悟。',
    '突破突破，升级升级，打脸打脸。功法修为境界，修真炼气筑基金丹元婴化神。'
].join('\n\n');

describe('TechniqueDeconstructor - P5 题材自适应技巧匹配', () => {
    let deconstructor: TechniqueDeconstructor;

    beforeEach(() => {
        // 重置 GenreConfigRegistry 单例，确保每次测试都使用内置预设
        GenreConfigRegistry.resetInstance();
        deconstructor = new TechniqueDeconstructor();
    });

    describe('紫川（军事题材）样本拆解', () => {
        it('不检测到甜宠/虐恋', async () => {
            const result = await deconstructor.analyze(MILITARY_SAMPLE);
            const techniqueIds = result.techniques.map(t => t.id);
            expect(techniqueIds).not.toContain('sweet_pet');
            expect(techniqueIds).not.toContain('angst');
        });

        it('检测到军事谋略/政治博弈/战争场面/讽刺幽默/热血 中至少 2 个题材相关技巧', async () => {
            const result = await deconstructor.analyze(MILITARY_SAMPLE);
            const techniqueIds = result.techniques.map(t => t.id);
            const expected = [
                'military_strategy',
                'political_maneuvering',
                'war_scene',
                'satirical_humor',
                'passion'
            ];
            const matched = expected.filter(id => techniqueIds.includes(id));
            expect(matched.length).toBeGreaterThanOrEqual(2);
        });

        it('所有输出技巧 confidence >= 0.5', async () => {
            const result = await deconstructor.analyze(MILITARY_SAMPLE);
            expect(result.techniques.length).toBeGreaterThan(0);
            for (const tech of result.techniques) {
                expect(tech.confidence).toBeGreaterThanOrEqual(0.5);
            }
        });

        it('所有输出技巧关键词命中数 >= 2', async () => {
            const result = await deconstructor.analyze(MILITARY_SAMPLE);
            for (const tech of result.techniques) {
                expect(tech.count).toBeGreaterThanOrEqual(2);
            }
        });

        it('题材自适应激活的技巧 genreWeight = 1.5', async () => {
            const result = await deconstructor.analyze(MILITARY_SAMPLE);
            const genreRelated = result.techniques.filter(t =>
                ['military_strategy', 'political_maneuvering', 'war_scene', 'satirical_humor', 'passion'].includes(t.id)
            );
            for (const tech of genreRelated) {
                expect(tech.genreWeight).toBe(1.5);
            }
        });

        it('result.genreId 为 military', async () => {
            const result = await deconstructor.analyze(MILITARY_SAMPLE);
            expect(result.genreId).toBe('military');
        });
    });

    describe('修仙样本拆解', () => {
        it('仍能检测升级/打脸/扮猪吃虎等修仙技巧', async () => {
            const result = await deconstructor.analyze(CULTIVATION_SAMPLE);
            const techniqueIds = result.techniques.map(t => t.id);
            const expected = ['breakthrough', 'face_slap', 'hidden_strength', 'underdog_rise'];
            const matched = expected.filter(id => techniqueIds.includes(id));
            expect(matched.length).toBeGreaterThanOrEqual(1);
        });

        it('不检测到军事题材专属技巧（military_strategy / war_scene）', async () => {
            const result = await deconstructor.analyze(CULTIVATION_SAMPLE);
            const techniqueIds = result.techniques.map(t => t.id);
            expect(techniqueIds).not.toContain('military_strategy');
            expect(techniqueIds).not.toContain('war_scene');
        });

        it('所有输出技巧 confidence >= 0.5', async () => {
            const result = await deconstructor.analyze(CULTIVATION_SAMPLE);
            expect(result.techniques.length).toBeGreaterThan(0);
            for (const tech of result.techniques) {
                expect(tech.confidence).toBeGreaterThanOrEqual(0.5);
            }
        });

        it('result.genreId 为 cultivation', async () => {
            const result = await deconstructor.analyze(CULTIVATION_SAMPLE);
            expect(result.genreId).toBe('cultivation');
        });
    });

    describe('题材自适应过滤边界', () => {
        it('空文本返回空结果', async () => {
            const result = await deconstructor.analyze('');
            expect(result.techniques).toHaveLength(0);
            expect(result.stats.totalTechniques).toBe(0);
        });

        it('通用文本（无题材特征词）保持通用行为不报错', async () => {
            const genericText = '今天天气不错，我们一起去散步。路边的花开得很美，鸟儿在歌唱。山间小溪潺潺流水。';
            const result = await deconstructor.analyze(genericText);
            // 通用文本识别为 generic，不应用题材筛选，但可能因 confidence < 0.5 / count < 2 被过滤
            expect(result).toBeDefined();
            expect(result.techniques).toBeInstanceOf(Array);
        });
    });
});
