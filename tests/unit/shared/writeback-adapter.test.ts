import { describe, expect, it } from 'vitest';
import { adaptWritebackInputs, describeAdapterResult, resolveMarker } from '@/shared/writeback-adapter';
import type { ResolvedTarget } from '@/shared/writeback-adapter';

const resolver = (map: Record<string, ResolvedTarget>) => (name: string): ResolvedTarget => map[name] ?? { id: null };

describe('resolveMarker', () => {
    it('识别常用标记', () => {
        expect(resolveMarker('UPDATE_CHARACTER')).toEqual({ op: 'update_entity' });
        expect(resolveMarker('NEW_FORESHADOW')).toEqual({ op: 'new_entity', type: 'foreshadow' });
        expect(resolveMarker('RELATION')).toEqual({ op: 'relation' });
        expect(resolveMarker('GROWTH')).toEqual({ op: 'growth' });
    });

    it('未识别返回 null', () => {
        expect(resolveMarker('WHAT')).toBeNull();
    });
});

describe('adaptWritebackInputs', () => {
    it('更新类解析为 ID', () => {
        const result = adaptWritebackInputs([
            { marker: 'UPDATE_CHARACTER', name: '林玄', fields: { 境界: '筑基' } },
        ], resolver({ 林玄: { id: 'CHR-0001' } }));
        expect(result.commands[0].targetId).toBe('CHR-0001');
        expect(result.commands[0].fields).toEqual({ 境界: '筑基' });
    });

    it('新建类不需要解析目标，补名称字段', () => {
        const result = adaptWritebackInputs([
            { marker: 'NEW_FORESHADOW', name: '断剑来历', fields: { 状态: 'planted' } },
        ], resolver({}));
        expect(result.commands[0].op).toBe('new_entity');
        expect(result.commands[0].targetType).toBe('foreshadow');
        expect(result.commands[0].fields).toEqual({ 名称: '断剑来历', 状态: 'planted' });
    });

    it('未找到实体进 unresolved（不猜）', () => {
        const result = adaptWritebackInputs([
            { marker: 'UPDATE_CHARACTER', name: '路人', fields: {} },
        ], resolver({}));
        expect(result.commands).toEqual([]);
        expect(result.unresolved[0].reason).toContain('未找到');
    });

    it('多义名称进 unresolved 并带候选', () => {
        const result = adaptWritebackInputs([
            { marker: 'UPDATE_CHARACTER', name: '同名', fields: {} },
        ], resolver({ 同名: { id: null, candidates: ['CHR-0001', 'CHR-0002'] } }));
        expect(result.unresolved[0].candidates).toEqual(['CHR-0001', 'CHR-0002']);
    });

    it('未识别标记进 unresolved', () => {
        const result = adaptWritebackInputs([{ marker: '???', name: 'x', fields: {} }], resolver({}));
        expect(result.unresolved[0].reason).toContain('未识别的标记');
    });

    it('摘要文本', () => {
        const result = adaptWritebackInputs([{ marker: 'RELATION', name: '林玄', fields: { trust: 60 } }], resolver({ 林玄: { id: 'REL-0001' } }));
        expect(describeAdapterResult(result)).toContain('已结构化 1 条');
    });
});
