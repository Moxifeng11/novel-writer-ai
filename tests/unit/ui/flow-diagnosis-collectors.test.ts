/**
 * flow-diagnosis-collectors.test.ts — 链路诊断采集器回归（DSH-20261112-14）
 *
 * 孤儿向量对账接入 collectKnowledge 后，该文件超过 view-tests 阈值；
 * 这里锁采集器行为：孤儿降级注入、store 异常不抛错（采集失败按未知计入）、
 * 无项目时约束流返回全空。判定函数本身在 shared/link-status-compute 已有单测。
 */
import { describe, expect, it, vi } from 'vitest';
import { createFlowDiagnosisDeps } from '../../../ui/services/flow-diagnosis-collectors';
import type NovelWriterPlugin from '../../../main';

function makeHost(options: {
    books?: Array<Record<string, unknown>>;
    orphanIds?: string[];
    storeThrows?: boolean;
    activeProject?: string | null;
} = {}) {
    const store = {
        getLoadedBookIds: () => (options.orphanIds?.length ? ['kb_ghost'] : []),
        isLoaded: () => true,
        reconcileWithIndex: options.storeThrows
            ? () => { throw new Error('对账炸了'); }
            : (ids: string[]) => ({
                orphans: options.orphanIds ?? [],
                missing: ids.filter(id => !(options.orphanIds ?? []).includes(id) && id !== 'kb_live'),
                healthy: [],
            }),
    };
    const plugin = {
        knowledgeBaseManager: { getAllBooks: vi.fn(async () => options.books ?? []) },
        knowledgeVectorStore: store,
        getActiveProject: () => options.activeProject ?? null,
        settings: {},
    } as unknown as NovelWriterPlugin;
    return { deps: createFlowDiagnosisDeps({ app: {} as never, plugin }), plugin };
}

describe('collectKnowledge 孤儿对账注入', () => {
    it('有孤儿：degradations 追加「向量库 N 本不在知识库索引」', async () => {
        const { deps } = makeHost({
            books: [{ id: 'kb_live', breakdownStatus: 'completed', vectorStatus: 'done' }],
            orphanIds: ['kb_ghost'],
        });
        const input = await deps.collectKnowledge();
        expect(input.bookTotal).toBe(1);
        expect(input.vectorDone).toBe(1);
        expect(input.degradations?.some(d => d.includes('孤儿向量'))).toBe(true);
        expect(input.degradations?.some(d => d.includes('1 本不在知识库索引'))).toBe(true);
        // DSH-20261112-17：环节级呈现——orphanCount 随输入透传给判定函数
        expect(input.orphanCount).toBe(1);
    });

    it('无孤儿：不追加孤儿降级（原有降级列表保持）', async () => {
        const { deps } = makeHost({ books: [{ id: 'kb_live' }], orphanIds: [] });
        const input = await deps.collectKnowledge();
        expect(input.degradations?.some(d => d.includes('孤儿向量'))).toBe(false);
    });

    it('store 对账抛错：采集不抛错、孤儿降级缺省（诊断不能因服务故障整体失败）', async () => {
        const { deps } = makeHost({ books: [], storeThrows: true });
        const input = await deps.collectKnowledge();
        expect(input.bookTotal).toBe(0);
        expect(input.storeReady).toBe(true);
        expect(input.degradations?.some(d => d.includes('孤儿向量'))).toBe(false);
    });

    it('store 缺 reconcileWithIndex（旧宿主）：按「无孤儿」处理不抛错', async () => {
        const host = makeHost({ books: [] });
        // 真正构造旧宿主形态：删掉方法，让 ?.reconcileWithIndex?. 分支命中
        delete (host.plugin.knowledgeVectorStore as unknown as Record<string, unknown>).reconcileWithIndex;
        const input = await host.deps.collectKnowledge();
        expect(input).toBeTruthy();
        expect(input.storeReady).toBe(true);
        expect(input.degradations?.some(d => d.includes('孤儿向量'))).toBe(false);
    });
});

describe('collectConstraint 无项目', () => {
    it('无项目：返回全空输入（不做设定/审核判定）', async () => {
        const { deps } = makeHost({ activeProject: null });
        const input = await deps.collectConstraint();
        expect(input).toEqual({
            sourceCount: 0,
            settingExists: false,
            reviewStatus: 'none',
            bound: false,
            rulesHasContent: false,
        });
    });
});
