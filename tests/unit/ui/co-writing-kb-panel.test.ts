import { describe, it, expect } from 'vitest';
import { getBookTopCharacters, getBookTopTechniques } from '../../../ui/co-writing/kb-panel';
import type { BookBasicInfo } from '../../../services/knowledge-base-manager';
import type { WebnovelKnowledgeBase } from '../../../shared/webnovel-knowledge-base';

/**
 * 书籍卡片的「高频人物/技法」在无知识库或无流派数据时必须回落主题标签，
 * 否则卡片会空白；这里锁定两条路径与截断上限。
 */
function makeBook(partial: Partial<BookBasicInfo> = {}): BookBasicInfo {
    return {
        id: 'book-1',
        name: '参考书',
        author: '作者',
        themeTags: ['玄幻', '成长', '群像', '热血', '权谋', '多余'],
        techniqueTags: ['留白', '倒叙', '多线', '意象', '短句', '多余'],
        primaryGenre: 'xuanhuan',
        ...partial,
    } as BookBasicInfo;
}

function makeKb(genre: { personalityTags: string[]; techniques: Array<{ name: string; description: string }> } | null): WebnovelKnowledgeBase {
    return {
        getGenre: () => genre,
    } as unknown as WebnovelKnowledgeBase;
}

describe('co-writing kb-panel 书籍高频标签', () => {
    it('无知识库时回落到主题标签并截断 5 条', () => {
        const book = makeBook();
        expect(getBookTopCharacters(null, book)).toEqual(['玄幻', '成长', '群像', '热血', '权谋']);
        expect(getBookTopTechniques(null, book)).toEqual(['留白', '倒叙', '多线', '意象', '短句']);
    });

    it('无 primaryGenre 时同样回落', () => {
        const book = makeBook({ primaryGenre: undefined });
        expect(getBookTopCharacters(makeKb(null), book)).toEqual(['玄幻', '成长', '群像', '热血', '权谋']);
        expect(getBookTopTechniques(makeKb(null), book)).toEqual(['留白', '倒叙', '多线', '意象', '短句']);
    });

    it('有流派数据时取流派标签与技法名', () => {
        const book = makeBook();
        const kb = makeKb({
            personalityTags: ['冷静', '克制', '疏离', '执拗', '孤勇', '多余'],
            techniques: [
                { name: '留白', description: '不写之写' },
                { name: '倒叙', description: '先果后因' },
                { name: '多线', description: '并行推进' },
                { name: '意象', description: '以物写人' },
                { name: '短句', description: '节奏收紧' },
                { name: '多余', description: '应被截断' },
            ],
        });
        expect(getBookTopCharacters(kb, book)).toEqual(['冷静', '克制', '疏离', '执拗', '孤勇']);
        expect(getBookTopTechniques(kb, book)).toEqual(['留白', '倒叙', '多线', '意象', '短句']);
    });
});
