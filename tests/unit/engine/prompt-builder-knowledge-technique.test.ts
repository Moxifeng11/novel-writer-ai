import { describe, it, expect, vi, type Mock } from 'vitest';
import { PromptBuilder } from '../../../engine/prompt-builder';

/**
 * 主续写的「知识库 - 技巧参考」段此前把 structure 与 technique 混检：
 * structure 样本的 category 是「起/承/转/合」，非动作/对话方向时会被当作技巧渲染成
 * 「技巧：起 …」，既误导模型又挤掉真正的技巧条目（与知识注入段已修的坑同源）。
 */
describe('PromptBuilder — 技巧参考只消费 technique 维度', () => {
    function makeBuilder(store: { search: Mock }) {
        const builder = new PromptBuilder(() => null);
        builder.setReferenceBooks(['book-1']);
        builder.setKnowledgeBase(null, store as any);
        return builder;
    }

    it('structure 样本不进入技巧参考，检索维度不含 structure', async () => {
        const search = vi.fn(async (_query: string, options?: { dimensions?: string[] }) => {
            if (options?.dimensions?.includes('original')) return [];
            return [
                { sample: '结构样本：起', bookId: 'book-1', bookName: '参考书', dimension: 'structure', category: '起', score: 0.92 },
                { sample: '技巧样本：用留白收束情绪', bookId: 'book-1', bookName: '参考书', dimension: 'technique', category: '氛围', score: 0.81 },
            ];
        });
        const builder = makeBuilder({ search });

        const parts = await builder.getKnowledgePromptParts('他推开门，屋里没有人。', 'emotion');
        const joined = parts.join('\n');

        expect(joined).toContain('技巧样本：用留白收束情绪');
        expect(joined).not.toContain('结构样本：起');
        expect(joined).not.toContain('技巧：起');
        const mergedCall = search.mock.calls.find(([, options]) => options?.dimensions?.includes('technique'));
        expect(mergedCall?.[1]?.dimensions).not.toContain('structure');
    });

    it('动作方向仍优先保留动作类技巧', async () => {
        const search = vi.fn(async (_query: string, options?: { dimensions?: string[] }) => {
            if (options?.dimensions?.includes('original')) return [];
            return [
                { sample: '结构样本：承', bookId: 'book-1', bookName: '参考书', dimension: 'structure', category: '承', score: 0.9 },
                { sample: '技巧样本：动作分镜', bookId: 'book-1', bookName: '参考书', dimension: 'technique', category: '动作描写', score: 0.7 },
            ];
        });
        const builder = makeBuilder({ search });

        const parts = await builder.getKnowledgePromptParts('他抬手挡下这一刀。', 'action');
        const joined = parts.join('\n');

        expect(joined).toContain('技巧样本：动作分镜');
        expect(joined).not.toContain('结构样本：承');
    });
});

/**
 * 原文按 400 字 / 40 字重叠分块，相邻块（position 差 1）共享一段文本。
 * 知识片段的「原文片段」段此前直接取前 3 条，重复块会双份占预算；
 * 注入段已在 Revision 47 修过，这里是另一条消费路径。
 */
describe('PromptBuilder — 原文片段相邻块去重', () => {
    it('同书相邻 position 只保留高分块，检索按 2 倍取', async () => {
        const search = vi.fn(async (_query: string, options?: { dimensions?: string[] }) => {
            if (options?.dimensions?.includes('original')) {
                return [
                    { sample: '原文A前半【重叠段】', bookId: 'book-1', bookName: '参考书', dimension: 'original', position: 4, score: 0.9 },
                    { sample: '【重叠段】原文A后半', bookId: 'book-1', bookName: '参考书', dimension: 'original', position: 5, score: 0.88 },
                    { sample: '原文B独立片段', bookId: 'book-1', bookName: '参考书', dimension: 'original', position: 12, score: 0.7 },
                ];
            }
            return [];
        });
        const builder = new PromptBuilder(() => null);
        builder.setReferenceBooks(['book-1']);
        builder.setKnowledgeBase(null, { search } as any);

        const parts = await builder.getKnowledgePromptParts('他推开门，屋里没有人。', 'emotion');
        const joined = parts.join('\n');

        expect(joined).toContain('原文A前半');
        expect(joined).not.toContain('原文A后半');
        expect(joined).toContain('原文B独立片段');

        const originalCall = search.mock.calls.find((call) => {
            const options = call[1] as { dimensions?: string[] } | undefined;
            return options?.dimensions?.includes('original');
        });
        expect((originalCall?.[1] as { topN?: number } | undefined)?.topN).toBe(6);
    });
});
