import { describe, expect, it } from 'vitest';
import { renderWritebackReview, validateWritebackCommands } from '@/shared/writeback-command-model';
import type { WritebackCommand } from '@/shared/writeback-command-model';

const cmd = (over: Partial<WritebackCommand>): WritebackCommand => ({ op: 'update_entity', fields: {}, ...over });
const known = ['CHR-0001', 'CHR-0002', 'REL-0001', 'FSH-0001'];

describe('validateWritebackCommands', () => {
    it('合法指令通过', () => {
        const result = validateWritebackCommands([cmd({ targetId: 'CHR-0001', fields: { 境界: '筑基' } })], known);
        expect(result.accepted).toHaveLength(1);
        expect(result.rejected).toEqual([]);
    });

    it('未知目标进入待确认（不按名字猜）', () => {
        const result = validateWritebackCommands([cmd({ targetId: 'CHR-9999', fields: { x: 'y' } })], known);
        expect(result.accepted).toEqual([]);
        expect(result.unresolved).toHaveLength(1);
    });

    it('关系数值越界被拒', () => {
        const result = validateWritebackCommands([
            cmd({ op: 'relation', targetId: 'REL-0001', fields: { trust: 150 } }),
        ], known);
        expect(result.rejected[0].reasons.join()).toContain('超出范围');
    });

    it('关系非数值被拒', () => {
        const result = validateWritebackCommands([
            cmd({ op: 'relation', targetId: 'REL-0001', fields: { trust: '很高' } }),
        ], known);
        expect(result.rejected[0].reasons.join()).toContain('不是数值');
    });

    it('关系未知字段被拒', () => {
        const result = validateWritebackCommands([
            cmd({ op: 'relation', targetId: 'REL-0001', fields: { 随便: 'x' } }),
        ], known);
        expect(result.rejected[0].reasons.join()).toContain('白名单');
    });

    it('伏笔非法状态被拒', () => {
        const result = validateWritebackCommands([
            cmd({ op: 'foreshadow', targetId: 'FSH-0001', fields: { 状态: '半开' } }),
        ], known);
        expect(result.rejected[0].reasons.join()).toContain('伏笔状态非法');
    });

    it('new_entity 缺 targetType 被拒', () => {
        const result = validateWritebackCommands([cmd({ op: 'new_entity', fields: { 名: 'x' } })], known);
        expect(result.rejected[0].reasons.join()).toContain('targetType');
    });

    it('new_entity 的 ID 已存在被拒', () => {
        const result = validateWritebackCommands([
            cmd({ op: 'new_entity', targetType: 'character', targetId: 'CHR-0001', fields: { 名: 'x' } }),
        ], known);
        expect(result.rejected[0].reasons.join()).toContain('已存在');
    });

    it('同目标同字段多次写记录冲突并保留最后一条', () => {
        const result = validateWritebackCommands([
            cmd({ targetId: 'CHR-0001', fields: { 境界: '练气' } }),
            cmd({ targetId: 'CHR-0001', fields: { 境界: '筑基' } }),
        ], known);
        expect(result.conflicts).toHaveLength(1);
        expect(result.conflicts[0].kept).toBe('筑基');
        expect(result.conflicts[0].dropped).toBe('练气');
    });
});

describe('renderWritebackReview', () => {
    it('渲染待确认与冲突', () => {
        const result = validateWritebackCommands([
            cmd({ targetId: 'CHR-9999', fields: { x: 'y' }, raw: 'UPDATE_CHARACTER: 路人' }),
            cmd({ targetId: 'CHR-0001', fields: { 境界: 'a' } }),
            cmd({ targetId: 'CHR-0001', fields: { 境界: 'b' } }),
        ], known);
        const text = renderWritebackReview(result);
        expect(text).toContain('待确认');
        expect(text).toContain('冲突');
    });

    it('无问题时返回空串', () => {
        expect(renderWritebackReview({ accepted: [], rejected: [], conflicts: [], unresolved: [] })).toBe('');
    });
});
