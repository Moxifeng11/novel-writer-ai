import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const root = path.resolve(__dirname, '../../..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
const css = read('styles.css').replace(/\r\n/g, '\n');

describe('统一拖拽原语', () => {
    it('panel-resizer 用 Pointer Events 而不是 mouse 事件', () => {
        const src = read('ui/panel-resizer.ts');
        expect(src).toContain('pointerdown');
        expect(src).toContain('setPointerCapture');
        // 不应再出现只支持鼠标的 mousedown 拖拽
        expect(src).not.toContain("addEventListener('mousedown'");
    });

    it('可键盘操作且声明了 separator 语义', () => {
        const src = read('ui/panel-resizer.ts');
        expect(src).toContain("role: 'separator'");
        expect(src).toContain('tabindex');
        expect(src).toContain('aria-orientation');
        // 方向键微调 + Home 复位
        expect(src).toContain('ArrowLeft');
        expect(src).toContain('ArrowRight');
        expect(src).toContain("'Home'");
    });

    it('尺寸写入 CSS 变量，而不是逐次改 inline style', () => {
        const src = read('ui/panel-resizer.ts');
        // 变量名由调用方指定（默认 --nw-panel-size），统一走 setProperty
        expect(src).toContain('setProperty(cssVar');
        expect(src).toContain("cssVar = '--nw-panel-size'");
        // 不再直接写 style.width
        expect(src).not.toMatch(/\.style\.width\s*=/);
    });

    it('双击恢复默认值', () => {
        const src = read('ui/panel-resizer.ts');
        expect(src).toContain('dblclick');
        expect(src).toContain('defaultValue');
    });

    it('Agent 工作台改用统一原语并在关闭时释放监听', () => {
        const src = read('ui/agent-workbench-view.ts');
        expect(src).toContain('createPanelResizer');
        expect(src).toContain('destroyLayoutResizers');
        // onClose 必须释放，否则视图关闭后仍持有 DOM
        expect(src).toMatch(/onClose\(\)[\s\S]{0,120}destroyLayoutResizers/);
        // 旧的 mousedown 手写实现应已移除
        expect(src).not.toContain("addEventListener('mousemove', onMove)");
    });
});

describe('面板尺寸可调', () => {
    it('settings 声明了 panelSizes 且工作台宽度仍在', () => {
        const main = read('main.ts');
        expect(main).toContain('panelSizes?:');
        expect(main).toContain('fwStepNav?: number');
        expect(main).toContain('fwRightPanel?: number');
        expect(main).toContain('agentWorkbenchLeftWidth?: number');
    });

    it('工作台三栏宽度由 panelSizes 驱动，不再两处各写一套', () => {
        const theme = read('core/theme-manager.ts');
        const view = read('ui/full-writer-view.ts');
        // 三栏已改 flex，宽度由两个面板变量驱动（可拖拽）
        expect(theme).toContain('--nw-panel-nav');
        expect(theme).toContain('--nw-panel-context');
        expect(theme).toContain('fwStepNav');
        // 任何地方都不应再注入 grid 模板（会与 flex 冲突）
        expect(theme).not.toMatch(/setProperty\('--nw-grid-workspace'/);
        expect(view).not.toMatch(/setProperty\('--nw-grid-workspace'/);
    });

    it('设置页提供面板尺寸数字输入与恢复默认', () => {
        const src = read('ui/settings/writing-sections.ts');
        expect(src).toContain('renderPanelSizeRows');
        expect(src).toContain('写作工作台 · 左栏');
        expect(src).toContain('写作工作台 · 右栏');
        expect(src).toContain('恢复全部面板尺寸');
    });

    it('可拖面板用 --nw-panel-size 作为唯一宽度来源', () => {
        expect(css).toContain('width: var(--nw-panel-size, 230px)');
        expect(css).toContain('width: var(--nw-panel-size, 430px)');
        expect(css).toContain('.nw-awb-panel-resizable');
    });
});

describe('动效统一（zcode 手感）', () => {
    it('三档时长 + 统一缓动 token 存在', () => {
        expect(css).toContain('--nw-dur-fast: 120ms');
        expect(css).toContain('--nw-dur-base: 180ms');
        expect(css).toContain('--nw-dur-slow: 240ms');
        expect(css).toContain('--nw-ease: cubic-bezier(0.2, 0.7, 0.3, 1)');
    });

    it('不再有 transition: all（会连布局属性一起补间，拖拽时抖动）', () => {
        expect(css).not.toContain('transition: all');
    });

    it('入场动效不超过 300ms（描线与常驻循环除外）', () => {
        // 收集所有「一次性」animation 声明的裸时长。
        // infinite 循环的周期本来就长（进度条 1.2s、打字点 1.2s），
        // 那衡量的是节奏而不是响应速度，不在此约束内。
        const offenders: string[] = [];
        for (const m of css.matchAll(/animation:\s*([\w-]+)\s+([^;]+);/g)) {
            const [, name, timing] = m;
            if (name === 'nw-draw') continue;      // 描线需要更长
            if (timing.includes('infinite')) continue; // 常驻循环，另测
            const seconds = timing.match(/([\d.]+)s\b/);
            if (!seconds) continue;
            if (Number(seconds[1]) > 0.3) offenders.push(`${name}: ${seconds[1]}s`);
        }
        expect(offenders).toEqual([]);
    });

    it('常驻 infinite 动画只保留必要的几个', () => {
        const infinite = [...css.matchAll(/animation:\s*([\w-]+)[^;]*infinite/g)].map(m => m[1]);
        // 只允许：流式光标、进度条、打字点、计划脉冲、
        // 桌面宠物待机三件套（漂浮/摆尾/眨眼，宠物不动的观感接近「卡死」）
        const allowed = new Set([
            'nw-stream-blink',
            'nw-indeterminate',
            'nw-progress-anim',
            'nw-awb-dot-pulse',
            'nw-awb-plan-pulse',
            'nw-pet-float',
            'nw-pet-tail',
            'nw-pet-blink',
            'nw-pet-happy',
        ]);
        for (const name of infinite) {
            expect(allowed.has(name)).toBe(true);
        }
    });

    it('列表错峰入场与弹层浮起动效已定义并真正被引用', () => {
        expect(css).toContain('.nw-list-enter');
        expect(css).toContain('nw-item-enter');
        expect(css).toContain('nw-popover-in');
        expect(css).toMatch(/nw-list-enter:nth-child\(2\)/);
    });

    it('reduced-motion 覆盖拖拽态与毛玻璃', () => {
        expect(css).toContain('.nw-panel-resizer');
        const reduced = css.split('prefers-reduced-motion: reduce').slice(1).join('\n');
        expect(reduced).toContain('nw-panel-resizing');
        expect(reduced).toContain('backdrop-filter: none');
    });
});
