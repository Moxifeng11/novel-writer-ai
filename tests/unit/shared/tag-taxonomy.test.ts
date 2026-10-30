import { describe, expect, it } from 'vitest';
import {
    KIND_NAMESPACE_TAG,
    LEGACY_TO_NAMESPACE,
    formatTagArray,
    isNamespaceTag,
    missingNamespaceTags,
    namespaceTagOf,
    withNamespaceTags,
} from '../../../shared/tag-taxonomy';

describe('tag-taxonomy — 映射表', () => {
    it('正文/短篇/剧本都归到 nw/正文', () => {
        expect(namespaceTagOf('正文')).toBe('nw/正文');
        expect(namespaceTagOf('短篇正文')).toBe('nw/正文');
        expect(namespaceTagOf('剧本')).toBe('nw/正文');
        expect(KIND_NAMESPACE_TAG.body).toBe('nw/正文');
    });

    it('实体与步骤分组', () => {
        expect(namespaceTagOf('人物')).toBe('nw/实体/人物');
        expect(namespaceTagOf('物品功法')).toBe('nw/实体/物品');
        expect(namespaceTagOf('分析报告')).toBe('nw/步骤/分析报告');
        expect(namespaceTagOf('Scene展开')).toBe('nw/步骤/Scene展开');
    });

    it('未知标签返回 null，不误加命名空间', () => {
        expect(namespaceTagOf('我的私人标签')).toBeNull();
        expect(namespaceTagOf('')).toBeNull();
        expect(namespaceTagOf('#正文')).toBe('nw/正文');
    });

    it('isNamespaceTag 识别前缀', () => {
        expect(isNamespaceTag('nw/正文')).toBe(true);
        expect(isNamespaceTag('#nw/步骤/分析报告')).toBe(true);
        expect(isNamespaceTag('正文')).toBe(false);
    });

    it('映射值全部以 nw/ 开头', () => {
        for (const value of Object.values(LEGACY_TO_NAMESPACE)) {
            expect(value.startsWith('nw/')).toBe(true);
        }
    });
});

describe('tag-taxonomy — 双标签幂等', () => {
    it('保留旧标签并追加层级标签', () => {
        expect(withNamespaceTags(['正文'], '正文')).toEqual(['正文', 'nw/正文']);
    });

    it('已有层级标签不重复追加', () => {
        expect(withNamespaceTags(['正文', 'nw/正文'], '正文')).toEqual(['正文', 'nw/正文']);
    });

    it('字符串输入也能处理', () => {
        expect(withNamespaceTags('正文, 人物', ['人物'])).toEqual(['正文', '人物', 'nw/实体/人物']);
    });

    it('未知标签原样保留、不追加', () => {
        expect(withNamespaceTags(['我的标签'], '我的标签')).toEqual(['我的标签']);
    });

    it('空输入返回空数组', () => {
        expect(withNamespaceTags(undefined, [])).toEqual([]);
        expect(withNamespaceTags([], '')).toEqual([]);
    });

    it('missingNamespaceTags 只列缺失项', () => {
        expect(missingNamespaceTags(['正文', '人物'])).toEqual(['nw/正文', 'nw/实体/人物']);
        expect(missingNamespaceTags(['正文', 'nw/正文'])).toEqual([]);
        expect(missingNamespaceTags(['私人标签'])).toEqual([]);
    });

    it('formatTagArray 输出 YAML 内联数组', () => {
        expect(formatTagArray(['正文', 'nw/正文'])).toBe('[正文, nw/正文]');
    });
});