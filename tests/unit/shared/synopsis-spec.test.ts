import { describe, expect, it } from 'vitest';
import { parseSynopsisVariants, validateSynopsisText } from '../../../shared/synopsis-spec';

describe('synopsis-spec', () => {
    it('解析四版结构化简介', () => {
        const variants = parseSynopsisVariants(JSON.stringify([
            { style: 'hook', title: '甲', text: '第一段？第二段。', selfCheck: '钩子' },
            { style: 'satisfaction', title: '乙', text: '第二段？第三段。' },
            { style: 'character', title: '丙', text: '第三段？第四段。' },
            { style: 'world', title: '丁', text: '第四段？第五段。' },
        ]));
        expect(variants).toHaveLength(4);
        expect(variants.map(v => v.style)).toEqual(['hook', 'satisfaction', 'character', 'world']);
    });

    it('模型只返回一段正文时保留为单版', () => {
        const variants = parseSynopsisVariants('这是一个很长的简介正文，'.repeat(20));
        expect(variants).toHaveLength(1);
        expect(variants[0].style).toBe('hook');
    });

    it('套话/过短会被扣分并给出问题', () => {
        const result = validateSynopsisText('这是一个少年的故事。且看少年如何逆袭。', 'hook');
        expect(result.score).toBeLessThan(90);
        expect(result.issues.length).toBeGreaterThan(0);
    });
});