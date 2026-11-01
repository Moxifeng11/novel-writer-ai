import { describe, expect, it } from 'vitest';
import { isImeComposing } from '../../../shared/keyboard';

describe('isImeComposing', () => {
    it('isComposing 为 true 时视为组字中', () => {
        expect(isImeComposing({ isComposing: true })).toBe(true);
    });

    it('keyCode 229 兜底视为组字中', () => {
        expect(isImeComposing({ keyCode: 229 })).toBe(true);
    });

    it('读取 nativeEvent 上的标记', () => {
        expect(isImeComposing({ nativeEvent: { isComposing: true } })).toBe(true);
        expect(isImeComposing({ nativeEvent: { keyCode: 229 } })).toBe(true);
    });

    it('普通按键返回 false', () => {
        expect(isImeComposing({ isComposing: false, keyCode: 13 })).toBe(false);
        expect(isImeComposing({})).toBe(false);
    });

    it('空值安全', () => {
        expect(isImeComposing(null)).toBe(false);
        expect(isImeComposing(undefined)).toBe(false);
    });
});
