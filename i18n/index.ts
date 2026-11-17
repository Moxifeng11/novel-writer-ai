/**
 * i18n/index.ts — 插件界面文案的唯一入口（第一期）
 *
 * 用法：
 *   `t('settings.group.connect')` / `t('common.cancel')`
 *
 * 设计取舍：
 * - **不依赖 Obsidian 的 locale API**：桌面/移动/测试环境的可用性不一致，
 *   只读 `window.localStorage.language`（Obsidian 自己也是这么记的）做「跟随应用」检测。
 * - **缺失键不抛错**：返回键名本身并在控制台警告一次，避免一个漏翻把整页炸掉。
 * - **资源是普通对象**：键路径在运行时解析，因此新增文案不需要改类型；
 *   中英结构一致性由 `check:i18n` 与 `i18n-parity.test.ts` 双向校验。
 */

import { zhCN, type MessageTree } from './messages/zh-CN';
import { enUS } from './messages/en-US';

export type { MessageTree };
export type Locale = 'zh-CN' | 'en-US';

/** 支持的语言（顺序即设置页下拉顺序） */
export const SUPPORTED_LOCALES: readonly Locale[] = ['zh-CN', 'en-US'];

/** 资源缺失时的兜底语言 */
export const DEFAULT_LOCALE: Locale = 'zh-CN';

/** 设置值：auto = 跟随 Obsidian */
export type LocaleSetting = 'auto' | Locale;

/** 设置页下拉项：value 写进 settings.language，labelKey 走 t() */
export const LOCALE_OPTIONS: ReadonlyArray<{ value: LocaleSetting; labelKey: string }> = [
    { value: 'auto', labelKey: 'settings.appearance.language.auto' },
    { value: 'zh-CN', labelKey: 'settings.appearance.language.zhCN' },
    { value: 'en-US', labelKey: 'settings.appearance.language.enUS' },
];

const CATALOGS: Record<Locale, MessageTree> = {
    'zh-CN': zhCN,
    'en-US': enUS,
};

let activeLocale: Locale = DEFAULT_LOCALE;
const listeners = new Set<(locale: Locale) => void>();
const warnedKeys = new Set<string>();

/**
 * 判断任意值是否是受支持的语言代码。
 *
 * @param value - 任意值
 * @returns 是否受支持
 */
export function isSupportedLocale(value: unknown): value is Locale {
    return typeof value === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/** 把设置值收敛成受支持的设置值（未知值按 auto 处理） */
export function normalizeLocaleSetting(value: unknown): LocaleSetting {
    if (value === 'auto' || isSupportedLocale(value)) return value;
    return 'auto';
}

/**
 * 读宿主应用语言（Obsidian 把界面语言存在 localStorage.language，如 `zh` / `en`）。
 *
 * @returns 识别到的语言，或默认语言
 */
export function detectHostLocale(): Locale {
    let raw = '';
    try {
        const storage = typeof window !== 'undefined' ? window.localStorage : undefined;
        raw = String(storage?.getItem('language') ?? '');
    } catch {
        raw = '';
    }
    const normalized = raw.trim().toLowerCase();
    if (normalized.startsWith('zh')) return 'zh-CN';
    if (normalized.startsWith('en')) return 'en-US';
    return DEFAULT_LOCALE;
}

/**
 * 把设置值解析成实际语言。
 *
 * @param setting - `'auto'` / `'zh-CN'` / `'en-US'`，缺省按 auto
 * @returns 实际语言
 * @example
 * resolveLocale('auto'); // 跟随 localStorage.language，缺省 zh-CN
 */
export function resolveLocale(setting?: LocaleSetting | null): Locale {
    const normalized = normalizeLocaleSetting(setting);
    return normalized === 'auto' ? detectHostLocale() : normalized;
}

/** 当前生效语言 */
export function getLocale(): Locale {
    return activeLocale;
}

/**
 * 切换当前语言并通知订阅者（不写设置，写盘由调用方负责）。
 *
 * @param locale - 目标语言
 * @example
 * setLocale('en-US');
 */
export function setLocale(locale: Locale): void {
    if (activeLocale === locale) return;
    activeLocale = locale;
    for (const listener of Array.from(listeners)) {
        try {
            listener(locale);
        } catch { // silent-ok: 单个订阅者异常不能影响语言切换
        }
    }
}

/**
 * 按设置值切换语言（启动与设置变更的唯一入口）。
 *
 * @param setting - 设置值
 * @returns 实际生效的语言
 */
export function applyLocaleSetting(setting?: LocaleSetting | null): Locale {
    const locale = resolveLocale(setting);
    setLocale(locale);
    return locale;
}

/**
 * 订阅语言变化。
 *
 * @param listener - 回调
 * @returns 取消订阅函数
 */
export function onLocaleChange(listener: (locale: Locale) => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/** 按点分键取字符串；路径不存在或不是字符串时返回 undefined */
function lookup(tree: MessageTree, key: string): string | undefined {
    const parts = key.split('.');
    let node: string | MessageTree | undefined = tree;
    for (const part of parts) {
        if (typeof node !== 'object' || node === null) return undefined;
        node = node[part];
        if (node === undefined) return undefined;
    }
    return typeof node === 'string' ? node : undefined;
}

/**
 * 纯函数翻译：指定语言 + 键 + 插值参数。
 *
 * 查找顺序：目标语言 → 默认语言（zh-CN）→ 键名本身。
 *
 * @param locale - 语言
 * @param key - 点分键
 * @param params - 插值参数（`{count}` 之类）
 * @returns 文案
 * @example
 * translate('en-US', 'common.cancel'); // 'Cancel'
 */
export function translate(locale: Locale, key: string, params?: Record<string, string | number>): string {
    const hit = lookup(CATALOGS[locale] ?? CATALOGS[DEFAULT_LOCALE], key)
        ?? (locale === DEFAULT_LOCALE ? undefined : lookup(CATALOGS[DEFAULT_LOCALE], key));
    if (hit === undefined) {
        warnMissing(key);
        return key;
    }
    return interpolate(hit, params);
}

/**
 * 当前语言下翻译（界面代码统一用这个）。
 *
 * @param key - 点分键
 * @param params - 插值参数
 * @returns 文案
 * @example
 * t('settings.tab.api');
 */
export function t(key: string, params?: Record<string, string | number>): string {
    return translate(activeLocale, key, params);
}

/**
 * 判断键是否在默认语言资源里（用于测试与门禁）。
 *
 * @param key - 点分键
 * @returns 是否存在
 */
export function hasMessage(key: string): boolean {
    return lookup(CATALOGS[DEFAULT_LOCALE], key) !== undefined;
}

/**
 * 插值：把 `{name}` 替换成参数值；未提供的占位符原样保留。
 *
 * @param template - 带占位符的文案
 * @param params - 参数
 * @returns 替换后的文案
 */
export function interpolate(template: string, params?: Record<string, string | number>): string {
    if (!params) return template;
    return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
        Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : whole);
}

/**
 * 把资源树拍平成「键 → 文案」表（门禁与测试用）。
 *
 * @param tree - 资源树
 * @param prefix - 前缀
 * @returns 拍平后的表
 */
export function flattenMessages(tree: MessageTree = zhCN, prefix = ''): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(tree)) {
        const path = prefix ? `${prefix}.${key}` : key;
        if (typeof value === 'string') {
            out[path] = value;
        } else {
            Object.assign(out, flattenMessages(value, path));
        }
    }
    return out;
}

/** 取文案里的占位符集合（门禁校验用） */
export function placeholdersOf(template: string): string[] {
    return Array.from(template.matchAll(/\{(\w+)\}/g), match => match[1]).sort();
}

/** 供门禁脚本读取整棵资源树 */
export function getCatalog(locale: Locale): MessageTree {
    return CATALOGS[locale];
}

function warnMissing(key: string): void {
    if (warnedKeys.has(key)) return;
    warnedKeys.add(key);
    // silent-ok: 缺失键在运行时只提示一次，生产不阻塞
    console.warn(`[i18n] 缺少文案键：${key}`);
}
