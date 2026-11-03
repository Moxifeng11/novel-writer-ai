import { describe, it, expect } from 'vitest';
import { BodyWriter } from '../../../engine/body-writer';
import { DEFAULT_BODY_FORMAT } from '../../../shared/body-format';

/**
 * 同一章正文可能有多个写入者（协同自动保存、流水线、润色、修正回写）。
 * BodyWriter 的写入是「读旧 frontmatter → 整篇覆盖」，必须按路径串行，
 * 否则后写覆盖前写，甚至把两次读到的旧 frontmatter 互相覆盖。
 */

const PATH = '项目/03-大纲与章节/正文/第1卷/第9章_正文.md';

function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

class SlowFileSystem {
    files = new Map<string, string>();
    maxInFlight = 0;
    private inFlight = 0;

    private async track<T>(fn: () => Promise<T>): Promise<T> {
        this.inFlight += 1;
        this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
        try {
            await delay(5);
            return await fn();
        } finally {
            this.inFlight -= 1;
        }
    }

    async exists(path: string): Promise<boolean> {
        return this.track(async () => this.files.has(path));
    }

    async read(path: string): Promise<string> {
        return this.track(async () => {
            const value = this.files.get(path);
            if (value === undefined) throw new Error(`ENOENT: ${path}`);
            return value;
        });
    }

    async write(path: string, content: string): Promise<void> {
        return this.track(async () => {
            this.files.set(path, content);
        });
    }

    async mkdir(): Promise<void> {
        return this.track(async () => undefined);
    }

    async getFile(): Promise<null> {
        return null;
    }

    async delete(path: string): Promise<void> {
        this.files.delete(path);
    }

    async listFiles(): Promise<never[]> {
        return [];
    }

    async listFolders(): Promise<never[]> {
        return [];
    }

    async listAll(): Promise<never[]> {
        return [];
    }

    async rename(): Promise<void> {}
}

class NoopFrontmatter {
    async processFrontmatter(): Promise<void> {}
}

describe('BodyWriter — 同一路径写入串行', () => {
    it('两个并发写入不会互相穿插（同一路径最多一个写入者）', async () => {
        const fs = new SlowFileSystem();
        fs.files.set('项目/作品信息.md', '# 项目');
        const writer = new BodyWriter({ fs: fs as any, frontmatter: new NoopFrontmatter() as any });
        const bodyA = '他抬手。'.repeat(40);
        const bodyB = '风从袖口灌进来。'.repeat(40);

        await Promise.all([
            writer.write({
                path: PATH,
                raw: bodyA,
                chapterNum: 9,
                chapterName: '第9章',
                volume: '第1卷',
                writingMode: 'co-writer',
                contract: DEFAULT_BODY_FORMAT,
            }),
            writer.write({
                path: PATH,
                raw: bodyB,
                chapterNum: 9,
                chapterName: '第9章',
                volume: '第1卷',
                writingMode: 'pipeline',
                contract: DEFAULT_BODY_FORMAT,
            }),
        ]);

        // 没有锁时两个写入会同时进入 exists/read/write（maxInFlight >= 2）
        expect(fs.maxInFlight).toBe(1);
        expect(fs.files.get(PATH)).toContain('风从袖口灌进来');
    });
});
