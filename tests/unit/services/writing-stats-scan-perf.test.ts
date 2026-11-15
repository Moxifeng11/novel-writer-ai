/**
 * 首次统计扫描性能口径（对抗审查 P2）：
 * 有 frontmatter word_count 时不得整篇读取正文
 */

import { describe, expect, it, vi } from 'vitest';
import { WritingStatsService } from '@/services/writing-stats-service';

function makeService(frontmatter: Record<string, unknown> | undefined) {
    const read = vi.fn().mockResolvedValue('# 第1章\n\n正文正文正文');
    const service = new WritingStatsService({
        app: {
            vault: {
                adapter: {
                    exists: async () => false,
                    read: async () => '',
                    write: async () => {},
                    mkdir: async () => {},
                },
                read,
                getFiles: () => [],
            },
            metadataCache: { getFileCache: () => ({ frontmatter }) },
        },
        ledgerPath: '长篇小说/甲/04-项目总控/写作统计.json',
        isBodyPath: () => true,
        listBodyFiles: () => [],
    } as never);
    return { service, read };
}

const FILE = { path: '长篇小说/甲/03-大纲与章节/正文/第1卷/第1章_正文.md' };

describe('WritingStatsService — 扫描不整篇读正文', () => {
    it('frontmatter 有 word_count 时直接用，不读文件', async () => {
        const { service, read } = makeService({ word_count: 1234 });
        const count = await (service as unknown as {
            resolveCountForScan(file: { path: string }): Promise<number | null>;
        }).resolveCountForScan(FILE);
        expect(count).toBe(1234);
        expect(read).not.toHaveBeenCalled();
    });

    it('frontmatter 缺失时回退读正文', async () => {
        const { service, read } = makeService(undefined);
        const count = await (service as unknown as {
            resolveCountForScan(file: { path: string }): Promise<number | null>;
        }).resolveCountForScan(FILE);
        expect(count).toBeGreaterThan(0);
        expect(read).toHaveBeenCalled();
    });
});
