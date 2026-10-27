/**
 * 协同写作 — 创作模式约束注入回归
 *
 * 短篇/剧本项目在协同续写时必须带平台硬约束，否则模型仍按长篇散文写；
 * 长篇保持空块，prompt 与旧版逐字一致。
 */
import { describe, it, expect } from 'vitest';
import { PromptBuilder, type PromptSnapshot } from '../../../engine/prompt-builder';

function build(snapshot: Partial<PromptSnapshot>): string {
    const builder = new PromptBuilder(() => snapshot as PromptSnapshot);
    return builder.buildSuggestionPrompt('前文一句。', 'action', '', '', '').user;
}

describe('PromptBuilder — 创作模式约束', () => {
    it('短篇项目注入番茄短篇硬约束', () => {
        const user = build({
            creationModeContext: '【创作模式：番茄短篇小说】\n- 分类：婚姻家庭\n- 每节结尾必须有钩子。',
        });
        expect(user).toContain('【创作模式：番茄短篇小说】');
        expect(user).toContain('每节结尾必须有钩子');
    });

    it('剧本项目注入红果短剧硬约束', () => {
        const user = build({
            creationModeContext: '【创作模式：红果短剧】\n- 单集 60–120 秒，3–6 场。',
        });
        expect(user).toContain('【创作模式：红果短剧】');
        expect(user).toContain('3–6 场');
    });

    it('长篇（空块）不注入模式段，且不挤掉同人约束', () => {
        const longUser = build({ creationModeContext: '' });
        expect(longUser).not.toContain('【创作模式：');

        const fanficUser = build({
            creationModeContext: '',
            fanficRulesContext: '【同人原作约束】\n- 不得改变原作力量体系。',
        });
        expect(fanficUser).toContain('【同人原作约束】');
    });
});