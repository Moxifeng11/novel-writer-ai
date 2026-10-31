import { describe, expect, it } from 'vitest';
import { isChapterBodyPath } from '../../../shared/body-path';

const bs = String.fromCharCode(92);
const p = (s: string) => s.replace(/\//g, bs);

describe('body-path — 章节正文判定（P1-13 集成）', () => {
    it('长篇正文（含章名重命名）', () => {
        expect(isChapterBodyPath('长篇小说/书/03-大纲与章节/正文/第1卷/第1章_正文.md')).toBe(true);
        expect(isChapterBodyPath('长篇小说/书/03-大纲与章节/正文/第1卷/第1章_九脉逆行_正文.md')).toBe(true);
        expect(isChapterBodyPath(p('长篇小说/书/03-大纲与章节/正文/第1卷/第1章_正文.md'))).toBe(true);
    });

    it('短篇/剧本新结构（03-正文/第N节｜第N集）', () => {
        expect(isChapterBodyPath('短篇创作/某短篇/03-正文/第3节.md')).toBe(true);
        expect(isChapterBodyPath('剧本创作/某剧本/03-正文/第2集.md')).toBe(true);
    });

    it('设定/大纲/旁注不算正文', () => {
        expect(isChapterBodyPath('长篇小说/书/01-世界架构/世界观.md')).toBe(false);
        expect(isChapterBodyPath('长篇小说/书/03-大纲与章节/步骤结果/第1卷/第1章/第1章_大纲摘要.md')).toBe(false);
        expect(isChapterBodyPath('随手笔记.md')).toBe(false);
        expect(isChapterBodyPath('')).toBe(false);
    });
});
