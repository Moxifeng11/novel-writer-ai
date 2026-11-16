/**
 * kb-book-card.ts — 知识库书籍卡片的纯 DOM 构建（自 knowledge-base-view 抽出）
 *
 * 只负责「给定一本书 + 宿主能力，构建出卡片 DOM」这一件事：
 *  - 选中高亮、状态徽标、向量化失败警示、拆解进度条、分类标签、流派/自定义标签、质量分与日期
 *  - 自身不持有任何状态：选中判断、文案格式化、内容分类、详情跳转全部通过 KbBookCardHost
 *    回调宿主（KnowledgeBaseView），保证与抽取前行为完全一致
 */

import type { BookBasicInfo } from '@/services/knowledge-base-manager';
import { isClassificationTag, type ClassificationResult } from '@/shared/content-classifier';
import {
    resolveBookStatusTone,
    shouldShowVectorWarning,
    resolveVectorWarningTitle,
    shouldShowBreakdownProgress,
    formatBreakdownProgressLabel,
    selectClassificationPreview,
    formatClassificationTagTitle,
    selectCustomTagPreview,
    formatQualityBadge,
    formatAuthorName,
} from './kb-card-logic';

/**
 * 书籍卡片构建所需的宿主能力集合。
 *
 * 由 KnowledgeBaseView 以自身方法/字段注入，卡片构建函数不直接依赖视图实例。
 */
export interface KbBookCardHost {
    /** 判断指定书籍是否为当前选中书籍（决定卡片的选中高亮样式）。 */
    isSelectedBook(id: string): boolean;
    /** 将拆解状态翻译为中文徽标文案。 */
    getStatusLabel(status: string): string;
    /** 将字数格式化为「x.x 万字 / n 字 / 未知」；字数未知（undefined/0）时返回「未知」。 */
    formatWordCount(n: number | undefined): string;
    /** 对书籍做内容分类（主分类 + 分类标签）。 */
    classifyBookInfo(book: BookBasicInfo): ClassificationResult;
    /** 查询流派名称；流派不存在或知识库未就绪时返回空字符串。 */
    getGenreName(id: string): string;
    /** 将时间戳格式化为 yyyy-MM-dd。 */
    formatDate(ts: number): string;
    /** 打开书籍详情页（fire-and-forget，异步返回值由宿主自行处理）。 */
    openBookDetail(book: BookBasicInfo): void | Promise<void>;
    /**
     * 对单本书重试向量化（v4.83.1）。
     *
     * 缺失时卡片不显示重试按钮——向量化失败的书此前只能到设置页做「全部重向量化」，
     * 粒度太粗。
     */
    onRetryVectorize?(book: BookBasicInfo): void;
}

/**
 * 构建一本书的列表卡片 DOM（结构、类名与抽取前完全一致）。
 *
 * @param book 书籍基础信息（名称、作者、拆解状态、分类标签、质量分等）
 * @param host 宿主能力回调集合（选中判断 / 文案格式化 / 分类 / 详情跳转等）
 * @returns 已绑定 hover 与点击事件的卡片根元素
 */
export function buildKbBookCard(book: BookBasicInfo, host: KbBookCardHost): HTMLElement {
    // 2026-11-16 视觉重构：内联样式与死类（nw-hover-border/is-selected）改为语义类 + 修饰类
    const card = createDiv({
        cls: `nw-kb-book-card${host.isSelectedBook(book.id) ? ' nw-kb-book-card--selected' : ''}`,
    });

    const header = card.createDiv({ cls: 'nw-kb-book-card-header' });
    const title = header.createDiv({ text: book.name, cls: 'nw-kb-book-card-title' });
    void title;

    const statusTone = resolveBookStatusTone(book.breakdownStatus);
    const statusBadge = header.createSpan({
        text: host.getStatusLabel(book.breakdownStatus),
        cls: `nw-kb-book-card-status nw-kb-book-card-status--${statusTone}`,
    });
    void statusBadge;

    // A5: 拆解完成但向量化失败时，检索实际不可用，列表必须能看出来
    if (shouldShowVectorWarning(book)) {
        const warning = header.createSpan({
            text: '⚠️ 向量化失败',
            cls: 'nw-kb-book-card-warning',
            attr: { title: resolveVectorWarningTitle(book) },
        });
        // v4.83.1：单本重试入口。此前失败的书只能到设置页做「全部重向量化」，粒度太粗。
        if (host.onRetryVectorize) {
            const retry = warning.createEl('button', {
                text: '重试',
                cls: 'nw-btn nw-btn-secondary nw-btn-sm',
                attr: { title: '按当前嵌入模型重新计算这本书的向量（不重新拆解、不调用 AI）' },
            });
            retry.addEventListener('click', (event) => {
                // 卡片本身有「打开详情」点击；重试不能顺带把详情页也打开
                event.stopPropagation();
                host.onRetryVectorize?.(book);
            });
        }
    }

    const meta = card.createDiv({ cls: 'nw-kb-book-card-meta' });
    meta.createSpan({ text: formatAuthorName(book.author) });
    meta.createSpan({ text: ' · ' + host.formatWordCount(book.wordCount) });

    if (shouldShowBreakdownProgress(book)) {
        const progressWrap = card.createDiv({ cls: 'nw-kb-book-card-progress' });
        const bar = progressWrap.createDiv({ cls: 'nw-kb-book-card-progress-track' });
        const fill = bar.createDiv({ cls: 'nw-kb-book-card-progress-fill' });
        // 进度是动态数值：通过 CSS 变量传给样式表（不写死 width 内联样式）
        fill.style.setProperty('--nw-progress', `${book.breakdownProgress}%`);
        progressWrap.createSpan({
            text: formatBreakdownProgressLabel(book),
            cls: 'nw-kb-book-card-progress-label',
        });
    }

    const tags = card.createDiv({ cls: 'nw-kb-book-card-tags' });
    const classification = host.classifyBookInfo(book);
    const classificationPreview = selectClassificationPreview(classification);
    if (classificationPreview.length > 0) {
        const classRow = card.createDiv({ cls: 'nw-kb-class-row' });
        classRow.createSpan({
            text: `🏷️ ${classification.primary}`,
            cls: 'nw-kb-class-primary',
            attr: { title: classification.summary }
        });
        classificationPreview.forEach(tag => {
            classRow.createSpan({
                text: tag.label,
                cls: 'nw-kb-class-tag',
                attr: { title: formatClassificationTagTitle(tag) }
            });
        });
    }
    if (book.primaryGenre) {
        const genreName = host.getGenreName(book.primaryGenre);
        if (genreName) {
            tags.createSpan({
                text: genreName,
                cls: 'nw-kb-book-card-tag'
            });
        }
    }
    selectCustomTagPreview(book.customTags, isClassificationTag).forEach(tag => {
        tags.createSpan({
            text: tag,
            cls: 'nw-kb-book-card-tag'
        });
    });

    const footer = card.createDiv({ cls: 'nw-kb-book-card-footer' });

    const qualityText = formatQualityBadge(book.qualityScores);
    if (qualityText) {
        footer.createSpan({ text: qualityText, cls: 'nw-kb-book-card-quality' });
    } else {
        footer.createSpan();
    }

    footer.createSpan({ text: host.formatDate(book.createdAt), cls: 'nw-kb-book-card-date' });

    card.addEventListener('click', () => {
        void host.openBookDetail(book);
    });

    return card;
}
