import { describe, expect, it } from 'vitest';
import { TFile } from '../../__mocks__/obsidian';
import { ForeshadowManager, type TrackedForeshadowItem } from '../../../engine/foreshadow-manager';
import { pjForeshadowTracker } from '../../../shared/paths';
import type { FileSystemPort, VaultMetaPort } from '../../../shared/file-system-port';

/**
 * updateTracker：读 → 改 → 写整段进锁。
 *
 * 旧 API（loadTracker → 内存修改 → saveTracker）在并发调用时会丢更新：
 * 两个调用方各自 load 到同一份旧快照，后保存者覆盖先保存者。
 */
function harness() {
    const files = new Map<string, string>();
    const fileObjs = new Map<string, TFile>();
    const ensureFile = (path: string): TFile => {
        let file = fileObjs.get(path);
        if (!file) {
            file = new TFile();
            file.path = path;
            file.name = path.split('/').pop() || path;
            file.basename = file.name.replace(/\.md$/, '');
            fileObjs.set(path, file);
        }
        return file;
    };
    const fs: FileSystemPort = {
        read: async (path) => {
            await new Promise<void>(resolve => setTimeout(resolve, 0));
            const content = files.get(path);
            if (content === undefined) throw new Error(`ENOENT: ${path}`);
            return content;
        },
        write: async (path, content) => { files.set(path, content); ensureFile(path); },
        exists: async (path) => files.has(path),
        getFile: async (path) => fileObjs.get(path) ?? null,
        getFolder: async () => null,
        listFiles: async () => [],
        listFolders: async () => [],
        mkdir: async () => {},
        delete: async (path) => { files.delete(path); fileObjs.delete(path); },
        listAll: async () => [],
        rename: async () => {},
    };
    const vaultMeta: VaultMetaPort = {
        getFiles: () => Array.from(fileObjs.values()),
        getFolders: () => [],
        getAbstractFileByPath: (path) => fileObjs.get(path) ?? null,
    };
    const manager = new ForeshadowManager({ app: {} } as never);
    // 注入最小端口，避免真实 Obsidian App
    (manager as unknown as { fs: FileSystemPort }).fs = fs;
    (manager as unknown as { vaultMeta: VaultMetaPort }).vaultMeta = vaultMeta;
    return { files, manager };
}

function item(content: string): TrackedForeshadowItem {
    return {
        id: `manual_${content}`,
        content,
        category: 'object',
        importance: 'medium',
        plantedChapter: 1,
        status: 'planted',
        confidence: 1,
        autoDetected: false,
    };
}

describe('updateTracker — 并发读改写不丢更新', () => {
    it('两个并发 updateTracker 的条目都保留', async () => {
        const project = '长篇小说/追踪器并发测试';
        const h = harness();

        await Promise.all([
            h.manager.updateTracker(project, tracker => { tracker.items.push(item('甲伏笔')); }),
            h.manager.updateTracker(project, tracker => { tracker.items.push(item('乙伏笔')); }),
        ]);

        const content = h.files.get(pjForeshadowTracker(project)) || '';
        expect(content).toContain('甲伏笔');
        expect(content).toContain('乙伏笔');
        expect(content).toContain('伏笔总数：**2**');
    });
});
