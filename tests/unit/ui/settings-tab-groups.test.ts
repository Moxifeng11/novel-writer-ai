/**
 * settings-tab-groups.test.ts — 设置 6 分组一级 tab 的初屏渲染与切换（settings-tab-regroup-fix）
 *
 * 缺陷背景（dsh 派单）：31bda235 重构后用户在 Obsidian 打开设置页只看到
 * 「📖 设置 → 黑色空块 → 模型设置」——因为 renderBars 只挂在分组/tab 的 click
 * 回调里，初次 display() 时 groupBar/tabBar 是空 div，6 个一级分组 pill 与
 * 二级 tab 全部不出现。修复 = display() 末尾主动调用一次 renderBars()。
 *
 * 本文件用假 DOM 锁定四条行为：
 *   ① 初屏渲染 6 个一级分组 pill（连接与模型/写作与协同/规则与一致性/知识与拆解/界面与工作台/项目与运维）
 *   ② 初屏二级 tab 只渲染当前分组内「可见」tab（高级折叠时 agent 不出现）
 *   ③ 点击分组 pill 切换二级 tab（真实走 click 回调，非手动改内部状态）
 *   ④ 折叠高级设置时当前 tab 隐藏能回退到组内首个可见 tab（display 与点击两条路径）
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SETTINGS_GROUPS, SETTINGS_TAB_DEFINITIONS } from '../../../ui/settings/section-factory';
import { NovelWriterSettingTab } from '../../../ui/settings-tab';

// settings-tab.ts 顶层 import 了 @/main（会拉起整棵插件依赖树）与 sessionStorage
// 写入模块；本测试只验证外壳 DOM，两个都换成轻量替身。
vi.mock('@/main', () => ({
    default: class NovelWriterPluginStub {},
    DEFAULT_SETTINGS: {},
}));
vi.mock('@/shared/reload-state', () => ({ savePendingReloadState: vi.fn() }));

/** 假元素：覆盖 settings-tab.ts display()/renderActiveTab() 用到的全部 DOM 面 */
interface FakeEl {
    children: FakeEl[];
    className: string;
    textContent: string;
    attrs: Record<string, string>;
    handlers: Record<string, (ev?: unknown) => void>;
    classList: { add: (...cls: string[]) => void; contains: (cls: string) => boolean };
    addClass: (cls: string) => void;
    toggleClass: (cls: string, on: boolean) => void;
    getAttribute: (name: string) => string | null;
    setAttribute: (name: string, value: string) => void;
    addEventListener: (type: string, fn: (ev?: unknown) => void) => void;
    fire: (type: string) => void;
    appendChild: (child: FakeEl) => FakeEl;
    append: (...nodes: FakeEl[]) => void;
    empty: () => void;
    createDiv: (o?: { cls?: string; text?: string; attr?: Record<string, string> }) => FakeEl;
    createEl: (tag: string, o?: { cls?: string; text?: string; attr?: Record<string, string> }) => FakeEl;
    createSpan: (o?: { text?: string }) => FakeEl;
    querySelectorAll: (selector: string) => FakeEl[];
    remove: () => void;
}

/** 极简 document 替身：createElement 产出上述 FakeEl 形状 */
function stubDocument(): void {
    const factory = (): FakeEl => {
        const el: FakeEl = {
            children: [],
            className: '',
            textContent: '',
            attrs: {},
            handlers: {},
            classList: {
                add(...cls: string[]) {
                    const set = new Set(el.className.split(' ').filter(Boolean));
                    cls.forEach(c => set.add(c));
                    el.className = [...set].join(' ');
                },
                contains(cls: string) {
                    return el.className.split(' ').includes(cls);
                },
            },
            addClass(cls: string) { el.classList.add(cls); },
            toggleClass(cls: string, on: boolean) {
                const set = new Set(el.className.split(' ').filter(Boolean));
                if (on) set.add(cls); else set.delete(cls);
                el.className = [...set].join(' ');
            },
            getAttribute(name: string) { return el.attrs[name] ?? null; },
            setAttribute(name: string, value: string) { el.attrs[name] = value; },
            addEventListener(type: string, fn: (ev?: unknown) => void) { el.handlers[type] = fn; },
            fire(type: string) { el.handlers[type]?.(); },
            appendChild(child: FakeEl) { el.children.push(child); return child; },
            append(...nodes: FakeEl[]) { for (const n of nodes) el.children.push(n); },
            empty() { el.children = []; },
            createDiv(o) {
                const child = factory();
                if (o?.cls) child.className = o.cls;
                if (o?.text !== undefined) child.textContent = o.text;
                if (o?.attr) for (const [k, v] of Object.entries(o.attr)) child.setAttribute(k, v);
                el.children.push(child);
                return child;
            },
            createEl(tag, o) {
                const child = factory();
                child.setAttribute('tagName', tag);
                if (o?.cls) child.className = o.cls;
                if (o?.text !== undefined) child.textContent = o.text;
                if (o?.attr) for (const [k, v] of Object.entries(o.attr)) child.setAttribute(k, v);
                el.children.push(child);
                return child;
            },
            createSpan(o) {
                const child = factory();
                if (o?.text !== undefined) child.textContent = o.text;
                el.children.push(child);
                return child;
            },
            querySelectorAll(selector: string) {
                const cls = selector.replace(/^\./, '');
                const hits: FakeEl[] = [];
                const walk = (node: FakeEl): void => {
                    if (node.classList.contains(cls)) hits.push(node);
                    for (const c of node.children) walk(c);
                };
                walk(el);
                return hits;
            },
            remove() {},
        };
        return el;
    };
    vi.stubGlobal('document', { createElement: () => factory() });
}

function makeSettings(): NovelWriterSettingTab {
    const app = { workspace: { getLeavesOfType: vi.fn(() => []) } };
    const plugin = {
        settings: { settingsUiShowAdvanced: false },
        saveSettings: vi.fn(async () => {}),
        _pendingReloadState: undefined,
    };
    const settings = new NovelWriterSettingTab(app as never, plugin as never);
    // 分区实例替换为桩：本测试只关心外壳（分组栏/tab 栏）DOM，不深入 18 个分区渲染
    for (const key of [
        'api', 'knowledge', 'fingerprint', 'deconstruction', 'foreshadow', 'coWrite',
        'writing', 'modes', 'template', 'appearance', 'projectLibrary', 'layout',
        'performance', 'rules', 'about', 'recognition', 'suggestions', 'agentBackend',
    ]) {
        (settings as unknown as Record<string, unknown>)[key] = { render: vi.fn(), renderBanner: vi.fn() };
    }
    return settings;
}

/** tabBar 里实际带 data-tab-id 的 tab（排除「⚙ 高级设置」toggle——它也挂 nw-settings-tab 类） */
function visibleTabIds(settings: NovelWriterSettingTab): string[] {
    const tabBar = (settings as unknown as { tabBar: FakeEl }).tabBar;
    return tabBar.querySelectorAll('.nw-settings-tab')
        .map(el => el.getAttribute('data-tab-id'))
        .filter((id): id is string => id !== null);
}

function groupPills(settings: NovelWriterSettingTab): FakeEl[] {
    const groupBar = (settings as unknown as { groupBar: FakeEl }).groupBar;
    return groupBar.querySelectorAll('.nw-settings-group');
}

beforeEach(() => {
    stubDocument();
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('设置 6 分组一级 tab：初屏渲染与切换（settings-tab-regroup-fix）', () => {
    it('① 初屏渲染 6 个一级分组 pill，文案与 SETTINGS_GROUPS 一致', () => {
        const settings = makeSettings();
        settings.display();
        const pills = groupPills(settings);
        expect(pills).toHaveLength(6);
        expect(pills.map(p => p.textContent)).toEqual(SETTINGS_GROUPS.map(g => g.label));
        expect(pills.map(p => p.getAttribute('data-group-id')))
            .toEqual(['connect', 'writing', 'rules', 'knowledge', 'ui', 'ops']);
        // 初屏 connect 组激活
        expect(pills[0].classList.contains('active')).toBe(true);
    });

    it('② 初屏二级 tab 只渲染 connect 组可见 tab（高级折叠 → 仅 api，agent 不出现）', () => {
        const settings = makeSettings();
        settings.display();
        expect(visibleTabIds(settings)).toEqual(['api']);
    });

    it('③ 点击「✍️ 写作与协同」pill：二级 tab 切到 cowrite/writing，active 态随之迁移', () => {
        const settings = makeSettings();
        settings.display();
        const writingPill = groupPills(settings).find(p => p.textContent?.includes('写作与协同'));
        expect(writingPill).toBeDefined();
        writingPill!.fire('click');

        // 高级折叠时 writing 组可见 tab：cowrite（首个可见，自动落入）+ writing
        expect(visibleTabIds(settings)).toEqual(['cowrite', 'writing']);
        // active 态迁移：writing pill 亮、connect pill 灭
        const pills = groupPills(settings);
        expect(pills.find(p => p.getAttribute('data-group-id') === 'writing')!.classList.contains('active')).toBe(true);
        expect(pills.find(p => p.getAttribute('data-group-id') === 'connect')!.classList.contains('active')).toBe(false);
    });

    it('④ 点击「⚙ 高级设置」toggle：advanced tab（modes/suggestions）进入二级 tab，再点收起', () => {
        const settings = makeSettings();
        settings.display();
        groupPills(settings).find(p => p.textContent?.includes('写作与协同'))!.fire('click');
        expect(visibleTabIds(settings)).toEqual(['cowrite', 'writing']);

        const currentToggle = (): FakeEl => (settings as unknown as { tabBar: FakeEl }).tabBar
            .querySelectorAll('.nw-settings-tab-advanced-toggle')[0];
        // 注意：每次点击后 renderBars() 会重建 toggle 元素（handler 捕获新的 advancedOpen），
        // 必须重新取当前元素，不能沿用旧引用。
        currentToggle().fire('click');
        expect(visibleTabIds(settings)).toEqual(['cowrite', 'writing', 'modes', 'suggestions']);
        // saveSettings 已随 toggle 触发
        expect((settings as unknown as { plugin: { saveSettings: ReturnType<typeof vi.fn> } }).plugin.saveSettings).toHaveBeenCalled();

        currentToggle().fire('click');
        expect(visibleTabIds(settings)).toEqual(['cowrite', 'writing']);
    });

    it('⑤ 展开高级后停在 modes，折叠该 tab 隐藏 → display() 回退到组内首个可见 tab（accept ③）', () => {
        const settings = makeSettings();
        (settings as unknown as { plugin: { settings: { settingsUiShowAdvanced: boolean } } })
            .plugin.settings.settingsUiShowAdvanced = true;
        (settings as unknown as { activeTab: string }).activeTab = 'modes';
        settings.display();
        expect(visibleTabIds(settings)).toEqual(['cowrite', 'writing', 'modes', 'suggestions']);

        // 折叠高级后重开设置页：modes 属 advanced 被隐藏，回退到 cowrite
        (settings as unknown as { plugin: { settings: { settingsUiShowAdvanced: boolean } } })
            .plugin.settings.settingsUiShowAdvanced = false;
        settings.display();
        expect(visibleTabIds(settings)).toEqual(['cowrite', 'writing']);
        expect((settings as unknown as { activeTab: string }).activeTab).toBe('cowrite');
    });

    it('⑥ 回归锁：display() 若不再首屏调用 renderBars，分组 pill 消失即红', () => {
        const settings = makeSettings();
        settings.display();
        // 锁定修复点：初屏（无任何点击）groupBar 必须已有 6 个 pill。
        // 旧实现此处为 0（renderBars 只在 click 回调里调用）——本断言即修复的回归锁。
        expect(groupPills(settings).length).toBe(6);
        expect(visibleTabIds(settings).length).toBeGreaterThan(0);
    });

    it('⑦ 全部 18 个 tab 都归入 6 个分组（无遗漏、无重复）', () => {
        const all = SETTINGS_TAB_DEFINITIONS.map(d => d.id).sort();
        const grouped = SETTINGS_GROUPS.flatMap(g => [...g.tabs]).sort();
        expect(grouped).toEqual(all);
        expect(SETTINGS_GROUPS).toHaveLength(6);
        expect(new Set(grouped).size).toBe(all.length);
    });
});
