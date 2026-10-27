/**
 * project-utils.getProjectMeta — 创作模式解析回归
 *
 * 背景：短篇批量建章曾因 getProjectMeta 未解析 `.project` 的创作模式，
 * 误走长篇分卷大纲分支（显示“创建 2 章骨架”并报大纲缺失）。
 * 这里锁定 long/short/script 三种模式从 `.project` 到项目元数据的映射。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

const readProjectMeta = vi.fn<[], Promise<string | null>>();

vi.mock('../../../shared/paths', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../shared/paths')>();
    return { ...actual, readProjectMeta: () => readProjectMeta() };
});

vi.mock('../../../utils/helpers', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../utils/helpers')>();
    return { ...actual, readMergedVolumeOutline: async () => '' };
});

import { getProjectMeta } from '../../../ui/project-utils';

afterEach(() => {
    readProjectMeta.mockReset();
});

describe('getProjectMeta 创作模式解析', () => {
    it('没有 .project 时回退长篇模式', async () => {
        readProjectMeta.mockResolvedValue(null);
        const meta = await getProjectMeta({} as never, '任意项目');
        expect(meta.creationMode).toBe('long');
        expect(meta.creationModeLabel).toBe('长篇小说');
        expect(meta.unitLabel).toBe('章');
    });

    it('解析短篇模式、分类与目标字数', async () => {
        readProjectMeta.mockResolvedValue([
            '# 短篇项目',
            '## 题材',
            '婚姻家庭',
            '## 创作模式',
            'short',
            '## 短篇分类',
            '婚姻家庭',
            '## 目标字数',
            '60000',
        ].join('\n'));
        const meta = await getProjectMeta({} as never, '短篇项目');
        expect(meta.creationMode).toBe('short');
        expect(meta.creationModeLabel).toBe('短篇小说');
        expect(meta.shortCategory).toBe('婚姻家庭');
        expect(meta.modeTargetWords).toBe(60000);
        expect(meta.unitLabel).toBe('节');
    });

    it('解析剧本模式、类型与目标集数', async () => {
        readProjectMeta.mockResolvedValue([
            '# 剧本项目',
            '## 题材',
            '都市逆袭',
            '## 创作模式',
            'script',
            '## 剧本类型',
            '都市逆袭',
            '## 目标字数',
            '60000',
            '## 目标集数',
            '60',
        ].join('\n'));
        const meta = await getProjectMeta({} as never, '剧本项目');
        expect(meta.creationMode).toBe('script');
        expect(meta.creationModeLabel).toBe('短剧剧本');
        expect(meta.scriptGenre).toBe('都市逆袭');
        expect(meta.modeTargetUnits).toBe(60);
        expect(meta.unitLabel).toBe('集');
    });
});