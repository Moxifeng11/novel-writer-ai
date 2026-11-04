/**
 * chapter-match.ts — 协同视图「本章匹配」的纯计算与卡片 DOM 构建（自 co-writing-view 抽出）
 *
 * 只负责两件事：
 *  - calculateChapterMatches：给定右侧编辑器正文 + 知识库书籍缓存 + 知识库实例，
 *    计算当前章节与每本书的匹配度（流派人设标签 / 技法关键词 / 题材标签命中计数，
 *    叠加质量分加权），按匹配分降序返回；无 DOM、无状态写入，全部输入由视图传入
 *  - buildMatchCard：给定一条匹配结果 + 标签插入回调，构建匹配卡片 DOM
 *    （结构、类名与抽取前完全一致），人设/技巧标签点击时经回调插入正文
 */

import type { BookBasicInfo } from '@/services/knowledge-base-manager';
import type { WebnovelKnowledgeBase } from '@/shared/webnovel-knowledge-base';

/**
 * 单本书与当前章节的匹配结果。
 */
export interface ChapterMatch {
    /** 命中的书籍。 */
    book: BookBasicInfo;
    /** 匹配得分（标签/关键词命中计数 + 质量分 × 0.1 加权，已四舍五入）。 */
    score: number;
    /** 正文命中的主要人设标签（最多 3 个；无命中时回落为流派人设 Top 3）。 */
    topChars: string[];
    /** 正文命中的核心技巧名（最多 3 个；无命中时回落为流派技法 Top 3）。 */
    topTechs: string[];
}

/**
 * 计算本章与每本书的匹配度（纯计算，与抽取前行为完全一致）。
 *
 * 计分规则：
 *  - 流派人设标签每命中 1 次计 2 分，命中过的前 3 个标签记入 topChars
 *  - 流派技法关键词每命中 1 次计 1 分，命中过任一关键词的前 3 个技法记入 topTechs
 *  - 题材标签每命中 1 次计 1 分（不计入 top 列表）
 *  - 最终得分 = 命中分 + 质量总分 × 0.1（四舍五入）；零分且未拆解完成的书籍不返回
 *  - 人设/技巧 Top 列表无命中时，回落为流派的 Top 3
 *
 * @param text - 右侧编辑器当前正文（用于关键词命中统计）；为空或书籍缓存为空时返回空数组
 * @param books - 知识库书籍缓存（逐本计算匹配度）
 * @param kb - 知识库实例；未就绪时传 null（此时仅按题材标签计分，Top 列表为空）
 * @returns 匹配结果数组，按匹配分降序排列
 * @example
 * ```ts
 * const matches = calculateChapterMatches(editor.value, booksCache, kb);
 * // [{ book, score: 12, topChars: ['冷面', '腹黑'], topTechs: ['三幕节奏'] }, …]
 * ```
 */
export function calculateChapterMatches(text: string, books: BookBasicInfo[], kb: WebnovelKnowledgeBase | null): ChapterMatch[] {
    if (!text || books.length === 0) return [];

    const results: ChapterMatch[] = [];

    for (const book of books) {
        let score = 0;
        const topChars: string[] = [];
        const topTechs: string[] = [];

        const genre = kb && book.primaryGenre ? kb.getGenre(book.primaryGenre) : null;

        if (genre) {
            for (const tag of genre.personalityTags) {
                const count = (text.match(new RegExp(tag, 'g')) || []).length;
                if (count > 0) {
                    score += count * 2;
                    if (topChars.length < 3) topChars.push(tag);
                }
            }
            for (const tech of genre.techniques) {
                for (const kw of tech.keywords) {
                    const count = (text.match(new RegExp(kw, 'g')) || []).length;
                    if (count > 0) {
                        score += count;
                        if (topTechs.length < 3 && !topTechs.includes(tech.name)) {
                            topTechs.push(tech.name);
                        }
                        break;
                    }
                }
            }
        }

        for (const tag of book.themeTags) {
            const count = (text.match(new RegExp(tag, 'g')) || []).length;
            if (count > 0) score += count;
        }

        if (score > 0 || book.breakdownStatus === 'completed') {
            results.push({
                book,
                score: Math.round(score + (book.qualityScores?.overall || 0) * 0.1),
                topChars: topChars.length > 0 ? topChars : genre?.personalityTags.slice(0, 3) || [],
                topTechs: topTechs.length > 0 ? topTechs : genre?.techniques.slice(0, 3).map(t => t.name) || []
            });
        }
    }

    results.sort((a, b) => b.score - a.score);
    return results;
}

/**
 * 构建一条匹配结果的卡片 DOM（结构、类名与抽取前完全一致）。
 *
 * 卡片内容：书名 + 匹配百分比（score × 3 + 20，封顶 95%）→ 进度条 →
 * 相关人设标签行（可点击插入正文）→ 相关技巧标签行（可点击插入正文）。
 * topChars / topTechs 为空时对应区块整体省略。
 *
 * @param match - 匹配结果（来自 calculateChapterMatches）
 * @param onInsertTag - 标签点击回调：将标签文本插入右侧编辑器光标处
 * @returns 已绑定标签点击事件的卡片根元素
 * @example
 * ```ts
 * container.appendChild(buildMatchCard(match, tag => view.quickInsertText(tag)));
 * ```
 */
export function buildMatchCard(match: ChapterMatch, onInsertTag: (tag: string) => void): HTMLElement {
    const card = createDiv({ cls: "nw-kb-match-card" });

    const header = card.createDiv({ cls: "nw-kb-match-header" });
    const title = header.createDiv({ cls: "nw-kb-match-title" });
    title.createSpan({ cls: "nw-kb-match-name", text: match.book.name });
    const matchPct = Math.min(95, Math.round(match.score * 3 + 20));
    header.createSpan({
        cls: "nw-kb-match-score",
        text: `${matchPct}%`
    });

    const bar = card.createDiv({ cls: "nw-kb-match-bar" });
    bar.createDiv({
        cls: "nw-kb-match-bar-fill",
        attr: { style: `width: ${matchPct}%` }
    });

    if (match.topChars.length > 0) {
        const chars = card.createDiv({ cls: "nw-kb-match-section" });
        chars.createSpan({ cls: "nw-kb-match-label", text: "相关人设：" });
        const tags = chars.createDiv({ cls: "nw-kb-mini-tags" });
        match.topChars.forEach(tag => {
            const tagEl = tags.createSpan({
                cls: "nw-kb-tag nw-kb-tag-character nw-kb-tag-clickable",
                text: tag
            });
            tagEl.addEventListener("click", () => onInsertTag(tag));
        });
    }

    if (match.topTechs.length > 0) {
        const techs = card.createDiv({ cls: "nw-kb-match-section" });
        techs.createSpan({ cls: "nw-kb-match-label", text: "相关技巧：" });
        const tags = techs.createDiv({ cls: "nw-kb-mini-tags" });
        match.topTechs.forEach(tag => {
            const tagEl = tags.createSpan({
                cls: "nw-kb-tag nw-kb-tag-technique nw-kb-tag-clickable",
                text: tag
            });
            tagEl.addEventListener("click", () => onInsertTag(tag));
        });
    }

    return card;
}
