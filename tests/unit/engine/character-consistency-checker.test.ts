import { describe, it, expect } from 'vitest';
import { CharacterConsistencyChecker } from '../../../engine/character-consistency-checker';

function appearanceIssues(
  result: Awaited<ReturnType<CharacterConsistencyChecker['check']>>,
  name: string
) {
  return result.characterResults[name].inconsistencies.filter((i) => i.type === 'appearance');
}

describe('CharacterConsistencyChecker — 段落切分与外貌矛盾', () => {
  it('单换行分段时，同章其他角色的外貌词不算到主角头上', async () => {
    const checker = new CharacterConsistencyChecker();
    const result = await checker.check(
      '林惊鸿走进大殿，四下打量。\n苏白一头金发，站在门口。',
      [{ name: '林惊鸿', appearance: '一头黑发' }]
    );
    expect(appearanceIssues(result, '林惊鸿')).toHaveLength(0);
  });

  it('同一段落内出现反义外貌词仍报外貌矛盾', async () => {
    const checker = new CharacterConsistencyChecker();
    const result = await checker.check(
      '林惊鸿一头金发，站在门口。\n苏白没有说话。',
      [{ name: '林惊鸿', appearance: '一头黑发' }]
    );
    expect(appearanceIssues(result, '林惊鸿')).toHaveLength(1);
  });

  it('设定同时提到两种发色时，同一矛盾词只报一条', async () => {
    const checker = new CharacterConsistencyChecker();
    const result = await checker.check(
      '林惊鸿一头白发，站在门口。',
      [{ name: '林惊鸿', appearance: '原本一头黑发，后因功法变成金发' }]
    );
    expect(appearanceIssues(result, '林惊鸿')).toHaveLength(1);
  });
});

describe('CharacterConsistencyChecker — 性格关键词回退', () => {
  it('性格设定用关键词（冷静）而不是标签（沉稳）时，行为矛盾仍能检出', async () => {
    const checker = new CharacterConsistencyChecker();
    const result = await checker.check(
      '林惊鸿惊慌失措地后退，手忙脚乱。',
      [{ name: '林惊鸿', personality: '冷静' }]
    );
    const behaviorIssues = result.characterResults['林惊鸿'].inconsistencies
      .filter((i) => i.type === 'behavior');
    expect(behaviorIssues).toHaveLength(1);
  });

  it('性格关键词与段落描写一致时不报性格不符', async () => {
    const checker = new CharacterConsistencyChecker();
    const result = await checker.check(
      '林惊鸿冷静地分析局势，不动声色。',
      [{ name: '林惊鸿', personality: '冷静' }]
    );
    const personalityIssues = result.characterResults['林惊鸿'].inconsistencies
      .filter((i) => i.type === 'personality');
    expect(personalityIssues).toHaveLength(0);
  });
});
