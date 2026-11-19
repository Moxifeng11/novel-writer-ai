/**
 * 单元写作台撤销栈（C 清单 A-17 的回归护栏）
 *
 * 单元写作台原先只有 textarea 原生撤销：切单元 / 重开页签后历史丢失，
 * 误删一大段只能靠版本历史找回。这里改成与协同视图共用 shared/edit-history
 * 的「项目|单元」多栈，本测试守住接线不变量。
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const CONTROLLER = path.join(ROOT, 'ui/full-writer/unit-writer-controller.ts');

function read(rel: string): string {
    return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

describe('单元写作台撤销栈（A-17）', () => {
    it('撤销栈来自 shared/edit-history，ui/co-writing 下不再有该模块', () => {
        const controller = fs.readFileSync(CONTROLLER, 'utf8');
        expect(controller).toContain("from '@/shared/edit-history'");
        expect(controller).not.toContain('ui/co-writing/edit-history');
        expect(fs.existsSync(path.join(ROOT, 'shared/edit-history.ts'))).toBe(true);
        expect(fs.existsSync(path.join(ROOT, 'ui/co-writing/edit-history.ts'))).toBe(false);
    });

    it('撤销栈按「项目|单元」隔离', () => {
        const controller = fs.readFileSync(CONTROLLER, 'utf8');
        expect(controller).toContain('private unitHistoryKey(): string');
        expect(controller).toContain("return (this.ctx?.project ?? '') + '|' + (this.ctx?.unitNumber ?? 0);");
    });

    it('输入、失焦、AI 落笔都会提交快照', () => {
        const controller = fs.readFileSync(CONTROLLER, 'utf8');
        // 输入节流提交 + 失焦强制提交
        expect(controller).toMatch(/this\.scheduleSave\(\);\s*\r?\n\s*this\.pushHistorySnapshot\(\);/);
        expect(controller).toContain("this.editorEl.addEventListener('blur', () => this.pushHistorySnapshot(true));");
        // 程序化改写（AI 结果 / 一键排版）也要能撤销
        expect(controller).toMatch(/private setBody\(text: string\): void \{[\s\S]*?this\.pushHistorySnapshot\(true\);/);
        expect(controller).toMatch(/this\.editorEl\.value = originalBody;\s*\r?\n\s*this\.pushHistorySnapshot\(true\);/);
    });

    it('Ctrl+Z / Ctrl+Y 只在正文编辑器内接管，且落到自建栈', () => {
        const controller = fs.readFileSync(CONTROLLER, 'utf8');
        expect(controller).toContain('if (event.target === this.editorEl && (key === \'z\' || key === \'y\')) {');
        expect(controller).toMatch(/if \(key === 'y' \|\| event\.shiftKey\) this\.redoEdit\(\);/);
        expect(controller).toMatch(/else this\.undoEdit\(\);/);
    });

    it('撤销/重做按钮随栈状态启用，文案走 i18n', () => {
        const controller = fs.readFileSync(CONTROLLER, 'utf8');
        expect(controller).toContain("t('fullwriter.uw.undoBtn')");
        expect(controller).toContain("t('fullwriter.uw.redoBtn')");
        expect(controller).toContain('const state = canUndoRedo(history);');
        expect(controller).toContain('this.undoBtn.disabled = !state.canUndo;');
        expect(controller).toContain('this.redoBtn.disabled = !state.canRedo;');
    });

    it('撤销到底/无可重做时给出提示，不静默', () => {
        const controller = fs.readFileSync(CONTROLLER, 'utf8');
        expect(controller).toContain("showWarningNotice(t('cowrite.undoEarliest')");
        expect(controller).toContain("showWarningNotice(t('cowrite.redoEmpty')");
    });

    it('资源键双语齐备', () => {
        expect(read('i18n/messages/zh-CN.ts')).toContain("undoTip: '撤销（Ctrl+Z）',");
        expect(read('i18n/messages/en-US.ts')).toContain("undoTip: 'Undo (Ctrl+Z)',");
    });
});
