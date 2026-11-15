/**
 * C1：单元写入走 BodyWriter 管道
 */

import { describe, expect, it } from 'vitest';
import { App, Vault } from 'obsidian';
import { createBodyWriterUnitFilePort } from '@/engine/mode-unit-writer';
import type { BodyWriteRequest } from '@/engine/body-writer';

const make = () => {
    const vault = new Vault() as Vault & { _seedFile(path: string, content: string): unknown };
    const app = new App();
    app.vault = vault;
    const requests: BodyWriteRequest[] = [];
    const writer = { write: async (req: BodyWriteRequest) => { requests.push(req); return { path: req.path }; } };
    return { app, vault, requests, writer };
};

describe('createBodyWriterUnitFilePort', () => {
    it('短篇：写请求带 unit 模式并开启自然段重排', async () => {
        const { app, requests, writer } = make();
        const port = createBodyWriterUnitFilePort(app, { project: '短篇小说/甲', mode: 'short', writer: writer as never });
        await port.write('短篇小说/甲/短篇创作/03-正文/第01节.md', '---\ntags: [短篇正文]\n---\n\n## 本节目标\n- 核心冲突：开门\n');
        expect(requests).toHaveLength(1);
        expect(requests[0].writingMode).toBe('unit');
        expect(requests[0].naturalize).toBe(true);
        expect(requests[0].project).toBe('短篇小说/甲');
        expect(requests[0].raw).toContain('核心冲突：开门');
    });

    it('剧本：写请求不开自然段重排（避免合并对白）', async () => {
        const { app, requests, writer } = make();
        const port = createBodyWriterUnitFilePort(app, { project: '剧本/乙', mode: 'script', writer: writer as never });
        await port.write('剧本/乙/剧本创作/03-剧本/第01集.md', '# 第1集\n\n### 1-1 日/内 山门\n角色：（情绪）对白\n');
        expect(requests[0].naturalize).toBe(false);
        expect(requests[0].writingMode).toBe('unit');
    });

    it('读回原文', async () => {
        const { app, vault, writer } = make();
        (vault as unknown as { _seedFile(p: string, c: string): unknown })._seedFile('x/第01节.md', '原文');
        const port = createBodyWriterUnitFilePort(app, { project: 'p', mode: 'short', writer: writer as never });
        expect(await port.read('x/第01节.md')).toBe('原文');
        expect(await port.read('x/不存在.md')).toBe('');
    });
});
