/**
 * kb-reference-card.ts — 知识库参考书迷你卡片的纯 DOM 构建（自 co-writing-view 抽出）
 *
 * 只负责「给定一本书 + 宿主能力，构建出协同视图知识库页签的迷你卡片」这一件事：
 *  - 折叠态：书名 / 作者 / 质量分 / 展开箭头
 *  - 展开态：题材、质量、主要人设 Top 5、核心技巧 Top 5、启用/主参考/权重操作行
 *  - 自身不持有任何状态：展开判断、流派名解析、标签插值、参考书增删改全部通过
 *    KbReferenceCardHost 回调宿主（CoWritingView），保证与抽取前行为完全一致
 */

import type { BookBasicInfo } from '@/services/knowledge-base-manager';

/**
 * 参考书迷你卡片构建所需的宿主能力集合。
 *
 * 由 CoWritingView 以自身方法/字段注入，卡片构建函数不直接依赖视图实例。
 */
export interface KbReferenceCardHost {
    /** 判断指定书籍当前是否处于展开态（决定 is-expanded 类与箭头方向）。 */
    isBookExpanded(bookId: string): boolean;
    /**
     * 切换展开态：已展开则折叠（置 null），否则展开该书；
     * 内部需触发书籍列表重渲，与抽取前「写 expandedBookId + renderKbBookList()」行为一致。
     */
    toggleBookExpanded(bookId: string): void;
    /** 查询流派名称；流派不存在或知识库未就绪时返回空字符串。 */
    getGenreName(genreId: string): string;
    /** 取书籍主要人设标签 Top 5 名称。 */
    getBookTopCharacters(book: BookBasicInfo): string[];
    /** 取书籍核心技法 Top 5 名称。 */
    getBookTopTechniques(book: BookBasicInfo): string[];
    /** 将标签文本快速插入右侧编辑器光标处。 */
    quickInsertText(text: string): void;
    /** 当前已启用参考的书籍 ID 列表（首位即主参考）。 */
    getActiveReferenceBookIds(): string[];
    /** 启用/停用参考书（内部负责持久化与知识库页签相关区域重渲）。 */
    toggleReferenceBook(bookId: string, bookName: string, enable: boolean): void;
    /** 将指定书籍设为主参考（移到参考列表首位）。 */
    setPrimaryReference(bookId: string): void;
    /** 调整参考书权重（0.1-1，写入设置并即时作用到注入器）。 */
    adjustReferenceWeight(bookId: string, weight: number): void;
}

/**
 * 构建一本书的参考书迷你卡片 DOM（结构、类名与抽取前完全一致）。
 *
 * @param book 书籍基础信息（名称、作者、质量分、流派、人设/技法标签等）
 * @param host 宿主能力回调集合（展开状态 / 流派名 / 标签插入 / 参考书操作等）
 * @returns 已绑定展开与标签点击事件的卡片根元素
 */
export function buildKbReferenceCard(book: BookBasicInfo, host: KbReferenceCardHost): HTMLElement {
    const isExpanded = host.isBookExpanded(book.id);
    const card = createDiv({
        cls: `nw-kb-mini-card${isExpanded ? ' is-expanded' : ''}`,
        attr: { 'data-book-id': book.id }
    });

    const header = card.createDiv({ cls: 'nw-kb-mini-card-header' });
    const titleInfo = header.createDiv({ cls: 'nw-kb-mini-card-title' });
    titleInfo.createSpan({ cls: 'nw-kb-mini-card-name', text: book.name });
    if (book.author) {
        titleInfo.createSpan({ cls: 'nw-kb-mini-card-author', text: book.author });
    }

    const quality = book.qualityScores?.overall;
    if (quality !== undefined) {
        header.createSpan({ cls: 'nw-kb-mini-card-score', text: `⭐ ${quality.toFixed(0)}` });
    }

    const toggle = header.createSpan({
        cls: 'nw-kb-mini-card-toggle',
        text: isExpanded ? '▼' : '▶'
    });
    void toggle;

    header.addEventListener('click', () => {
        host.toggleBookExpanded(book.id);
    });

    if (isExpanded) {
        const body = card.createDiv({ cls: 'nw-kb-mini-card-body' });

        if (book.primaryGenre) {
            const genreRow = body.createDiv({ cls: 'nw-kb-mini-row' });
            genreRow.createSpan({ cls: 'nw-kb-mini-label', text: '题材：' });
            const genreName = host.getGenreName(book.primaryGenre) || book.primaryGenre;
            genreRow.createSpan({ cls: 'nw-kb-tag nw-kb-tag-genre', text: genreName });
        }

        if (book.qualityScores) {
            const scoreRow = body.createDiv({ cls: 'nw-kb-mini-row' });
            scoreRow.createSpan({ cls: 'nw-kb-mini-label', text: '质量：' });
            scoreRow.createSpan({ text: `${book.qualityScores.overall.toFixed(0)}分` });
        }

        const topChars = host.getBookTopCharacters(book);
        if (topChars.length > 0) {
            const charRow = body.createDiv({ cls: 'nw-kb-mini-section' });
            charRow.createDiv({ cls: 'nw-kb-mini-section-title', text: '🏷 主要人设 Top 5' });
            const tagsWrap = charRow.createDiv({ cls: 'nw-kb-mini-tags' });
            topChars.forEach(tag => {
                const tagEl = tagsWrap.createSpan({
                    cls: 'nw-kb-tag nw-kb-tag-character nw-kb-tag-clickable',
                    text: tag
                });
                tagEl.addEventListener('click', (e) => {
                    e.stopPropagation();
                    host.quickInsertText(tag);
                });
            });
        }

        const topTechniques = host.getBookTopTechniques(book);
        if (topTechniques.length > 0) {
            const techRow = body.createDiv({ cls: 'nw-kb-mini-section' });
            techRow.createDiv({ cls: 'nw-kb-mini-section-title', text: '💡 核心技巧 Top 5' });
            const tagsWrap = techRow.createDiv({ cls: 'nw-kb-mini-tags' });
            topTechniques.forEach(tag => {
                const tagEl = tagsWrap.createSpan({
                    cls: 'nw-kb-tag nw-kb-tag-technique nw-kb-tag-clickable',
                    text: tag
                });
                tagEl.addEventListener('click', (e) => {
                    e.stopPropagation();
                    host.quickInsertText(tag);
                });
            });
        }

        const actionRow = body.createDiv({ cls: 'nw-kb-mini-section nw-kb-action-row' });
        const activeRefs = host.getActiveReferenceBookIds();
        const isActive = activeRefs.includes(book.id);
        const isPrimary = activeRefs.indexOf(book.id) === 0;

        const toggleBtn = actionRow.createEl('button', {
            cls: `nw-btn nw-btn-sm ${isActive ? 'nw-btn-primary' : 'nw-btn-ghost'}`,
            text: isActive ? '✓ 已启用参考' : '启用参考'
        });
        toggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            host.toggleReferenceBook(book.id, book.name, !isActive);
        });

        if (isActive) {
            const primaryBtn = actionRow.createEl('button', {
                cls: `nw-btn nw-btn-sm ${isPrimary ? 'nw-btn-accent' : 'nw-btn-ghost'}`,
                text: isPrimary ? '★ 主参考' : '设为主参考'
            });
            primaryBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                host.setPrimaryReference(book.id);
            });

            if (activeRefs.length > 1) {
                const weightWrap = actionRow.createDiv({ cls: 'nw-kb-weight-wrap' });
                weightWrap.createSpan({ cls: 'nw-kb-weight-label', text: '权重:' });
                const weightSlider = weightWrap.createEl('input', {
                    type: 'range',
                    cls: 'nw-kb-weight-slider',
                    attr: { min: '10', max: '100', value: String(isPrimary ? 100 : 50) }
                });
                weightSlider.addEventListener('input', (e) => {
                    e.stopPropagation();
                    const value = parseInt(weightSlider.value, 10);
                    host.adjustReferenceWeight(book.id, value / 100);
                });
            }
        }
    }

    return card;
}
