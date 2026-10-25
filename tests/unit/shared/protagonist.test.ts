import { describe, expect, it } from 'vitest';
import { findProtagonistName, roleIndicatesProtagonist } from '../../../shared/protagonist';

describe('protagonist — 身份判定', () => {
    it('字符串与数组两种身份写法都能识别', () => {
        expect(roleIndicatesProtagonist('主角')).toBe(true);
        expect(roleIndicatesProtagonist(['核心', '主人公'])).toBe(true);
        expect(roleIndicatesProtagonist('主角/剑修')).toBe(true);
    });

    it('配角与非字符串值不算主角', () => {
        expect(roleIndicatesProtagonist('配角')).toBe(false);
        expect(roleIndicatesProtagonist(undefined)).toBe(false);
        expect(roleIndicatesProtagonist(123)).toBe(false);
    });
});

describe('protagonist — 从人物列表取名', () => {
    it('返回第一个身份为主角的名字', () => {
        const list = [
            { name: '路人甲', 身份: '配角' },
            { name: '林惊鸿', 身份: ['主角', '剑修'] },
        ];
        expect(findProtagonistName(list)).toBe('林惊鸿');
    });

    it('姓名/fileName 回退，并去掉 .md 后缀', () => {
        expect(findProtagonistName([{ 姓名: '沈青', 身份: '主角' }])).toBe('沈青');
        expect(findProtagonistName([{ fileName: '苏晚.md', 身份: '主人公' }])).toBe('苏晚');
    });

    it('没有主角或输入为空时返回空串', () => {
        expect(findProtagonistName([{ name: '配角甲', 身份: '配角' }])).toBe('');
        expect(findProtagonistName([])).toBe('');
        expect(findProtagonistName(undefined)).toBe('');
    });
});
