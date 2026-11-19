/**
 * ModalDirtyGuard 接线不变量（ZC-20261120-27 回归）。
 *
 * 组件本身的行为由 modal-dirty-guard.test.ts 覆盖；这里锁的是**接线**——
 * 组件写对了但没接上（或接了却漏了 markClean），用户侧问题依旧存在：
 * - 悬浮面板：输入必须真正排上自动保存（曾经 scheduleAutoSave 定义了但没人调用），
 *   状态展示必须走 saveStateLabel（曾经直接 setText('saved') 把枚举键显示给用户）；
 * - plan-book：生成成功已落盘，关闭前必须 markClean，否则成功后被问「丢弃修改」；
 * - add-fanfic：所有主动完成（草稿/绑定/生成）的关闭都要 markClean，且不许重复插桩。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function source(file: string): string {
    return readFileSync(resolve(process.cwd(), file), 'utf8');
}

function stripComments(src: string): string {
    return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

describe('悬浮面板自动保存接线', () => {
    const src = stripComments(source('ui/co-write-floating-panel.ts'));

    it('输入事件真的排上自动保存', () => {
        expect(src).toContain('this.scheduleAutoSave();');
        // 调用点必须在 input 监听里，而不是只定义不调用
        const inputListener = src.slice(src.indexOf('addEventListener("input"'));
        const end = inputListener.indexOf('});');
        expect(inputListener.slice(0, end)).toContain('this.scheduleAutoSave();');
    });

    it('自动保存用固定防抖键与 2000ms 节拍', () => {
        expect(src).toContain("const FLOATING_AUTOSAVE_KEY = 'floating-auto-save';");
        expect(src).toContain('const FLOATING_AUTOSAVE_DELAY = 2000;');
        expect(src).toContain('debounceFixed(FLOATING_AUTOSAVE_KEY');
        // saveBody 先取消待执行的自动保存，避免保存后又写一遍
        expect(src).toMatch(/async saveBody\(\)[^{]*\{\s*this\.autoSaveDebouncer\.cancel\(FLOATING_AUTOSAVE_KEY\);/);
    });

    it('状态展示走 saveStateLabel，不把枚举键直接显示', () => {
        expect(src).toMatch(/updateSaveState\(state: SaveState\)/);
        expect(src).toContain('saveStateLabel(state)');
        expect(src).not.toMatch(/setText\(state\)/);
        expect(src).toContain('isDirtySaveState(state)');
    });
});

describe('plan-book 成功关闭前解除脏标记', () => {
    it('生成成功写盘后先 markClean 再 close，再打开大纲树', () => {
        const src = stripComments(source('ui/plan-book-modal.ts'));
        expect(src).toMatch(/writeVolumeOutlines[\s\S]{0,1500}markClean\(\);\s*\n\s*this\.close\(\);\s*\n\s*new ChapterOutlineTreeModal/);
    });
});

describe('add-fanfic 关闭路径逐条 markClean', () => {
    const src = stripComments(source('ui/add-fanfic-setting-modal.ts'));
    const lines = src.split('\n');

    it('每个 this.close() 之前都有 markClean', () => {
        const closeLines = lines
            .map((text, index) => ({ text, index }))
            .filter((entry) => entry.text.includes('this.close();'));
        expect(closeLines.length).toBeGreaterThanOrEqual(4);
        for (const entry of closeLines) {
            const preceding = lines.slice(Math.max(0, entry.index - 4), entry.index).join('\n');
            expect(preceding, `第 ${entry.index + 1} 行的 close 缺少 markClean`).toContain('markClean();');
        }
    });

    it('没有重复插桩（曾经连插三次）', () => {
        expect(src).not.toMatch(/markClean\(\);\s*\n\s*markClean\(\);/);
    });
});
