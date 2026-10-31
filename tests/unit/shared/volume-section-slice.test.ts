import { describe, expect, it } from 'vitest';
import { volumeSectionSlice } from '../../../shared/format-constants';

const outline = [
    '### 第1卷',
    '### 第3章 测脉',
    '本章任务：复测',
    '### 第2卷',
    '### 第3章 重逢',
    '本章任务：与旧敌重逢',
].join('\n');

describe('format-constants — 分卷大纲卷内切片', () => {
    it('同号章只命中当前卷的段落', () => {
        const slice = volumeSectionSlice(outline, '第1卷');
        expect(slice).toContain('复测');
        expect(slice).not.toContain('重逢');
        expect(slice.match(/第3章/g)?.length).toBe(1);
    });

    it('卷名不存在时返回全文（行为不变）', () => {
        expect(volumeSectionSlice(outline, '第9卷')).toBe(outline);
    });

    it('未传卷名时返回全文', () => {
        expect(volumeSectionSlice(outline, undefined)).toBe(outline);
    });
});

describe('paths.matchProjectFromPath — 项目根最长匹配（P1-4）', () => {
    it('已知项目键里取最长前缀，而不是路径首段', async () => {
        const { matchProjectFromPath } = await import('../../../shared/paths');
        const known = ['长篇小说', '长篇小说/九霄逆脉行', '短篇创作/某短篇'];
        expect(matchProjectFromPath('长篇小说/九霄逆脉行/01-世界架构/人物/沈砚.md', known))
            .toBe('长篇小说/九霄逆脉行');
        expect(matchProjectFromPath('短篇创作/某短篇/01-设定.md', known)).toBe('短篇创作/某短篇');
    });

    it('没有已知项目时退回首段（兼容旧行为）', async () => {
        const { matchProjectFromPath } = await import('../../../shared/paths');
        expect(matchProjectFromPath('长篇小说/新书/01-设定.md', [])).toBe('长篇小说');
    });

    it('反斜杠路径归一化', async () => {
        const { matchProjectFromPath } = await import('../../../shared/paths');
        const bs = String.fromCharCode(92);
        expect(matchProjectFromPath(`长篇小说${bs}九霄逆脉行${bs}01-设定.md`, ['长篇小说/九霄逆脉行']))
            .toBe('长篇小说/九霄逆脉行');
    });
});
