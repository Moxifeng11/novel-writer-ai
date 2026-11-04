/**
 * writing-advice.ts — 协同视图「写作建议」的纯数据生成（自 co-writing-view 抽出）
 *
 * 只负责「给定正文 + 书籍缓存 + 参考状态 + 流派查询，产出最多 6 条建议」这一件事：
 *  - 无 DOM、无状态写入：正文取自输入、书籍列表由视图缓存传入、
 *    启用中的参考书以 ID 列表传入、流派配置通过 getGenre 回调按需查询
 *  - 建议维度：篇幅充实 / 流派节奏·爽点·情感·人设 / 拆解等待 / 句长 / 对话 / 战斗与情感场景
 */

import type { BookBasicInfo } from '@/services/knowledge-base-manager';
import type { GenreConfig } from '@/shared/webnovel-knowledge-base';

/**
 * 单条写作建议的展示形状（渲染层按 icon/title/desc/source 依次展示）。
 */
export interface WritingAdviceItem {
    /** 建议图标（emoji）。 */
    icon: string;
    /** 建议标题。 */
    title: string;
    /** 建议正文描述。 */
    desc: string;
    /** 来源参考书标签（如《书名》），无来源时省略。 */
    source?: string;
    /** 建议分类（general/rhythm/technique/emotion/character/style/dialogue/scene）。 */
    category?: string;
}

/**
 * 写作建议生成所需输入。
 */
export interface WritingAdviceInput {
    /** 右侧编辑器当前正文（用于字数、句长、对话与场景判定）；未挂载时传空串。 */
    text: string;
    /** 知识库书籍缓存（从中筛选拆解完成的参考书）。 */
    books: BookBasicInfo[];
    /** 当前已启用参考的书籍 ID 列表（首位即主参考）。 */
    activeRefIds: string[];
    /** 按流派 ID 查询流派配置；知识库未就绪或流派不存在时返回 undefined。 */
    getGenre: (id: string) => GenreConfig | undefined;
}

/**
 * 生成写作建议（最多返回 6 条，形状与抽取前完全一致）。
 *
 * @param input 正文、书籍缓存、启用参考 ID 列表与流派查询回调
 * @returns 建议数组（不足 6 条时返回全部）
 */
export function generateWritingAdvice(input: WritingAdviceInput): WritingAdviceItem[] {
    const text = input.text;
    const advice: WritingAdviceItem[] = [];

    if (text.length < 300) {
        advice.push({
            icon: "📝",
            title: "继续充实内容",
            desc: `当前 ${text.length} 字，建议至少写到 500 字让情节展开。`,
            category: "general"
        });
    }

    const completedBooks = input.books.filter(b => b.breakdownStatus === 'completed');
    const activeRefs = input.activeRefIds;

    if (completedBooks.length > 0) {
        for (const refBook of completedBooks.slice(0, 2)) {
            const genre = refBook.primaryGenre ? input.getGenre(refBook.primaryGenre) : null;
            if (genre) {
                const isActive = activeRefs.includes(refBook.id);
                const sourceLabel = isActive ? `《${refBook.name}》（启用中）` : `《${refBook.name}》`;

                const rhythmTech = genre.techniques.find(t => t.category === 'rhythm');
                if (rhythmTech) {
                    advice.push({
                        icon: "📈",
                        title: `节奏建议：${rhythmTech.name}`,
                        desc: rhythmTech.description,
                        source: sourceLabel,
                        category: "rhythm"
                    });
                }

                const coolTech = genre.techniques.find(t => t.category === 'cool_point');
                if (coolTech) {
                    advice.push({
                        icon: "🔥",
                        title: `爽点建议：${coolTech.name}`,
                        desc: coolTech.description,
                        source: sourceLabel,
                        category: "technique"
                    });
                }

                const emotionTech = genre.techniques.find(t => t.category === 'emotion');
                if (emotionTech) {
                    advice.push({
                        icon: "💖",
                        title: `情感建议：${emotionTech.name}`,
                        desc: emotionTech.description,
                        source: sourceLabel,
                        category: "emotion"
                    });
                }

                if (genre.personalityTags.length > 0) {
                    const charTag = genre.personalityTags[0];
                    advice.push({
                        icon: "🎭",
                        title: `人设参考：${charTag}`,
                        desc: `可借鉴${sourceLabel}中「${charTag}」类型的角色塑造方式，让人物更立体。`,
                        source: sourceLabel,
                        category: "character"
                    });
                }
            }
        }
    } else if (input.books.length > 0) {
        const first = input.books[0];
        advice.push({
            icon: "⏳",
            title: "等待书籍拆解完成",
            desc: `《${first.name}》正在拆解中，完成后可获得更多建议。`,
            category: "general"
        });
    } else {
        advice.push({
            icon: "📚",
            title: "添加参考书籍",
            desc: "导入参考书籍并拆解后，可获得个性化写作建议。",
            category: "general"
        });
    }

    const sentenceCount = (text.match(/[。！？.!?]/g) || []).length;
    if (sentenceCount > 0 && text.length / sentenceCount > 40) {
        advice.push({
            icon: "✂️",
            title: "句子偏长，建议拆分",
            desc: "当前平均句长较长，适当使用短句可以加快节奏。",
            category: "style"
        });
    }

    const dialogueCount = (text.match(/["""「『]/g) || []).length;
    if (sentenceCount > 5 && dialogueCount < sentenceCount * 0.1) {
        advice.push({
            icon: "💬",
            title: "增加对话互动",
            desc: "对话可以让场景更生动，人物更鲜活，建议适当增加。",
            category: "dialogue"
        });
    }

    const battleKeywords = ['战斗', '打斗', '交手', '对战', '攻击', '防御'];
    let battleScore = 0;
    for (const kw of battleKeywords) if (text.includes(kw)) battleScore++;
    if (battleScore >= 2 && completedBooks.length > 0) {
        const refBook = completedBooks[0];
        advice.push({
            icon: "⚔️",
            title: "战斗场景优化",
            desc: `当前是战斗场景，可参考《${refBook.name}》的战斗节奏和动作描写方式。`,
            source: `《${refBook.name}》`,
            category: "scene"
        });
    }

    const emotionKeywords = ['伤心', '感动', '愤怒', '恐惧', '喜悦', '悲伤', '思念'];
    let emotionScore = 0;
    for (const kw of emotionKeywords) if (text.includes(kw)) emotionScore++;
    if (emotionScore >= 2 && completedBooks.length > 0) {
        const refBook = completedBooks[0];
        advice.push({
            icon: "💕",
            title: "情感场景深化",
            desc: `当前是情感场景，可借鉴《${refBook.name}》的情感表达方式，让情绪更有层次。`,
            source: `《${refBook.name}》`,
            category: "scene"
        });
    }

    return advice.slice(0, 6);
}
