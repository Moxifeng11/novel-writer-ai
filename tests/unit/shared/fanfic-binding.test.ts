import { describe, it, expect } from 'vitest';
import { listFanficSettingCandidates } from '../../../shared/fanfic-binding';

const PROJECT_DIR = '我的小说/05-同人设定库';
const GLOBAL_DIR = '元文件/05-同人设定库';

describe('listFanficSettingCandidates — 从已有文件绑定同人设定', () => {
    it('FB-1: 只保留指定目录下的 .md', () => {
        const result = listFanficSettingCandidates([
            '我的小说/05-同人设定库/遮天设定.md',
            '我的小说/05-同人设定库/说明.txt',
            '我的小说/01-基础信息/人物.md',
        ], [PROJECT_DIR, GLOBAL_DIR]);
        expect(result.map(c => c.path)).toEqual(['我的小说/05-同人设定库/遮天设定.md']);
        expect(result[0].name).toBe('遮天设定');
    });

    it('FB-2: 包含设定库的子目录', () => {
        const result = listFanficSettingCandidates([
            '元文件/05-同人设定库/斗破/斗破设定.md',
        ], [GLOBAL_DIR]);
        expect(result).toEqual([{ path: '元文件/05-同人设定库/斗破/斗破设定.md', name: '斗破设定' }]);
    });

    it('FB-3: 非 .md 文件忽略', () => {
        expect(listFanficSettingCandidates([
            '我的小说/05-同人设定库/设定.json',
            '我的小说/05-同人设定库/设定',
        ], [PROJECT_DIR])).toEqual([]);
    });

    it('FB-4: 当前已绑定的文件不进入候选', () => {
        const result = listFanficSettingCandidates([
            '我的小说/05-同人设定库/甲设定.md',
            '我的小说/05-同人设定库/乙设定.md',
        ], [PROJECT_DIR], '我的小说/05-同人设定库/甲设定.md');
        expect(result.map(c => c.path)).toEqual(['我的小说/05-同人设定库/乙设定.md']);
    });

    it('FB-5: 重复路径只保留一次', () => {
        const result = listFanficSettingCandidates([
            '我的小说/05-同人设定库/甲设定.md',
            '我的小说/05-同人设定库/甲设定.md',
        ], [PROJECT_DIR]);
        expect(result).toHaveLength(1);
    });

    it('FB-6: 反斜杠与目录尾斜杠归一化后仍能命中', () => {
        const result = listFanficSettingCandidates([
            '我的小说\\05-同人设定库\\甲设定.md',
        ], ['我的小说/05-同人设定库/']);
        expect(result).toEqual([{ path: '我的小说/05-同人设定库/甲设定.md', name: '甲设定' }]);
    });

    it('FB-7: 按展示名排序（中文）', () => {
        const result = listFanficSettingCandidates([
            '我的小说/05-同人设定库/遮天设定.md',
            '我的小说/05-同人设定库/斗破设定.md',
        ], [PROJECT_DIR]);
        expect(result.map(c => c.name)).toEqual(['斗破设定', '遮天设定']);
    });

    it('FB-8: 无候选目录时返回空数组', () => {
        expect(listFanficSettingCandidates(['我的小说/05-同人设定库/甲设定.md'], [])).toEqual([]);
    });

    it('FB-9: 只做目录前缀匹配，不误收相似目录', () => {
        expect(listFanficSettingCandidates([
            '我的小说/05-同人设定库备份/甲设定.md',
        ], [PROJECT_DIR])).toEqual([]);
    });

    it('FB-10: 空路径与非法路径忽略', () => {
        expect(listFanficSettingCandidates(['', '   '], [PROJECT_DIR])).toEqual([]);
    });
});
