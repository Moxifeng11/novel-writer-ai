/**
 * 窄面板三栏折单列（G5-5）
 *
 * 历史状态：
 *  - 写作工作台只有窗口级 @media（≤1100px，在 04-workspace-layers.css）；
 *    面板被拖进侧栏/分屏（窗口仍宽、容器很窄）时没有任何规则，
 *    中栏被 min-width 撑破、上下文栏被 overflow:hidden 裁掉。
 *    同时 02 的注释把这条媒体查询写成「见下方」，同文件里并不存在。
 *  - Agent 工作台只有 @media 直接隐藏左右栏，窄面板下功能直接消失。
 *
 * 这里把不能退化的约定钉在构建产物上：
 *  1. 两个工作台的容器查询挂在正确节点上（并在命名容器内）
 *  2. 容器变窄时三栏改纵向、整体可滚动（写作 ≤760px，Agent ≤980px）
 *  3. 左右栏限高 + 各自滚动，而不是被媒体查询藏掉
 *  4. 单列下隐藏横向拖拽抓手
 */
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const root = path.resolve(__dirname, '../../..');
const css = fs
    .readFileSync(path.join(root, 'styles.css'), 'utf8')
    .replace(/\r\n/g, '\n');

/** 取出从 selector 起始到配对右花括号之间的整段块体 */
function blockBody(source: string, blockStart: number): string {
    const open = source.indexOf('{', blockStart);
    if (open < 0) return '';
    let depth = 0;
    for (let i = open; i < source.length; i++) {
        if (source[i] === '{') depth++;
        else if (source[i] === '}') {
            depth--;
            if (depth === 0) return source.slice(open + 1, i);
        }
    }
    return '';
}

function containerBlock(name: string, maxWidth: number): { index: number; body: string } {
    const marker = `@container ${name} (max-width: ${maxWidth}px)`;
    const index = css.indexOf(marker);
    return { index, body: index < 0 ? '' : blockBody(css, index) };
}

/** 从块体里取出某个选择器的声明（只取一层，够用） */
function ruleIn(body: string, selector: string): string {
    const index = body.indexOf(selector);
    if (index < 0) return '';
    const open = body.indexOf('{', index);
    const close = body.indexOf('}', open);
    return open < 0 || close < 0 ? '' : body.slice(open, close);
}

/** 该选择器所有规则块体（同一类名常有多条规则，取包含目标声明的那条） */
function bodiesOf(source: string, selector: string): string[] {
    const bodies: string[] = [];
    let from = 0;
    while (true) {
        const index = source.indexOf(selector, from);
        if (index < 0) break;
        const after = source.slice(index + selector.length);
        if (!/^\s*\{/.test(after)) {
            from = index + selector.length;
            continue;
        }
        bodies.push(blockBody(source, index));
        from = index + selector.length;
    }
    return bodies;
}

function hasDecl(source: string, selector: string, decl: string): boolean {
    return bodiesOf(source, selector).some(body => body.includes(decl));
}

describe('命名容器声明', () => {
    it('写作工作台由 layout-host 承担 nw-fw 容器', () => {
        expect(hasDecl(css, '.novel-writer-fw-layout-host', 'container-name: nw-fw')).toBe(true);
        expect(hasDecl(css, '.novel-writer-fw-layout-host', 'container-type: inline-size')).toBe(true);
        // layout-host 必须自己撑满剩余高度，否则 workspace 的 height:100% 失去参照
        expect(hasDecl(css, '.novel-writer-fw-layout-host', 'flex: 1')).toBe(true);
        expect(hasDecl(css, '.novel-writer-fw-layout-host', 'min-height: 0')).toBe(true);
    });

    it('容器不挂在 .novel-writer-fw-container 上', () => {
        // 该容器内有 position:fixed 的执行日志；layout containment 会改它的包含块
        // 并被容器 overflow:hidden 裁掉
        expect(hasDecl(css, '.novel-writer-fw-container', 'container-type')).toBe(false);
        expect(hasDecl(css, '.novel-writer-fw-container', 'container-name')).toBe(false);
    });

    it('Agent 工作台根节点是 nw-awb 容器', () => {
        expect(hasDecl(css, '.nw-awb', 'container-name: nw-awb')).toBe(true);
        expect(hasDecl(css, '.nw-awb', 'container-type: inline-size')).toBe(true);
    });
});

describe('写作工作台 ≤760px 折单列', () => {
    const block = containerBlock('nw-fw', 760);

    it('容器查询存在', () => {
        expect(block.index).toBeGreaterThan(-1);
    });

    it('三栏容器改纵向且可滚动', () => {
        const rule = ruleIn(block.body, '.novel-writer-fw-workspace');
        expect(rule).toContain('flex-direction: column');
        expect(rule).toContain('overflow-y: auto');
    });

    it('左右两栏取消固定宽度并限高', () => {
        const nav = ruleIn(block.body, '.novel-writer-fw-step-nav');
        expect(nav).toContain('width: auto');
        expect(nav).toContain('max-height');

        const context = ruleIn(block.body, '.novel-writer-fw-context-panel');
        expect(context).toContain('width: auto');
        expect(context).toContain('max-height');
        // 单列时左右分隔线要换成上下分隔线
        expect(context).toContain('border-top');
    });

    it('中栏解除 280px 最小宽度，否则窄面板仍会横向溢出', () => {
        expect(ruleIn(block.body, '.novel-writer-fw-prompt-area')).toContain('min-width: 0');
    });

    it('横向拖拽抓手在单列下隐藏', () => {
        expect(block.body).toContain('.nw-fw-resizer');
        expect(ruleIn(block.body, '.nw-fw-resizer')).toContain('display: none');
    });
});

describe('Agent 工作台 ≤980px 折单列', () => {
    const block = containerBlock('nw-awb', 980);

    it('容器查询存在', () => {
        expect(block.index).toBeGreaterThan(-1);
    });

    it('三栏容器改纵向且可滚动', () => {
        const rule = ruleIn(block.body, '.nw-awb-layout');
        expect(rule).toContain('flex-direction: column');
        expect(rule).toContain('overflow-y: auto');
    });

    it('左右栏恢复显示（媒体查询会隐藏它们）并限高', () => {
        const left = ruleIn(block.body, '.nw-awb-left');
        expect(left).toContain('display: flex');
        expect(left).toContain('max-height');

        const right = ruleIn(block.body, '.nw-awb-right');
        expect(right).toContain('display: flex');
        expect(right).toContain('max-height');
    });

    it('容器查询必须晚于隐藏左右栏的媒体查询，否则后置的 display:none 会赢', () => {
        expect(block.index).toBeGreaterThan(css.indexOf('@media (max-width: 820px)'));
        expect(block.index).toBeGreaterThan(css.indexOf('@media (max-width: 900px)'));
    });

    it('中栏解除 min-width 并给足高度', () => {
        const center = ruleIn(block.body, '.nw-awb-center');
        expect(center).toContain('min-width: 0');
        expect(center).toContain('min-height');
    });
});

describe('注释与实现一致', () => {
    it('写作工作台注释同时指向窗口级媒体查询与面板级容器查询', () => {
        const source = fs.readFileSync(
            path.join(root, 'styles-src/02-full-writer-view.css'),
            'utf8',
        );
        // 历史缺陷：注释写「见下方媒体查询」，但同文件里并没有这条规则
        expect(source).not.toMatch(/见下方媒体查询/);
        expect(source).toContain('@container nw-fw');
        expect(source).toContain('04-workspace-layers.css');
    });

    it('视图代码里的响应式注释指向容器查询', () => {
        const source = fs.readFileSync(
            path.join(root, 'ui/full-writer-view.ts'),
            'utf8',
        );
        expect(source).not.toContain('@media(max-width:1100px)');
        expect(source).toContain('@container nw-fw');
    });

    it('写作工作台实际渲染出 layout-host 包装节点', () => {
        const source = fs.readFileSync(
            path.join(root, 'ui/full-writer-view.ts'),
            'utf8',
        );
        expect(source).toContain('novel-writer-fw-layout-host');
        // workspace 必须在 layout-host 之内，否则容器查询匹配不到
        expect(source).toMatch(
            /layoutHost\.createDiv\(\{\s*cls:\s*'novel-writer-fw-workspace'/,
        );
    });
});
