/**
 * 维度②三轮（2026-11-11）P1 回归：
 * 1. 章节结算弹窗回写正文 settled 状态必须持路径锁（整文件 RMW，与自动保存互斥）；
 * 2. EntityStateManager 扩展「涉及人物」必须锁内重读正文，不得用锁前快照覆盖。
 */

import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { TFile } from 'obsidian';

vi.mock('../../../main', () => ({
    default: class NovelWriterPlugin {},
}));

import { EntityStateManager } from '../../../engine/entity-state-manager';

const ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const BODY = [
    '---',
    'status: written',
    '涉及人物:',
    '  - 甲',
    '---',
    '',
    '正文内容',
].join('\n');

function makeManager(content: string, mentioned: string[]) {
    const app = {
        metadataCache: {
            getFileCache: () => ({ frontmatter: { '涉及人物': ['甲'] } }),
        },
    };
    const manager = new EntityStateManager({
        app,
        plugin: {},
        aiEngine: {},
    } as never);

    const writes: string[] = [];
    const file = new TFile();
    file.path = '书A/第1章_正文.md';

    (manager as unknown as Record<string, unknown>).fs = {
        read: async () => content,
        write: async (_path: string, next: string) => { writes.push(next); },
    };
    (manager as unknown as Record<string, unknown>).vaultMeta = {
        getAbstractFileByPath: () => file,
    };
    (manager as unknown as Record<string, unknown>).extractMentionedNames = async () => mentioned;
    return { manager, writes };
}

describe('EntityStateManager.updateInvolvedEntities — 锁内重读', () => {
    it('合并新人物后写回，保留原有条目', async () => {
        const { manager, writes } = makeManager(BODY, ['乙']);
        await manager.updateInvolvedEntities('书A', '书A/第1章_正文.md', '正文内容');

        expect(writes).toHaveLength(1);
        expect(writes[0]).toContain('甲');
        expect(writes[0]).toContain('乙');
    });

    it('没有新人物时不写盘', async () => {
        const { manager, writes } = makeManager(BODY, ['甲']);
        await manager.updateInvolvedEntities('书A', '书A/第1章_正文.md', '正文内容');
        expect(writes).toHaveLength(0);
    });

    it('提取不到人物时既不读也不写（提取在锁外）', async () => {
        const { manager, writes } = makeManager(BODY, []);
        const fsPort = (manager as unknown as { fs: { read: () => Promise<string> } }).fs;
        const readSpy = vi.spyOn(fsPort, 'read');

        await manager.updateInvolvedEntities('书A', '书A/第1章_正文.md', '正文内容');

        expect(readSpy).not.toHaveBeenCalled();
        expect(writes).toHaveLength(0);
    });
});

describe('数据一致性接线契约', () => {
    it('EntityStateManager：提取在锁外，读改写都在 withWriteLock 内', () => {
        const src = read('engine/entity-state-manager.ts');
        const extractIdx = src.indexOf('const mentionedNames = await this.extractMentionedNames');
        const lockIdx = src.indexOf('await withWriteLock(chapterBodyPath, async () => {');
        const readIdx = src.indexOf('const content = await this.getFS().read(chapterBodyPath);', lockIdx);

        expect(extractIdx).toBeGreaterThan(-1);
        expect(lockIdx).toBeGreaterThan(extractIdx);
        expect(readIdx).toBeGreaterThan(lockIdx);
    });

    it('结算弹窗：settled 回写包在 withWriteLock(target.bodyPath) 内', () => {
        const src = read('ui/chapter-settlement-modal.ts');
        const lockIdx = src.indexOf('withWriteLock(target.bodyPath');
        const fmIdx = src.indexOf('processFrontmatter(bodyFile');
        expect(lockIdx).toBeGreaterThan(-1);
        expect(fmIdx).toBeGreaterThan(lockIdx);
        // 全文只有这一处正文 status 回写（不得再出现无锁直写）
        expect(src.match(/processFrontmatter\(bodyFile/g)?.length).toBe(1);
    });

    it('引擎侧 settled 写入仍持锁（弹窗回写只是兜底，不替代引擎）', () => {
        const src = read('engine/settlement-engine.ts');
        const settleIdx = src.indexOf("fmObj['status'] = 'settled';");
        const lockIdx = src.lastIndexOf('withWriteLock(bodyFile.path', settleIdx);
        expect(settleIdx).toBeGreaterThan(-1);
        expect(lockIdx).toBeGreaterThan(-1);
    });
});
