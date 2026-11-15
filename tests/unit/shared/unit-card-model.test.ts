import { describe, expect, it } from 'vitest';
import {
    normalizeScriptSceneHeadings, parseScriptEpisodeOutline, parseScriptScenes,
    parseShortUnitOutline, parseShotList, renderScriptOutline, renderShortUnitOutline,
} from '@/shared/unit-card-model';

const SHORT = `## 第1节：雨夜来客

- 目标：主角发现异样
- 冲突：与掌柜争执
- 情绪变化：平静→警觉
- 结尾钩子：门外脚步声

## 第2节：追踪
- 目标：跟踪黑影
`;

const SCRIPT_EPISODES = `## 第1集：入门

- 核心冲突：测灵失败
- 爽点反转：隐藏灵根
- 场次数：2

## 第2集：试炼
- 核心冲突：试炼受阻
`;

const EPISODE_BODY = `### 1-1 日/内 山门

人物：林玄、苏婉
△ 林玄抬头看向牌匾。
林玄：这就是青云宗？

### 1-2 夜/外 后山
△ 风声骤起。
`;

describe('短篇节卡', () => {
    it('解析节与字段', () => {
        const cards = parseShortUnitOutline(SHORT);
        expect(cards).toHaveLength(2);
        expect(cards[0].index).toBe(1);
        expect(cards[0].fields['目标']).toBe('主角发现异样');
        expect(cards[0].fields['结尾钩子']).toBe('门外脚步声');
    });

    it('渲染派生视图', () => {
        const text = renderShortUnitOutline(parseShortUnitOutline(SHORT));
        expect(text).toContain('## 第1节');
        expect(text).toContain('- 目标：主角发现异样');
    });
});

describe('剧本集卡与场卡', () => {
    it('解析分集大纲', () => {
        const episodes = parseScriptEpisodeOutline(SCRIPT_EPISODES);
        expect(episodes).toHaveLength(2);
        expect(episodes[0].fields['爽点反转']).toBe('隐藏灵根');
    });

    it('解析集正文场卡并生成场 ID', () => {
        const scenes = parseScriptScenes(EPISODE_BODY, 1);
        expect(scenes).toHaveLength(2);
        expect(scenes[0].id).toBe('EP01-S01');
        expect(scenes[0].timeOfDay).toBe('日/内');
        expect(scenes[0].location).toBe('山门');
        expect(scenes[0].characters).toEqual(['林玄', '苏婉']);
        expect(scenes[0].actionLines).toBe(1);
        expect(scenes[1].id).toBe('EP01-S02');
    });

    it('规范化场标题补场 ID', () => {
        const normalized = normalizeScriptSceneHeadings(EPISODE_BODY);
        expect(normalized).toContain('### 01-01 日/内 山门');
        expect(normalized).toContain('### 01-02 夜/外 后山');
    });

    it('重复规范化不变（幂等）', () => {
        const once = normalizeScriptSceneHeadings(EPISODE_BODY);
        expect(normalizeScriptSceneHeadings(once)).toBe(once);
    });

    it('渲染分集派生视图含场次', () => {
        const text = renderScriptOutline(parseScriptEpisodeOutline(SCRIPT_EPISODES), parseScriptScenes(EPISODE_BODY, 1));
        expect(text).toContain('EP01-S01');
        expect(text).toContain('山门');
    });
});

describe('分镜表', () => {
    const SHOTS = `| 镜号 | 景别 | 运镜 | 时长 | 画面 |
|---|---|---|---|---|
| E01-S01-SH01 | 全景 | 推 | 3s | 山门远景 |
| E01-S01-SH02 | 近景 | 固定 | 2s | 林玄面部 |
`;

    it('解析镜卡', () => {
        const shots = parseShotList(SHOTS);
        expect(shots).toHaveLength(2);
        expect(shots[0].shotId).toBe('E01-S01-SH01');
        expect(shots[0].fields['景别']).toBe('全景');
    });

    it('无表头返回空', () => {
        expect(parseShotList('随便文本')).toEqual([]);
    });
});
