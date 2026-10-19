import { describe, it, expect, beforeEach } from 'vitest';
import { SuggestionManager } from '../../../engine/suggestion-manager';
import type {
    AnalysisSuggestion,
    SuggestionType,
    SuggestionStatus,
} from '../../../engine/types/analysis-suggestion';

function createMockSuggestion(
    overrides: Partial<AnalysisSuggestion> = {}
): AnalysisSuggestion {
    return {
        id: overrides.id ?? 'test-suggestion-1',
        type: (overrides.type as SuggestionType) ?? 'character',
        status: (overrides.status as SuggestionStatus) ?? 'pending',
        confidence: overrides.confidence ?? 0.8,
        source: overrides.source ?? 'rule',
        payload: overrides.payload ?? { name: '测试角色' },
        createdAt: overrides.createdAt ?? Date.now(),
        ...overrides,
    };
}

describe('SuggestionManager — 构造与初始化', () => {
    it('默认构造函数创建空管理器', () => {
        const manager = new SuggestionManager();
        expect(manager.getAllSuggestions()).toEqual([]);
        expect(manager.getStats().total).toBe(0);
    });

    it('接受初始建议数组', () => {
        const suggestions = [
            createMockSuggestion({ id: 's1' }),
            createMockSuggestion({ id: 's2' }),
        ];
        const manager = new SuggestionManager(suggestions);
        expect(manager.getAllSuggestions().length).toBe(2);
        expect(manager.getSuggestionById('s1')).toBeDefined();
        expect(manager.getSuggestionById('s2')).toBeDefined();
    });

    it('空初始数组不报错', () => {
        const manager = new SuggestionManager([]);
        expect(manager.getAllSuggestions()).toEqual([]);
    });
});

describe('SuggestionManager — 查询方法', () => {
    let manager: SuggestionManager;

    beforeEach(() => {
        manager = new SuggestionManager([
            createMockSuggestion({ id: 's1', type: 'character', status: 'pending' }),
            createMockSuggestion({ id: 's2', type: 'plot', status: 'adopted' }),
            createMockSuggestion({ id: 's3', type: 'character', status: 'rejected' }),
            createMockSuggestion({ id: 's4', type: 'quality', status: 'pending' }),
            createMockSuggestion({ id: 's5', type: 'character', status: 'modified' }),
        ]);
    });

    describe('getAllSuggestions', () => {
        it('返回所有建议', () => {
            const all = manager.getAllSuggestions();
            expect(all.length).toBe(5);
        });

        it('按类型过滤', () => {
            const characterSuggestions = manager.getAllSuggestions('character');
            expect(characterSuggestions.length).toBe(3);
            for (const s of characterSuggestions) {
                expect(s.type).toBe('character');
            }
        });

        it('不存在的类型返回空数组', () => {
            const result = manager.getAllSuggestions('theme' as SuggestionType);
            expect(result).toEqual([]);
        });
    });

    describe('getPendingSuggestions', () => {
        it('返回所有 pending 状态的建议', () => {
            const pending = manager.getPendingSuggestions();
            expect(pending.length).toBe(2);
            for (const s of pending) {
                expect(s.status).toBe('pending');
            }
        });

        it('按类型过滤 pending 建议', () => {
            const pending = manager.getPendingSuggestions('character');
            expect(pending.length).toBe(1);
            expect(pending[0].id).toBe('s1');
        });
    });

    describe('getSuggestionById', () => {
        it('存在的 ID 返回建议', () => {
            const suggestion = manager.getSuggestionById('s1');
            expect(suggestion).toBeDefined();
            expect(suggestion!.id).toBe('s1');
        });

        it('不存在的 ID 返回 undefined', () => {
            expect(manager.getSuggestionById('nonexistent')).toBeUndefined();
        });
    });

    describe('getSuggestionsByStatus', () => {
        it('按状态过滤', () => {
            const pending = manager.getSuggestionsByStatus('pending');
            expect(pending.length).toBe(2);

            const adopted = manager.getSuggestionsByStatus('adopted');
            expect(adopted.length).toBe(1);
            expect(adopted[0].id).toBe('s2');

            const rejected = manager.getSuggestionsByStatus('rejected');
            expect(rejected.length).toBe(1);
            expect(rejected[0].id).toBe('s3');

            const modified = manager.getSuggestionsByStatus('modified');
            expect(modified.length).toBe(1);
            expect(modified[0].id).toBe('s5');
        });

        it('空状态返回空数组', () => {
            const emptyManager = new SuggestionManager();
            expect(emptyManager.getSuggestionsByStatus('pending')).toEqual([]);
        });
    });
});

describe('SuggestionManager — 操作方法', () => {
    let manager: SuggestionManager;

    beforeEach(() => {
        manager = new SuggestionManager();
    });

    describe('addSuggestion', () => {
        it('添加建议并返回 ID', () => {
            const id = manager.addSuggestion({
                type: 'character',
                confidence: 0.9,
                source: 'rule',
                payload: { name: '新角色' },
            });

            expect(id).toBeDefined();
            expect(typeof id).toBe('string');

            const suggestion = manager.getSuggestionById(id);
            expect(suggestion).toBeDefined();
            expect(suggestion!.type).toBe('character');
            expect(suggestion!.confidence).toBe(0.9);
            expect(suggestion!.status).toBe('pending');
            expect(suggestion!.createdAt).toBeGreaterThan(0);
        });

        it('可指定初始状态', () => {
            const id = manager.addSuggestion({
                type: 'plot',
                confidence: 0.7,
                source: 'llm',
                payload: {},
                status: 'adopted',
            });

            const suggestion = manager.getSuggestionById(id);
            expect(suggestion!.status).toBe('adopted');
        });

        it('生成的 ID 唯一', () => {
            const ids: string[] = [];
            for (let i = 0; i < 100; i++) {
                const id = manager.addSuggestion({
                    type: 'character',
                    confidence: 0.5,
                    source: 'rule',
                    payload: {},
                });
                ids.push(id);
            }
            const uniqueIds = new Set(ids);
            expect(uniqueIds.size).toBe(100);
        });
    });

    describe('adopt', () => {
        it('pending → adopted 成功', () => {
            const id = manager.addSuggestion({
                type: 'character',
                confidence: 0.8,
                source: 'rule',
                payload: { name: '角色A' },
            });

            const result = manager.adopt(id);
            expect(result).toBe(true);

            const suggestion = manager.getSuggestionById(id);
            expect(suggestion!.status).toBe('adopted');
            expect(suggestion!.adoptedAt).toBeDefined();
        });

        it('pending → modified（带 modifiedPayload）成功', () => {
            const id = manager.addSuggestion({
                type: 'character',
                confidence: 0.8,
                source: 'rule',
                payload: { name: '角色A', age: 20 },
            });

            const modifiedPayload = { name: '角色A修改版', age: 25 };
            const result = manager.adopt(id, modifiedPayload);
            expect(result).toBe(true);

            const suggestion = manager.getSuggestionById(id);
            expect(suggestion!.status).toBe('modified');
            expect(suggestion!.payload).toEqual(modifiedPayload);
            expect(suggestion!.originalPayload).toEqual({ name: '角色A', age: 20 });
            expect(suggestion!.adoptedAt).toBeDefined();
        });

        it('adopted → pending 非法转移返回 false', () => {
            const id = manager.addSuggestion({
                type: 'character',
                confidence: 0.8,
                source: 'rule',
                payload: {},
                status: 'adopted',
            });

            const result = manager.adopt(id);
            expect(result).toBe(false);
        });

        it('不存在的 ID 返回 false', () => {
            expect(manager.adopt('nonexistent')).toBe(false);
        });
    });

    describe('reject', () => {
        it('pending → rejected 成功', () => {
            const id = manager.addSuggestion({
                type: 'character',
                confidence: 0.8,
                source: 'rule',
                payload: {},
            });

            const result = manager.reject(id);
            expect(result).toBe(true);

            const suggestion = manager.getSuggestionById(id);
            expect(suggestion!.status).toBe('rejected');
        });

        it('adopted → rejected 非法转移返回 false', () => {
            const id = manager.addSuggestion({
                type: 'character',
                confidence: 0.8,
                source: 'rule',
                payload: {},
                status: 'adopted',
            });

            const result = manager.reject(id);
            expect(result).toBe(false);
        });

        it('rejected → rejected 非法转移返回 false', () => {
            const id = manager.addSuggestion({
                type: 'character',
                confidence: 0.8,
                source: 'rule',
                payload: {},
                status: 'rejected',
            });

            const result = manager.reject(id);
            expect(result).toBe(false);
        });

        it('不存在的 ID 返回 false', () => {
            expect(manager.reject('nonexistent')).toBe(false);
        });
    });

    describe('removeSuggestion', () => {
        it('移除存在的建议', () => {
            const id = manager.addSuggestion({
                type: 'character',
                confidence: 0.8,
                source: 'rule',
                payload: {},
            });

            expect(manager.getSuggestionById(id)).toBeDefined();

            const result = manager.removeSuggestion(id);
            expect(result).toBe(true);
            expect(manager.getSuggestionById(id)).toBeUndefined();
        });

        it('移除不存在的建议返回 false', () => {
            expect(manager.removeSuggestion('nonexistent')).toBe(false);
        });
    });
});

describe('SuggestionManager — 批量操作', () => {
    let manager: SuggestionManager;

    beforeEach(() => {
        manager = new SuggestionManager([
            createMockSuggestion({ id: 's1', type: 'character', status: 'pending', confidence: 0.9 }),
            createMockSuggestion({ id: 's2', type: 'character', status: 'pending', confidence: 0.6 }),
            createMockSuggestion({ id: 's3', type: 'plot', status: 'pending', confidence: 0.8 }),
            createMockSuggestion({ id: 's4', type: 'character', status: 'adopted', confidence: 0.7 }),
            createMockSuggestion({ id: 's5', type: 'quality', status: 'pending', confidence: 0.4 }),
        ]);
    });

    describe('batchAdopt', () => {
        it('批量采纳所有 pending 建议', () => {
            const count = manager.batchAdopt({});
            expect(count).toBe(4);

            const stats = manager.getStats();
            expect(stats.adopted).toBe(5);
            expect(stats.pending).toBe(0);
        });

        it('按类型批量采纳', () => {
            const count = manager.batchAdopt({ type: 'character' });
            expect(count).toBe(2);

            const characterPending = manager.getPendingSuggestions('character');
            expect(characterPending.length).toBe(0);

            const plotPending = manager.getPendingSuggestions('plot');
            expect(plotPending.length).toBe(1);
        });

        it('按最低置信度批量采纳', () => {
            const count = manager.batchAdopt({ minConfidence: 0.8 });
            expect(count).toBe(2);

            const stats = manager.getStats();
            expect(stats.adopted).toBe(3);
            expect(stats.pending).toBe(2);
        });

        it('同时按类型和置信度过滤', () => {
            const count = manager.batchAdopt({ type: 'character', minConfidence: 0.8 });
            expect(count).toBe(1);

            const suggestion = manager.getSuggestionById('s1');
            expect(suggestion!.status).toBe('adopted');
        });

        it('空列表返回 0', () => {
            const emptyManager = new SuggestionManager();
            expect(emptyManager.batchAdopt({})).toBe(0);
        });
    });

    describe('batchReject', () => {
        it('批量拒绝所有 pending 建议', () => {
            const count = manager.batchReject({});
            expect(count).toBe(4);

            const stats = manager.getStats();
            expect(stats.rejected).toBe(4);
            expect(stats.pending).toBe(0);
        });

        it('按类型批量拒绝', () => {
            const count = manager.batchReject({ type: 'plot' });
            expect(count).toBe(1);

            const plotPending = manager.getPendingSuggestions('plot');
            expect(plotPending.length).toBe(0);

            const characterPending = manager.getPendingSuggestions('character');
            expect(characterPending.length).toBe(2);
        });

        it('按最高置信度批量拒绝', () => {
            const count = manager.batchReject({ maxConfidence: 0.5 });
            expect(count).toBe(1);

            const qualitySuggestion = manager.getSuggestionById('s5');
            expect(qualitySuggestion!.status).toBe('rejected');
        });

        it('同时按类型和置信度过滤', () => {
            const count = manager.batchReject({ type: 'character', maxConfidence: 0.7 });
            expect(count).toBe(1);

            const suggestion = manager.getSuggestionById('s2');
            expect(suggestion!.status).toBe('rejected');
        });

        it('空列表返回 0', () => {
            const emptyManager = new SuggestionManager();
            expect(emptyManager.batchReject({})).toBe(0);
        });
    });
});

describe('SuggestionManager — 状态机', () => {
    let manager: SuggestionManager;

    beforeEach(() => {
        manager = new SuggestionManager();
    });

    it('pending → adopted → pending（重置）', () => {
        const id = manager.addSuggestion({
            type: 'character',
            confidence: 0.8,
            source: 'rule',
            payload: {},
        });

        expect(manager.adopt(id)).toBe(true);
        expect(manager.getSuggestionById(id)!.status).toBe('adopted');
    });

    it('pending → rejected → pending（重置）', () => {
        const id = manager.addSuggestion({
            type: 'character',
            confidence: 0.8,
            source: 'rule',
            payload: {},
        });

        expect(manager.reject(id)).toBe(true);
        expect(manager.getSuggestionById(id)!.status).toBe('rejected');
    });

    it('pending → modified → adopted', () => {
        const id = manager.addSuggestion({
            type: 'character',
            confidence: 0.8,
            source: 'rule',
            payload: { name: 'A' },
        });

        expect(manager.adopt(id, { name: 'B' })).toBe(true);
        expect(manager.getSuggestionById(id)!.status).toBe('modified');
    });

    it('adopted → rejected 非法转移', () => {
        const id = manager.addSuggestion({
            type: 'character',
            confidence: 0.8,
            source: 'rule',
            payload: {},
            status: 'adopted',
        });

        expect(manager.reject(id)).toBe(false);
    });

    it('rejected → adopted 非法转移', () => {
        const id = manager.addSuggestion({
            type: 'character',
            confidence: 0.8,
            source: 'rule',
            payload: {},
            status: 'rejected',
        });

        expect(manager.adopt(id)).toBe(false);
    });

    it('modified → rejected 非法转移', () => {
        const id = manager.addSuggestion({
            type: 'character',
            confidence: 0.8,
            source: 'rule',
            payload: {},
            status: 'modified',
        });

        expect(manager.reject(id)).toBe(false);
    });
});

describe('SuggestionManager — 状态统计', () => {
    it('空管理器统计正确', () => {
        const manager = new SuggestionManager();
        const stats = manager.getStats();
        expect(stats).toEqual({
            total: 0,
            pending: 0,
            adopted: 0,
            rejected: 0,
            modified: 0,
        });
    });

    it('混合状态统计正确', () => {
        const manager = new SuggestionManager([
            createMockSuggestion({ id: 's1', status: 'pending' }),
            createMockSuggestion({ id: 's2', status: 'pending' }),
            createMockSuggestion({ id: 's3', status: 'adopted' }),
            createMockSuggestion({ id: 's4', status: 'rejected' }),
            createMockSuggestion({ id: 's5', status: 'modified' }),
        ]);

        const stats = manager.getStats();
        expect(stats.total).toBe(5);
        expect(stats.pending).toBe(2);
        expect(stats.adopted).toBe(1);
        expect(stats.rejected).toBe(1);
        expect(stats.modified).toBe(1);
    });
});

describe('SuggestionManager — 序列化', () => {
    it('toJSON 返回所有建议数组', () => {
        const suggestions = [
            createMockSuggestion({ id: 's1' }),
            createMockSuggestion({ id: 's2' }),
        ];
        const manager = new SuggestionManager(suggestions);

        const json = manager.toJSON();
        expect(Array.isArray(json)).toBe(true);
        expect(json.length).toBe(2);
    });

    it('fromJSON 加载数据', () => {
        const manager = new SuggestionManager();
        const data: AnalysisSuggestion[] = [
            createMockSuggestion({ id: 's1' }),
            createMockSuggestion({ id: 's2' }),
        ];

        manager.fromJSON(data);
        expect(manager.getAllSuggestions().length).toBe(2);
        expect(manager.getSuggestionById('s1')).toBeDefined();
    });

    it('fromJSON 清除现有数据', () => {
        const manager = new SuggestionManager([
            createMockSuggestion({ id: 'old-1' }),
        ]);

        manager.fromJSON([
            createMockSuggestion({ id: 'new-1' }),
        ]);

        expect(manager.getAllSuggestions().length).toBe(1);
        expect(manager.getSuggestionById('old-1')).toBeUndefined();
        expect(manager.getSuggestionById('new-1')).toBeDefined();
    });

    it('fromJSON 空数组清空所有建议', () => {
        const manager = new SuggestionManager([
            createMockSuggestion({ id: 's1' }),
        ]);

        manager.fromJSON([]);
        expect(manager.getAllSuggestions().length).toBe(0);
    });

    it('fromJSON 忽略无效数据（无 id）', () => {
        const manager = new SuggestionManager();
        const data = [
            { type: 'character' } as AnalysisSuggestion,
            createMockSuggestion({ id: 'valid' }),
        ];

        manager.fromJSON(data);
        expect(manager.getAllSuggestions().length).toBe(1);
        expect(manager.getSuggestionById('valid')).toBeDefined();
    });
});

describe('SuggestionManager — 多次修改同一个建议', () => {
    let manager: SuggestionManager;

    beforeEach(() => {
        manager = new SuggestionManager();
    });

    it('pending → modified（第一次修改）', () => {
        const id = manager.addSuggestion({
            type: 'character',
            confidence: 0.8,
            source: 'rule',
            payload: { name: '角色A', age: 20 },
        });

        const result = manager.adopt(id, { name: '角色A修改版', age: 25 });
        expect(result).toBe(true);

        const suggestion = manager.getSuggestionById(id);
        expect(suggestion!.status).toBe('modified');
        expect(suggestion!.payload).toEqual({ name: '角色A修改版', age: 25 });
        expect(suggestion!.originalPayload).toEqual({ name: '角色A', age: 20 });
    });

    it('modified → adopted（修改后采纳）', () => {
        const id = manager.addSuggestion({
            type: 'character',
            confidence: 0.8,
            source: 'rule',
            payload: { name: '角色A' },
        });

        manager.adopt(id, { name: '角色A修改版' });
        expect(manager.getSuggestionById(id)!.status).toBe('modified');

        const result = manager.adopt(id);
        expect(result).toBe(true);
        expect(manager.getSuggestionById(id)!.status).toBe('adopted');
    });

    it('pending → modified → pending → modified（多次修改循环）', () => {
        const id = manager.addSuggestion({
            type: 'character',
            confidence: 0.8,
            source: 'rule',
            payload: { name: 'v1' },
        });

        expect(manager.adopt(id, { name: 'v2' })).toBe(true);
        expect(manager.getSuggestionById(id)!.status).toBe('modified');
        expect(manager.getSuggestionById(id)!.payload.name).toBe('v2');

        manager.fromJSON([
            createMockSuggestion({ id, status: 'pending', payload: { name: 'v2' } }),
        ]);

        expect(manager.adopt(id, { name: 'v3' })).toBe(true);
        expect(manager.getSuggestionById(id)!.status).toBe('modified');
        expect(manager.getSuggestionById(id)!.payload.name).toBe('v3');
    });

    it('修改后 payload 与 originalPayload 不同', () => {
        const id = manager.addSuggestion({
            type: 'character',
            confidence: 0.8,
            source: 'rule',
            payload: { name: '原名称', age: 20 },
        });

        manager.adopt(id, { name: '新名称', age: 25 });

        const suggestion = manager.getSuggestionById(id);
        expect(suggestion!.originalPayload).toBeDefined();
        expect(suggestion!.originalPayload!.name).toBe('原名称');
        expect(suggestion!.payload.name).toBe('新名称');
    });

    it('adopt 不带 modifiedPayload 时状态为 adopted 而非 modified', () => {
        const id = manager.addSuggestion({
            type: 'character',
            confidence: 0.8,
            source: 'rule',
            payload: { name: '角色A' },
        });

        manager.adopt(id);
        const suggestion = manager.getSuggestionById(id);
        expect(suggestion!.status).toBe('adopted');
        expect(suggestion!.originalPayload).toBeUndefined();
    });

    it('多次 batchAdopt 不重复计数', () => {
        manager.addSuggestion({
            type: 'character',
            confidence: 0.9,
            source: 'rule',
            payload: {},
        });
        manager.addSuggestion({
            type: 'character',
            confidence: 0.8,
            source: 'rule',
            payload: {},
        });

        const count1 = manager.batchAdopt({ type: 'character' });
        expect(count1).toBe(2);

        const count2 = manager.batchAdopt({ type: 'character' });
        expect(count2).toBe(0);
    });

    it('多次 batchReject 不重复计数', () => {
        manager.addSuggestion({
            type: 'character',
            confidence: 0.5,
            source: 'rule',
            payload: {},
        });
        manager.addSuggestion({
            type: 'character',
            confidence: 0.4,
            source: 'rule',
            payload: {},
        });

        const count1 = manager.batchReject({ type: 'character' });
        expect(count1).toBe(2);

        const count2 = manager.batchReject({ type: 'character' });
        expect(count2).toBe(0);
    });
});

describe('SuggestionManager — 按来源筛选', () => {
    let manager: SuggestionManager;

    beforeEach(() => {
        manager = new SuggestionManager([
            createMockSuggestion({ id: 's1', source: 'rule' }),
            createMockSuggestion({ id: 's2', source: 'vector' }),
            createMockSuggestion({ id: 's3', source: 'llm' }),
            createMockSuggestion({ id: 's4', source: 'rule' }),
            createMockSuggestion({ id: 's5', source: 'vector' }),
        ]);
    });

    it('getAllSuggestions 可配合 source 过滤（手动 filter）', () => {
        const ruleSuggestions = manager.getAllSuggestions().filter(s => s.source === 'rule');
        expect(ruleSuggestions.length).toBe(2);

        const llmSuggestions = manager.getAllSuggestions().filter(s => s.source === 'llm');
        expect(llmSuggestions.length).toBe(1);

        const vectorSuggestions = manager.getAllSuggestions().filter(s => s.source === 'vector');
        expect(vectorSuggestions.length).toBe(2);
    });

    it('getPendingSuggestions 可配合 source 过滤（手动 filter）', () => {
        const manager2 = new SuggestionManager([
            createMockSuggestion({ id: 's1', source: 'rule', status: 'pending' }),
            createMockSuggestion({ id: 's2', source: 'llm', status: 'adopted' }),
            createMockSuggestion({ id: 's3', source: 'rule', status: 'rejected' }),
            createMockSuggestion({ id: 's4', source: 'vector', status: 'pending' }),
        ]);

        const pendingRule = manager2.getPendingSuggestions().filter(s => s.source === 'rule');
        expect(pendingRule.length).toBe(1);
        expect(pendingRule[0].id).toBe('s1');
    });
});

describe('SuggestionManager — 边界条件', () => {
    it('空列表操作不报错', () => {
        const manager = new SuggestionManager();

        expect(() => manager.getPendingSuggestions()).not.toThrow();
        expect(() => manager.getAllSuggestions()).not.toThrow();
        expect(() => manager.getSuggestionById('nonexistent')).not.toThrow();
        expect(() => manager.getSuggestionsByStatus('pending')).not.toThrow();
        expect(() => manager.adopt('nonexistent')).not.toThrow();
        expect(() => manager.reject('nonexistent')).not.toThrow();
        expect(() => manager.removeSuggestion('nonexistent')).not.toThrow();
        expect(() => manager.batchAdopt({})).not.toThrow();
        expect(() => manager.batchReject({})).not.toThrow();
        expect(() => manager.getStats()).not.toThrow();
        expect(() => manager.toJSON()).not.toThrow();
        expect(() => manager.fromJSON([])).not.toThrow();
    });

    it('重复 ID（fromJSON 时后面覆盖前面）', () => {
        const manager = new SuggestionManager();
        const data: AnalysisSuggestion[] = [
            createMockSuggestion({ id: 'dup', confidence: 0.5 }),
            createMockSuggestion({ id: 'dup', confidence: 0.9 }),
        ];

        manager.fromJSON(data);
        expect(manager.getAllSuggestions().length).toBe(1);
        expect(manager.getSuggestionById('dup')!.confidence).toBe(0.9);
    });
});
