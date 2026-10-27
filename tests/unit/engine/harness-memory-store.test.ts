import { describe, it, expect } from 'vitest';
import {
    MemoryStore,
    createMemoryRecord,
    memoryRecordPath,
} from '../../../engine/harness/memory-store';

function memoryAdapter() {
    const files = new Map<string, string>();
    const dirs = new Set<string>();
    return {
        files,
        dirs,
        async exists(path: string) { return files.has(path) || dirs.has(path); },
        async mkdir(path: string) { dirs.add(path); },
        async write(path: string, content: string) { files.set(path, content); },
        async read(path: string) { return files.get(path) ?? ''; },
        async remove(path: string) { files.delete(path); },
        async list(path: string) {
            return {
                files: [...files.keys()].filter(file => file.startsWith(`${path}/`) && !file.slice(path.length + 1).includes('/')),
                folders: [...dirs].filter(dir => dir.startsWith(`${path}/`) && !dir.slice(path.length + 1).includes('/')),
            };
        },
    };
}

describe('MemoryStore', () => {
    it('AI 记忆默认 pending，确认后进入 confirmed', async () => {
        const adapter = memoryAdapter();
        const store = new MemoryStore(adapter as never, '短篇小说/测试');
        const record = createMemoryRecord({
            mode: 'short', scope: 'section', kind: 'continuity-risk',
            title: '第1节钩子', content: '主角发现合同日期异常', source: 'ai',
        });
        expect(record.status).toBe('pending');
        await store.savePending(record);
        expect(adapter.files.has(memoryRecordPath('短篇小说/测试', 'pending', record.id))).toBe(true);

        const confirmed = await store.confirm(record.id);
        expect(confirmed?.status).toBe('confirmed');
        expect(adapter.files.has(memoryRecordPath('短篇小说/测试', 'pending', record.id))).toBe(false);
        expect(adapter.files.has(memoryRecordPath('短篇小说/测试', 'confirmed', record.id))).toBe(true);
        expect((await store.listConfirmed())).toHaveLength(1);
    });

    it('拒绝后进入 rejected 且不出现在 confirmed', async () => {
        const adapter = memoryAdapter();
        const store = new MemoryStore(adapter as never, '剧本/测试');
        const record = createMemoryRecord({
            mode: 'script', scope: 'episode', kind: 'fact',
            title: '第1集事实', content: '主角是继承人', source: 'ai',
        });
        await store.savePending(record);
        const rejected = await store.reject(record.id);
        expect(rejected?.status).toBe('rejected');
        expect(await store.listConfirmed()).toHaveLength(0);
    });

    it('拒绝空标题/空内容；索引只包含元数据', async () => {
        expect(() => createMemoryRecord({ mode: 'short', scope: 'project', kind: 'fact', title: '', content: 'x' })).toThrow();
        expect(() => createMemoryRecord({ mode: 'short', scope: 'project', kind: 'fact', title: 'x', content: '' })).toThrow();
        const adapter = memoryAdapter();
        const store = new MemoryStore(adapter as never, '短篇小说/测试');
        const record = createMemoryRecord({ mode: 'short', scope: 'project', kind: 'fact', title: '事实', content: '内容' });
        await store.savePending(record);
        const index = await store.buildIndex();
        expect(index[0]).toMatchObject({ id: record.id, title: '事实', status: 'pending' });
        expect(index[0]).not.toHaveProperty('content');
    });
});