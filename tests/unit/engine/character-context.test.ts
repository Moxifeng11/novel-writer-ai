import { describe, it, expect } from 'vitest';
import { toCharacterContextInfos } from '../../../engine/character-context';

describe('toCharacterContextInfos — 人物 frontmatter 映射', () => {
    it('标准中文字段映射到检测上下文', () => {
        const list = toCharacterContextInfos([
            {
                name: '林惊鸿',
                性格标签: '冷静 沉稳',
                外貌特征: '黑发',
                '功法/技能树': '剑修',
                人物背景: '宗门弃徒',
            },
        ]);

        expect(list).toEqual([
            {
                name: '林惊鸿',
                personality: '冷静 沉稳',
                appearance: '黑发',
                abilities: '剑修',
                background: '宗门弃徒',
            },
        ]);
    });

    it('缺 name 时回退「姓名」与 fileName', () => {
        const list = toCharacterContextInfos([
            { 姓名: '苏白', 性格标签: '温柔' },
            { fileName: '沈渊.md', 外貌特征: '高大' },
        ]);

        expect(list.map(c => c.name)).toEqual(['苏白', '沈渊.md']);
    });

    it('没有可用姓名的记录被丢弃', () => {
        const list = toCharacterContextInfos([
            { 性格标签: '冷静' },
            { name: '   ' },
            { name: '林惊鸿' },
        ]);

        expect(list).toHaveLength(1);
        expect(list[0].name).toBe('林惊鸿');
    });

    it('非字符串字段降级为空串，不产生 "[object Object]"', () => {
        const list = toCharacterContextInfos([
            { name: '林惊鸿', 性格标签: { text: '冷静' }, 外貌特征: 123 },
        ]);

        expect(list[0].personality).toBe('');
        expect(list[0].appearance).toBe('');
    });

    it('金手指字段作为能力回退', () => {
        const list = toCharacterContextInfos([
            { name: '沈渊', '金手指/特殊能力': '读心' },
        ]);

        expect(list[0].abilities).toBe('读心');
    });

    it('空输入返回空数组', () => {
        expect(toCharacterContextInfos([])).toEqual([]);
        expect(toCharacterContextInfos(undefined)).toEqual([]);
        expect(toCharacterContextInfos(null)).toEqual([]);
    });
});
