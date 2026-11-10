import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * M3-2（维度①三轮）：popout 第二窗口的样式/字体作用域接线。
 *
 * popout 有独立的 documentElement 与 FontFaceSet，主窗口注入的 --nw-* 变量
 * 与自定义字体不会跨窗口生效。约束：
 * 1. main.ts 监听 window-open/window-close，登记并补齐主题/布局/字体；
 * 2. ThemeManager 与 font-manager 都通过 shared/document-scopes 取文档列表，
 *    不得再写死全局 document.documentElement / document.fonts。
 */
const ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('popout 文档作用域接线', () => {
    it('main.ts 登记窗口并补齐主题/布局/字体，卸载时清空登记', () => {
        const main = read('main.ts');
        expect(main).toContain("this.app.workspace.on('window-open'");
        expect(main).toContain("this.app.workspace.on('window-close'");
        expect(main).toContain('registerDocumentScope(win.document)');
        expect(main).toContain('unregisterDocumentScope(win.document)');
        expect(main).toContain('addRegisteredFontsTo(win.document)');
        expect(main).toContain('clearDocumentScopes()');
    });

    it('ThemeManager 写入全部已登记文档，且不再直接写全局 documentElement', () => {
        const theme = read('core/theme-manager.ts');
        expect(theme).toContain("from '@/shared/document-scopes'");
        expect(theme).toContain('listDocumentScopes()');
        expect(theme).not.toContain('document.documentElement');
    });

    it('font-manager 注册/卸载覆盖全部已登记文档', () => {
        const font = read('services/font-manager.ts');
        expect(font).toContain("from '@/shared/document-scopes'");
        expect(font).toContain('listDocumentScopes()');
        expect(font).not.toContain('document.fonts.add');
        expect(font).not.toContain('document.fonts.delete');
    });
});
