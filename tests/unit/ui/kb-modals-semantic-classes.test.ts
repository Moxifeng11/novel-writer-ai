/**
 * Slice G：知识库管理弹窗语义类契约（2026-11-17）
 *
 * `ui/views/knowledge-base-modals.ts` 里四个弹窗（导入 / 编辑书籍 / 题材编辑 / 批量操作）
 * 原本靠工具类串 + 内联 style 拼装视觉。这类写法有两个老问题：
 *
 * 1. 工具类串一旦有拼写错误就静默失效（历史上 `nw-text-muted-11` 从未定义过，
 *    作者一直按继承的 15px 正文色显示，肉眼看不出「没生效」）；
 * 2. 内联 style 会压过 CSS，:hover / 选中态无法接管。
 *
 * 语义化之后，类名与样式源是两份文件，容易再次漂移（改名只改 TS、样式没加）。
 * 本文件用静态断言守住四条契约，成本极低但能挡住这类静默失效。
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const root = path.resolve(__dirname, '../../..');

function read(rel: string): string {
    return fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');
}

const MODALS = read('ui/views/knowledge-base-modals.ts');
const KB_CSS = read('styles-src/27-knowledge-base.css');

describe('Slice G：知识库弹窗语义类', () => {
    it('不再引用工具类 / 死类', () => {
        const utility = [...MODALS.matchAll(/nw-u-[a-z0-9-]+/g)].map(m => m[0]);
        expect(utility).toEqual([]);
        expect(MODALS).not.toContain('nw-text-muted-11');
        expect(MODALS).not.toContain('nw-flex-center');
        expect(MODALS).not.toContain('nw-hover-border');
    });

    it('内联 style 只剩隐藏 file input 的功能性一处', () => {
        // `style: '风格'` 是权重数据的字段值，不是 CSS 声明；用「含 : 或 ;」区分
        const inline = [...MODALS.matchAll(/style:\s*'([^']*)'/g)]
            .map(m => m[1])
            .filter(value => /[:;]/.test(value));
        expect(inline).toEqual(['display:none;']);
    });

    it('四个主弹窗标题都挂 nw-modal-title（窄弹窗文件选择器除外）', () => {
        const titles = [...MODALS.matchAll(/createEl\('h3',\s*\{([^}]*)\}/g)].map(m => ({
            text: /text:\s*'([^']*)'/.exec(m[1])?.[1] ?? '',
            cls: /cls:\s*'([^']*)'/.exec(m[1])?.[1] ?? '',
        }));
        const withTitle = titles.filter(t => t.cls.split(/\s+/).includes('nw-modal-title'));
        expect(withTitle).toHaveLength(4);
        // 剩下的裸 h3 只应是窄弹窗「选择文件」——它保留浏览器默认间距，与主弹窗标题节奏不同
        expect(titles.filter(t => !t.cls).map(t => t.text)).toEqual(['选择文件']);
    });

    it('TS 用到的每个 nw-kb-modal-* 类都在样式源里有定义', () => {
        const used = [...new Set([...MODALS.matchAll(/nw-kb-modal-[a-z0-9-]+/g)].map(m => m[0]))];
        expect(used.length).toBeGreaterThanOrEqual(70);
        const missing = used.filter(cls => !new RegExp('\\.' + cls + '(?![a-z0-9-])').test(KB_CSS));
        expect(missing).toEqual([]);
    });
});
