/**
 * 移动端触屏可用性回归（M3-6）。
 *
 * 三处缺陷：
 * 1. 浮窗拖拽没有 touch-action / pointercancel → 手机上拖不动，或手势被打断后
 *    isDragging 永远为 true；
 * 2. 390px 屏默认布局按 960 宽计算 → 面板大半在屏外，且恢复布局只夹左/上边界；
 * 3. 知识卡操作按钮只在 :hover 显示 → 触屏永远点不到。
 */

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { DraggablePanel } from '../../../ui/draggable-panel';

interface FakeStyle {
    values: Map<string, string>;
    setProperty: (name: string, value: string) => void;
}

interface FakePanel {
    style: FakeStyle;
    addClass: () => void;
    removeClass: () => void;
    getBoundingClientRect: () => { left: number; top: number; width: number; height: number };
}

function makeStyle(): FakeStyle {
    const values = new Map<string, string>();
    return { values, setProperty: (name, value) => values.set(name, value) };
}

function makePanel(rect = { left: 900, top: 900, width: 900, height: 900 }): FakePanel {
    return {
        style: makeStyle(),
        addClass: () => undefined,
        removeClass: () => undefined,
        getBoundingClientRect: () => rect,
    };
}

function makePanelInstance(panelId: string, panel: FakePanel, viewport = { innerWidth: 390, innerHeight: 844 }) {
    const instance = Object.create(DraggablePanel.prototype) as Record<string, unknown>;
    instance.panelId = panelId;
    instance.panelContainer = panel;
    instance.containerEl = { win: viewport } as unknown as HTMLElement;
    return instance as unknown as {
        createDefaultLayoutEntry: () => { position: { x: number; y: number }; size: { width: number; height: number } };
        applyLayoutEntry: (entry: unknown) => void;
    };
}

describe('浮窗布局 — 390px 视口不越界', () => {
    it('默认布局的宽度与 x 不超出视口', () => {
        const instance = makePanelInstance('monitor-a', makePanel());
        const entry = instance.createDefaultLayoutEntry();

        expect(entry.size.width).toBeLessThanOrEqual(390 - 16);
        expect(entry.position.x + entry.size.width).toBeLessThanOrEqual(390 - 8);
        expect(entry.position.y).toBeGreaterThanOrEqual(48);
    });

    it('恢复旧布局时把位置与尺寸夹回视口', () => {
        const panel = makePanel();
        const instance = makePanelInstance('writing', panel);
        instance.applyLayoutEntry({
            id: 'writing',
            position: { x: 900, y: 900 },
            size: { width: 900, height: 900 },
            collapsed: false,
        });

        const left = parseFloat(panel.style.values.get('left') || 'NaN');
        const top = parseFloat(panel.style.values.get('top') || 'NaN');
        const width = parseFloat(panel.style.values.get('width') || 'NaN');
        const height = parseFloat(panel.style.values.get('height') || 'NaN');

        expect(width).toBeLessThanOrEqual(390 - 16);
        expect(left + width).toBeLessThanOrEqual(390 - 8);
        expect(height).toBeLessThanOrEqual(844 - 48);
        expect(top).toBeLessThanOrEqual(844 - 80);
    });
});

describe('触屏接线契约', () => {
    const root = path.resolve(__dirname, '../../..');
    const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

    it('浮窗监听 pointercancel，header 声明 touch-action: none', () => {
        const src = read('ui/draggable-panel.ts');
        expect(src).toContain('"pointercancel"');

        const css = read('styles-src/05-floating-panels-and-settings.css');
        const headerBlock = css.slice(css.indexOf('.nw-float-header {'), css.indexOf('.nw-float-header-icon'));
        expect(headerBlock).toContain('touch-action: none');
    });

    it('知识卡操作在无 hover 设备常显，并支持键盘聚焦', () => {
        const css = read('styles-src/26-cleanup-utilities.css');
        expect(css).toContain('@media (hover: none)');
        expect(css).toContain('.nw-kb-book-card:focus-within .nw-kb-card-actions');
        const touchBlock = css.slice(css.indexOf('@media (hover: none)'));
        expect(touchBlock).toContain('.nw-kb-book-card .nw-kb-card-actions');
    });
});
