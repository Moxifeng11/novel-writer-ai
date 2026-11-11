/**
 * context-panel-dom.test.ts — 上下文监控面板假 DOM 渲染回归（DSH-20261112-13）
 *
 * ui/rendering/context-panel.ts（504 可执行行）此前 0%：模式提示、token 预算
 * 配色分档（>70% 红 / >50% 黄）、紧凑/完整切换按钮与十几张折叠卡片的
 * 「空数据不渲染」判定全内联。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeEl, stubCreateDiv, stubDocument } from './support/fake-dom';

vi.mock('@/main', () => ({ default: class NovelWriterPlugin {} }));

const { ContextPanel } = await import('../../../ui/rendering/context-panel');

function makePluginStub(settingsExtra: Record<string, unknown> = {}) {
    return {
        settings: { contextScope: 'compact', maxContext: 128000, ...settingsExtra },
        saveSettings: vi.fn(async () => {}),
        refreshFullWriterContextPanel: vi.fn(),
    };
}

function renderPanel(options: {
    settingsExtra?: Record<string, unknown>;
    context?: unknown;
    vars?: Record<string, string>;
} = {}): { root: FakeEl; plugin: ReturnType<typeof makePluginStub> } {
    const root = new FakeEl('div');
    const plugin = makePluginStub(options.settingsExtra);
    const pluginWithVars = Object.assign(plugin, { fullWriterView: { vars: options.vars ?? {} } });
    // app.vault.getFiles 供 ObsidianVaultMeta 读取（空 vault 即可）
    new ContextPanel({ vault: { getFiles: () => [], getAbstractFileByPath: () => null } } as never).render(
        root as unknown as HTMLElement,
        (options.context ?? null) as never,
        '长篇小说/晨星外传',
        3,
        pluginWithVars as never,
        () => 0,
    );
    return { root, plugin };
}

beforeEach(() => {
    stubCreateDiv();
    stubDocument();
});

describe('ContextPanel.render（context=null）', () => {
    it('面板标题与紧凑模式提示渲染，token 预算未注入时不出现', () => {
        const { root } = renderPanel();
        const text = root.allText();
        expect(text).toContain('📊 上下文监控');
        expect(text).toContain('当前：（仅注入本章涉及实体）');
        expect(text).toContain('📌 上下文：紧凑模式');
        expect(text).not.toContain('Token 预算');
    });

    it('完整模式：提示文案与标签随之切换', () => {
        const { root } = renderPanel({ settingsExtra: { contextScope: 'full' } });
        const text = root.allText();
        expect(text).toContain('当前：（完整遍历所有实体）');
        expect(text).toContain('🔍 上下文：完整模式');
    });

    it('token 预算 ≤50%：绿色提示出现且百分比取整', () => {
        const { root } = renderPanel({ vars: { _contextTokens: '51200' } });
        const text = root.allText();
        expect(text).toContain('Token 预算: 51,200 / 128K (40%)');
    });

    it('token 预算 >70%：红色提示出现', () => {
        const { root } = renderPanel({ vars: { _contextTokens: '102400' } });
        expect(root.allText()).toContain('Token 预算: 102,400 / 128K (80%)');
        // 配色走 el.style.cssText 直接赋值（FakeEl.style 是普通对象，字段落在 cssText 上）
        const styles = collectStyles(root);
        expect(styles.some(st => typeof st.cssText === 'string' && st.cssText.includes('#ff4444'))).toBe(true);
    });

    it('50%~70% 区间：黄色配色', () => {
        const { root } = renderPanel({ vars: { _contextTokens: '76800' } });
        expect(root.allText()).toContain('Token 预算: 76,800 / 128K (60%)');
        expect(collectStyles(root).some(st => typeof st.cssText === 'string' && st.cssText.includes('#ffaa00'))).toBe(true);
    });
});


describe('ContextPanel.render（空 GatheredContext）', () => {
    it('十几张折叠卡片的标题按序渲染，空数据不给正文内容', () => {
        // GatheredContext 形态：{ data: {...} }；_failedModules 缺省即无警告条
        const { root } = renderPanel({ context: { data: { _failedModules: ['风格引擎'] } } });
        const text = root.allText();
        for (const title of ['👤 人物状态', '📍 地点', '🏰 势力', '⚔️ 物品功法', '🔮 伏笔库', '📋 分卷大纲', '⏱️ 时间线', '🌍 世界观', '⚙️ 设定库', '🖋️ 写作规则']) {
            expect(text).toContain(title);
        }
        // 失败模块警告条：把 _failedModules 转成可读提示
        expect(text).toContain('⚠️ 以下模块加载失败：风格引擎（已跳过）');
    });

    it('作用域标签点击：切到完整模式并保存设置', async () => {
        const { root, plugin } = renderPanel();
        const label = root.findAll('novel-writer-scope-label')[0];
        expect(label.textContent).toContain('紧凑模式');
        label.dispatch('click');
        await new Promise(r => setTimeout(r, 0));
        expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
        expect(plugin.refreshFullWriterContextPanel).toHaveBeenCalledTimes(1);
        expect(plugin.settings.contextScope).toBe('full');
    });
});


describe('ContextPanel.render（有人物数据）', () => {
    it('人物卡：渲染姓名/身份/状态/情绪/动机/软肋', () => {
        const { root } = renderPanel({
            context: {
                data: {
                    character_state: [{
                        name: '林晚',
                        身份: '守塔人',
                        当前状态: '清醒但疲惫',
                        当前情绪: '压抑',
                        核心动机: '查明沉船真相',
                        核心驱动力_软肋: '怕黑',
                    }],
                },
            },
        });
        const text = root.allText();
        expect(text).toContain('林晚');
        expect(text).toContain('— 守塔人');
        expect(text).toContain('状态：清醒但疲惫');
        expect(text).toContain('情绪：压抑');
        expect(text).toContain('动机：查明沉船真相');
        expect(text).toContain('软肋：怕黑');
        expect(text).not.toContain('无人物数据');
    });

    it('无人物数据：给占位文案', () => {
        const { root } = renderPanel({ context: { data: { character_state: [] } } });
        expect(root.allText()).toContain('无人物数据');
    });

    it('智能实体上下文：未初始化给「加载中」提示', () => {
        const { root } = renderPanel({ context: { data: {} } });
        const text = root.allText();
        expect(text).toContain('智能上下文加载中');
        expect(text).toContain('打开章节后自动生成智能实体推荐');
    });

    it('加载失败模块警告条按可读文案渲染', () => {
        const { root } = renderPanel({ context: { data: { _failedModules: ['向量层', 'LLM 层'] } } });
        expect(root.allText()).toContain('⚠️ 以下模块加载失败：向量层、LLM 层（已跳过）');
    });
});


describe('ContextPanel.render（实体与伏笔数据）', () => {
    it('地点/势力/物品卡：中文字段优先渲染，无数据给占位', () => {
        const { root } = renderPanel({
            context: {
                data: {
                    locations: [{ 名称: '雾港', 类型: '港口城市', 重要程度: '高' }],
                    factions: [{ 名称: '守塔人公会', 类型: '行会', 领袖: '老塔长', '地位/排名': '唯一' }],
                    items: [{ 名称: '铜钉灯芯', 类型: '法器', '品阶/等级': '三阶' }],
                },
            },
        });
        const text = root.allText();
        // allText 在兄弟节点间补空格，span 前缀含空格——逐段断言
        expect(text).toContain('雾港');
        expect(text).toContain('港口城市');
        expect(text).toContain('重要程度：高');
        expect(text).toContain('守塔人公会');
        expect(text).toContain('领袖：老塔长');
        expect(text).toContain('地位：唯一');
        expect(text).toContain('铜钉灯芯');
        expect(text).toContain('等级：三阶');
        expect(text).not.toContain('无地点数据');
        expect(text).not.toContain('无势力数据');
        expect(text).not.toContain('无物品功法数据');
    });

    it('地点/势力/物品为空：三个占位文案齐全', () => {
        const { root } = renderPanel({ context: { data: {} } });
        const text = root.allText();
        expect(text).toContain('无地点数据');
        expect(text).toContain('无势力数据');
        expect(text).toContain('无物品功法数据');
    });

    it('伏笔库：未揭示伏笔按重要度渲染，含埋设章与计划回收', () => {
        const { root } = renderPanel({
            context: {
                data: {
                    foreshadows: {
                        unrevealed: [
                            { name: '断剑重铸', importance: '高', buryChapter: 3, plannedReveal: 18 },
                            { name: '预言残句', importance: '低' },
                            { name: '无名信', importance: '中' },
                        ],
                    },
                },
            },
        });
        const text = root.allText();
        expect(text).toContain('[高]');
        expect(text).toContain('断剑重铸');
        expect(text).toContain('埋于：3 | 计划回收：18');
        expect(text).toContain('[低]');
        expect(text).toContain('预言残句');
        expect(text).toContain('[中]');
        expect(text).toContain('无名信');
        expect(text).not.toContain('无未揭示伏笔');
    });

    it('伏笔库为空：占位文案', () => {
        const { root } = renderPanel({ context: { data: { foreshadows: { unrevealed: [] } } } });
        expect(root.allText()).toContain('无未揭示伏笔');
    });
});


describe('ContextPanel.render（时间线与压缩警告）', () => {
    it('时间线：按与当前章节接近度排序取最近 15 条，表头三列', () => {
        const { root } = renderPanel({
            context: {
                data: {
                    timeline: [
                        { time: '第一夜', chapter: '第2章', event: '抵达雾港' },
                        { time: '第三夜', chapter: '第4章', event: '断剑出水' },
                        { time: '第二夜', chapter: '第3章', event: '结识老塔长' },
                    ],
                },
            },
        });
        const text = root.allText();
        expect(text).toContain('时间');
        expect(text).toContain('章节');
        expect(text).toContain('事件');
        expect(text).toContain('断剑出水');
        expect(text).not.toContain('无时间线事件');
    });

    it('时间线为空：占位文案', () => {
        const { root } = renderPanel({ context: { data: {} } });
        expect(root.allText()).toContain('无时间线事件');
    });

    it('压缩警告：truncationApplied 时给「已智能压缩」与四行压缩明细', () => {
        const { root } = renderPanel({
            context: {
                data: {
                    compressed: {
                        truncationApplied: true,
                        worldView: '压缩后的世界观',
                        settingLib: '压缩后的设定库',
                        foreshadows: '伏笔一行\n第二行',
                        timeline: '时间线一行',
                    },
                    world_view: { raw: '原始世界观'.repeat(10) },
                    setting_lib: { raw: '原始设定库'.repeat(10) },
                    foreshadows: { unrevealed: [{ name: 'x', importance: '中' }], revealed: [], abandoned: [] },
                    timeline: [{ time: 't', chapter: '第1章', event: 'e' }],
                },
            },
        });
        const text = root.allText();
        expect(text).toContain('⚠️ 上下文过长，已智能压缩（点击查看详情）');
        expect(text).toContain('🌍 世界观');
        expect(text).toContain('🔮 伏笔');
        expect(text).toContain('⏱️ 时间线');
    });
});

/** 收集子树里每个元素的 style 对象（cssText 直接赋值场景） */
function collectStyles(el: FakeEl): Array<{ cssText?: string }> {
    const out: Array<{ cssText?: string }> = [el.style];
    el.children.forEach(c => out.push(...collectStyles(c)));
    return out;
}
