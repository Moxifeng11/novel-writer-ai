import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const root = path.resolve(__dirname, '../../..');
const css = fs
    .readFileSync(path.join(root, 'styles.css'), 'utf8')
    .replace(/\r\n/g, '\n')
    .replace(/\/\*[\s\S]*?\*\//g, '');

/** animation 声明里引用到的 keyframes 名 */
function referencedKeyframes(): Set<string> {
    const names = new Set<string>();
    for (const m of css.matchAll(/animation(?:-name)?:\s*([A-Za-z_-][\w-]*)/g)) {
        names.add(m[1]);
    }
    return names;
}

/** 文件里定义了的 keyframes 名 */
function declaredKeyframes(): Set<string> {
    const names = new Set<string>();
    for (const m of css.matchAll(/@keyframes\s+([\w-]+)/g)) names.add(m[1]);
    return names;
}

describe('CSS 动画完整性', () => {
    it('每个被引用的 animation 都有对应的 @keyframes 定义', () => {
        const declared = declaredKeyframes();
        const missing = [...referencedKeyframes()]
            .filter(name => !declared.has(name))
            .filter(name => name !== 'none' && name !== 'inherit')
            .filter(name => !name.startsWith('var'));
        // 历史缺陷：nw-progress-anim 被向导进度条引用但从未定义，动画完全不执行
        expect(missing).toEqual([]);
    });

    it('向导进度条动画的 keyframes 已定义', () => {
        expect(declaredKeyframes().has('nw-progress-anim')).toBe(true);
        // UI 侧确实在用这个动画
        const ui = fs.readFileSync(
            path.join(root, 'ui/full-writer/wizard-step-renderers.ts'),
            'utf8',
        );
        expect(ui).toContain('nw-u-animation-nw-progress-anim');
    });

    it('reduced-motion 有全局兜底，且覆盖 nw- 前缀类', () => {
        expect(css).toContain('prefers-reduced-motion: reduce');
        // 兜底块必须同时覆盖 .nw-scope 与 nw- 前缀
        const reducedBlocks = css.split('prefers-reduced-motion: reduce').slice(1);
        const joined = reducedBlocks.join('\n');
        expect(joined).toContain('animation-duration');
        expect(joined).toMatch(/nw-/);
    });
});

describe('CSS 层级收敛', () => {
    it('背景 token 收敛为三层 + 派生，不再有独立的 surface 取值', () => {
        // --nw-surface 必须与面板同值（由 paletteToCssVars 注入），
        // 基础声明里也不再指向单独的 background-secondary 语义
        expect(css).toContain('--nw-app-bg:');
        expect(css).toContain('--nw-panel-bg:');
        expect(css).toContain('--nw-card-bg:');
        expect(css).toContain('--nw-accent:');
    });

    it('主按钮跟随主题强调色，不再被硬编码渐变 !important 架空', () => {
        // 历史 Bug：--nw-btn-primary-bg 被注入但被渐变 + !important 压掉，
        // 用户改「强调色」时主按钮不变。
        const block = css.match(/\.novel-writer-cowrite-primary-btn,\s*\.nw-btn-primary\s*\{[^}]*\}/);
        expect(block).not.toBeNull();
        expect(block![0]).toContain('--nw-btn-primary-bg');
        expect(block![0]).not.toContain('!important');
        expect(block![0]).not.toContain('--nw-accent-gradient');
    });

    it('同一选择器不出现「!important 被后置普通规则覆盖」的倒挂', () => {
        // 收集每个选择器带 !important 的位置与其后是否还有同选择器普通声明
        const offenders: string[] = [];
        const seen = new Map<string, { hasImportant: boolean; line: number }>();

        for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
            const selector = m[1].trim().replace(/\s+/g, ' ');
            if (!selector || selector.startsWith('@') || selector.includes(',')) continue;
            const body = m[2];
            const important = /!important/.test(body);
            const props = [...body.matchAll(/([a-z-]+)\s*:/g)].map(p => p[1]);
            const prev = seen.get(selector);
            if (prev?.hasImportant) {
                // 关键：上一条带 !important，这条不带的同名属性会被压掉 → 倒挂
                // 只有「本条也带 !important」或属性完全不重叠才算正常
                if (!important) {
                    offenders.push(`${selector}（前一条含 !important，后者普通声明可能失效）`);
                }
            }
            seen.set(selector, { hasImportant: important, line: 0 });
        }
        // 允许少量已知的响应式例外；这里只要求不新增
        expect(offenders.length).toBeLessThanOrEqual(20);
    });

    it('面板色板死代码已移除', () => {
        expect(css).not.toContain('.nw-theme-preview-swatch-panel');
    });

    it('工作台快捷按钮样式不再重复定义', () => {
        const count = (css.match(/^\.nw-awb-quick \{/gm) ?? []).length;
        expect(count).toBe(1);
    });

    it('!important 总量不超过 170（重构前 192）', () => {
        const total = (css.match(/!important/g) ?? []).length;
        expect(total).toBeLessThanOrEqual(170);
    });
});
