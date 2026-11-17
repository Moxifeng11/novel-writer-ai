/**
 * 章节大纲树弹窗的类名契约（Slice O）
 *
 * 该弹窗原先 177 处 nw-u-* 工具类 + 2 处内联样式；现在统一收敛到
 * styles-src/34-outline-tree.css 的 nw-ot-* 语义类（作用域 .nw-scope）。
 * 两条硬约束：
 *  1. 按钮规则必须带 button. 前缀 —— Obsidian 的 .modal button（0,1,1）
 *     会压掉单类规则（保存键曾因此退回白底黑字）；
 *  2. 不许再用 attr: { cls: ... } —— Obsidian 只写同名属性，不落 class
 *     （标签/拖拽手柄的样式因此长期是死 CSS）。
 */
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const root = path.resolve(__dirname, '../../..');
const modalSource = fs.readFileSync(path.join(root, 'ui/chapter-outline-tree-modal.ts'), 'utf8');
const cssSource = fs.readFileSync(path.join(root, 'styles-src/34-outline-tree.css'), 'utf8');
const planningCss = fs.readFileSync(path.join(root, 'styles-src/25-planning-outline-controls.css'), 'utf8');

describe('章节大纲树弹窗类名', () => {
    it('不再引用任何 nw-u-* 工具类', () => {
        expect(modalSource).not.toMatch(/nw-u-[a-z0-9-]+/);
    });

    it('不再写内联 style', () => {
        expect(modalSource).not.toContain('style:');
        expect(modalSource).not.toContain('attr: { style');
    });

    it('不再把 cls 塞进 attr（否则 class 不会落盘）', () => {
        expect(modalSource).not.toMatch(/attr:\s*\{\s*cls:/);
    });

    it('行状态走 -- 修饰类，显隐走 nw-is-hidden', () => {
        expect(modalSource).toContain('nw-ot-chap-row--target');
        expect(modalSource).toContain('nw-ot-chap-row--dragging');
        expect(modalSource).toContain("addClass('nw-is-hidden')");
        expect(modalSource).toContain("removeClass('nw-is-hidden')");
        expect(cssSource).toContain('.nw-scope .nw-is-hidden');
    });

    it('按钮规则带 button. 前缀，样式集中在 34 号文件', () => {
        expect(cssSource).toContain('button.nw-ot-save');
        expect(cssSource).toContain('button.nw-ot-footer-btn');
        expect(cssSource).toContain('button.nw-ot-search-go');
        expect(cssSource).toContain('.nw-scope .nw-ot-chap-row');
        expect(cssSource).toContain('.nw-scope .nw-ot-scene-label');
        expect(planningCss).not.toContain('.nw-outline-footer-btn');
        expect(planningCss).not.toContain('.nw-outline-edit-input');
    });
});
