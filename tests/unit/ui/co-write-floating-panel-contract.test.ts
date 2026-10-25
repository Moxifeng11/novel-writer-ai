/**
 * CoWriteFloatingPanel 保存契约（源码级不变量）。
 *
 * 浮窗保存必须与主视图共用 BodyWriter 落盘入口：
 * - 走 BodyWriter 才能统一标题、按格式契约规整、保留 frontmatter；
 * - 必须携带完整章节身份（project/volume/chapterNum/chapterName）与 `writingMode: 'co-writer'`；
 * - 不得绕过 BodyWriter 直接 `vault.modify`。
 *
 * BodyWriter 自身的 frontmatter/标题/广播行为由 tests/unit/engine/body-writer.test.ts 覆盖；
 * 这里只锁定浮窗的调用形态，防止后续改动把统一入口换回旧路径。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SOURCE = readFileSync(resolve(process.cwd(), 'ui/co-write-floating-panel.ts'), 'utf8');

function stripComments(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

describe('CoWriteFloatingPanel — BodyWriter 保存契约', () => {
    it('保存走 BodyWriter 并携带完整身份与协同模式', () => {
        const source = stripComments(SOURCE);
        expect(source).toContain('new BodyWriter(');
        expect(source).toContain("writingMode: 'co-writer'");
        for (const field of [
            'chapterNum: this.chapterNum',
            'chapterName: this.chapterName',
            'volume: this.volume',
            'project: this.project',
        ]) {
            expect(source, `缺少保存身份字段 ${field}`).toContain(field);
        }
    });

    it('保存路径不得绕过 BodyWriter 直接 vault.modify', () => {
        const source = stripComments(SOURCE);
        expect(source).not.toContain('vault.modify(');
    });
});
