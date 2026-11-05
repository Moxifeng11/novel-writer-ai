/**
 * kb-panel.ts — 协同写作「知识库」子页签渲染
 *
 * 从 `ui/co-writing-view.ts` 抽出：书籍列表、章节匹配、快速引用、写作建议四块
 * 只负责 DOM 与纯函数计算，状态与业务动作由宿主注入。
 */
import type { BookBasicInfo } from '@/services/knowledge-base-manager';
import type { WebnovelKnowledgeBase } from '@/shared/webnovel-knowledge-base';
import { createEmptyState } from '@/ui/components/empty-state';
import { showSuccessNotice } from '@/ui/components/notice-helpers';
import { buildKbReferenceCard } from './kb-reference-card';
import { buildMatchCard, calculateChapterMatches } from './chapter-match';
import { generateWritingAdvice } from './writing-advice';

/** 知识库面板宿主：提供数据快照与动作回调。 */
export interface KbPanelHost {
    /** 书籍缓存 */
    books: BookBasicInfo[];
    /** 当前展开的书籍 ID */
    expandedBookId: string | null;
    /** 右侧编辑器正文 */
    editorText: string;
    /** 已启用参考书籍 */
    activeReferenceIds: string[];
    /** 取知识库实例 */
    getKnowledgeBase(): WebnovelKnowledgeBase | null;
    /** 插入文本到编辑器 */
    insertText(text: string): void;
    /** 插入技法示例 */
    insertTechnique(tech: { name: string; description: string }): void;
    /** 打开完整知识库面板 */
    openKnowledgePanel(): void;
    /** 设置展开书籍 */
    setExpandedBookId(id: string | null): void;
    /** 重渲染书籍列表 */
    refreshBookList(): void;
    /** 启用/停用参考书 */
    toggleReferenceBook(bookId: string, bookName: string, enable: boolean): void;
    /** 设为主参考书 */
    setPrimaryReference(bookId: string): void;
    /** 调整参考权重 */
    adjustReferenceWeight(bookId: string, weight: number): void;
}

/**
 * 取书籍高频人物（无流派数据时回落到主题标签）。
 *
 * @param kb - 知识库实例
 * @param book - 书籍
 * @returns 名称数组
 * @example
 * ```ts
 * getBookTopCharacters(kb, book);
 * ```
 */
export function getBookTopCharacters(kb: WebnovelKnowledgeBase | null, book: BookBasicInfo): string[] {
    if (!kb || !book.primaryGenre) return book.themeTags.slice(0, 5);
    const genre = kb.getGenre(book.primaryGenre);
    if (!genre) return book.themeTags.slice(0, 5);
    return genre.personalityTags.slice(0, 5);
}

/**
 * 取书籍高频技法（无流派数据时回落到技法标签）。
 *
 * @param kb - 知识库实例
 * @param book - 书籍
 * @returns 名称数组
 * @example
 * ```ts
 * getBookTopTechniques(kb, book);
 * ```
 */
export function getBookTopTechniques(kb: WebnovelKnowledgeBase | null, book: BookBasicInfo): string[] {
    if (!kb || !book.primaryGenre) return book.techniqueTags.slice(0, 5);
    const genre = kb.getGenre(book.primaryGenre);
    if (!genre) return book.techniqueTags.slice(0, 5);
    return genre.techniques.slice(0, 5).map(t => t.name);
}

/**
 * 渲染「书籍」子页签（搜索框 + 列表容器 + 打开完整知识库）。
 *
 * @param container - 子页签容器
 * @param host - 面板宿主
 * @param onSearchInput - 搜索框输入回调
 * @returns 搜索框与列表容器
 * @example
 * ```ts
 * const { searchInput, listContainer } = renderBooksTabContent(content, host, onSearch);
 * ```
 */
export function renderBooksTabContent(
    container: HTMLElement,
    host: KbPanelHost,
    onSearchInput: () => void,
): { searchInput: HTMLInputElement; listContainer: HTMLElement } {
    const tab = container.createDiv({
        cls: 'nw-kb-subtab-content is-active',
        attr: { 'data-subtab': 'books' },
    });

    const searchWrap = tab.createDiv({ cls: 'nw-kb-search-wrap' });
    const searchInput = searchWrap.createEl('input', {
        type: 'text',
        cls: 'nw-kb-search-input',
        attr: { placeholder: '🔍 搜索书名...' },
    });
    searchInput.addEventListener('input', onSearchInput);

    const listContainer = tab.createDiv({ cls: 'nw-kb-book-list-panel' });

    const openFullBtn = tab.createEl('button', {
        text: '📂 打开完整知识库',
        cls: 'nw-btn nw-btn-ghost nw-btn-sm nw-kb-open-full',
    });
    openFullBtn.addEventListener('click', () => host.openKnowledgePanel());

    return { searchInput, listContainer };
}

/**
 * 渲染书籍列表（含关键词过滤与空态）。
 *
 * @param container - 列表容器
 * @param host - 面板宿主
 * @param keyword - 已小写化的搜索词
 * @example
 * ```ts
 * renderBookList(listEl, host, '');
 * ```
 */
export function renderBookList(container: HTMLElement, host: KbPanelHost, keyword: string): void {
    container.empty();

    let books = host.books;
    if (keyword) {
        books = books.filter(b =>
            b.name.toLowerCase().includes(keyword) ||
            (b.author?.toLowerCase().includes(keyword)) ||
            b.themeTags.some(t => t.toLowerCase().includes(keyword))
        );
    }

    if (books.length === 0) {
        const emptyState = createEmptyState({
            icon: keyword ? 'search' : 'book',
            title: keyword ? '未找到匹配的书籍' : '暂无书籍',
            description: keyword ? '尝试更换关键词或清空搜索' : '点击上方按钮导入书籍'
        });
        container.appendChild(emptyState);
        return;
    }

    books.forEach(book => {
        container.appendChild(createBookCard(book, host));
    });
}

/**
 * 创建单本书籍卡片。
 *
 * @param book - 书籍
 * @param host - 面板宿主
 * @returns 卡片元素
 * @example
 * ```ts
 * const card = createBookCard(book, host);
 * ```
 */
export function createBookCard(book: BookBasicInfo, host: KbPanelHost): HTMLElement {
    const kb = host.getKnowledgeBase();
    return buildKbReferenceCard(book, {
        isBookExpanded: id => host.expandedBookId === id,
        toggleBookExpanded: id => {
            host.setExpandedBookId(host.expandedBookId === id ? null : id);
            host.refreshBookList();
        },
        getGenreName: id => kb?.getGenre(id)?.name || '',
        getBookTopCharacters: b => getBookTopCharacters(kb, b),
        getBookTopTechniques: b => getBookTopTechniques(kb, b),
        quickInsertText: text => host.insertText(text),
        getActiveReferenceBookIds: () => host.activeReferenceIds,
        toggleReferenceBook: (id, name, enable) => host.toggleReferenceBook(id, name, enable),
        setPrimaryReference: id => host.setPrimaryReference(id),
        adjustReferenceWeight: (id, weight) => host.adjustReferenceWeight(id, weight),
    });
}

/**
 * 渲染「匹配」子页签。
 *
 * @param container - 子页签容器
 * @param host - 面板宿主
 * @returns 匹配容器
 * @example
 * ```ts
 * this.kbMatchContainer = renderMatchTabContent(content, host);
 * ```
 */
export function renderMatchTabContent(container: HTMLElement, host: KbPanelHost): HTMLElement {
    const tab = container.createDiv({
        cls: 'nw-kb-subtab-content',
        attr: { 'data-subtab': 'match' },
    });
    refreshMatchInto(tab, host);
    return tab;
}

/**
 * 刷新章节匹配内容。
 *
 * @param container - 匹配容器
 * @param host - 面板宿主
 * @example
 * ```ts
 * refreshMatchInto(this.kbMatchContainer, host);
 * ```
 */
export function refreshMatchInto(container: HTMLElement, host: KbPanelHost): void {
    container.empty();

    const header = container.createDiv({ cls: 'nw-kb-section-header' });
    header.createSpan({ text: '🎯 当前章节最相关' });
    header.createSpan({ cls: 'nw-kb-section-desc', text: '基于内容自动匹配' });

    const matches = calculateChapterMatches(host.editorText, host.books, host.getKnowledgeBase());
    if (matches.length === 0) {
        container.createDiv({ cls: 'nw-kb-empty', text: '暂无匹配的参考书籍' });
        return;
    }

    matches.slice(0, 3).forEach(match => {
        container.appendChild(buildMatchCard(match, tag => host.insertText(tag)));
    });
}

/**
 * 渲染「引用」子页签。
 *
 * @param container - 子页签容器
 * @param host - 面板宿主
 * @returns 引用容器
 * @example
 * ```ts
 * this.kbQuoteContainer = renderQuoteTabContent(content, host);
 * ```
 */
export function renderQuoteTabContent(container: HTMLElement, host: KbPanelHost): HTMLElement {
    const tab = container.createDiv({
        cls: 'nw-kb-subtab-content',
        attr: { 'data-subtab': 'quote' },
    });
    refreshQuoteInto(tab, host);
    return tab;
}

/**
 * 刷新快速引用内容。
 *
 * @param container - 引用容器
 * @param host - 面板宿主
 * @example
 * ```ts
 * refreshQuoteInto(this.kbQuoteContainer, host);
 * ```
 */
export function refreshQuoteInto(container: HTMLElement, host: KbPanelHost): void {
    container.empty();

    const kb = host.getKnowledgeBase();
    if (!kb) {
        container.createDiv({ cls: 'nw-kb-empty', text: '知识库未初始化' });
        return;
    }

    const header = container.createDiv({ cls: 'nw-kb-section-header' });
    header.createSpan({ text: '✨ 快速引用' });
    header.createSpan({ cls: 'nw-kb-section-desc', text: '点击插入编辑器' });

    const currentBook = host.books[0];
    const genreId = currentBook?.primaryGenre || 'xuanhuan_xianxia';
    const genre = kb.getGenre(genreId);

    if (!genre) {
        container.createDiv({ cls: 'nw-kb-empty', text: '无可用的参考数据' });
        return;
    }

    const charSection = container.createDiv({ cls: 'nw-kb-quote-section' });
    charSection.createDiv({ cls: 'nw-kb-quote-section-title', text: '🎭 性格标签' });
    const charTags = charSection.createDiv({ cls: 'nw-kb-quote-tags' });
    genre.personalityTags.slice(0, 12).forEach(tag => {
        const tagEl = charTags.createSpan({
            cls: 'nw-kb-tag nw-kb-tag-character nw-kb-tag-clickable',
            text: tag,
        });
        tagEl.addEventListener('click', () => {
            host.insertText(tag);
            showSuccessNotice(`已插入：${tag}`, { timeout: 1500 });
        });
    });

    const techSection = container.createDiv({ cls: 'nw-kb-quote-section' });
    techSection.createDiv({ cls: 'nw-kb-quote-section-title', text: '💡 写作技巧' });
    const techTags = techSection.createDiv({ cls: 'nw-kb-quote-tags' });
    genre.techniques.slice(0, 10).forEach(tech => {
        const tagEl = techTags.createSpan({
            cls: 'nw-kb-tag nw-kb-tag-technique nw-kb-tag-clickable',
            text: tech.name,
        });
        tagEl.addEventListener('click', () => {
            host.insertTechnique(tech);
        });
        tagEl.title = tech.description;
    });

    const hint = container.createDiv({ cls: 'nw-kb-quote-hint' });
    hint.createSpan({ text: '💡 点击标签即可插入到编辑器光标位置' });
}

/**
 * 渲染「建议」子页签。
 *
 * @param container - 子页签容器
 * @param host - 面板宿主
 * @returns 建议容器
 * @example
 * ```ts
 * this.kbAdviceContainer = renderAdviceTabContent(content, host);
 * ```
 */
export function renderAdviceTabContent(container: HTMLElement, host: KbPanelHost): HTMLElement {
    const tab = container.createDiv({
        cls: 'nw-kb-subtab-content',
        attr: { 'data-subtab': 'advice' },
    });
    refreshAdviceInto(tab, host);
    return tab;
}

/**
 * 刷新写作建议内容。
 *
 * @param container - 建议容器
 * @param host - 面板宿主
 * @example
 * ```ts
 * refreshAdviceInto(this.kbAdviceContainer, host);
 * ```
 */
export function refreshAdviceInto(container: HTMLElement, host: KbPanelHost): void {
    container.empty();

    const header = container.createDiv({ cls: 'nw-kb-section-header' });
    header.createSpan({ text: '💡 写作建议' });
    header.createSpan({ cls: 'nw-kb-section-desc', text: '基于内容和参考书籍' });

    const kb = host.getKnowledgeBase();
    const adviceList = generateWritingAdvice({
        text: host.editorText,
        books: host.books,
        activeRefIds: host.activeReferenceIds,
        getGenre: id => kb?.getGenre(id),
    });
    if (adviceList.length === 0) {
        container.createDiv({ cls: 'nw-kb-empty', text: '多写一些内容后会生成建议' });
        return;
    }

    const list = container.createDiv({ cls: 'nw-kb-advice-list' });
    adviceList.forEach(advice => {
        const item = list.createDiv({ cls: 'nw-kb-advice-item' });
        item.createSpan({ cls: 'nw-kb-advice-icon', text: advice.icon });
        const content = item.createDiv({ cls: 'nw-kb-advice-content' });
        content.createDiv({ cls: 'nw-kb-advice-title', text: advice.title });
        content.createDiv({ cls: 'nw-kb-advice-desc', text: advice.desc });
        if (advice.source) {
            content.createDiv({
                cls: 'nw-kb-advice-source',
                text: `来源：${advice.source}`,
            });
        }
    });
}
