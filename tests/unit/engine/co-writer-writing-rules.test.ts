import { describe, expect, it } from 'vitest';
import { formatWritingRulesForPrompt } from '../../../engine/prompts/writing-rules-format';

describe('formatWritingRulesForPrompt — 协同写作规则渲染', () => {
    it('把 mandatory 对象渲染成标题/说明/要点，而不是 [object Object]', () => {
        const text = formatWritingRulesForPrompt({
            mandatory: [
                { title: '视角', description: '第三人称限知', points: ['贴主角', '不跳视角'] },
                { title: '节奏', points: ['短长句混用'] },
            ],
        });
        expect(text).not.toContain('[object Object]');
        expect(text).toContain('### 视角');
        expect(text).toContain('第三人称限知');
        expect(text).toContain('- 贴主角');
        expect(text).toContain('- 不跳视角');
        expect(text).toContain('### 节奏');
        expect(text).toContain('- 短长句混用');
    });

    it('checklist 逐条输出，空项被过滤', () => {
        const text = formatWritingRulesForPrompt({ checklist: ['不写总结段', '  ', ''] });
        expect(text).toBe('- 不写总结段');
    });

    it('空对象 / undefined 返回空串', () => {
        expect(formatWritingRulesForPrompt(undefined)).toBe('');
        expect(formatWritingRulesForPrompt({})).toBe('');
    });

    it('title 为空时只输出说明与要点（不产生空标题行）', () => {
        const text = formatWritingRulesForPrompt({ mandatory: [{ description: '说明', points: ['要点'] }] });
        expect(text).toBe('说明\n- 要点');
    });
});
