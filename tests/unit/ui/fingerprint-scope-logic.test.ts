/**
 * fingerprint-scope-logic.test.ts — 指纹三层作用域判定与引导回归（阶段 D2 / DSH-20261112-11）
 *
 * 作用域页签样式、空层引导（NBI-01）、切层重置、标签芯片截断此前内联在
 * 渲染方法里零覆盖。重点锁：切层必须清空选中（否则详情面板显示别的层的
 * 指纹）、引导优先指向有数据的层、三层全空才给兜底文案。
 */
import { describe, expect, it } from 'vitest';
import {
    buildEmptyScopeGuidance,
    buildScopeTabStyle,
    FINGERPRINT_SCOPES,
    resetScopeSelection,
    SCOPE_ICONS,
    SCOPE_LABELS,
    visibleTagChips,
} from '../../../ui/views/fingerprint-scope-logic';

describe('buildScopeTabStyle', () => {
    it('选中层：强调色下划线 + 600 字重', () => {
        const style = buildScopeTabStyle('global', 'global');
        expect(style).toContain('border-bottom:2px solid var(--interactive-accent)');
        expect(style).toContain('color:var(--interactive-accent)');
        expect(style).toContain('font-weight:600');
    });

    it('未选中层：透明下划线 + muted + 400 字重', () => {
        const style = buildScopeTabStyle('global', 'template');
        expect(style).toContain('border-bottom:2px solid transparent');
        expect(style).toContain('color:var(--text-muted)');
        expect(style).toContain('font-weight:400');
    });
});

describe('buildEmptyScopeGuidance（NBI-01）', () => {
    const empty: Record<'template' | 'global' | 'project', number> = { template: 0, global: 0, project: 0 };

    it('其它层有数据：优先指向有数据的层（跳过当前层）', () => {
        const text = buildEmptyScopeGuidance('template', { ...empty, global: 3, project: 5 });
        expect(text).toBe('当前层暂无指纹，可切换到🌐 全局层 / 📁 项目层查看');
    });

    it('只指向有数据的层，没有数据的层不出现', () => {
        const text = buildEmptyScopeGuidance('project', { ...empty, global: 2 });
        expect(text).toBe('当前层暂无指纹，可切换到🌐 全局层查看');
        expect(text).not.toContain('模板层');
    });

    it('三层全空：给提取兜底文案', () => {
        expect(buildEmptyScopeGuidance('global', empty)).toBe('从章节文本提取写作指纹，用于风格对齐与参考');
    });
});

describe('resetScopeSelection', () => {
    it('换层且清空选中（防「幽灵选中」别的层的指纹）', () => {
        expect(resetScopeSelection('project')).toEqual({
            activeScope: 'project',
            selectedFingerprintId: null,
            selectedFingerprintScope: null,
        });
    });

    it('切到同层也清空（幂等，不给调用方特判负担）', () => {
        expect(resetScopeSelection('global').selectedFingerprintId).toBeNull();
    });
});

describe('visibleTagChips', () => {
    it('默认最多 10 个，不改原数组', () => {
        const tags = Array.from({ length: 13 }, (_, i) => `t${i}`);
        expect(visibleTagChips(tags)).toHaveLength(10);
        expect(tags).toHaveLength(13);
        expect(visibleTagChips(['a'])).toEqual(['a']);
    });

    it('自定义上限与 0/负数', () => {
        expect(visibleTagChips(['a', 'b', 'c'], 2)).toEqual(['a', 'b']);
        expect(visibleTagChips(['a', 'b'], 0)).toEqual([]);
        expect(visibleTagChips(['a', 'b'], -1)).toEqual([]);
    });
});

describe('作用域常量', () => {
    it('三层固定顺序，标签带图标且互不相同', () => {
        expect(FINGERPRINT_SCOPES).toEqual(['template', 'global', 'project']);
        expect(SCOPE_LABELS.template).toContain('模板层');
        expect(SCOPE_LABELS.project).toContain('项目层');
        expect(new Set(Object.values(SCOPE_ICONS)).size).toBe(3);
    });
});
