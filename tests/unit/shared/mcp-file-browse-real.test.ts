/**
 * mcp-file-browse 真实目录读取（临时目录，桌面测试环境）
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { pickDirectoryEntries } from '@/shared/mcp-file-browse';

const dirs: string[] = [];

afterEach(() => {
    for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('pickDirectoryEntries 真实读取', () => {
    it('列出目录与允许的程序文件，过滤掉非程序文件', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nw-browse-'));
        dirs.push(dir);
        fs.mkdirSync(path.join(dir, 'sub'));
        fs.writeFileSync(path.join(dir, 'server.mjs'), '// x', 'utf8');
        fs.writeFileSync(path.join(dir, 'note.txt'), 'x', 'utf8');

        const result = await pickDirectoryEntries(dir, ['.mjs', '.py']);
        expect(result.ok).toBe(true);
        expect(result.entries.map(entry => entry.name)).toEqual(['sub', 'server.mjs']);
        expect(result.entries[0].isDirectory).toBe(true);
    });

    it('目录不存在时返回结构化错误（不抛错）', async () => {
        const missing = path.join(os.tmpdir(), 'nw-browse-not-exist-xyz');
        const result = await pickDirectoryEntries(missing, ['.js']);
        expect(result.ok).toBe(false);
        expect(result.error).toContain('无法读取目录');
    });
});
