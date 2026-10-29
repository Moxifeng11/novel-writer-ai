import { describe, expect, it } from 'vitest';
import { extractUnitOutlineSection, listOutlineUnitNumbers } from '../../../shared/mode-unit-outline';

describe('mode-unit-outline — 分节大纲切段', () => {
    it('三级标题写法：只取目标节，遇到同级下一节停止', () => {
        const doc = [
            '# 分节大纲',
            '### 第1节 开局',
            '- 目标：交代背景',
            '### 第2节 反转',
            '- 目标：揭示身份',
            '#### 子标题保留',
            '### 第3节 收尾',
        ].join('\n');
        const section = extractUnitOutlineSection(doc, 'short', 2);
        expect(section).toContain('第2节 反转');
        expect(section).toContain('子标题保留');
        expect(section).not.toContain('第1节');
        expect(section).not.toContain('第3节');
    });

    it('二级标题 + 冒号写法（剧本）', () => {
        const doc = [
            '# 分集大纲',
            '## 第1集：开场',
            '- 核心冲突：误会',
            '## 第2集：反击',
            '- 核心冲突：摊牌',
            '## 第3集：收束',
        ].join('\n');
        const section = extractUnitOutlineSection(doc, 'script', 2);
        expect(section).toContain('第2集：反击');
        expect(section).toContain('摊牌');
        expect(section).not.toContain('第1集');
        expect(section).not.toContain('第3集');
    });

    it('平铺写法（无标题层级）', () => {
        const doc = [
            '第1节 开场',
            '目标：交代背景',
            '第2节 反转',
            '目标：揭示身份',
        ].join('\n');
        expect(extractUnitOutlineSection(doc, 'short', 2)).toBe('第2节 反转\n目标：揭示身份');
    });

    it('编号不存在或参数非法时返回空串', () => {
        const doc = '### 第1节 开局\n内容';
        expect(extractUnitOutlineSection(doc, 'short', 9)).toBe('');
        expect(extractUnitOutlineSection(doc, 'short', 0)).toBe('');
        expect(extractUnitOutlineSection('', 'short', 1)).toBe('');
    });

    it('正文里顺带提到「第2节」不会被当成段落起点', () => {
        const doc = [
            '### 第1节 开局',
            '第2节的伏笔会在这里埋下',
            '### 第2节 反转',
            '目标：揭示身份',
        ].join('\n');
        const section = extractUnitOutlineSection(doc, 'short', 2);
        expect(section).toBe('### 第2节 反转\n目标：揭示身份');
    });

    it('列出大纲里出现过的单元编号（正文顺带提及不算）', () => {
        const doc = [
            '### 第2节 反转',
            '### 第1节 开局',
            '### 第10节 收尾',
            '第3节的钩子',
        ].join('\n');
        expect(listOutlineUnitNumbers(doc, 'short')).toEqual([1, 2, 10]);
        expect(listOutlineUnitNumbers('## 第1集\n## 第2集', 'script')).toEqual([1, 2]);
        expect(listOutlineUnitNumbers('', 'short')).toEqual([]);
    });
});
