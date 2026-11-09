import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * 指纹强度弹窗静态样式收口（4.81.0 社区审核 `no-static-styles-assignment`）。
 *
 * 预览区块曾有 `attr: { style }` 与 `setAttribute('style', ...)` 两处内联样式；
 * 现统一由 `.nw-intensity-preview*` 类承载。这里钉住源码不再回流。
 */

const REPO_ROOT = path.resolve(__dirname, '../../..');
const SOURCE = fs.readFileSync(
    path.join(REPO_ROOT, 'ui/fingerprint-intensity-modal.ts'),
    'utf8',
);
const CSS = fs.readFileSync(
    path.join(REPO_ROOT, 'styles-src/26-cleanup-utilities.css'),
    'utf8',
);

describe('fingerprint-intensity-modal 预览样式', () => {
    it('不再使用 setAttribute("style") 直接写内联样式', () => {
        expect(SOURCE).not.toMatch(/setAttribute\(\s*['"]style['"]/);
    });

    it('预览区块不再用 attr.style 承载布局', () => {
        const previewStart = SOURCE.indexOf('private renderPreview');
        const previewEnd = SOURCE.indexOf('private computePreview');
        expect(previewStart).toBeGreaterThan(-1);
        expect(previewEnd).toBeGreaterThan(previewStart);
        expect(SOURCE.slice(previewStart, previewEnd)).not.toMatch(/attr:\s*\{\s*style:/);
    });

    it('预览结构走语义类，且样式类有定义', () => {
        for (const cls of [
            'nw-intensity-preview',
            'nw-intensity-preview-title',
            'nw-intensity-preview-grid',
            'nw-intensity-preview-row',
            'nw-intensity-preview-label',
            'nw-intensity-preview-value',
            'nw-intensity-preview-warning',
        ]) {
            expect(SOURCE).toContain(cls);
            expect(CSS).toContain(`.${cls}`);
        }
    });

    it('更新预览复用 fillPreview，不再手工替换节点', () => {
        expect(SOURCE).toContain('this.fillPreview(section);');
        expect(SOURCE).not.toContain('parent.replaceChild(newEl, oldEl)');
    });
});
