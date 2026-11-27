/**
 * ⟨✍⟩ 摘要批注测试（2026-11-27）
 *
 * 设计：摘要说「发生什么」，批注说「怎么处理这一段」，用标记分隔。
 */
import { describe, it, expect } from 'vitest';
import {
    extractAnnotations, renderAnnotationBlock, hasAnnotations, buildAnnotationParts,
} from '../../../shared/annotation-marker';
import { BODY_GENERATION_USER_TEMPLATE_V2 } from '../../../engine/prompts/body-v2-prompts';
import { BODY_GENERATION_USER_TEMPLATE_V4 } from '../../../engine/prompts/body-v4-prompts';
import { TEMPLATE_VAR_FALLBACK_KEYS } from '../../../ui/full-writer/template-vars-builder';

describe('extractAnnotations 提取与剥离', () => {
    it('提取单条批注并剥离干净', () => {
        const { text, annotations } = extractAnnotations('他推门。⟨✍ 门后应有声音 ⟩');
        expect(annotations).toHaveLength(1);
        expect(annotations[0].text).toBe('门后应有声音');
        expect(text).toBe('他推门。');
    });

    it('提取多条批注', () => {
        const { text, annotations } = extractAnnotations(
            '他推门。⟨✍ 门后应有声音 ⟩他进屋。⟨✍ 不写屋内陈设 ⟩',
        );
        expect(annotations).toHaveLength(2);
        expect(text).toBe('他推门。他进屋。');
    });

    it('支持多行批注', () => {
        const { annotations } = extractAnnotations('正文。⟨✍ 第一行\n第二行 ⟩');
        expect(annotations).toHaveLength(1);
        expect(annotations[0].text).toContain('第二行');
    });

    it('无批注时原样返回', () => {
        const { text, annotations } = extractAnnotations('普通摘要，没有批注。');
        expect(annotations).toHaveLength(0);
        expect(text).toBe('普通摘要，没有批注。');
    });

    it('空批注被忽略（⟨✍ ⟩）', () => {
        const { annotations } = extractAnnotations('正文。⟨✍  ⟩');
        expect(annotations).toHaveLength(0);
    });

    it('剥离后不留多余空行', () => {
        const { text } = extractAnnotations('第一段。\n⟨✍ 批注 ⟩\n第二段。');
        expect(text).not.toMatch(/\n{3,}/);
    });
});

describe('renderAnnotationBlock 渲染', () => {
    it('无批注返回空串（调用方可据此决定不注入）', () => {
        expect(renderAnnotationBlock([])).toBe('');
    });

    it('渲染带编号的批注块', () => {
        const block = renderAnnotationBlock(['门后应有声音', '不写屋内陈设']);
        expect(block).toContain('本章写作批注');
        expect(block).toContain('1. 门后应有声音');
        expect(block).toContain('2. 不写屋内陈设');
    });

    it('说明批注是「写法要求」不是「剧情要求」', () => {
        const block = renderAnnotationBlock(['x']);
        expect(block).toContain('写法要求');
        expect(block).toContain('不是剧情要求');
    });

    it('接受 ExtractedAnnotation 对象', () => {
        const block = renderAnnotationBlock([{ text: '批注A', index: 0 }]);
        expect(block).toContain('批注A');
    });
});

describe('hasAnnotations 探测', () => {
    it('有批注返回 true', () => expect(hasAnnotations('正文⟨✍ x ⟩')).toBe(true));
    it('无批注返回 false', () => expect(hasAnnotations('正文')).toBe(false));
});

describe('buildAnnotationParts 一步完成', () => {
    it('返回干净摘要 + 批注块', () => {
        const r = buildAnnotationParts('他推门。⟨✍ 门后应有声音 ⟩');
        expect(r.cleanSummary).toBe('他推门。');
        expect(r.annotationBlock).toContain('门后应有声音');
    });

    it('无批注时块为空串', () => {
        const r = buildAnnotationParts('普通摘要');
        expect(r.cleanSummary).toBe('普通摘要');
        expect(r.annotationBlock).toBe('');
    });
});

describe('模板与变量登记', () => {
    it('正文 user 模板注入 writingAnnotations 占位（V2/V4）', () => {
        // 批注紧跟在 infoPlan 之后注入（都属于「本章要写什么 + 怎么写」的 user 段内容）
        expect(BODY_GENERATION_USER_TEMPLATE_V2).toContain('writingAnnotations');
        expect(BODY_GENERATION_USER_TEMPLATE_V4).toContain('writingAnnotations');
    });

    it('writingAnnotations 登记在 fallback 键表', () => {
        expect(TEMPLATE_VAR_FALLBACK_KEYS).toContain('writingAnnotations');
    });
});
