import { describe, expect, it } from 'vitest';
import {
    formatListLinkValue,
    formatSingleLinkValue,
    getLinkPolicy,
    parseLinkValue,
    toWikiLink,
    toWikiLinks,
} from '../../../shared/entity-links';

describe('entity-links — 链接策略', () => {
    it('链接字段策略表覆盖所有权与归属', () => {
        expect(getLinkPolicy('item', '所属/归属')).toMatchObject({ cardinality: 'single', targetCategory: 'character' });
        expect(getLinkPolicy('character', '所属势力')).toMatchObject({ cardinality: 'single', targetCategory: 'faction' });
        expect(getLinkPolicy('character', '持有物品')).toMatchObject({ cardinality: 'list', targetCategory: 'item' });
        expect(getLinkPolicy('character', '当前情绪')).toBeUndefined();
    });
});

describe('entity-links — 名称 → 链接', () => {
    it('toWikiLink 包裹实体名，已链接的原样保留', () => {
        expect(toWikiLink('武昭')).toBe('[[武昭]]');
        expect(toWikiLink('[[武昭]]')).toBe('[[武昭]]');
        expect(toWikiLink('')).toBe('');
    });

    it('toWikiLinks 去重去空', () => {
        expect(toWikiLinks(['武昭', ' 武昭 ', '', '沈青'])).toEqual(['[[武昭]]', '[[沈青]]']);
    });

    it('single 取第一个名字，list 全量', () => {
        expect(formatSingleLinkValue(['武昭', '沈青'])).toBe('[[武昭]]');
        expect(formatListLinkValue(['武昭', '沈青'])).toEqual(['[[武昭]]', '[[沈青]]']);
        expect(formatSingleLinkValue([])).toBe('');
    });
});

describe('entity-links — 旧格式值解析（读取兼容）', () => {
    it('解析 wiki-link（含别名）', () => {
        expect(parseLinkValue('[[武昭]]')).toEqual(['武昭']);
        expect(parseLinkValue('[[武昭|主角]]')).toEqual(['武昭']);
        expect(parseLinkValue('[[武昭]] 和 [[沈青|女主]]')).toEqual(['武昭', '沈青']);
    });

    it('解析纯字符串与分隔符', () => {
        expect(parseLinkValue('青云宗')).toEqual(['青云宗']);
        expect(parseLinkValue('黑色石头、沈安旧名；倒S纹路')).toEqual(['黑色石头', '沈安旧名', '倒S纹路']);
    });

    it('解析数组值（YAML 列表）', () => {
        expect(parseLinkValue(['[[武昭]]', '沈青'])).toEqual(['武昭', '沈青']);
        expect(parseLinkValue([])).toEqual([]);
    });

    it('空值返回空数组', () => {
        expect(parseLinkValue(null)).toEqual([]);
        expect(parseLinkValue('')).toEqual([]);
        expect(parseLinkValue('   ')).toEqual([]);
    });

    it('纯文本超长片段不误判为实体名（>60 字丢弃）', () => {
        const long = '一'.repeat(80);
        expect(parseLinkValue(long)).toEqual([]);
    });
});
