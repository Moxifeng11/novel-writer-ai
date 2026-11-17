/**
 * i18n-parity.test.ts — 中英资源结构一致性
 *
 * 资源是普通对象，缺键/多键在运行时不会报错，只会让英文界面掉回中文或直接露出键名。
 * 这里做双向校验（键集合、占位符、非空），与 check:i18n 门禁互为双保险。
 */
import { describe, expect, it } from 'vitest';
import { SUPPORTED_LOCALES, flattenMessages, getCatalog, placeholdersOf } from '../../../i18n';

const zh = flattenMessages(getCatalog('zh-CN'));
const en = flattenMessages(getCatalog('en-US'));

describe('键集合一致', () => {
    it('英文不缺键', () => {
        const missing = Object.keys(zh).filter(key => !(key in en));
        expect(missing).toEqual([]);
    });

    it('英文不多出中文没有的键', () => {
        const extra = Object.keys(en).filter(key => !(key in zh));
        expect(extra).toEqual([]);
    });

    it('资源树非空（防止被清空后测试仍然全绿）', () => {
        expect(Object.keys(zh).length).toBeGreaterThan(20);
        expect(Object.keys(en).length).toBe(Object.keys(zh).length);
    });
});

describe('文案内容', () => {
    it('每条文案都是非空字符串', () => {
        for (const [key, value] of [...Object.entries(zh), ...Object.entries(en)]) {
            expect(typeof value, key).toBe('string');
            expect(value.trim().length, key).toBeGreaterThan(0);
        }
    });

    it('占位符集合逐键一致', () => {
        const mismatched = Object.keys(zh).filter(key =>
            placeholdersOf(zh[key]).join(',') !== placeholdersOf(en[key]).join(','));
        expect(mismatched).toEqual([]);
    });

    it('英文资源里不应残留中文（语言自称项除外）', () => {
        const allowed = new Set(['settings.appearance.language.zhCN']);
        const offenders = Object.entries(en)
            .filter(([key, value]) => !allowed.has(key) && /[\u4e00-\u9fff]/.test(value))
            .map(([key]) => key);
        expect(offenders).toEqual([]);
    });
});

describe('门禁可直接复用同一套口径', () => {
    it('SUPPORTED_LOCALES 每种语言都能拍平成同类结构', () => {
        for (const locale of SUPPORTED_LOCALES) {
            const flat = flattenMessages(getCatalog(locale));
            expect(Object.keys(flat).length).toBe(Object.keys(zh).length);
        }
    });
});
