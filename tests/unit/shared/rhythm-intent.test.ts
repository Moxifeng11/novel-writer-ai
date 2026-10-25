import { describe, expect, it } from 'vitest';
import { parseExpectedRhythm } from '../../../shared/rhythm-intent';

describe('parseExpectedRhythm — 只认显式标注', () => {
    it('标签写法：快 / 中 / 慢', () => {
        expect(parseExpectedRhythm('节奏：快')).toBe('fast');
        expect(parseExpectedRhythm('预期节奏 = 中等')).toBe('medium');
        expect(parseExpectedRhythm('节奏:慢')).toBe('slow');
    });

    it('Markdown 强调不影响识别', () => {
        expect(parseExpectedRhythm('**节奏**：`慢`')).toBe('slow');
    });

    it('常见短语写法', () => {
        expect(parseExpectedRhythm('本章是快节奏追逐')).toBe('fast');
        expect(parseExpectedRhythm('节奏偏慢，铺垫为主')).toBe('slow');
        expect(parseExpectedRhythm('中等节奏推进')).toBe('medium');
        expect(parseExpectedRhythm('慢热开局，后段升温')).toBe('slow');
    });

    it('没有显式标注时返回 undefined（不猜）', () => {
        expect(parseExpectedRhythm('主角进入宗门，遇到长老')).toBeUndefined();
        expect(parseExpectedRhythm('', '   ', undefined, null)).toBeUndefined();
    });

    it('快慢要求同时出现时返回 undefined（单值表达不了）', () => {
        expect(parseExpectedRhythm('前段快节奏，后段慢节奏收束')).toBeUndefined();
    });

    it('显式标签优先于短语', () => {
        expect(parseExpectedRhythm('节奏：慢。虽然是快节奏追捕的回忆。')).toBe('slow');
    });

    it('多个文本按序拼接后仍能识别', () => {
        expect(parseExpectedRhythm('日常铺垫', '节奏：快')).toBe('fast');
    });
});
