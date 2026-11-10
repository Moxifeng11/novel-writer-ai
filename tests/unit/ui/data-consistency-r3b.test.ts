/**
 * D3-4 / D3-14（维度② r3）：其余无锁整文件读改写收口。
 *
 * - context-injector：检索数秒后才写正文，必须锁内重读再注入；
 * - agent-port append：读—改—写必须与结算/自动保存共用路径锁；
 * - project-rename 同步：`.project`/世界观/写作配置的读—替换—写加锁。
 */

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('D3-4 上下文注入', () => {
    it('锁内重读正文后再 upsert 与写入', () => {
        const src = read('ui/context-injector-modal.ts');
        const lockIdx = src.indexOf('await withWriteLock(filePath, async () => {');
        const freshIdx = src.indexOf('const fresh = await adapter.read(filePath);', lockIdx);
        const upsertIdx = src.indexOf('upsertAutoContext(fresh', lockIdx);
        const writeIdx = src.indexOf('await writeVaultText(this.app, filePath, newContent);', lockIdx);

        expect(lockIdx).toBeGreaterThan(-1);
        expect(freshIdx).toBeGreaterThan(lockIdx);
        expect(upsertIdx).toBeGreaterThan(freshIdx);
        expect(writeIdx).toBeGreaterThan(upsertIdx);
        // 旧的「先读一次存 content，最后用旧 content 写」不得回潮
        expect(src).not.toContain('upsertAutoContext(content, body, marker)');
    });
});

describe('D3-14 Agent 写入与改名同步', () => {
    it('agent-port 的 append 在路径锁内重读', () => {
        const src = read('ui/services/agent-port.ts');
        const lockIdx = src.indexOf('await withWriteLock(guard.path, async () => {');
        const readIdx = src.indexOf('await app.vault.adapter.read(guard.path)', lockIdx);
        expect(lockIdx).toBeGreaterThan(-1);
        expect(readIdx).toBeGreaterThan(lockIdx);
    });

    it('改名同步的三个写点都在 withWriteLock(path) 内', () => {
        const src = read('services/project-rename-service.ts');
        for (const marker of ['syncProjectMeta', 'syncWorldview', 'syncWritingProfile']) {
            const start = src.indexOf(`private async ${marker}(`);
            const end = src.indexOf('\n    }', start);
            const body = src.slice(start, end);
            expect(body).toContain('await withWriteLock(path, async () => {');
            expect(body.indexOf('await adapter.read(path)')).toBeGreaterThan(body.indexOf('withWriteLock(path'));
        }
    });
});
