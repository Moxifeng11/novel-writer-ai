/**
 * kb-config-panel.ts — 知识参考库配置页签的纯 DOM 构建（自 knowledge-base-view 抽出）
 *
 * 只负责「给定频道分类 + 题材列表 + 宿主能力，构建出配置页签 DOM」这一件事：
 *  - 左侧频道分类按钮行（男频/女频/中性，含选中态高亮）
 *  - 顶部工具栏（频道标题 + 新增/导入/导出/恢复默认按钮）
 *  - 题材卡片网格（自定义徽标、删除入口、统计条、细分题材标签）
 *  - 自身不持有任何状态：当前分类、选中题材 id 与全部增删改弹窗均通过
 *    KbConfigPanelHost 回调宿主（KnowledgeBaseView），保证与抽取前行为完全一致
 */

import type { GenreConfig, WebnovelKnowledgeBase } from '@/shared/webnovel-knowledge-base';
import {
    KB_CONFIG_CATEGORIES,
    isCustomGenre as isCustomGenreUi,
    buildGenreStatItems,
    selectSubGenrePreview,
    formatSubGenreSectionTitle,
} from './kb-card-logic';

/**
 * 频道分类 key（与视图本地类型 ConfigCategoryKey、GenreConfig['category'] 同构）。
 */
export type KbConfigCategoryKey = GenreConfig['category'];

/**
 * 配置页签构建所需的宿主能力集合。
 *
 * 由 KnowledgeBaseView 以自身方法/字段注入，构建函数不直接依赖视图实例。
 * 可写状态（configCategory / selectedGenreId）只保留在视图中：
 * 分类切换与卡片选中通过 switchCategory / selectGenre 回调交还宿主写入。
 */
export interface KbConfigPanelHost {
    /** 当前频道分类（决定分类按钮高亮、标题文案与题材列表来源；构建期只读快照）。 */
    readonly configCategory: KbConfigCategoryKey;
    /** 知识库实例（题材列表查询与自定义题材判断；为 null 时题材列表为空）。 */
    readonly kb: WebnovelKnowledgeBase | null;
    /** 判断题材是否为当前选中题材（实时读取视图字段，卡片高亮与 hover 守卫使用）。 */
    isSelectedGenre(genreId: string): boolean;
    /** 将频道 key 翻译为中文文案（标题栏「xx题材配置」使用）。 */
    getChannelLabel(channel: string): string;
    /** 切换频道分类（宿主内部写 configCategory、清空选中题材并重渲右侧面板）。 */
    switchCategory(category: KbConfigCategoryKey): void;
    /** 选中题材卡片（宿主内部写 selectedGenreId 并打开题材编辑弹窗）。 */
    selectGenre(genre: GenreConfig): void;
    /** 打开「新增题材」弹窗（以当前分类为默认频道）。 */
    addGenre(): void;
    /** 打开 JSON 文件选择器导入自定义题材。 */
    importConfig(): void;
    /** 导出自定义题材为 JSON 文件（异步返回值由宿主自行处理）。 */
    exportConfig(): Promise<void>;
    /** 恢复默认配置（宿主内部捕获异常并记录错误日志）。 */
    resetConfig(): void;
    /** 删除指定自定义题材（宿主内部二次确认并捕获异常记录日志）。 */
    deleteGenre(genreId: string): void;
}

/**
 * 构建知识参考库配置页签 DOM（结构、类名、文案与事件与抽取前完全一致）。
 *
 * 调用方（renderRightPanel）已先清空右侧容器，这里不再重复清空。
 * 空分类（暂无题材配置）时只渲染占位提示后提前返回。
 *
 * @param rightContentEl 右侧面板内容容器（分类面板与主内容将挂载于此）
 * @param host 宿主能力回调集合（当前分类 / 选中题材 / 知识库 / 各操作入口）
 */
export function buildKbConfigPanel(rightContentEl: HTMLElement, host: KbConfigPanelHost): void {
    const content = rightContentEl.createDiv({
        cls: "nw-kb-config-tab",
        attr: {}
    });

    const categoryPanel = content.createDiv({
        cls: "nw-kb-config-category-panel",
        attr: {}
    });

    const categoryHeader = categoryPanel.createDiv({
        cls: 'nw-kb-config-category-header'
    });
    categoryHeader.createEl('h3', { text: '频道分类', cls: 'nw-kb-config-category-title' });

    const categories = KB_CONFIG_CATEGORIES;

    categories.forEach(cat => {
        const item = categoryPanel.createDiv({
            cls: host.configCategory === cat.key
                ? 'nw-kb-config-category-item nw-kb-config-category-item--active'
                : 'nw-kb-config-category-item',
        });
        item.createSpan({ text: cat.icon });
        item.createSpan({ text: cat.label });
        item.addEventListener('click', () => host.switchCategory(cat.key));
    });

    const mainContent = content.createDiv({
        cls: "nw-kb-config-main",
        attr: {}
    });

    const toolbar = mainContent.createDiv({
        cls: "nw-kb-config-toolbar", attr: {}
    });
    toolbar.createEl('h3', { text: `${host.getChannelLabel(host.configCategory)}题材配置`, cls: 'nw-kb-config-title' });

    const actions = toolbar.createDiv({ cls: 'nw-kb-config-actions' });
    const addGenreBtn = actions.createEl('button', {
        text: '➕ 新增题材',
        cls: 'nw-btn nw-btn-primary nw-btn-sm'
    });
    addGenreBtn.addEventListener('click', () => host.addGenre());
    const importBtn = actions.createEl('button', {
        text: '📥 导入',
        cls: 'nw-btn nw-btn-secondary nw-btn-sm'
    });
    importBtn.addEventListener('click', () => host.importConfig());
    const exportBtn = actions.createEl('button', {
        text: '📤 导出',
        cls: 'nw-btn nw-btn-secondary nw-btn-sm'
    });
    exportBtn.addEventListener('click', () => { void host.exportConfig(); });
    const resetBtn = actions.createEl('button', {
        text: '↺ 恢复默认',
        cls: 'nw-btn nw-btn-secondary nw-btn-sm'
    });
    resetBtn.addEventListener('click', () => host.resetConfig());

    const configContent = mainContent.createDiv({
        cls: "nw-kb-config-content",
        attr: {}
    });

    const genres = host.kb?.getGenresByCategory(host.configCategory) || [];

    if (genres.length === 0) {
        configContent.createDiv({
            cls: 'nw-kb-config-empty'
        }).createSpan({ text: '暂无题材配置' });
        return;
    }

    const grid = configContent.createDiv({
        cls: 'nw-kb-config-grid'
    });

    genres.forEach(genre => {
        const isCustom = isCustomGenreUi(genre, host.kb ? id => host.kb!.isCustomGenre(id) : undefined);
        const card = grid.createDiv({
            cls: host.isSelectedGenre(genre.id)
                ? 'nw-kb-config-card nw-kb-config-card--selected'
                : 'nw-kb-config-card',
        });

        const header = card.createDiv({ cls: 'nw-kb-config-card-header' });
        const titleWrap = header.createDiv({ cls: 'nw-kb-config-card-title-wrap' });
        const titleRow = titleWrap.createDiv({ cls: 'nw-kb-config-card-title-row' });
        titleRow.createDiv({ text: genre.name, cls: 'nw-kb-config-card-name' });
        if (isCustom) {
            titleRow.createSpan({
                text: '自定义',
                cls: 'nw-kb-config-badge'
            });
        }

        const actions = header.createDiv({ cls: 'nw-kb-config-card-actions' });
        if (isCustom) {
            const deleteIcon = actions.createSpan({
                text: '🗑️',
                cls: 'nw-kb-config-delete',
                attr: { 'aria-label': '删除这个题材', role: 'button', tabindex: '0' }
            });
            deleteIcon.addEventListener('click', (e) => {
                e.stopPropagation();
                host.deleteGenre(genre.id);
            });
        }

        card.createDiv({
            text: genre.description,
            cls: "nw-kb-config-desc", attr: {}
        });

        const stats = card.createDiv({ cls: 'nw-kb-config-stats' });
        const statItems = buildGenreStatItems(genre);
        statItems.forEach(s => {
            const statItem = stats.createDiv({
                cls: 'nw-kb-config-stat'
            });
            statItem.createDiv({ text: s.value.toString(), cls: 'nw-kb-config-stat-value' });
            statItem.createDiv({ text: s.label, cls: 'nw-kb-config-stat-label' });
        });

        const subGenrePreview = selectSubGenrePreview(genre.subGenres);
        if (subGenrePreview.shown.length > 0) {
            const subSection = card.createDiv({ cls: 'nw-kb-config-subgenres' });
            subSection.createDiv({ text: formatSubGenreSectionTitle(genre.subGenres!.length), cls: "nw-kb-config-subgenres-title", attr: {} });
            const subTags = subSection.createDiv({ cls: 'nw-kb-config-subgenres-tags' });
            subGenrePreview.shown.forEach(sub => {
                subTags.createSpan({
                    text: sub.name,
                    cls: 'nw-kb-config-subgenre-tag'
                });
            });
            if (subGenrePreview.overflow > 0) {
                subTags.createSpan({
                    text: `+${subGenrePreview.overflow}`,
                    cls: "nw-kb-config-subgenre-more", attr: {}
                });
            }
        }

        card.addEventListener('click', () => host.selectGenre(genre));
    });
}
