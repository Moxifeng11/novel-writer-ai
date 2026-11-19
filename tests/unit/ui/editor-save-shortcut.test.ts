import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SAVE_FEEDBACK_MS } from '@/shared/interaction-timing';

function read(relative: string): string {
    return readFileSync(resolve(process.cwd(), relative), 'utf8');
}

/**
 * Ctrl+S 三处行为统一（审计 A-2 / C 清单 #5）。
 *
 * 旧状：协同视图「推快照 + 保存」、单元写作台「保存 + 1.5s 提示」、
 * 提示时长 3000 / 1500 两套，且快捷键只绑在正文编辑器元素上 ——
 * 焦点落到工具条按钮时就落回 Obsidian，而 tooltip 承诺的却是「保存正文」。
 */
describe('Ctrl+S 保存行为统一', () => {
    it('保存反馈时长是单一常量 1500ms', () => {
        expect(SAVE_FEEDBACK_MS).toBe(1500);
    });

    it('两个视图都走 common.bodySaved + SAVE_FEEDBACK_MS', () => {
        const view = read('ui/co-writing-view.ts');
        const unit = read('ui/full-writer/unit-writer-controller.ts');
        const controller = read('ui/cowrite/body-save-controller.ts');

        // 提示文案与时长的唯一出口在保存管线里
        expect(controller).toContain("t('common.bodySaved')");
        expect(controller).toContain('SAVE_FEEDBACK_MS');
        expect(controller).not.toContain('cowrite.save.savedNotice');

        // 单元写作台的成功提示同口径
        expect(unit).toContain("t('common.bodySaved')");
        expect(unit).toContain('SAVE_FEEDBACK_MS');
        expect(unit).not.toContain('showSuccessNotice(t(\'fullwriter.uw.savedNotice\')');
    });

    it('快捷键绑在容器层，焦点不在编辑器时也能保存', () => {
        const view = read('ui/co-writing-view.ts');
        const unit = read('ui/full-writer/unit-writer-controller.ts');

        // 协同视图：编辑器层之外再挂一层容器兜底
        expect(view).toContain("this.contentEl.addEventListener(\"keydown\"");
        expect(view).toContain('handleViewSaveShortcut');
        // 容器兜底不重复处理编辑器内的按键
        expect(view).toContain('if (event.target === this.rightEditor) return;');

        // 单元写作台：键在容器上而不是 textarea 上
        expect(unit).toContain("main.addEventListener('keydown'");
        expect(unit).not.toContain("this.editorEl.addEventListener('keydown'");
    });

    it('协同视图的撤销快照语义保留（与单元写作台的差异是设计决定）', () => {
        const view = read('ui/co-writing-view.ts');
        expect(view).toContain('private async saveFromShortcut(): Promise<void> {');
        expect(view).toContain('this.pushHistorySnapshot(true);');
    });
});
