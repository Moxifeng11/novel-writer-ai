/**
 * 智能扩写弹窗的类名契约（Slice M）
 *
 * 该弹窗原先 220 处 nw-u-* 工具类 + 1 处内联样式（段落项，还带无效的 hover: 伪声明）。
 * 现统一收敛到 styles-src/25-outline-expand.css 的 nw-oe-* 语义类：
 * 布局类不得再回流到 TS，显示隐藏用 nw-is-hidden，状态用 -- 修饰类。
 */
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const root = path.resolve(__dirname, '../../..');
const modalSource = fs.readFileSync(path.join(root, 'ui/outline-expand-modal.ts'), 'utf8');
const cssSource = fs.readFileSync(path.join(root, 'styles-src/25-outline-expand.css'), 'utf8');
const planningCss = fs.readFileSync(path.join(root, 'styles-src/25-planning-outline-controls.css'), 'utf8');

describe('扩写弹窗类名', () => {
    it('不再引用任何 nw-u-* 工具类', () => {
        expect(modalSource).not.toMatch(/nw-u-[a-z0-9-]+/);
    });

    it('不再写内联 style', () => {
        expect(modalSource).not.toContain('style:');
        expect(modalSource).not.toContain('attr: { style');
    });

    it('场景项与段落项走语义类 + 修饰类', () => {
        expect(modalSource).toContain('nw-oe-scene-item');
        expect(modalSource).toContain('nw-oe-scene-item--active');
        expect(modalSource).toContain('nw-oe-scene-item--adopted');
        expect(modalSource).toContain('nw-oe-para-item');
        expect(modalSource).toContain('nw-oe-para-item--selected');
    });

    it('进度条用 nw-is-hidden 而不是 nw-u-d-none', () => {
        expect(modalSource).toContain("this.progressEl.addClass('nw-is-hidden')");
        expect(modalSource).toContain("this.progressEl.removeClass('nw-is-hidden')");
        expect(cssSource).toContain('.nw-oe-progress.nw-is-hidden');
    });

    it('样式集中在 25-outline-expand.css，旧的 nw-expand-* 前缀已迁走', () => {
        expect(cssSource).toContain('.nw-oe-header');
        expect(cssSource).toContain('.nw-oe-scene-item--adopted');
        expect(cssSource).toContain('.nw-oe-para-item--selected');
        expect(planningCss).not.toContain('.nw-expand-scene');
        expect(planningCss).not.toContain('.nw-expand-adopt');
    });
});
