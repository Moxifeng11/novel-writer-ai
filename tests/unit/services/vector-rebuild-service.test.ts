/**
 * vector-rebuild-service.test.ts — 批量重向量化编排
 *
 * 换 embedding 模型后旧向量会被跳过；重新拆解/重提指纹都要调用 AI。
 * 本服务只把已有样本文本按当前模型重算，因此必须验证：
 * 单条失败不中断、空样本如实跳过、进度顺序稳定。
 */

import { describe, it, expect, vi } from 'vitest';
import { rebuildAllVectors } from '../../../services/vector-rebuild-service';
import type { VectorRebuildDeps, VectorRebuildProgress } from '../../../services/vector-rebuild-service';

function makeDeps(overrides: Partial<VectorRebuildDeps> = {}): VectorRebuildDeps {
    return {
        listBooks: async () => [
            { bookId: 'b1', bookName: '书一' },
            { bookId: 'b2', bookName: '书二' },
        ],
        revectorizeBook: vi.fn(async () => undefined),
        listFingerprints: async () => [
            { id: 'f1', name: '指纹一', samples: ['样本 A', '样本 B'], scope: 'global' },
            { id: 'f2', name: '指纹二', samples: ['样本 C'], scope: 'project' },
        ],
        revectorizeFingerprint: vi.fn(async () => undefined),
        ...overrides,
    };
}

describe('rebuildAllVectors — 批量重向量化', () => {
    it('全部成功时统计与进度顺序正确', async () => {
        const deps = makeDeps();
        const progress: VectorRebuildProgress[] = [];

        const report = await rebuildAllVectors(deps, p => progress.push(p));

        expect(report.books).toMatchObject({ total: 2, rebuilt: 2, skipped: [], failed: [] });
        expect(report.fingerprints).toMatchObject({ total: 2, rebuilt: 2, skipped: [], failed: [] });
        expect(progress.map(p => `${p.phase}:${p.current}/${p.total}`)).toEqual([
            'books:1/2',
            'books:2/2',
            'fingerprints:1/2',
            'fingerprints:2/2',
        ]);
    });

    it('单本书失败不中断后续书籍', async () => {
        const revectorizeBook = vi.fn(async (bookId: string) => {
            if (bookId === 'b1') throw new Error('embedding 超时');
        });
        const deps = makeDeps({ revectorizeBook });

        const report = await rebuildAllVectors(deps);

        expect(revectorizeBook).toHaveBeenCalledTimes(2);
        expect(report.books.rebuilt).toBe(1);
        expect(report.books.failed).toEqual([{ name: '书一', reason: 'embedding 超时' }]);
    });

    it('没有样本文本的指纹记为跳过且不调用重算', async () => {
        const revectorizeFingerprint = vi.fn(async () => undefined);
        const deps = makeDeps({
            listFingerprints: async () => [
                { id: 'empty', name: '空指纹', samples: [], scope: 'global' },
                { id: 'ok', name: '正常指纹', samples: ['样本'], scope: 'global' },
            ],
            revectorizeFingerprint,
        });

        const report = await rebuildAllVectors(deps);

        expect(revectorizeFingerprint).toHaveBeenCalledTimes(1);
        expect(report.fingerprints.rebuilt).toBe(1);
        expect(report.fingerprints.skipped).toEqual([{ name: '空指纹', reason: '没有可用的样本文本' }]);
    });

    it('单个指纹失败不影响后续指纹', async () => {
        const revectorizeFingerprint = vi.fn(async (target: { id: string }) => {
            if (target.id === 'f1') throw new Error('写入失败');
        });
        const deps = makeDeps({ revectorizeFingerprint });

        const report = await rebuildAllVectors(deps);

        expect(revectorizeFingerprint).toHaveBeenCalledTimes(2);
        expect(report.fingerprints.rebuilt).toBe(1);
        expect(report.fingerprints.failed).toEqual([{ name: '指纹一', reason: '写入失败' }]);
    });

    it('空知识库与空指纹库返回零计数，不产生失败', async () => {
        const deps = makeDeps({
            listBooks: async () => [],
            listFingerprints: async () => [],
        });

        const report = await rebuildAllVectors(deps);

        expect(report.books).toMatchObject({ total: 0, rebuilt: 0, skipped: [], failed: [] });
        expect(report.fingerprints).toMatchObject({ total: 0, rebuilt: 0, skipped: [], failed: [] });
    });

    it('列举书籍失败时整体抛出（装配问题不应被当成单条失败）', async () => {
        const deps = makeDeps({
            listBooks: async () => {
                throw new Error('知识库未初始化');
            },
        });

        await expect(rebuildAllVectors(deps)).rejects.toThrow('知识库未初始化');
    });
});
