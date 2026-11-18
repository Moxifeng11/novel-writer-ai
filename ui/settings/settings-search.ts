/**
 * settings-search.ts — 设置搜索（全局索引跳转 + 当前分区内过滤）
 *
 * 背景（2026-11-16，S-01）：设置页 6 个一级分组 + 20 个二级 tab，
 * 找「AI 味阈值」「字数目标」「保存间隔」只能逐个 tab 翻，用户容易以为功能不存在。
 *
 * 两种能力（A3）：
 * 1. **全局索引跳转**：输入关键词 → 结果列表（分组 › tab › 项），点击跳到对应 tab；
 * 2. **当前分区过滤**：在当前 tab 内按项名/描述实时过滤，隐藏不匹配项。
 *
 * 全局索引 = 静态部分（分组名 + tab 名 + 常见主题词）+ 动态部分（已渲染分区的真实设置项名），
 * 两者合并去重。这样未渲染过的分区靠主题词也能搜到，渲染过的分区则能精确到设置项。
 *
 * 国际化（i18n 第二期第八片）：主题词的名称与同义词不再写死中文——
 * 条目里存 `nameKey`，展示/匹配时经 `entryLabel()` 求值；同义词取 zh/en 两份资源
 * 的并集，因此英文界面输入「模型」或中文界面输入「model」都能命中。
 */
// 只依赖类型/数据形状，不在运行时 import 装配表：搜索逻辑是纯函数，
// 这样单测不需要 mock Obsidian（各 Section 会拖入 obsidian 依赖）。

import { t, translate } from '@/i18n';

/** 分组形状（与 section-factory.SETTINGS_GROUPS 对齐） */
export interface SettingsGroupLike {
    id: string;
    label: string;
    tabs: readonly string[];
}

/** 页签形状（与 section-factory.SETTINGS_TAB_DEFINITIONS 对齐） */
export interface SettingsTabLike {
    id: string;
    label: string;
}

/** 一条搜索索引 */
export interface SettingsSearchEntry {
    /** 一级分组 id */
    groupId: string;
    /** 一级分组名（含 emoji） */
    groupLabel: string;
    /** 二级 tab id */
    tabId: string;
    /** 二级 tab 名（含 emoji） */
    tabLabel: string;
    /** 具体设置项名；仅 tab 级条目与主题词条目为空 */
    itemName?: string;
    /** 主题词条目的名称资源键（展示与匹配时经 entryLabel 求值） */
    itemNameKey?: string;
    /** 额外同义词（如「ai味」「字数」「mcp」） */
    keywords?: string[];
    /** 来源：tab / 主题词 / 已渲染分区采集 */
    source: 'tab' | 'topic' | 'dynamic';
}

/** 主题词条目：tabId + 名称键（同义词从资源里按 id 取） */
const TOPIC_ENTRIES: ReadonlyArray<{ id: string; tabId: string; nameKey: string }> = [
    { id: 'apiModels', tabId: 'api', nameKey: 'settings.search.topic.apiModels.name' },
    { id: 'apiResearch', tabId: 'api', nameKey: 'settings.search.topic.apiResearch.name' },
    { id: 'writingLength', tabId: 'writing', nameKey: 'settings.search.topic.writingLength.name' },
    { id: 'writingSave', tabId: 'writing', nameKey: 'settings.search.topic.writingSave.name' },
    { id: 'cowrite', tabId: 'cowrite', nameKey: 'settings.search.topic.cowrite.name' },
    { id: 'rulesBanned', tabId: 'rules', nameKey: 'settings.search.topic.rulesBanned.name' },
    { id: 'rulesKeywords', tabId: 'rules', nameKey: 'settings.search.topic.rulesKeywords.name' },
    { id: 'fingerprint', tabId: 'fingerprint', nameKey: 'settings.search.topic.fingerprint.name' },
    { id: 'recognition', tabId: 'recognition', nameKey: 'settings.search.topic.recognition.name' },
    { id: 'knowledge', tabId: 'knowledge', nameKey: 'settings.search.topic.knowledge.name' },
    { id: 'deconstruction', tabId: 'deconstruction', nameKey: 'settings.search.topic.deconstruction.name' },
    { id: 'foreshadow', tabId: 'foreshadow', nameKey: 'settings.search.topic.foreshadow.name' },
    { id: 'template', tabId: 'template', nameKey: 'settings.search.topic.template.name' },
    { id: 'appearance', tabId: 'appearance', nameKey: 'settings.search.topic.appearance.name' },
    { id: 'layout', tabId: 'layout', nameKey: 'settings.search.topic.layout.name' },
    { id: 'mcp', tabId: 'mcp', nameKey: 'settings.search.topic.mcp.name' },
    { id: 'agent', tabId: 'agent', nameKey: 'settings.search.topic.agent.name' },
    { id: 'performance', tabId: 'performance', nameKey: 'settings.search.topic.performance.name' },
    { id: 'projects', tabId: 'projects', nameKey: 'settings.search.topic.projects.name' },
    { id: 'setup', tabId: 'setup', nameKey: 'settings.search.topic.setup.name' },
    { id: 'about', tabId: 'about', nameKey: 'settings.search.topic.about.name' },
];

/** 参与同义词合并的语言（两份都取，保证切语言后两种输入都能命中） */
const KEYWORD_LOCALES = ['zh-CN', 'en-US'] as const;

/**
 * 取主题词的同义词（zh + en 两份资源按逗号拆分后合并）。
 *
 * @param id - 主题词 id（与 TOPIC_ENTRIES 一致）
 * @returns 去空白后的同义词列表（保持资源里的顺序）
 */
function topicKeywords(id: string): string[] {
    const key = `settings.search.topic.${id}.keywords`;
    const words: string[] = [];
    for (const locale of KEYWORD_LOCALES) {
        for (const raw of translate(locale, key).split(',')) {
            const word = raw.trim();
            if (word) words.push(word);
        }
    }
    return words;
}

/**
 * 取条目的展示名（主题词按当前语言求值，其余用采集到的项名）。
 *
 * @param entry - 搜索索引条目
 * @returns 展示名；tab 级条目为空串
 * @example
 * entryLabel({ ...entry, itemNameKey: 'settings.search.topic.mcp.name' }); // 'MCP 服务' / 'MCP servers'
 */
export function entryLabel(entry: SettingsSearchEntry): string {
    if (entry.itemNameKey) return t(entry.itemNameKey);
    return entry.itemName ?? '';
}

/**
 * 构建静态搜索索引（分组名 + tab 名 + 主题词）。
 *
 * @param groups - 一级分组列表
 * @param tabs - 页签列表
 * @returns 静态条目（顺序稳定，便于单测）
 * @example
 * buildStaticSearchIndex([{ id: 'g', label: '组', tabs: ['a'] }], [{ id: 'a', label: 'A' }]);
 */
export function buildStaticSearchIndex(
    groups: readonly SettingsGroupLike[],
    tabs: readonly SettingsTabLike[],
): SettingsSearchEntry[] {
    const entries: SettingsSearchEntry[] = [];
    for (const group of groups) {
        for (const tabId of group.tabs) {
            const tab = tabs.find(item => item.id === tabId);
            if (!tab) continue;
            entries.push({
                groupId: group.id,
                groupLabel: group.label,
                tabId: tab.id,
                tabLabel: tab.label,
                source: 'tab',
            });
        }
    }
    for (const topic of TOPIC_ENTRIES) {
        const group = groups.find(item => item.tabs.includes(topic.tabId));
        const tab = tabs.find(item => item.id === topic.tabId);
        if (!group || !tab) continue;
        entries.push({
            groupId: group.id,
            groupLabel: group.label,
            tabId: tab.id,
            tabLabel: tab.label,
            itemNameKey: topic.nameKey,
            keywords: topicKeywords(topic.id),
            source: 'topic',
        });
    }
    return entries;
}

/**
 * 从已渲染的分区里采集真实设置项名（动态索引）。
 *
 * 只读 DOM，不触发渲染；同一 tab 的重复项按名称去重。
 *
 * @param root - 已渲染的分区容器
 * @param context - 该分区所属的分组与 tab 信息
 * @returns 采集到的条目
 * @example
 * collectRenderedItems(panel, { groupId: 'rules', groupLabel: '📜 规则', tabId: 'rules', tabLabel: '📜 写作规则' });
 */
export function collectRenderedItems(
    root: HTMLElement,
    context: { groupId: string; groupLabel: string; tabId: string; tabLabel: string },
): SettingsSearchEntry[] {
    const names = new Set<string>();
    for (const el of Array.from(root.querySelectorAll('.setting-item-name'))) {
        const text = (el.textContent || '').trim();
        if (text) names.add(text);
    }
    return Array.from(names).map(name => ({
        groupId: context.groupId,
        groupLabel: context.groupLabel,
        tabId: context.tabId,
        tabLabel: context.tabLabel,
        itemName: name,
        source: 'dynamic' as const,
    }));
}

/** 一条匹配结果 */
export interface SettingsSearchHit {
    entry: SettingsSearchEntry;
    /** 命中分值（越大越靠前） */
    score: number;
}

/**
 * 模糊搜索索引条目。
 *
 * 打分：项名完全相等 100 > 项名包含 80 > tab 名包含 60 > 分组名包含 40 > 关键词包含 30。
 *
 * @param entries - 索引条目
 * @param query - 搜索词（大小写不敏感，忽略首尾空白）
 * @param limit - 最多返回条数（默认 12）
 * @returns 按分值降序的结果
 * @example
 * searchSettings(buildStaticSearchIndex(), 'mcp').length > 0; // true
 */
export function searchSettings(
    entries: readonly SettingsSearchEntry[],
    query: string,
    limit = 12,
): SettingsSearchHit[] {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return [];
    const hits: SettingsSearchHit[] = [];
    for (const entry of entries) {
        let score = 0;
        const item = entryLabel(entry).toLowerCase();
        const tab = entry.tabLabel.toLowerCase();
        const group = entry.groupLabel.toLowerCase();
        if (item && item === q) score = 100;
        else if (item && item.includes(q)) score = 80;
        else if (tab.replace(/^[^\p{L}\p{N}]+/u, '').includes(q)) score = 60;
        else if (group.replace(/^[^\p{L}\p{N}]+/u, '').includes(q)) score = 40;
        else if (entry.keywords?.some(keyword => keyword.toLowerCase().includes(q) || q.includes(keyword.toLowerCase()))) score = 30;
        if (score > 0) hits.push({ entry, score });
    }
    hits.sort((a, b) => b.score - a.score || (entryLabel(a.entry) || a.entry.tabLabel).localeCompare(entryLabel(b.entry) || b.entry.tabLabel));
    return hits.slice(0, limit);
}

/**
 * 在当前分区内按关键词过滤设置项（A3 的「过滤当前 tab 内设置项」）。
 *
 * 匹配范围是整条 `.setting-item` 的文本（名称 + 描述 + 控件值），
 * 清空关键词后恢复全部。只切换 display，不重建 DOM，因此不影响分区状态。
 *
 * @param root - 分区容器
 * @param query - 搜索词；空字符串表示恢复全部
 * @returns 命中数与总项数
 * @example
 * filterSettingsItems(panel, 'ai 味'); // { visible: 2, total: 30 }
 */
export function filterSettingsItems(root: HTMLElement, query: string): { visible: number; total: number } {
    const q = String(query || '').trim().toLowerCase();
    const items = Array.from(root.querySelectorAll<HTMLElement>('.setting-item'));
    let visible = 0;
    for (const item of items) {
        const text = (item.textContent || '').toLowerCase();
        const matched = !q || text.includes(q);
        item.toggleClass('nw-settings-item-hidden', !matched);
        if (matched) visible += 1;
    }
    return { visible, total: items.length };
}

/**
 * 跳转到分区后定位并高亮目标设置项。
 *
 * 优先精确匹配项名，其次包含匹配；找不到时仅保留在 tab 顶部。
 *
 * @param root - 分区容器
 * @param itemName - 目标设置项名
 * @returns 是否定位成功
 * @example
 * highlightSettingItem(panel, 'AI 高频词'); // true
 */
export function highlightSettingItem(root: HTMLElement, itemName: string): boolean {
    const target = String(itemName || '').trim().toLowerCase();
    if (!target) return false;
    const items = Array.from(root.querySelectorAll<HTMLElement>('.setting-item'));
    let found: HTMLElement | null = null;
    for (const item of items) {
        const name = (item.querySelector('.setting-item-name')?.textContent || '').trim().toLowerCase();
        if (name === target) {
            found = item;
            break;
        }
        if (!found && name.includes(target)) found = item;
    }
    if (!found) return false;
    // 假 DOM / 无布局环境里 scrollIntoView 可能不存在，optional 调用
    (found as HTMLElement & { scrollIntoView?: (options?: ScrollIntoViewOptions) => void })
        .scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    found.addClass('nw-settings-item-highlight');
    setTimeout(() => found?.removeClass('nw-settings-item-highlight'), 2200);
    return true;
}
