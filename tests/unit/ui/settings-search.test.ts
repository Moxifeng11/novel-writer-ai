/**
 * 设置搜索测试（2026-11-16，S-01 / A3）
 *
 * 覆盖：静态索引（分组/tab/主题词）、全局搜索打分、当前分区过滤、目标项高亮、动态索引采集。
 * 用 tests/unit/ui/support/fake-dom 的 FakeEl（项目统一做法，不依赖 jsdom）。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { setLocale } from '../../../i18n';
import { FakeEl } from './support/fake-dom';
import {
    buildStaticSearchIndex,
    collectRenderedItems,
    entryLabel,
    filterSettingsItems,
    highlightSettingItem,
    searchSettings,
    type SettingsGroupLike,
    type SettingsTabLike,
} from '../../../ui/settings/settings-search';

const GROUPS: SettingsGroupLike[] = [
    { id: 'connect', label: '🔌 连接与模型', tabs: ['api', 'mcp'] },
    { id: 'rules', label: '📜 规则与一致性', tabs: ['rules', 'fingerprint'] },
    { id: 'knowledge', label: '📚 知识与拆解', tabs: ['knowledge'] },
];
const TABS: SettingsTabLike[] = [
    { id: 'api', label: '🔌 API 配置' },
    { id: 'mcp', label: '🔌 MCP 服务' },
    { id: 'rules', label: '📜 写作规则' },
    { id: 'fingerprint', label: '🔍 写作指纹库' },
    { id: 'knowledge', label: '📚 写作知识库' },
];

/** 造一条 .setting-item（含 .setting-item-name 与可选描述） */
function makeItem(name: string, description?: string): FakeEl {
    const item = new FakeEl('div');
    item.className = 'setting-item';
    item.createDiv({ cls: 'setting-item-name', text: name });
    if (description) item.createDiv({ cls: 'setting-item-description', text: description });
    // 真实 DOM 的 textContent 会聚合子元素文本；FakeEl 只存自身文本，测试里显式聚合
    item.textContent = description ? `${name} ${description}` : name;
    return item;
}

function panelWith(names: string[]): FakeEl {
    const root = new FakeEl('div');
    for (const name of names) {
        const item = makeItem(name);
        root.appendChild(item);
    }
    return root;
}

describe('buildStaticSearchIndex', () => {
    it('每个 tab 都有一条索引', () => {
        const index = buildStaticSearchIndex(GROUPS, TABS);
        for (const group of GROUPS) {
            for (const tabId of group.tabs) {
                expect(index.some(entry => entry.tabId === tabId && entry.source === 'tab')).toBe(true);
            }
        }
    });

    it('包含常见主题词', () => {
        const index = buildStaticSearchIndex(GROUPS, TABS);
        expect(index.some(entry => entry.tabId === 'rules' && entryLabel(entry) === 'AI 味与禁用词')).toBe(true);
        expect(index.some(entry => entry.tabId === 'mcp' && entryLabel(entry) === 'MCP 服务')).toBe(true);
    });

    it('主题词对应的 tab 不在列表里时跳过（不产生幽灵条目）', () => {
        const index = buildStaticSearchIndex([{ id: 'x', label: 'X', tabs: ['api'] }], [{ id: 'api', label: 'A' }]);
        expect(index.every(entry => entry.tabId === 'api')).toBe(true);
    });
});

describe('searchSettings', () => {
    it('中文关键词命中主题词', () => {
        const hits = searchSettings(buildStaticSearchIndex(GROUPS, TABS), 'AI 味');
        expect(hits.length).toBeGreaterThan(0);
        expect(hits[0].entry.tabId).toBe('rules');
    });

    it('英文/缩写命中（mcp / api）', () => {
        expect(searchSettings(buildStaticSearchIndex(GROUPS, TABS), 'mcp')[0]?.entry.tabId).toBe('mcp');
        expect(searchSettings(buildStaticSearchIndex(GROUPS, TABS), 'api').length).toBeGreaterThan(0);
    });

    it('tab 名命中', () => {
        const hits = searchSettings(buildStaticSearchIndex(GROUPS, TABS), '知识库');
        expect(hits.some(hit => hit.entry.tabId === 'knowledge')).toBe(true);
    });

    it('空查询返回空数组', () => {
        expect(searchSettings(buildStaticSearchIndex(GROUPS, TABS), '   ')).toEqual([]);
    });

    it('限制返回条数', () => {
        const hits = searchSettings(buildStaticSearchIndex(GROUPS, TABS), '设置', 2);
        expect(hits.length).toBeLessThanOrEqual(2);
    });
});

describe('filterSettingsItems', () => {
    it('按关键词过滤当前分区项', () => {
        const root = panelWith(['AI 高频词', '字数目标', '保存间隔']);
        const result = filterSettingsItems(root as unknown as HTMLElement, '字数');
        expect(result.visible).toBe(1);
        expect(result.total).toBe(3);
        expect(root.findAll('nw-settings-item-hidden')).toHaveLength(2);
    });

    it('清空关键词恢复全部', () => {
        const root = panelWith(['AI 高频词', '字数目标']);
        filterSettingsItems(root as unknown as HTMLElement, '字数');
        const result = filterSettingsItems(root as unknown as HTMLElement, '');
        expect(result.visible).toBe(2);
        expect(root.findAll('nw-settings-item-hidden')).toHaveLength(0);
    });
});

describe('highlightSettingItem', () => {
    it('精确命中项名并加高亮类', () => {
        const root = panelWith(['AI 高频词', '字数目标']);
        expect(highlightSettingItem(root as unknown as HTMLElement, '字数目标')).toBe(true);
        expect(root.findAll('nw-settings-item-highlight')).toHaveLength(1);
    });

    it('找不到时返回 false', () => {
        const root = panelWith(['AI 高频词']);
        expect(highlightSettingItem(root as unknown as HTMLElement, '不存在的项')).toBe(false);
    });
});

describe('collectRenderedItems', () => {
    it('采集已渲染分区的项名并去重', () => {
        const root = panelWith(['AI 高频词', 'AI 高频词', '字数目标']);
        const entries = collectRenderedItems(root as unknown as HTMLElement, {
            groupId: 'writing',
            groupLabel: '✍️ 写作与协同',
            tabId: 'writing',
            tabLabel: '✍️ 写作配置',
        });
        expect(entries).toHaveLength(2);
        expect(entries.every(entry => entry.source === 'dynamic')).toBe(true);
    });
});

describe('双语主题词（缺口⑦ 第二期第八片）', () => {
    afterEach(() => setLocale('zh-CN'));

    it('en-US 下主题词名称走英文资源，不回退键名', () => {
        setLocale('en-US');
        const index = buildStaticSearchIndex(GROUPS, TABS);
        const labels = index.filter(entry => entry.source === 'topic').map(entry => entryLabel(entry));
        expect(labels).toContain('Models & keys');
        expect(labels).toContain('MCP servers');
        expect(labels.some(label => label.startsWith('settings.search.topic.'))).toBe(false);
    });

    it('同义词是中英并集：英文界面搜中文、中文界面搜英文都能命中', () => {
        setLocale('en-US');
        const index = buildStaticSearchIndex(GROUPS, TABS);
        expect(searchSettings(index, '敏感词')[0]?.entry.tabId).toBe('rules');
        setLocale('zh-CN');
        expect(searchSettings(index, 'banned').some(hit => hit.entry.tabId === 'rules')).toBe(true);
    });

    it('同一份索引在切语言后名称跟着变（entryLabel 惰性求值）', () => {
        setLocale('en-US');
        const index = buildStaticSearchIndex(GROUPS, TABS);
        expect(index.some(entry => entryLabel(entry) === 'MCP servers')).toBe(true);
        setLocale('zh-CN');
        expect(index.some(entry => entryLabel(entry) === 'MCP 服务')).toBe(true);
    });
});
