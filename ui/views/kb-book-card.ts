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

/** 拆解状态档位 → 徽标背景/前景色（样式留在视图层，判定在 kb-card-logic） */
const STATUS_TONE_STYLES: Record<ReturnType<typeof resolveBookStatusTone>, string> = {
    success: 'background:rgba(46,204,113,0.15);color:#2ecc71;',
    info: 'background:rgba(59,130,246,0.15);color:#3b82f6;',
    danger: 'background:rgba(231,76,60,0.15);color:#e74c3c;',
    warning: 'background:rgba(245,158,11,0.15);color:#f59e0b;',
    muted: 'background:var(--background-secondary);color:var(--text-muted);',
};

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
}

/**
 * 构建一本书的列表卡片 DOM（结构、类名与抽取前完全一致）。
 *
 * @param book 书籍基础信息（名称、作者、拆解状态、分类标签、质量分等）
 * @param host 宿主能力回调集合（选中判断 / 文案格式化 / 分类 / 详情跳转等）
 * @returns 已绑定 hover 与点击事件的卡片根元素
 */
export function buildKbBookCard(book: BookBasicInfo, host: KbBookCardHost): HTMLElement {
    const card = createDiv({
        cls: `nw-kb-book-card${host.isSelectedBook(book.id) ? ' is-selected' : ''}`,
        attr: {
            style: `border:1px solid var(--background-modifier-border);border-radius:8px;padding:12px;cursor:pointer;background:var(--background-primary);transition:all 0.15s;${
                host.isSelectedBook(book.id) ? 'border-color:var(--interactive-accent);box-shadow:0 0 0 2px rgba(var(--interactive-accent-rgb),0.1);' : ''
            }`
        }
    });

    card.addClass('nw-hover-border');

    const header = card.createDiv({ cls: 'nw-u-d-flex nw-u-ai-flex-start nw-u-jc-space-between nw-u-marginbottom-8px nw-u-gap-8px' });
    const title = header.createDiv({
        text: book.name,
        cls: 'nw-u-fs-14px nw-u-fwt-500 nw-u-ov-hidden nw-u-textoverflow-ellipsis nw-u-d-webkit-box nw-u-webkitlineclamp-2 nw-u-webkitboxorient-vertical nw-u-lh-1-4 nw-u-flex-1'
    });
    void title;

    const statusTone = resolveBookStatusTone(book.breakdownStatus);
    const statusBadge = header.createSpan({
        text: host.getStatusLabel(book.breakdownStatus),
        cls: 'nw-flex-shrink-0',
        attr: {
            style: `padding:2px 8px;font-size:11px;border-radius:10px;${STATUS_TONE_STYLES[statusTone]}`
        }
    });
    void statusBadge;

    // A5: 拆解完成但向量化失败时，检索实际不可用，列表必须能看出来
    if (shouldShowVectorWarning(book)) {
        header.createSpan({
            text: '⚠️ 向量化失败',
            attr: {
                title: resolveVectorWarningTitle(book),
                style: 'padding:2px 8px;font-size:11px;border-radius:10px;background:var(--nw-danger-soft-bg);color:var(--nw-danger-soft);flex-shrink:0;margin-left:4px;'
            }
        });
    }

    const meta = card.createDiv({ cls: "nw-text-sm-muted nw-u-marginbottom-8px", attr: {} });
    meta.createSpan({ text: formatAuthorName(book.author) });
    meta.createSpan({ text: ' · ' + host.formatWordCount(book.wordCount) });

    if (shouldShowBreakdownProgress(book)) {
        const progressWrap = card.createDiv({ cls: 'nw-u-marginbottom-8px' });
        const bar = progressWrap.createDiv({
            cls: 'nw-u-h-4px nw-u-bg-background-secondary nw-u-brd-2px nw-u-ov-hidden'
        });
        bar.createDiv({
            attr: { style: `height:100%;width:${book.breakdownProgress}%;background:var(--interactive-accent);transition:width 0.3s;` }
        });
        progressWrap.createSpan({
            text: formatBreakdownProgressLabel(book),
            cls: 'nw-text-muted-11'
        });
    }

    const tags = card.createDiv({ cls: "nw-flex-wrap-sm nw-u-marginbottom-8px", attr: {} });
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
                cls: 'nw-u-p-2px-6px nw-u-fs-10px nw-u-bg-background-secondary nw-u-c-text-muted nw-u-brd-8px'
            });
        }
    }
    selectCustomTagPreview(book.customTags, isClassificationTag).forEach(tag => {
        tags.createSpan({
            text: tag,
            cls: 'nw-u-p-2px-6px nw-u-fs-10px nw-u-bg-background-secondary nw-u-c-text-muted nw-u-brd-8px'
        });
    });

    const footer = card.createDiv({
        cls: 'nw-u-d-flex nw-u-ai-center nw-u-jc-space-between nw-u-paddingtop-8px nw-u-bt-1px-solid-background-m'
    });

    const qualityText = formatQualityBadge(book.qualityScores);
    if (qualityText) {
        footer.createSpan({
            text: qualityText,
            cls: 'nw-u-fs-12px nw-u-c-f59e0b nw-u-fwt-500'
        });
    } else {
        footer.createSpan();
    }

    footer.createSpan({
        text: host.formatDate(book.createdAt),
        cls: 'nw-text-muted-11'
    });

    card.addEventListener('click', () => {
        void host.openBookDetail(book);
    });

    return card;
}
