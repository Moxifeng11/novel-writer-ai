/**
 * 自定义字体跨窗口（popout）回归（M3-2）。
 *
 * popout 第二窗口有独立的 document.fonts；主窗口注册的 FontFace 不会自动出现，
 * 表现为 popout 内自定义字体回落默认字体。这里钉住：
 *  1. 注册时写入所有已登记文档；window-open 时可把已有字体补进新窗口；
 *  2. 卸载时从所有文档移除，避免重复注册后 FontFace 残留。
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    addRegisteredFontsTo,
    registerFont,
    unregisterAllCustomFonts,
} from '../../../services/font-manager';
import { clearDocumentScopes, registerDocumentScope } from '../../../shared/document-scopes';

function makeFontSet() {
    const fonts = new Set<unknown>();
    return {
        fonts,
        api: {
            add: (font: unknown) => { fonts.add(font); },
            delete: (font: unknown) => fonts.delete(font),
        },
    };
}

function makePlugin() {
    return {
        app: { vault: { readBinary: async () => new ArrayBuffer(8) } },
        settings: { customFonts: [] as Array<{ family: string; path: string }> },
        saveSettings: async () => undefined,
    };
}

afterEach(() => {
    unregisterAllCustomFonts();
    clearDocumentScopes();
    vi.unstubAllGlobals();
});

describe('font-manager — popout 文档字体', () => {
    it('注册写入主窗口，addRegisteredFontsTo 补进 popout 并可从两边卸载', async () => {
        class FakeFontFace {
            constructor(public family: string, public source: unknown) {}
            async load() { return this; }
        }
        vi.stubGlobal('FontFace', FakeFontFace);

        const main = makeFontSet();
        const popup = makeFontSet();
        vi.stubGlobal('document', { fonts: main.api });

        const plugin = makePlugin();
        const family = await registerFont(
            plugin as never,
            { name: '测试字体.ttf', path: '元文件/字体/测试字体.ttf' } as never,
        );

        expect(family).toBe('测试字体');
        expect(main.fonts.size).toBe(1);

        // window-open：先登记窗口，再把已有字体补进 popout
        // （同一个 FontFace 可加入多个 FontFaceSet）
        const popupDoc = { fonts: popup.api } as unknown as Document;
        registerDocumentScope(popupDoc);
        expect(addRegisteredFontsTo(popupDoc)).toBe(1);
        expect(popup.fonts.size).toBe(1);
        expect(addRegisteredFontsTo(null)).toBe(0);

        unregisterAllCustomFonts();
        expect(main.fonts.size).toBe(0);
        expect(popup.fonts.size).toBe(0);
    });

    it('注册时已登记的 popout 直接获得字体（启动后打开窗口前）', async () => {
        class FakeFontFace {
            constructor(public family: string, public source: unknown) {}
            async load() { return this; }
        }
        vi.stubGlobal('FontFace', FakeFontFace);

        const main = makeFontSet();
        const popup = makeFontSet();
        vi.stubGlobal('document', { fonts: main.api });
        registerDocumentScope({ fonts: popup.api } as unknown as Document);

        await registerFont(
            makePlugin() as never,
            { name: 'A.woff2', path: '元文件/字体/A.woff2' } as never,
        );

        expect(main.fonts.size).toBe(1);
        expect(popup.fonts.size).toBe(1);
    });
});
