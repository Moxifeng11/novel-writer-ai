import { describe, it, expect } from 'vitest';
import {
    buildBodyDir,
    buildStepFilePath,
    buildStepResultDirs,
    ensureVaultFolder,
    extractChapterTitleFromInfoPlan,
    extractChapterTitleFromOutline,
    isSameChapterIdentity,
    resolveChapterTitle,
    stripFrontmatter,
} from '../../../ui/co-writing/chapter-context';

/**
 * 章节上下文工具：路径拼接、标题优先级、身份比对与目录逐级创建。
 * 这些规则直接决定正文/步骤结果能否被找到，锁定边界避免回退。
 */
describe('co-writing chapter-context 路径', () => {
    it('正文目录按项目/卷拼接', () => {
        expect(buildBodyDir('我的项目', '第1卷')).toBe('我的项目/03-大纲与章节/正文/第1卷');
    });

    it('步骤结果目录先步骤结果后卷根，并带第N章前缀', () => {
        expect(buildStepResultDirs('我的项目', '第1卷', 3)).toEqual([
            '我的项目/03-大纲与章节/步骤结果/第1卷/第3章',
            '我的项目/03-大纲与章节/第1卷/第3章',
        ]);
    });

    it('步骤文件同时给目录和文件名加第N章前缀', () => {
        expect(buildStepFilePath('我的项目', '第1卷', 3, '信息规划'))
            .toBe('我的项目/03-大纲与章节/步骤结果/第1卷/第3章/第3章_信息规划.md');
    });
});

describe('co-writing chapter-context 标题提取', () => {
    it('去掉 frontmatter 后再匹配', () => {
        expect(stripFrontmatter('---\ntags: []\n---\n## 章名\n风起')).toBe('## 章名\n风起');
        expect(stripFrontmatter('## 章名\n风起')).toBe('## 章名\n风起');
    });

    it('信息规划优先 ## 章名，其次 **章名**：', () => {
        expect(extractChapterTitleFromInfoPlan('## 章名\n风起')).toBe('风起');
        expect(extractChapterTitleFromInfoPlan('**章名**：九脉逆行')).toBe('九脉逆行');
        expect(extractChapterTitleFromInfoPlan('## 章名\n风起\n\n**章名**：备选')).toBe('风起');
        expect(extractChapterTitleFromInfoPlan('没有标题')).toBe('');
    });

    it('大纲摘要支持书名号与第N章两种首行', () => {
        expect(extractChapterTitleFromOutline('# 《风起》')).toBe('风起');
        expect(extractChapterTitleFromOutline('# 第3章 风起 大纲摘要')).toBe('风起');
        expect(extractChapterTitleFromOutline('# 第3章 风起')).toBe('风起');
        expect(extractChapterTitleFromOutline('无标题')).toBe('');
    });

    it('合并时信息规划优先，全空回落空串', () => {
        expect(resolveChapterTitle('## 章名\n风起', '# 《备选》')).toBe('风起');
        expect(resolveChapterTitle(null, '# 《备选》')).toBe('备选');
        expect(resolveChapterTitle('## 无章名', null)).toBe('');
        expect(resolveChapterTitle(null, null)).toBe('');
    });
});

describe('co-writing chapter-context 身份与目录', () => {
    it('项目/章号/正文路径三者全等才算同一章', () => {
        const a = { project: 'P', chapterNum: 3, bodyPath: 'P/正文.md' };
        expect(isSameChapterIdentity(a, { ...a })).toBe(true);
        expect(isSameChapterIdentity(a, { ...a, project: 'Q' })).toBe(false);
        expect(isSameChapterIdentity(a, { ...a, chapterNum: 4 })).toBe(false);
        expect(isSameChapterIdentity(a, { ...a, bodyPath: 'P/旧.md' })).toBe(false);
    });

    it('逐级创建缺失目录，已存在的跳过', async () => {
        const created: string[] = [];
        const existing = new Set(['项目']);
        const vault = {
            getAbstractFileByPath: (path: string) => existing.has(path) ? {} : null,
            createFolder: async (path: string) => {
                created.push(path);
                existing.add(path);
                return {};
            },
        };
        await ensureVaultFolder(vault, '项目/03-大纲与章节/正文');
        expect(created).toEqual(['项目/03-大纲与章节', '项目/03-大纲与章节/正文']);
        expect(await ensureVaultFolder(vault, '')).toBeUndefined();
    });
});
