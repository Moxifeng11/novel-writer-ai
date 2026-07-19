/**
 * readability-deconstructor.test.ts — P8 可读性 bug 修复测试
 *
 * 验证 Task 14 的三个修复点：
 *   1. overallScore 归一化：返回 0-100 整数（不再为 0-1 小数）
 *   2. wordRepetition 使用 3 字 n-gram（不再产生 100 分假阳性）
 *   3. showPercentage 从 genreConfig.showSignalWords 读取信号词（紫川样本 > 15%）
 *
 * 紫川样本构造原则：
 *   - 含 military detectorSignals（统帅/谋略/厮杀/军团/统领/战役/战术/战略/将军/帝国）
 *     以触发 GenreDetector 识别为 military 题材
 *   - 每段含 military.showSignalWords（看/听/闻/道/说/笑/怒/喝/冲/砍）
 *   - 总长度 > 100 字以触发 wordRepetition 计算
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ReadabilityDeconstructor } from '../../../engine/deconstructors/readability-deconstructor';
import { GenreConfigRegistry } from '../../../engine/genre/genre-config-registry';

/**
 * 紫川风格军事样本：以《紫川》开篇氛围为蓝本的合成文本。
 * - military detectorSignals 占主导：统帅/谋略/军团/将军/帝国/战役/战术/战略
 * - 每段含 military.showSignalWords：看/听/闻/道/说/笑/怒/喝/冲/砍
 */
const ZICHUAN_MILITARY_SAMPLE = [
    '第一章 战前部署',
    '统帅站在山头，看着远方的战场。他听到号角声起，闻到硝烟味。谋略已成，战术已定，战略部署完毕。将军说道：冲！',
    '厮杀声起，军团冲锋。统领喝道：杀！士兵怒吼，挥刀砍去。战场上笑声与哭声交织。统帅看了一眼，说道：继续冲。',
    '政治博弈在朝堂上展开。谋略深沉，战术森严。统帅听谋士说：此战必胜。将军笑道：好！怒喝一声：冲！',
    '热血燃烧，战斗激昂。军团前进，统帅号令。战役战术战略已定。将军冲上前，砍倒敌人。士兵闻风而动，听着号令。',
    '帝国战争开始。统帅说：杀！将军冲！谋士听！士兵砍！战役战术战略已定。笑声阵阵，怒吼连连。',
    '统帅看着战场，听着厮杀，闻着血腥。将军笑道：胜了！谋士说道：妙计！统领喝道：追！士兵冲上前去。'
].join('\n\n');

/**
 * 极端重复样本：同一段 3 字组合反复出现，用于验证 wordRepetition 仍能检测真实重复。
 * 通过拼接构造，避免文件膨胀。
 */
function buildHighRepetitionSample(): string {
    const unit = '他看着我看着我看着我看着我看着我看着我看着我看着我看着我看着我看着我看着我看着我看着我看着我';
    // 拼接至约 1500 字，确保 windowSize=500 仍能命中重复
    return Array.from({ length: 20 }, () => unit).join('');
}

describe('ReadabilityDeconstructor - P8 可读性 bug 修复', () => {
    let deconstructor: ReadabilityDeconstructor;

    beforeEach(() => {
        // 重置 GenreConfigRegistry 单例，确保每次测试都使用内置预设
        GenreConfigRegistry.resetInstance();
        deconstructor = new ReadabilityDeconstructor();
    });

    describe('SubTask 14.1 - overallScore 归一化', () => {
        it('overallScore 是 0-100 范围的整数（紫川样本不为 0-1 小数）', async () => {
            const result = await deconstructor.analyze(ZICHUAN_MILITARY_SAMPLE);
            expect(Number.isInteger(result.overallScore)).toBe(true);
            expect(result.overallScore).toBeGreaterThanOrEqual(0);
            expect(result.overallScore).toBeLessThanOrEqual(100);
            // 修复前会返回 0.22 这类小数，整数检查能直接拦截
            expect(result.overallScore).not.toBeLessThan(1);
        });

        it('空文本返回 0（边界覆盖）', async () => {
            const result = await deconstructor.analyze('');
            expect(result.overallScore).toBe(0);
            expect(Number.isInteger(result.overallScore)).toBe(true);
        });
    });

    describe('SubTask 14.2 - wordRepetition 3 字 n-gram', () => {
        it('紫川样本 wordRepetition < 50（修复 100 假阳性）', async () => {
            const result = await deconstructor.analyze(ZICHUAN_MILITARY_SAMPLE);
            const wordRep = result.aiTrace.dimensions.wordRepetition;
            expect(wordRep.score).toBeLessThan(50);
            // details 字段名改为 repeatedTrigrams
            expect(wordRep.details).toHaveProperty('repeatedTrigrams');
            expect(wordRep.details).not.toHaveProperty('repeatedBigrams');
        });

        it('极端重复文本仍能检测到重复（wordRepetition > 0，避免回归）', async () => {
            const sample = buildHighRepetitionSample();
            const result = await deconstructor.analyze(sample);
            const wordRep = result.aiTrace.dimensions.wordRepetition;
            expect(wordRep.score).toBeGreaterThan(0);
        });
    });

    describe('SubTask 14.3 - showPercentage 从 genreConfig.showSignalWords 读取', () => {
        it('紫川样本 showPercentage > 15%（修复 3.13% 过低）', async () => {
            const result = await deconstructor.analyze(ZICHUAN_MILITARY_SAMPLE);
            expect(result.showTell.showPercentage).toBeGreaterThan(15);
        });

        it('military genreConfig.showSignalWords 包含看/听/闻/道/说/笑/怒/喝/冲/砍', () => {
            const config = GenreConfigRegistry.getInstance().getGenreConfig('military');
            expect(config.showSignalWords).toEqual(
                expect.arrayContaining(['看', '听', '闻', '道', '说', '笑', '怒', '喝', '冲', '砍'])
            );
        });

        it('generic genreConfig.showSignalWords 包含基础动作与感官词', () => {
            const config = GenreConfigRegistry.getInstance().getGenreConfig('generic');
            expect(config.showSignalWords).toEqual(
                expect.arrayContaining(['看', '听', '说', '走', '跑'])
            );
        });
    });

    describe('SubTask 14.4 - 紫川可读性综合验证', () => {
        it('紫川样本满足三项验收标准：overallScore 整数 / wordRepetition<50 / showPercentage>15%', async () => {
            const result = await deconstructor.analyze(ZICHUAN_MILITARY_SAMPLE);

            // 1. overallScore 为 0-100 整数
            expect(Number.isInteger(result.overallScore)).toBe(true);
            expect(result.overallScore).toBeGreaterThanOrEqual(0);
            expect(result.overallScore).toBeLessThanOrEqual(100);

            // 2. wordRepetition < 50
            expect(result.aiTrace.dimensions.wordRepetition.score).toBeLessThan(50);

            // 3. showPercentage > 15%
            expect(result.showTell.showPercentage).toBeGreaterThan(15);
        });
    });
});
