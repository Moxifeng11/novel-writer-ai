/**
 * settings-locale.test.ts — 设置页「界面语言」下拉（渲染 + 切换 + 落盘）
 *
 * obsidian 替身的 addDropdown 不保存 onChange 回调，无法驱动真实交互；这里用
 * 局部 mock 捕获下拉组件，才能验证「选完立即切换语言、写成设置、再通知宿主重开」。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** 捕获到的下拉组件状态 */
const captured: {
    options: Array<[string, string]>;
    value: string;
    change?: (value: string) => Promise<void> | void;
} = { options: [], value: '' };

vi.mock('obsidian', () => {
    class FakeSetting {
        name = '';
        desc = '';
        constructor(_container: unknown) {}
        setName(name: string): this { this.name = name; return this; }
        setDesc(desc: string): this { this.desc = desc; return this; }
        addDropdown(cb: (component: unknown) => void): this {
            cb({
                addOption(value: string, label: string) {
                    captured.options.push([value, label]);
                    return this;
                },
                setValue(value: string) {
                    captured.value = value;
                    return this;
                },
                onChange(fn: (value: string) => Promise<void> | void) {
                    captured.change = fn;
                    return this;
                },
            });
            return this;
        }
    }
    return { Setting: FakeSetting };
});

import {
    LOCALE_OPTIONS,
    SUPPORTED_LOCALES,
    applyLocaleSetting,
    getCatalog,
    getLocale,
    placeholdersOf,
    t,
} from '../../../i18n';
import { coalesceLocaleSetting, renderLocaleSetting } from '../../../ui/settings/locale-setting';

interface StubPlugin {
    settings: { language?: string };
    saveSettings: () => Promise<void>;
}

function makePlugin(language?: string): StubPlugin {
    return {
        settings: language === undefined ? {} : { language },
        saveSettings: vi.fn(async () => undefined),
    };
}

beforeEach(() => {
    captured.options = [];
    captured.value = '';
    captured.change = undefined;
    applyLocaleSetting('zh-CN');
});

afterEach(() => {
    applyLocaleSetting('zh-CN');
    vi.restoreAllMocks();
});

describe('渲染', () => {
    it('按当前语言渲染标题与说明，并给出三种语言选项', () => {
        const plugin = makePlugin('auto');
        renderLocaleSetting({} as HTMLElement, plugin as never, () => undefined);

        expect(captured.options.map(([value]) => value)).toEqual(['auto', 'zh-CN', 'en-US']);
        expect(captured.options.map(([, label]) => label)).toEqual(
            LOCALE_OPTIONS.map(option => t(option.labelKey)));
        expect(captured.value).toBe('auto');
    });

    it('切换到英文后重新渲染，标题与选项文案变英文', () => {
        applyLocaleSetting('en-US');
        renderLocaleSetting({} as HTMLElement, makePlugin('en-US') as never, () => undefined);

        const labels = captured.options.map(([, label]) => label);
        expect(labels).toContain('English');
        // 语言选项按「自称」写（中文项就是简体中文），其余文案必须是英文
        const nonSelfLabels = captured.options
            .filter(([value]) => value !== 'zh-CN')
            .map(([, label]) => label);
        expect(nonSelfLabels.some(label => /[\u4e00-\u9fff]/.test(label))).toBe(false);
        expect(captured.value).toBe('en-US');
    });

    it('非法设置值（未定义/未知语言）按 auto 显示', () => {
        renderLocaleSetting({} as HTMLElement, makePlugin(undefined) as never, () => undefined);
        expect(captured.value).toBe('auto');
        renderLocaleSetting({} as HTMLElement, makePlugin('ja-JP') as never, () => undefined);
        expect(captured.value).toBe('auto');
    });
});

describe('切换', () => {
    it('选择后写设置、立即生效、落盘并通知宿主', async () => {
        const plugin = makePlugin('auto');
        const onChanged = vi.fn();
        renderLocaleSetting({} as HTMLElement, plugin as never, onChanged);

        await captured.change?.('en-US');

        expect(plugin.settings.language).toBe('en-US');
        expect(getLocale()).toBe('en-US');
        expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
        expect(onChanged).toHaveBeenCalledTimes(1);
        // 先落盘再通知：宿主重开时读到的是已保存的值
        expect((plugin.saveSettings as unknown as { mock: { invocationCallOrder: number[] } })
            .mock.invocationCallOrder[0]).toBeLessThan(onChanged.mock.invocationCallOrder[0]);
    });

    it('非法回传值收敛成 auto（回到跟随应用）', async () => {
        const plugin = makePlugin('en-US');
        renderLocaleSetting({} as HTMLElement, plugin as never, () => undefined);

        await captured.change?.('klingon');

        expect(plugin.settings.language).toBe('auto');
    });
});

describe('coalesceLocaleSetting', () => {
    it('合法值原样返回，其余一律 auto', () => {
        expect(coalesceLocaleSetting('auto')).toBe('auto');
        for (const locale of SUPPORTED_LOCALES) expect(coalesceLocaleSetting(locale)).toBe(locale);
        expect(coalesceLocaleSetting(undefined)).toBe('auto');
        expect(coalesceLocaleSetting('')).toBe('auto');
        expect(coalesceLocaleSetting(1)).toBe('auto');
        expect(coalesceLocaleSetting({ language: 'en-US' })).toBe('auto');
    });
});

describe('资源可达性', () => {
    it('下拉用到的每个 labelKey 在两种语言里都有非空文案', () => {
        for (const option of LOCALE_OPTIONS) {
            for (const locale of SUPPORTED_LOCALES) {
                const catalog = getCatalog(locale);
                const label = option.labelKey.split('.').reduce<unknown>(
                    (node, part) => (node as Record<string, unknown> | undefined)?.[part], catalog);
                expect(typeof label, option.labelKey + '@' + locale).toBe('string');
                expect((label as string).trim().length).toBeGreaterThan(0);
                expect(placeholdersOf(label as string)).toEqual([]);
            }
        }
    });
});
