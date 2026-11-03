import { describe, expect, it } from 'vitest';
import { PromptBuilder, type PromptSnapshot } from '../../../engine/prompt-builder';

const PACK = '【故事上下文｜云端｜3 项｜约 120 tokens】\n■ 场景锚点\n- 场景1「断魂桥」：POV:沈砚 | 地点:断魂桥\n■ 人物\n- 沈砚：主角';
const COMPACT = '【故事上下文｜云端｜3 项｜约 60 tokens】\n■ 场景锚点\n- 场景1「断魂桥」：POV:沈砚';

function snapshot(overrides: Partial<PromptSnapshot> = {}): PromptSnapshot {
    return {
        chapterName: '第1章',
        allChars: '旧人物甲：旧状态',
        allFactions: '旧势力甲',
        allLocs: '旧地点甲',
        allItems: '旧物品甲',
        settingLib: '旧设定库内容',
        timeline: '旧时间线内容',
        foreshadows: {
            unrevealed: [
                { id: 'f1', name: '旧伏笔', plannedReveal: '第1章' },
            ],
        },
        ...overrides,
    };
}

describe('PromptBuilder — 故事上下文总线', () => {
    it('有完整信息包时注入，并停用旧的实体/设定/时间线/伏笔分段', () => {
        const builder = new PromptBuilder(() => snapshot({
            storyContextPack: PACK,
            storyContextPackCompact: COMPACT,
        }));
        const { user } = builder.buildSuggestionPrompt('前文一句。', 'action', '', '', '');

        expect(user).toContain('【故事上下文');
        expect(user).toContain('断魂桥');
        expect(user).not.toContain('【人物总览】');
        expect(user).not.toContain('【设定库】');
        expect(user).not.toContain('【时间线】');
        expect(user).not.toContain('【未回收伏笔提醒】');
        expect(user).not.toContain('旧人物甲');
        expect(user).not.toContain('旧设定库内容');
    });

    it('没有信息包时保留旧上下文，行为不变', () => {
        const builder = new PromptBuilder(() => snapshot());
        const { user } = builder.buildSuggestionPrompt('前文一句。', 'action', '', '', '');

        expect(user).toContain('【人物总览】');
        expect(user).toContain('旧人物甲');
        expect(user).toContain('【设定库】');
        expect(user).toContain('【时间线】');
        expect(user).toContain('【未回收伏笔提醒】');
    });

    it('选区改写使用完整信息包', () => {
        const builder = new PromptBuilder(() => snapshot({
            storyContextPack: PACK,
            storyContextPackCompact: COMPACT,
        }));
        const prompt = builder.buildRewritePrompt('选中文本。', '前文。', '后文。', '', 'action');
        expect(prompt).toContain('【故事上下文');
        expect(prompt).toContain('沈砚');
    });

    it('联想与迭代使用压缩信息包，避免挤占小窗口', () => {
        const builder = new PromptBuilder(() => snapshot({
            storyContextPack: PACK,
            storyContextPackCompact: COMPACT,
        }));
        const association = builder.buildAssociationPrompt('前文。', { type: 'continue' } as never);
        expect(association).toContain('约 60 tokens');
        expect(association).not.toContain('■ 人物');

        const iterate = builder.buildIteratePrompt('原候选', '前文。', '再克制一点', '');
        expect(iterate).toContain('约 60 tokens');
        expect(iterate).not.toContain('■ 人物');
    });
});
