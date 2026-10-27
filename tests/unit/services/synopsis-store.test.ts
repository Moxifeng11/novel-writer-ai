import { describe, expect, it } from 'vitest';
import { SynopsisStore } from '../../../services/synopsis-store';

function makeApp() {
    const files = new Map<string, string>();
    const dirs = new Set<string>();
    const adapter = {
        exists: async (path: string) => files.has(path) || dirs.has(path),
        read: async (path: string) => {
            const value = files.get(path);
            if (value === undefined) throw new Error(`not found: ${path}`);
            return value;
        },
        write: async (path: string, content: string) => { files.set(path, content); },
        remove: async (path: string) => { files.delete(path); },
        mkdir: async (path: string) => { dirs.add(path); },
    };
    return { app: { vault: { adapter } } as never, files, dirs };
}

describe('SynopsisStore — 多版本', () => {
    it('追加版本、设采用、读写草稿，不覆盖旧版本', async () => {
        const { app, files } = makeApp();
        const store = new SynopsisStore(app);

        const v1 = await store.saveVariant('书甲', {
            style: 'hook', title: '悬念版', text: '第一版简介。第二段？', wordCount: 12,
        });
        const v2 = await store.saveVariant('书甲', {
            style: 'satisfaction', title: '爽点版', text: '第二版简介。第二段！', wordCount: 13,
        });
        expect(v1.id).toBe('v001');
        expect(v2.id).toBe('v002');

        await store.setActive('书甲', v2.id);
        const snapshot = await store.load('书甲');
        expect(snapshot.versions).toHaveLength(2);
        expect(snapshot.index.activeId).toBe(v2.id);
        expect(files.get('书甲/04-项目总控/全书简介.md')).toContain('第二版简介');

        await store.saveDraft('书甲', '草稿内容');
        expect(await store.readDraft('书甲')).toBe('草稿内容');

        await store.deleteVersion('书甲', v1.id);
        const afterDelete = await store.load('书甲');
        expect(afterDelete.versions).toHaveLength(1);
    });
});
