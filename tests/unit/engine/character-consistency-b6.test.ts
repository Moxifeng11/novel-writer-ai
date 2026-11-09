import { describe, expect, it } from 'vitest';
import { CharacterConsistencyChecker } from '../../../engine/character-consistency-checker';
import { formatConsistencyReport } from '../../../engine/character-consistency-service';

describe('CharacterConsistencyChecker — B6 匹配与门禁', () => {
    it('短名不会命中更长人物名内部的区间', async () => {
        const checker = new CharacterConsistencyChecker();
        const result = await checker.check(
            '林惊鸿惊慌失措地后退。',
            [
                { name: '林', personality: '冷静' },
                { name: '林惊鸿', personality: '冷静' },
            ],
        );
        expect(result.characterResults['林'].inconsistencies).toHaveLength(0);
        expect(result.characterResults['林惊鸿'].inconsistencies.length).toBeGreaterThan(0);
    });

    it('句子级归属：同段另一个角色的行为不算到目标头上', async () => {
        const checker = new CharacterConsistencyChecker();
        const result = await checker.check(
            '林惊鸿站在门口。苏白惊慌失措地后退，手忙脚乱。',
            [{ name: '林惊鸿', personality: '冷静' }],
        );
        expect(result.characterResults['林惊鸿'].inconsistencies).toHaveLength(0);
    });

    it('能力检测在无向量时走关键词回退', async () => {
        const checker = new CharacterConsistencyChecker();
        const result = await checker.check(
            '林惊鸿运转焚天功法。林惊鸿施展御剑术。',
            [{ name: '林惊鸿', abilities: '御剑术、青云心法' }],
        );
        const abilities = result.characterResults['林惊鸿'].inconsistencies.filter((item) => item.type === 'ability');
        expect(abilities).toHaveLength(1);
        expect(abilities[0].description).toContain('超出设定');
        expect(abilities[0].severity).toBe('low');
    });

    it('构造函数阈值真正生效（向量相似度 0.5）', async () => {
        const enhancer = {
            isAvailable: async () => true,
            embedText: async (text: string) => (text.includes('冷静') ? [1, 0] : [0.866, 0.5]),
            cosineSimilarity: () => 0.5,
        };
        const strict = new CharacterConsistencyChecker(enhancer as never, 0.7);
        const strictResult = await strict.check('林惊鸿慌忙后退。', [{ name: '林惊鸿', personality: '冷静' }]);
        expect(strictResult.characterResults['林惊鸿'].inconsistencies.length).toBeGreaterThan(0);

        const loose = new CharacterConsistencyChecker(enhancer as never, 0.3);
        const looseResult = await loose.check('林惊鸿慌忙后退。', [{ name: '林惊鸿', personality: '冷静' }]);
        expect(looseResult.characterResults['林惊鸿'].inconsistencies).toHaveLength(0);
    });

    it('高严重度外貌矛盾使 passed=false，且不被平均分稀释', async () => {
        const checker = new CharacterConsistencyChecker();
        const result = await checker.check(
            '林惊鸿一头金发站在门口。苏白安静地坐着。',
            [
                { name: '林惊鸿', appearance: '一头黑发' },
                { name: '苏白', appearance: '黑发' },
            ],
        );
        expect(result.worstSeverity).toBe('high');
        expect(result.highSeverityCount).toBe(1);
        expect(result.passed).toBe(false);
    });

    it('报告格式包含最严重等级与高严重度计数', async () => {
        const checker = new CharacterConsistencyChecker();
        const result = await checker.check('林惊鸿一头金发。', [{ name: '林惊鸿', appearance: '黑发' }]);
        const report = formatConsistencyReport(result, '第3章');
        expect(report).toContain('最严重等级: high');
        expect(report).toContain('高严重度问题: 1');
        expect(report).toContain('通过: false');
    });
});
