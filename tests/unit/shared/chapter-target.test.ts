import { describe, it, expect } from 'vitest';
import { resolveActiveChapterTarget, volumeNumber } from '../../../shared/chapter-target';

const WORKBENCH = {
    project: '九霄逆脉行',
    volume: '第1卷',
    chapterName: '第1章',
    chapterNum: 1,
    chapDir: '九霄逆脉行/03-大纲与章节/步骤结果/第1卷/第1章',
};

describe('resolveActiveChapterTarget — 命令层章节上下文', () => {
    it('工作台上下文优先于 activeFile', () => {
        const r = resolveActiveChapterTarget({
            workbench: WORKBENCH,
            activeFilePath: '其他书/03-大纲与章节/正文/第2卷/第3章_正文.md',
        });
        expect(r).not.toBeNull();
        expect(r?.project).toBe('九霄逆脉行');
        expect(r?.chapterNum).toBe(1);
        expect(r?.bodyPath).toBe('九霄逆脉行/03-大纲与章节/正文/第1卷/第1章_正文.md');
    });

    it('无工作台上下文时从正文路径解析', () => {
        const r = resolveActiveChapterTarget({
            workbench: null,
            activeFilePath: '某书/03-大纲与章节/正文/第2卷/第3章_正文.md',
        });
        expect(r).toEqual({
            project: '某书',
            volume: '第2卷',
            chapterName: '第3章',
            chapterNum: 3,
            chapDir: '某书/03-大纲与章节/步骤结果/第2卷/第3章',
            bodyPath: '某书/03-大纲与章节/正文/第2卷/第3章_正文.md',
        });
    });

    it('活动文件是带标题正文时，bodyPath 保持真实文件', () => {
        const r = resolveActiveChapterTarget({
            workbench: null,
            activeFilePath: '某书/03-大纲与章节/正文/第2卷/第3章_风起_正文.md',
        });
        expect(r?.chapterName).toBe('第3章');
        expect(r?.chapterNum).toBe(3);
        expect(r?.bodyPath).toBe('某书/03-大纲与章节/正文/第2卷/第3章_风起_正文.md');
    });

    it('从步骤结果目录解析并推导正文路径', () => {
        const r = resolveActiveChapterTarget({
            workbench: null,
            activeFilePath: '某书/03-大纲与章节/步骤结果/第1卷/第4章/第4章_大纲摘要.md',
        });
        expect(r?.chapterName).toBe('第4章');
        expect(r?.chapterNum).toBe(4);
        expect(r?.bodyPath).toBe('某书/03-大纲与章节/正文/第1卷/第4章_正文.md');
    });

    it('工作台只有项目、没有章节时不产出章节目标', () => {
        const r = resolveActiveChapterTarget({
            workbench: { project: '某书', volume: '', chapterName: '', chapterNum: 0, chapDir: '' },
            activeFilePath: null,
        });
        expect(r).toBeNull();
    });

    it('非章节文件返回 null', () => {
        const r = resolveActiveChapterTarget({
            workbench: null,
            activeFilePath: '某书/01-世界架构/世界观.md',
        });
        expect(r).toBeNull();
    });

    it('volumeNumber 解析中文卷号', () => {
        expect(volumeNumber('第12卷')).toBe(12);
        expect(volumeNumber('')).toBe(0);
        expect(volumeNumber('第二卷')).toBe(0);
    });
});
