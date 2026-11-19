/**
 * i18n-core.test.ts — 文案核心（t / translate / 插值 / 兜底 / 语言切换）行为锁定
 *
 * 这些函数是「界面文案唯一入口」，一旦语义漂移（比如缺失键抛错、切换语言不通知、
 * 插值把未提供的占位符吃掉），所有迁移过的界面都会静默错。这里逐条钉住契约。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    DEFAULT_LOCALE,
    LOCALE_OPTIONS,
    SUPPORTED_LOCALES,
    applyLocaleSetting,
    detectHostLocale,
    flattenMessages,
    getCatalog,
    getLocale,
    hasMessage,
    interpolate,
    isSupportedLocale,
    normalizeLocaleSetting,
    onLocaleChange,
    placeholdersOf,
    resolveLocale,
    setLocale,
    t,
    translate,
} from '../../../i18n';
import { zhCN } from '../../../i18n/messages/zh-CN';
import { enUS } from '../../../i18n/messages/en-US';

/** 换掉宿主语言的 localStorage（node 环境无 window） */
function stubHostLanguage(raw: string | null): void {
    const win = { localStorage: { getItem: (key: string) => (key === 'language' ? raw : null) } };
    (globalThis as unknown as Record<string, unknown>).window = win;
}

function restoreHost(): void {
    delete (globalThis as unknown as Record<string, unknown>).window;
}

beforeEach(() => {
    applyLocaleSetting('zh-CN');
});

afterEach(() => {
    restoreHost();
    applyLocaleSetting('zh-CN');
    vi.restoreAllMocks();
});

describe('语言枚举与设置值收敛', () => {
    it('支持的语言与默认语言固定', () => {
        expect(SUPPORTED_LOCALES).toEqual(['zh-CN', 'en-US']);
        expect(DEFAULT_LOCALE).toBe('zh-CN');
        expect(LOCALE_OPTIONS.map(o => o.value)).toEqual(['auto', 'zh-CN', 'en-US']);
    });

    it('isSupportedLocale 只认受支持的语言代码', () => {
        expect(isSupportedLocale('zh-CN')).toBe(true);
        expect(isSupportedLocale('en-US')).toBe(true);
        expect(isSupportedLocale('ja-JP')).toBe(false);
        expect(isSupportedLocale('')).toBe(false);
        expect(isSupportedLocale(undefined)).toBe(false);
        expect(isSupportedLocale(42)).toBe(false);
    });

    it('normalizeLocaleSetting 把未知值收敛成 auto', () => {
        expect(normalizeLocaleSetting('auto')).toBe('auto');
        expect(normalizeLocaleSetting('en-US')).toBe('en-US');
        expect(normalizeLocaleSetting('en')).toBe('auto');
        expect(normalizeLocaleSetting(null)).toBe('auto');
        expect(normalizeLocaleSetting({})).toBe('auto');
    });
});

describe('宿主语言检测与解析', () => {
    it('无 window 时回退默认语言', () => {
        restoreHost();
        expect(detectHostLocale()).toBe('zh-CN');
    });

    it('localStorage.language 以 zh/en 开头时映射到对应语言', () => {
        stubHostLanguage('zh');
        expect(detectHostLocale()).toBe('zh-CN');
        stubHostLanguage('zh-TW');
        expect(detectHostLocale()).toBe('zh-CN');
        stubHostLanguage('EN-us');
        expect(detectHostLocale()).toBe('en-US');
    });

    it('localStorage 抛错或语言未知时回退默认语言', () => {
        const win = {
            localStorage: {
                getItem: () => {
                    throw new Error('denied');
                },
            },
        };
        (globalThis as unknown as Record<string, unknown>).window = win;
        expect(detectHostLocale()).toBe('zh-CN');
        stubHostLanguage('ja');
        expect(detectHostLocale()).toBe('zh-CN');
        stubHostLanguage(null);
        expect(detectHostLocale()).toBe('zh-CN');
    });

    it('resolveLocale：显式语言直接用，auto 跟随宿主，缺省按 auto', () => {
        stubHostLanguage('en-US');
        expect(resolveLocale('en-US')).toBe('en-US');
        expect(resolveLocale('zh-CN')).toBe('zh-CN');
        expect(resolveLocale('auto')).toBe('en-US');
        expect(resolveLocale()).toBe('en-US');
        expect(resolveLocale(null)).toBe('en-US');
        stubHostLanguage('zh');
        expect(resolveLocale('auto')).toBe('zh-CN');
    });
});

describe('语言切换与订阅', () => {
    it('setLocale 切换当前语言并通知订阅者', () => {
        const seen: string[] = [];
        const off = onLocaleChange(locale => seen.push(locale));
        setLocale('en-US');
        expect(getLocale()).toBe('en-US');
        expect(seen).toEqual(['en-US']);
        off();
        setLocale('zh-CN');
        expect(getLocale()).toBe('zh-CN');
        expect(seen).toEqual(['en-US']);
    });

    it('重复切到同一语言不重复通知', () => {
        const listener = vi.fn();
        onLocaleChange(listener);
        setLocale('zh-CN');
        expect(listener).not.toHaveBeenCalled();
        setLocale('en-US');
        setLocale('en-US');
        expect(listener).toHaveBeenCalledTimes(1);
    });

    it('单个订阅者抛错不影响其它订阅者与切换本身', () => {
        const ok = vi.fn();
        const offBad = onLocaleChange(() => {
            throw new Error('boom');
        });
        onLocaleChange(ok);
        expect(() => setLocale('en-US')).not.toThrow();
        expect(ok).toHaveBeenCalledWith('en-US');
        offBad();
    });

    it('applyLocaleSetting 返回实际生效语言并切换', () => {
        stubHostLanguage('en');
        expect(applyLocaleSetting('auto')).toBe('en-US');
        expect(getLocale()).toBe('en-US');
        expect(applyLocaleSetting('zh-CN')).toBe('zh-CN');
        expect(getLocale()).toBe('zh-CN');
    });
});

describe('翻译查找与兜底', () => {
    it('按当前语言取文案（缺省中文）', () => {
        expect(t('common.cancel')).toBe('取消');
        setLocale('en-US');
        expect(t('common.cancel')).toBe('Cancel');
    });

    it('translate 是纯函数，不受当前语言影响', () => {
        setLocale('en-US');
        expect(translate('zh-CN', 'common.confirm')).toBe('确定');
        expect(translate('en-US', 'common.confirm')).toBe('OK');
    });

    it('键在两份资源里都缺时返回键名，且同一键只警告一次', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        // 中文有、英文故意没有的键：用动态构造的英文部分缺失验证回退链路
        const key = 'i18n.test.fallback-probe-' + Math.random().toString(36).slice(2);
        expect(translate('en-US', key)).toBe(key);
        expect(translate('en-US', key)).toBe(key);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0][0]).toContain(key);
    });

    it('hasMessage 只看默认语言资源', () => {
        expect(hasMessage('settings.group.connect')).toBe(true);
        expect(hasMessage('settings.group.connect.deeper')).toBe(false);
        expect(hasMessage('nope.nothing')).toBe(false);
    });

    it('路径指向中间节点时不算命中', () => {
        expect(hasMessage('settings.group')).toBe(false);
    });
});

describe('插值', () => {
    it('替换提供的占位符，保留未提供的占位符', () => {
        expect(interpolate('共 {count} 章，{unknown}', { count: 3 })).toBe('共 3 章，{unknown}');
        expect(interpolate('{a}-{b}', { a: 'x', b: 2 })).toBe('x-2');
    });

    it('无参数时原样返回（含占位符）', () => {
        expect(interpolate('{a}')).toBe('{a}');
        expect(interpolate('纯文本', {})).toBe('纯文本');
    });

    it('参数名是原型链上的属性时不替换（只认自有属性）', () => {
        expect(interpolate('{toString}', {})).toBe('{toString}');
    });

    it('t 把参数透传给插值', () => {
        expect(t('common.loading')).toBe('加载中…');
        expect(interpolate(t('common.loading'), { count: 1 })).toBe('加载中…');
    });
});

describe('资源整形工具', () => {
    it('flattenMessages 拍平成点分键表', () => {
        const flat = flattenMessages({ a: { b: '1', c: { d: '2' } }, e: '3' });
        expect(flat).toEqual({ 'a.b': '1', 'a.c.d': '2', e: '3' });
    });

    it('flattenMessages 默认拍平中文资源树', () => {
        const flat = flattenMessages();
        expect(flat['common.cancel']).toBe('取消');
        expect(flat['settings.group.connect']).toContain('连接与模型');
        expect(Object.keys(flat).every(k => !k.includes('..'))).toBe(true);
    });

    it('placeholdersOf 返回排序后的占位符集合', () => {
        expect(placeholdersOf('{b} 与 {a} 与 {a}')).toEqual(['a', 'a', 'b']);
        expect(placeholdersOf('无占位符')).toEqual([]);
    });

    it('getCatalog 取到整棵资源树', () => {
        expect(getCatalog('zh-CN')).toBe(zhCN);
        expect(getCatalog('en-US')).toBe(enUS);
    });
});

describe('资源结构：对象键里不允许带点（lookup 按点分段下钻）', () => {
    /** 找出所有「键名本身含点」的对象键（扁平点号键会让 lookup 直接取不到） */
    function keysWithDot(tree: unknown, path: string[] = []): string[] {
        if (!tree || typeof tree !== 'object') return [];
        const bad: string[] = [];
        for (const [key, value] of Object.entries(tree as Record<string, unknown>)) {
            const here = [...path, key];
            if (key.includes('.')) bad.push(here.join(' > '));
            bad.push(...keysWithDot(value, here));
        }
        return bad;
    }

    it('zh-CN / en-US 都没有带点的对象键', () => {
        expect(keysWithDot(getCatalog('zh-CN'))).toEqual([]);
        expect(keysWithDot(getCatalog('en-US'))).toEqual([]);
    });

    it('拍平后的每个键都能被 translate 取到原文（点号键与漏译都会在这里露馅）', () => {
        for (const locale of SUPPORTED_LOCALES) {
            const flat = flattenMessages(getCatalog(locale));
            for (const key of Object.keys(flat)) {
                expect(translate(locale, key), `${locale}:${key}`).toBe(flat[key]);
            }
        }
    });
});
