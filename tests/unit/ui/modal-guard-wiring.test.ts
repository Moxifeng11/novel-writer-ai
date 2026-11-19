/**
 * ModalDirtyGuard 接线不变量（ZC-20261120-27 回归）。
 *
 * 组件本身的行为由 modal-dirty-guard.test.ts 覆盖；这里锁的是**接线**——
 * 组件写对了但没接上（或接了却漏了 markClean），用户侧问题依旧存在：
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
