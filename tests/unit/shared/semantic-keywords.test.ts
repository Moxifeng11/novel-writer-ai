/**
 * 语义关键词注册表单测
 *
 * A 类词表是「兜底手段」，这里锁住三件事：
 *  1. 词表集中在注册表（检测器不再各自维护）
 *  2. 可合并用户扩展词（去重）
 *  3. 能返回命中词（告警详情可展示"命中了哪个词"）
 */

import { describe, expect, it } from 'vitest';
import {
    ACTION_WORDS,
    DRASTIC_CHANGE_GROUPS,
    INJURY_WORDS,
    KEYWORD_FALLBACK_SOURCE,
    LOCATION_WORDS,
    MODERN_WORDS,
    findKeywordHits,
    mergeKeywordOverrides,
} from '@/shared/semantic-keywords';

describe('词表注册表', () => {
    it('剧变分组含死亡/重伤/能力变化', () => {
        const groups = DRASTIC_CHANGE_GROUPS.map(g => g.group);
        expect(groups).toContain('死亡');
        expect(groups).toContain('重伤');
        expect(groups).toContain('能力变化');
    });

    it('每组都有词', () => {
        for (const group of DRASTIC_CHANGE_GROUPS) {
            expect(group.words.length, group.group).toBeGreaterThan(0);
        }
    });

    it('伤情/行动/现代/地点词表非空', () => {
        for (const list of [INJURY_WORDS, ACTION_WORDS, MODERN_WORDS, LOCATION_WORDS]) {
            expect(list.length).toBeGreaterThan(0);
        }
    });

    it('兜底来源标记非空（告警详情用它说明"这是词表命中"）', () => {
        expect(KEYWORD_FALLBACK_SOURCE).toBeTruthy();
    });
});

describe('mergeKeywordOverrides · 用户扩展', () => {
    it('并入新词', () => {
        expect(mergeKeywordOverrides(['重伤'], ['断魂'])).toEqual(['重伤', '断魂']);
    });

    it('去重', () => {
        expect(mergeKeywordOverrides(['重伤'], ['重伤'])).toEqual(['重伤']);
    });

    it('扩展为空时原样返回', () => {
        expect(mergeKeywordOverrides(['重伤'], undefined)).toEqual(['重伤']);
    });

    it('忽略空白项', () => {
        expect(mergeKeywordOverrides(['重伤'], ['  ', ''])).toEqual(['重伤']);
    });
});

describe('findKeywordHits · 命中词', () => {
    it('返回命中的词', () => {
        expect(findKeywordHits('他重伤昏迷不醒', INJURY_WORDS)).toEqual(['重伤', '昏迷']);
    });

    it('未命中返回空数组', () => {
        expect(findKeywordHits('今天天气不错', INJURY_WORDS)).toEqual([]);
    });

    it('空文本返回空数组', () => {
        expect(findKeywordHits('', INJURY_WORDS)).toEqual([]);
    });
});
