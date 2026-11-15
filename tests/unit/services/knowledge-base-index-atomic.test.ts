/**
 * 索引写入原子性：先写 .tmp 再 rename（防 0 字节 index.json）
 */

import { describe, expect, it } from 'vitest';
import { KnowledgeBaseManager } from '@/services/knowledge-base-manager';
import { kbIndexFile } from '@/shared/paths';

class FakeFileSystem {
    files = new Map<string, string>();
    renames: Array<[string, string]> = [];
    async read(path: string): Promise<string> {
        const value = this.files.get(path);
        if (value === undefined) throw new Error(`ENOENT: ${path}`);
        return value;
    }
    async write(path: string, content: string): Promise<void> { this.files.set(path, content); }
    async exists(path: string): Promise<boolean> { return this.files.has(path); }
    async delete(path: string): Promise<void> { this.files.delete(path); }
    async rename(oldPath: string, newPath: string): Promise<void> {
        this.renames.push([oldPath, newPath]);
        const content = this.files.get(oldPath);
        if (content !== undefined) { this.files.delete(oldPath); this.files.set(newPath, content); }
    }
    async mkdir(): Promise<void> {}
    async listFiles(): Promise<never[]> { return []; }
    async listFolders(): Promise<never[]> { return []; }
    async listAll(): Promise<never[]> { return []; }
    async getFile(): Promise<null> { return null; }
    async getFolder(): Promise<null> { return null; }
}

describe('KnowledgeBaseManager.saveIndex — 原子写', () => {
    it('写入 .tmp 后 rename 到正式索引，不直接覆盖', async () => {
        const fake = new FakeFileSystem();
        const manager = new KnowledgeBaseManager({} as never);
        (manager as unknown as { fs: FakeFileSystem }).fs = fake;
        (manager as unknown as { books: Map<string, unknown> }).books.set('b1', { id: 'b1', name: '书一' });

        await (manager as unknown as { saveIndex(): Promise<void> }).saveIndex();
        // saveIndex 走串行写队列（fire-and-forget），测试里显式等队列排空
        await (manager as unknown as { indexWriter: { flush(ms?: number): Promise<void> } }).indexWriter.flush(2000);

        const index = kbIndexFile();
        expect(fake.renames.length).toBe(1);
        expect(fake.renames[0][1]).toBe(index);
        expect(fake.files.get(index)).toContain('书一');
        expect(fake.files.has(`${index}.tmp`)).toBe(false);
    });
});
