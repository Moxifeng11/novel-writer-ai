import { describe, it, expect, vi } from 'vitest';
import {
    buildBodyDir,
    buildStepFilePath,
    buildStepResultDirs,
    ensureVaultFolder,
    extractChapterTitleFromInfoPlan,
    extractChapterTitleFromOutline,
    isSameChapterIdentity,
    resolveChapterLocation,
    resolveChapterTitle,
    stripChapterBody,
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

describe('章节位置推定（切章守卫）', () => {
    it('显式章号优先于章名解析', () => {
        const location = resolveChapterLocation('第12章 夜袭', undefined, 7);
        expect(location.chapterNum).toBe(7);
    });

    it('缺章号时按章名解析', () => {
        const location = resolveChapterLocation('第12章 夜袭');
        expect(location.chapterNum).toBe(12);
        expect(location.volume).toBe('第1卷');
    });

    it('章名不含章号时回落到第 1 章', () => {
        const location = resolveChapterLocation('序章');
        expect(location.chapterNum).toBe(1);
    });

    it('显式卷名优先于反查结果', () => {
        const resolveVolume = vi.fn(() => '第3卷');
        const location = resolveChapterLocation('第2章', '第5卷', undefined, resolveVolume);
        expect(location.volume).toBe('第5卷');
        expect(resolveVolume).not.toHaveBeenCalled();
    });

    it('缺卷名时按解析出的章号反查卷', () => {
        const resolveVolume = vi.fn(() => '第3卷');
        const location = resolveChapterLocation('第12章 夜袭', undefined, undefined, resolveVolume);
        expect(location.volume).toBe('第3卷');
        expect(resolveVolume).toHaveBeenCalledWith(12);
    });

    it('反查不到时回落第 1 卷', () => {
        const location = resolveChapterLocation('第12章', undefined, undefined, () => null);
        expect(location.volume).toBe('第1卷');
    });

    it('反查返回 undefined 时同样回落第 1 卷', () => {
        const location = resolveChapterLocation('第12章', undefined, undefined, () => undefined);
        expect(location.volume).toBe('第1卷');
    });
});

describe('正文去壳', () => {
    it('去掉 frontmatter、章节标题与正文区域标记', () => {
        const raw = '---\ntitle: x\n---\n# 第1章 起\n<!-- 正文区域 -->\n正文';
        expect(stripChapterBody(raw)).toBe('正文');
    });

    it('无 frontmatter 且无标题时原样返回', () => {
        expect(stripChapterBody('正文第一段')).toBe('正文第一段');
    });

    it('只去掉首部章节标题，正文中的同名标题保留', () => {
        const raw = '# 第1章 起\n第一段\n# 第1章 起\n第二段';
        expect(stripChapterBody(raw)).toBe('第一段\n# 第1章 起\n第二段');
    });

    it('移除多处正文区域标记', () => {
        const raw = '<!-- 正文区域 -->\n甲\n<!-- 正文区域 结束 -->\n乙';
        expect(stripChapterBody(raw)).toBe('甲\n乙');
    });
});
