/**
 * memory patch/history 单测：局部替换语义 + 快照保留策略
 */

import { describe, expect, it } from 'vitest';
import { applyMemoryPatch, validateMemoryPatch } from '@/domains/memory/patch';
import {
    createHistorySnapshot,
    describeSnapshot,
    expiredSnapshotIds,
    MEMORY_HISTORY_KEEP,
    parseHistorySnapshot,
    snapshotToGraph,
} from '@/domains/memory/history';
import { emptyGraph, type MemoryEdge } from '@/domains/memory/model';

const edge = (id: string): MemoryEdge => ({ id, from: 'a', to: 'b', type: 'ally', label: '' });

describe('applyMemoryPatch 局部替换', () => {
    it('唯一匹配被替换', () => {
        const result = applyMemoryPatch('# 林玄\n\n外门弟子', '外门弟子', '内门弟子');
        expect(result.changed).toBe(true);
        expect(result.content).toContain('内门弟子');
    });

    it('newText 为空即删除该段', () => {
        const result = applyMemoryPatch('A\n要删掉的行\nB', '要删掉的行\n', '');
        expect(result.changed).toBe(true);
        expect(result.content).toBe('A\nB');
    });

    it('找不到原文 → 报错不修改', () => {
        const result = applyMemoryPatch('原文', '不存在', 'x');
        expect(result.changed).toBe(false);
        expect(result.error).toContain('找不到');
    });

    it('出现多次 → 报错要求更长上下文', () => {
        const result = applyMemoryPatch('同一段\n同一段', '同一段', 'x');
        expect(result.changed).toBe(false);
        expect(result.error).toContain('多次');
    });

    it('oldText 为空 → 报错', () => {
        expect(applyMemoryPatch('a', '', 'b').error).toContain('不能为空');
    });

    it('新旧相同 → changed=false（不产生空版本）', () => {
        const result = applyMemoryPatch('abc', 'abc', 'abc');
        expect(result.changed).toBe(false);
        expect(result.content).toBe('abc');
    });
});

describe('validateMemoryPatch 参数校验', () => {
    it('合法 patch 通过', () => {
        expect(validateMemoryPatch({ oldText: 'a', newText: 'b' })).toBeNull();
    });

    it('空 oldText 被拒绝', () => {
        expect(validateMemoryPatch({ oldText: '  ', newText: 'b' })).toContain('oldText');
    });

    it('newText 非字符串被拒绝', () => {
        expect(validateMemoryPatch({ oldText: 'a', newText: 1 })).toContain('newText');
    });

    it('非对象被拒绝', () => {
        expect(validateMemoryPatch(null)).toContain('对象');
    });
});

describe('历史快照', () => {
    const graph = { ...emptyGraph(1), edges: [edge('e1'), edge('e2')] };

    it('创建快照保留边与原因', () => {
        const snapshot = createHistorySnapshot(graph, '加关系', 1000);
        expect(snapshot.createdAt).toBe(1000);
        expect(snapshot.edges).toHaveLength(2);
        expect(snapshot.reason).toBe('加关系');
    });

    it('空原因回落为「未注明原因」', () => {
        expect(createHistorySnapshot(graph, '  ').reason).toBe('未注明原因');
    });

    it('解析损坏返回 null', () => {
        expect(parseHistorySnapshot('{oops')).toBeNull();
        expect(parseHistorySnapshot(JSON.stringify({ version: 0, edges: [] }))).toBeNull();
    });

    it('解析正常快照', () => {
        const raw = JSON.stringify(createHistorySnapshot(graph, 'x', 5));
        expect(parseHistorySnapshot(raw)?.edges).toHaveLength(2);
    });

    it('超出保留数时返回最旧的 id', () => {
        const snapshots = Array.from({ length: MEMORY_HISTORY_KEEP + 3 }, (_, index) =>
            createHistorySnapshot(graph, `s${index}`, 1000 + index));
        const expired = expiredSnapshotIds(snapshots, MEMORY_HISTORY_KEEP);
        expect(expired).toHaveLength(3);
        expect(expired).toContain(String(1000));
        expect(expired).toContain(String(1001));
    });

    it('未超限不删除', () => {
        expect(expiredSnapshotIds([createHistorySnapshot(graph, 'x', 1)], MEMORY_HISTORY_KEEP)).toEqual([]);
    });

    it('恢复为图保留边', () => {
        const snapshot = createHistorySnapshot(graph, 'x', 1);
        expect(snapshotToGraph(snapshot).edges).toHaveLength(2);
    });

    it('展示文本含关系数与原因', () => {
        const text = describeSnapshot(createHistorySnapshot(graph, '加关系', 1000));
        expect(text).toContain('2 条关系');
        expect(text).toContain('加关系');
    });
});
