/**
 * 章节版本写入必须与索引同事务（对抗审查 P1：fileTx 注入却未使用）
 */

import { describe, expect, it } from 'vitest';
import { App } from '../../__mocks__/obsidian';
import { ChapterVersionService } from '../../../services/chapter-version-service';

const PROJECT = '项目';
const CHAP = '第1章';
const SRC = `${PROJECT}/03-大纲与章节/正文/第1卷/第1章_正文.md`;

describe('ChapterVersionService — 内容与索引同事务', () => {
    it('注入 fileTx 时以一次事务写入正文版本 + 版本索引', async () => {
        const app = new App();
        (app.vault as unknown as { _seedFile(p: string, c: string): unknown })._seedFile(SRC, '正文');
        const batches: Array<Array<{ path: string; content: string }>> = [];
        const fileTx = {
            run: async (_project: string, writes: Array<{ path: string; content: string }>) => { batches.push(writes); return {}; },
        };
        const service = new ChapterVersionService(app as never, fileTx as never);
        await service.saveVersion(PROJECT, 'chapter', CHAP, SRC, '正文内容', { type: 'manual' });
        expect(batches).toHaveLength(1);
        expect(batches[0].length).toBe(2);
        expect(batches[0].some(w => w.path.includes('versions') || w.path.includes('_versions'))).toBe(true);
        expect(batches[0].some(w => w.path.endsWith('.json'))).toBe(true);
    });

    it('事务失败时不留下部分写入（错误向上抛）', async () => {
        const app = new App();
        (app.vault as unknown as { _seedFile(p: string, c: string): unknown })._seedFile(SRC, '正文');
        const fileTx = { run: async () => { throw new Error('索引写失败'); } };
        const service = new ChapterVersionService(app as never, fileTx as never);
        await expect(service.saveVersion(PROJECT, 'chapter', CHAP, SRC, '正文内容', { type: 'manual' }))
            .rejects.toThrow(/索引写失败/);
    });
});
