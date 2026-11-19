import { describe, expect, it } from 'vitest';
import { ENGINE_MSG_CODES } from '@/shared/engine-msg-codes';
import { flattenMessages, getCatalog, hasMessage, setLocale, t } from '@/i18n';

/**
 * engineMsg 键编译期常量表（审计 B7 / C 清单 #12）。
 *
 * `UiMessage.code` 现在是 `EngineMsgCode` 字面量联合类型 —— 拼错是编译错。
 * 本用例守住另一半：常量表与 i18n 资源必须双向一致（不多、不少、不重），
 * 且每条在 zh/en 都能解析、en 不含中文。
 */
function engineMsgKeys(locale: 'zh-CN' | 'en-US'): string[] {
    const flat = flattenMessages(getCatalog(locale));
    return Object.keys(flat).filter(key => key.startsWith('engineMsg.')).sort();
}

describe('ENGINE_MSG_CODES 与 i18n 资源一致', () => {
    it('与 zh 资源键集合完全相等（双向）', () => {
        expect([...ENGINE_MSG_CODES].sort()).toEqual(engineMsgKeys('zh-CN'));
    });

    it('与 en 资源键集合完全相等（双向）', () => {
        expect([...ENGINE_MSG_CODES].sort()).toEqual(engineMsgKeys('en-US'));
    });

    it('无重复键', () => {
        expect(new Set(ENGINE_MSG_CODES).size).toBe(ENGINE_MSG_CODES.length);
    });

    it('每条都能在 zh/en 解析，且 en 文案不含中文', () => {
        for (const code of ENGINE_MSG_CODES) {
            setLocale('zh-CN');
            expect(hasMessage(code)).toBe(true);
            expect(t(code)).not.toBe(code);
            setLocale('en-US');
            expect(hasMessage(code)).toBe(true);
            expect(t(code)).not.toMatch(/[\u4e00-\u9fff]/);
        }
        setLocale('zh-CN');
    });
});
