/**
 * Task 10 vault 落盘 — GenerationCheckpointStore 的 Obsidian 端口测试
 * 验证 CheckpointStoragePort 的 vault 实现（key → 文件路径映射 + 落盘/恢复/清除）。
 */
import { describe, it, expect } from 'vitest';
import { MockFileSystem } from '../../../shared/file-system-port';
import { VaultCheckpointStorage } from '../../../engine/generation-checkpoint-vault';
import { GenerationCheckpointStore, makeCheckpointKey } from '../../../engine/generation-checkpoint';

describe('VaultCheckpointStorage — key 到路径映射', () => {
    it('write 后 read 恢复（重启恢复）', async () => {
        const fs = new MockFileSystem();
        const storage = new VaultCheckpointStorage(fs);
        const key = makeCheckpointKey('测试项目', '第3章', 2, 'abc123');
        await storage.write(key, JSON.stringify({ content: '部分正文' }));
        const raw = await storage.read(key);
        expect(raw).toContain('部分正文');
    });

    it('write 前先创建断点目录（目录不存在也能落盘）', async () => {
        const fs = new MockFileSystem();
        const storage = new VaultCheckpointStorage(fs);
        const key = makeCheckpointKey('测试项目', '第3章', 2, 'abc123');
        await storage.write(key, '{}');
        // 修复前：write 不 mkdir，断点目录不存在；修复后应存在
        const dir = await fs.getFolder('测试项目/04-项目总控/断点');
        expect(dir).not.toBeNull();
    });

    it('read 不存在返回 null，remove 删除', async () => {
        const fs = new MockFileSystem();
        const storage = new VaultCheckpointStorage(fs);
        const key = makeCheckpointKey('测试项目', '第3章', 2, 'abc123');
        expect(await storage.read(key)).toBeNull();

        await storage.write(key, '{}');
        expect(await storage.read(key)).not.toBeNull();

        await storage.remove(key);
        expect(await storage.read(key)).toBeNull();
    });

    it('不同项目隔离（projectId 映射到不同目录）', async () => {
        const fs = new MockFileSystem();
        const storage = new VaultCheckpointStorage(fs);
        const key1 = makeCheckpointKey('项目A', '第1章', 1, 'hash1');
        const key2 = makeCheckpointKey('项目B', '第1章', 1, 'hash1');
        await storage.write(key1, '内容A');
        await storage.write(key2, '内容B');
        expect(await storage.read(key1)).toBe('内容A');
        expect(await storage.read(key2)).toBe('内容B');
    });
});

describe('GenerationCheckpointStore 端到端（vault 接线）', () => {
    it('save 后 get 恢复完整字段，discard 清除', async () => {
        const fs = new MockFileSystem();
        const store = new GenerationCheckpointStore(new VaultCheckpointStorage(fs));

        const ok = await store.save({
            projectId: '测试项目',
            chapter: '第3章',
            sceneNum: 2,
            promptHash: 'abc123',
            content: '部分正文',
            lastAcceptedParagraph: '第一段',
            finishReason: 'api_timeout',
        });
        expect(ok).toBe(true);

        const cp = await store.get({ projectId: '测试项目', chapter: '第3章', sceneNum: 2, promptHash: 'abc123' });
        expect(cp?.content).toBe('部分正文');
        expect(cp?.lastAcceptedParagraph).toBe('第一段');
        expect(cp?.finishReason).toBe('api_timeout');

        await store.discard({ projectId: '测试项目', chapter: '第3章', sceneNum: 2, promptHash: 'abc123' });
        expect(await store.get({ projectId: '测试项目', chapter: '第3章', sceneNum: 2, promptHash: 'abc123' })).toBeNull();
    });

    it('多场景隔离（sceneNum 维度）', async () => {
        const fs = new MockFileSystem();
        const store = new GenerationCheckpointStore(new VaultCheckpointStorage(fs));

        await store.save({
            projectId: '测试项目', chapter: '第3章', sceneNum: 1, promptHash: 'h1',
            content: '场景1', lastAcceptedParagraph: '', finishReason: 'aborted',
        });
        await store.save({
            projectId: '测试项目', chapter: '第3章', sceneNum: 2, promptHash: 'h1',
            content: '场景2', lastAcceptedParagraph: '', finishReason: 'aborted',
        });

        const s1 = await store.get({ projectId: '测试项目', chapter: '第3章', sceneNum: 1, promptHash: 'h1' });
        const s2 = await store.get({ projectId: '测试项目', chapter: '第3章', sceneNum: 2, promptHash: 'h1' });
        expect(s1?.content).toBe('场景1');
        expect(s2?.content).toBe('场景2');
    });
});

describe('GenerationCheckpointStore.listCheckpoints — 断点列出（恢复面板数据源）', () => {
    it('TR-C3: 列出项目全部断点并解析字段', async () => {
        const fs = new MockFileSystem();
        const store = new GenerationCheckpointStore(new VaultCheckpointStorage(fs));
        await store.save({
            projectId: '项目X', chapter: '第1章', sceneNum: 1, promptHash: 'h1',
            content: '场景1正文', lastAcceptedParagraph: '场景1正文', finishReason: 'scene_done',
        });
        await store.save({
            projectId: '项目X', chapter: '第1章', sceneNum: 2, promptHash: 'h1',
            content: '', lastAcceptedParagraph: '', finishReason: 'scene_failed',
        });

        const list = await store.listCheckpoints('项目X');
        expect(list).toHaveLength(2);
        const done = list.find((c) => c.sceneNum === 1);
        expect(done?.content).toBe('场景1正文');
        expect(done?.finishReason).toBe('scene_done');
        expect(list.some((c) => c.sceneNum === 2 && c.finishReason === 'scene_failed')).toBe(true);
    });

    it('TR-C3b: 无断点项目返回空数组', async () => {
        const fs = new MockFileSystem();
        const store = new GenerationCheckpointStore(new VaultCheckpointStorage(fs));
        expect(await store.listCheckpoints('空项目')).toEqual([]);
    });

    it('TR-C3c: port 未实现 list 时降级返回空数组', async () => {
        const store = new GenerationCheckpointStore({
            write: async () => {},
            read: async () => null,
            remove: async () => {},
        });
        expect(await store.listCheckpoints('任意')).toEqual([]);
    });
});
