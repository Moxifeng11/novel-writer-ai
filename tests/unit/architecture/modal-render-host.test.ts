import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Modal 渲染宿主约束（4.81.0 社区审核 `no-plugin-as-component`）。
 *
 * `Modal` 不是 `Component`，把 `this.plugin` 传给 `MarkdownRenderer.render`
 * 等于把弹窗的渲染生命周期挂到插件全局，既会被审核判错，也会在重复打开时
 * 累积子组件。这里钉住两个弹窗各自的 `renderHost`：onOpen load、onClose unload。
 */

const REPO_ROOT = path.resolve(__dirname, '../../..');
const TARGETS = [
    'ui/continue-chapters-modal.ts',
    'ui/unified-entity-manager-modal.ts',
];

function read(rel: string): string {
    return fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
}

describe.each(TARGETS)('%s', (rel) => {
    const source = read(rel);

    it('声明独立的 Component 渲染宿主', () => {
        expect(source).toContain('private renderHost = new Component();');
    });

    it('onOpen 加载、onClose 卸载，重复开关不累积', () => {
        expect(source).toContain('this.renderHost.load();');
        expect(source).toContain('this.renderHost.unload();');
        const openIndex = source.indexOf('onOpen(): void');
        const closeIndex = source.indexOf('onClose(): void');
        expect(openIndex).toBeGreaterThan(-1);
        expect(closeIndex).toBeGreaterThan(openIndex);
        expect(source.slice(openIndex, closeIndex)).toContain('this.renderHost.load();');
        expect(source.slice(closeIndex)).toContain('this.renderHost.unload();');
    });

    it('MarkdownRenderer.render 使用 renderHost，而不是插件实例', () => {
        const renderCalls = source.match(/MarkdownRenderer\.render\([\s\S]*?\);/g) ?? [];
        expect(renderCalls.length).toBeGreaterThan(0);
        for (const call of renderCalls) {
            expect(call).toContain('this.renderHost');
            expect(call).not.toContain('this.plugin');
        }
    });
});
