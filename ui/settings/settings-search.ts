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
 */
// 只依赖类型/数据形状，不在运行时 import 装配表：搜索逻辑是纯函数，
// 这样单测不需要 mock Obsidian（各 Section 会拖入 obsidian 依赖）。

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
    /** 具体设置项名；仅 tab 级条目为空 */
    itemName?: string;
    /** 额外同义词（如「ai味」「字数」「mcp」） */
    keywords?: string[];
    /** 来源：tab / 主题词 / 已渲染分区采集 */
    source: 'tab' | 'topic' | 'dynamic';
}

/**
 * 常见主题词 → tab 的静态映射。
 *
 * 只放「用户常找、但 tab 名没法直接命中」的词；渲染过的分区会由采集补齐精确项名。
 */
const TOPIC_ENTRIES: ReadonlyArray<{ tabId: string; name: string; keywords: string[] }> = [
    { tabId: 'api', name: '模型与密钥', keywords: ['模型', '密钥', 'key', 'api', 'base url', '端点', '连通性', '实际请求', '思考强度', '价格'] },
    { tabId: 'api', name: '联网检索（考据）', keywords: ['检索', '联网', '搜索', '考据', '同人', 'mcp 检索'] },
    { tabId: 'writing', name: '字数与生成参数', keywords: ['字数', '目标', '上下文', '温度', '并发', '超时', '重试', 'token'] },
    { tabId: 'writing', name: '自动保存与备份', keywords: ['保存', '备份', '自动', '间隔', '版本'] },
    { tabId: 'cowrite', name: '协同写作', keywords: ['协同', '句级', '共写', '续写', '段落'] },
    { tabId: 'rules', name: 'AI 味与禁用词', keywords: ['ai味', 'ai 味', '禁用词', '敏感词', '高频词', '口癖'] },
    { tabId: 'rules', name: '关键词兜底', keywords: ['关键词', '兜底', '伤情', '时代错位'] },
    { tabId: 'fingerprint', name: '写作指纹与统计词表', keywords: ['指纹', '风格', '统计词表', '情绪词', '文风'] },
    { tabId: 'recognition', name: '角色识别', keywords: ['角色', '人物', '识别', '别名'] },
    { tabId: 'knowledge', name: '写作知识库', keywords: ['知识库', '参考书', '拆解', '索引', '向量', 'embedding'] },
    { tabId: 'deconstruction', name: '拆解引擎', keywords: ['拆解', '拆书', '章节分析', '结构'] },
    { tabId: 'foreshadow', name: '伏笔管理', keywords: ['伏笔', '线索', '回收', '铺垫'] },
    { tabId: 'template', name: '模板管理', keywords: ['模板', '提示词', '预设'] },
    { tabId: 'appearance', name: '字体与主题', keywords: ['字体', '字号', '主题', '皮肤', '配色', '暗色'] },
    { tabId: 'layout', name: '工作台布局', keywords: ['布局', '面板', '宽度', '侧栏', '工作台'] },
    { tabId: 'mcp', name: 'MCP 服务', keywords: ['mcp', '服务', '工具', '服务器'] },
    { tabId: 'agent', name: 'Agent 对话', keywords: ['agent', '智能体', '对话', '后端'] },
    { tabId: 'performance', name: '性能与诊断', keywords: ['性能', '诊断', '日志', '耗时', '缓存'] },
    { tabId: 'projects', name: '项目库迁移', keywords: ['项目', '迁移', '目录', '旧版'] },
    { tabId: 'setup', name: '首启与自检', keywords: ['首启', '自检', '初始化', '安装', '环境'] },
    { tabId: 'about', name: '关于与更新', keywords: ['关于', '版本', '更新', '反馈', '重载'] },
];

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
            itemName: topic.name,
            keywords: topic.keywords,
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
        const item = (entry.itemName || '').toLowerCase();
        const tab = entry.tabLabel.toLowerCase();
        const group = entry.groupLabel.toLowerCase();
        if (item && item === q) score = 100;
        else if (item && item.includes(q)) score = 80;
        else if (tab.replace(/^[^\p{L}\p{N}]+/u, '').includes(q)) score = 60;
        else if (group.replace(/^[^\p{L}\p{N}]+/u, '').includes(q)) score = 40;
        else if (entry.keywords?.some(keyword => keyword.toLowerCase().includes(q) || q.includes(keyword.toLowerCase()))) score = 30;
        if (score > 0) hits.push({ entry, score });
    }
    hits.sort((a, b) => b.score - a.score || (a.entry.itemName || a.entry.tabLabel).localeCompare(b.entry.itemName || b.entry.tabLabel));
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
