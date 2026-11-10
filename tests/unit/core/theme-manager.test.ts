import { afterEach, describe, expect, it, vi } from 'vitest';
import { ThemeManager, parseCssVars } from '../../../core/theme-manager';
import {
    clearDocumentScopes,
    registerDocumentScope,
    unregisterDocumentScope,
} from '../../../shared/document-scopes';

/**
 * 主题变量写入回归（v4.80.0 批量 A）。
 *
 * 背景：社区目录禁止动态创建 <style>，主题色改为直接写 documentElement 的
 * 自定义属性。这里用最小 DOM 桩钉住三件事：
 *  1. 注入过程不创建任何元素（桩里根本没有 createElement，回归会直接抛错）；
 *  2. Obsidian 1.5+ 走 setCssProps，1.4.x 退回 style.setProperty；
 *  3. dispose 后主题变量与布局变量全部移除，不残留 --nw-*。
 */

interface FakeDoc {
    documentElement: HTMLElement & { setCssProps?: (props: Record<string, string>) => void };
    body: { classList: { contains: (name: string) => boolean } };
    getElementById: () => null;
    querySelectorAll: () => Element[];
}

function createFakeDoc({ withSetCssProps = false }: { withSetCssProps?: boolean } = {}) {
    const props = new Map<string, string>();
    const root = {
        style: {
            setProperty: (name: string, value: string) => props.set(name, value),
            removeProperty: (name: string) => {
                const previous = props.get(name) ?? '';
                props.delete(name);
                return previous;
            },
        },
    } as unknown as FakeDoc['documentElement'];

    if (withSetCssProps) {
        root.setCssProps = (vars: Record<string, string>) => {
            for (const [name, value] of Object.entries(vars)) props.set(name, value);
        };
    }

    const doc: FakeDoc = {
        documentElement: root,
        body: { classList: { contains: (name: string) => name === 'theme-dark' } },
        getElementById: () => null,
        querySelectorAll: () => [],
    };
    return { doc, props, root };
}

function makeDoc(options: { withSetCssProps?: boolean } = {}) {
    const created = createFakeDoc(options);
    vi.stubGlobal('document', created.doc);
    return created;
}

afterEach(() => {
    vi.unstubAllGlobals();
    clearDocumentScopes();
});

describe('parseCssVars', () => {
    it('解析声明块，保留 color-mix / 渐变等含逗号的取值', () => {
        const vars = parseCssVars(`
            --nw-app-bg: #1c1a1e;
            --nw-surface-hover: color-mix(in srgb, #232026, #C2410C 6%);
            --nw-accent-gradient: linear-gradient(90deg, #C2410C, #D97706);
            非法片段;
            --nw-empty: ;
        `);
        expect(vars['--nw-app-bg']).toBe('#1c1a1e');
        expect(vars['--nw-surface-hover']).toBe('color-mix(in srgb, #232026, #C2410C 6%)');
        expect(vars['--nw-accent-gradient']).toBe('linear-gradient(90deg, #C2410C, #D97706)');
        expect(vars['--nw-empty']).toBeUndefined();
        expect(Object.keys(vars).every((name) => name.startsWith('--'))).toBe(true);
    });
});

describe('ThemeManager 变量注入', () => {
    const settings = {
        theme: 'auto' as const,
        themeColors: undefined,
        themePresets: [],
    };

    it('1.4.x：无 setCssProps 时退回 style.setProperty，且不创建 <style>', () => {
        const { props } = makeDoc();
        const manager = new ThemeManager(() => settings);
        manager.injectThemeVariables();

        expect(props.get('--nw-app-bg')).toBe('#1c1a1e');
        expect(props.get('--nw-accent-gradient')).toMatch(/^linear-gradient\(90deg,/);
        // 基底变量 + 派生覆盖 ≥ 50 个
        expect(props.size).toBeGreaterThan(45);
    });

    it('1.5+：存在 setCssProps 时优先使用（值一致）', () => {
        const { props, root } = makeDoc({ withSetCssProps: true });
        const spy = vi.spyOn(root, 'setCssProps');
        const manager = new ThemeManager(() => settings);
        manager.injectThemeVariables();

        expect(spy).toHaveBeenCalledTimes(1);
        expect(props.get('--nw-app-bg')).toBe('#1c1a1e');
    });

    it('dispose 后主题变量与布局变量全部移除', () => {
        const { props } = makeDoc();
        const manager = new ThemeManager(
            () => settings,
            () => ({ fwStepNav: 180, fwRightPanel: 300 }),
        );
        manager.injectThemeVariables();
        manager.injectLayoutVariables();
        expect(props.get('--nw-panel-nav')).toBe('180px');
        expect(props.size).toBeGreaterThan(45);

        manager.dispose();
        expect(props.size).toBe(0);
    });
});

describe('ThemeManager 跨窗口（popout，M3-2）', () => {
    const settings = {
        theme: 'dark' as const,
        themeColors: undefined,
        themePresets: [],
    };

    it('主题与布局变量同时写入已登记的 popout 文档，dispose 一并移除', () => {
        makeDoc();
        const popup = createFakeDoc();
        registerDocumentScope(popup.doc as unknown as Document);

        const manager = new ThemeManager(
            () => settings,
            () => ({ fwStepNav: 180 }),
        );
        manager.injectThemeVariables();
        manager.injectLayoutVariables();

        // popout 有自己的 documentElement，变量不会跨窗口继承
        expect(popup.props.get('--nw-app-bg')).toBe('#1c1a1e');
        expect(popup.props.get('--nw-panel-nav')).toBe('180px');

        manager.dispose();
        expect(popup.props.size).toBe(0);
    });

    it('窗口关闭注销后不再写入该文档', () => {
        makeDoc();
        const popup = createFakeDoc();
        registerDocumentScope(popup.doc as unknown as Document);
        unregisterDocumentScope(popup.doc as unknown as Document);

        const manager = new ThemeManager(() => settings);
        manager.injectThemeVariables();

        expect(popup.props.size).toBe(0);
    });
});
