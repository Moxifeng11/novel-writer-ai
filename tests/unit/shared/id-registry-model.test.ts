/**
 * M3：唯一 ID 登记表模型测试
 */

import { describe, expect, it } from 'vitest';
import {
    allocate,
    emptyRegistry,
    findByPath,
    findById,
    formatId,
    ID_REGISTRY_VERSION,
    normalizeRegistry,
    nextId,
    parseId,
    rename,
    retire,
    validateRegistry,
} from '@/shared/id-registry-model';

describe('ID 格式', () => {
    it('前缀+补零序号', () => {
        expect(formatId('CHR', 1)).toBe('CHR-0001');
        expect(formatId('EVT', 42)).toBe('EVT-0042');
    });

    it('解析往返', () => {
        expect(parseId('CHR-0001')).toEqual({ prefix: 'CHR', seq: 1 });
        expect(parseId('bad')).toBeNull();
        expect(parseId('chr-0001')).toBeNull();
    });
});

describe('分配与计数', () => {
    it('按类型分配递增 ID', () => {
        let registry = emptyRegistry();
        const first = allocate(registry, 'character', 'p/人物/林玄.md', 1);
        registry = first.registry;
        const second = allocate(registry, 'character', 'p/人物/苏婉.md', 2);
        expect(first.id).toBe('CHR-0001');
        expect(second.id).toBe('CHR-0002');
        expect(second.registry.counters.CHR).toBe(2);
    });

    it('不同类型各自计数', () => {
        let registry = emptyRegistry();
        registry = allocate(registry, 'character', 'a.md', 1).registry;
        const evt = allocate(registry, 'timeline', 'b.md', 2);
        expect(evt.id).toBe('EVT-0001');
    });

    it('退休后 ID 不复用', () => {
        let registry = allocate(emptyRegistry(), 'foreshadow', 'a.md', 1).registry;
        registry = retire(registry, 'FSH-0001');
        expect(nextId(registry, 'foreshadow')).toBe('FSH-0002');
    });
});

describe('查询与改名', () => {
    it('按路径/ID 查询', () => {
        const registry = allocate(emptyRegistry(), 'item', 'p/物品/剑.md', 1).registry;
        expect(findByPath(registry, 'p/物品/剑.md')?.id).toBe('ITM-0001');
        expect(findById(registry, 'ITM-0001')?.path).toBe('p/物品/剑.md');
    });

    it('改名保 ID', () => {
        const registry = allocate(emptyRegistry(), 'item', 'p/物品/剑.md', 1).registry;
        const renamed = rename(registry, 'ITM-0001', 'p/物品/青锋剑.md');
        expect(findById(renamed, 'ITM-0001')?.path).toBe('p/物品/青锋剑.md');
    });
});

describe('校验与规范化', () => {
    it('合法表通过', () => {
        const registry = allocate(emptyRegistry(), 'character', 'a.md', 1).registry;
        expect(validateRegistry(registry)).toEqual([]);
    });

    it('发现重复 ID', () => {
        const registry = emptyRegistry();
        registry.entries.push(
            { id: 'CHR-0001', type: 'character', path: 'a.md', createdAt: 1 },
            { id: 'CHR-0001', type: 'character', path: 'b.md', createdAt: 2 },
        );
        expect(validateRegistry(registry).some(item => item.includes('重复'))).toBe(true);
    });

    it('规范化时从条目重建计数器', () => {
        const registry = normalizeRegistry({
            version: ID_REGISTRY_VERSION,
            entries: [{ id: 'CHR-0007', type: 'character', path: 'a.md', createdAt: 1 }],
        });
        expect(registry.counters.CHR).toBe(7);
        expect(nextId(registry, 'character')).toBe('CHR-0008');
    });

    it('损坏输入返回空表', () => {
        expect(normalizeRegistry(null).entries).toEqual([]);
        expect(normalizeRegistry({ entries: 'oops' }).entries).toEqual([]);
    });
});
