/**
 * settleLight 失败聚合可见性（v4.48.0 决策落地）
 *
 * 决策：轻结算维持「出场确认 best-effort + 写入幂等」，**不做整次事务**；
 * 缺口是失败不可见。本文件锁定：
 * 1. 任一实体写入失败 → result.lightPartial=true 且 lightFailures.entities 记名；
 * 2. 失败不影响其他实体（继续出场确认）；
 * 3. 重跑（不再失败）→ lightPartial 消失，且重复写入幂等（不产生重复字段）。
 */
import { describe, expect, it } from 'vitest';
import { TFile, TFolder } from '../../__mocks__/obsidian';
import { SettlementEngine } from '../../../engine/settlement-engine';
import { pjCharFile, pjBodyFile } from '../../../shared/paths';
import type { FileSystemPort, FrontmatterPort, VaultMetaPort } from '../../../shared/file-system-port';

const PROJECT = '长篇小说/测试书';
const VOL = 1;
const CHAP = 1;
const CHAP_NAME = '第1章';
const CHAP_DIR = `${PROJECT}/03-大纲与章节/步骤结果/第${VOL}卷/第${CHAP}章`;
const CHAR_A = pjCharFile(PROJECT, '甲');
const CHAR_B = pjCharFile(PROJECT, '乙');
const BODY_PATH = pjBodyFile(PROJECT, VOL, CHAP);

function parseFm(raw: string): { fm: Record<string, unknown>; body: string } {
    const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
    if (!match) return { fm: {}, body: raw };
    const fm: Record<string, unknown> = {};
    for (const line of match[1].split('\n')) {
        const sep = line.indexOf(':');
        if (sep <= 0) continue;
        fm[line.slice(0, sep).trim()] = line.slice(sep + 1).trim();
    }
    return { fm, body: match[2] };
}

function serializeFm(fm: Record<string, unknown>, body: string): string {
    const lines = Object.entries(fm).map(([key, value]) => `${key}: ${value}`);
    return `---\n${lines.join('\n')}\n---\n${body}`;
}

const CHAR_SEED = (name: string) => `---
当前状态: 健康
---
# ${name}

## 变更记录
`;

const BODY_SEED = `---
status: written
---
这是正文。
`;

function makeHarness(
    seed: Record<string, string>,
    failFrontmatter?: (path: string, count: number) => boolean,
) {
    const files = new Map<string, string>(Object.entries(seed));
    const fileObjs = new Map<string, TFile>();
    const writeCounts = new Map<string, number>();
    const folders = new Set<string>();

    const ensureFileObj = (path: string): TFile => {
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
    for (const path of Object.keys(seed)) ensureFileObj(path);

    const fs: FileSystemPort = {
        read: async (path) => {
            const content = files.get(path);
            if (content === undefined) throw new Error(`ENOENT: ${path}`);
            return content;
        },
        write: async (path, content) => {
            const count = (writeCounts.get(path) ?? 0) + 1;
            writeCounts.set(path, count);
            files.set(path, content);
            ensureFileObj(path);
        },
        exists: async (path) => files.has(path) || folders.has(path),
        getFile: async (path) => fileObjs.get(path) || null,
        getFolder: async () => (folders.has('x') ? new TFolder() : null),
        listFiles: async () => Array.from(fileObjs.values()),
        listFolders: async () => [],
        mkdir: async (path) => { folders.add(path); },
        delete: async (path) => { files.delete(path); fileObjs.delete(path); },
        listAll: async () => [],
        rename: async () => undefined,
    };

    const fmCounts = new Map<string, number>();
    const frontmatter: FrontmatterPort = {
        processFrontmatter: async (file, updater) => {
            const count = (fmCounts.get(file.path) ?? 0) + 1;
            fmCounts.set(file.path, count);
            if (failFrontmatter?.(file.path, count)) throw new Error(`模拟 frontmatter 写入失败: ${file.path}`);
            const raw = files.get(file.path) ?? '';
            const { fm, body } = parseFm(raw);
            updater(fm);
            files.set(file.path, serializeFm(fm, body));
        },
    };

    const vaultMeta: VaultMetaPort = {
        getFiles: () => Array.from(fileObjs.values()),
        getFolders: () => [],
        getAbstractFileByPath: (path) => fileObjs.get(path) || (folders.has(path) ? new TFolder() : null),
    };

    const app = {
        vault: {
            adapter: {
                read: async (path: string) => fs.read(path),
                write: async (path: string, content: string) => fs.write(path, content),
                exists: async (path: string) => fs.exists(path),
                mkdir: async (path: string) => fs.mkdir(path),
                list: async () => ({ files: [], folders: [] }),
                remove: async (path: string) => fs.delete(path),
            },
            getFiles: () => Array.from(fileObjs.values()),
            getAllFolders: () => [],
            getAbstractFileByPath: (path: string) => fileObjs.get(path) || (folders.has(path) ? new TFolder() : null),
        },
        metadataCache: { getFileCache: () => null },
        fileManager: {
            processFrontMatter: async (file: TFile, updater: (fm: Record<string, unknown>) => void) => {
                await frontmatter.processFrontmatter(file, updater);
            },
        },
    };

    const engine = new SettlementEngine(app as never, {
        fs,
        frontmatter,
        vaultMeta,
        notifier: { showNotice: () => undefined } as never,
    });

    return { files, engine };
}

function seedAll() {
    return {
        [CHAR_A]: CHAR_SEED('甲'),
        [CHAR_B]: CHAR_SEED('乙'),
        [BODY_PATH]: BODY_SEED,
    };
}

describe('settleLight — 失败聚合可见性', () => {
    it('单实体写入失败：lightPartial=true 且记名，其他实体不受影响', async () => {
        // 甲的第一次写入失败，乙正常
        const h = makeHarness(seedAll(), (path) => path === CHAR_A);
        const result = await h.engine.settleLight(PROJECT, CHAP_DIR, CHAP_NAME, '甲和乙同行。', {
            involvedChars: ['甲', '乙'],
        });

        expect(result.mode).toBe('light');
        expect(result.lightPartial).toBe(true);
        expect(result.lightFailures?.entities).toContain('甲');
        expect(result.updatedChars).toBe(1);

        // 乙成功出场确认
        const { fm: fmB } = parseFm(h.files.get(CHAR_B)!);
        expect(fmB['entity_last_seen_at']).toBe(CHAP_NAME);
        // 甲未被写入
        const { fm: fmA } = parseFm(h.files.get(CHAR_A)!);
        expect(fmA['entity_last_seen_at']).toBeUndefined();
    });

    it('重跑即修复：第二次不再失败时 lightPartial 消失且写入幂等', async () => {
        // 仅第一次写入甲失败
        const h = makeHarness(seedAll(), (path, count) => path === CHAR_A && count === 1);
        const first = await h.engine.settleLight(PROJECT, CHAP_DIR, CHAP_NAME, '甲和乙同行。', {
            involvedChars: ['甲', '乙'],
        });
        expect(first.lightPartial).toBe(true);

        const second = await h.engine.settleLight(PROJECT, CHAP_DIR, CHAP_NAME, '甲和乙同行。', {
            involvedChars: ['甲', '乙'],
        });
        expect(second.lightPartial).toBeUndefined();
        expect(second.updatedChars).toBe(2);

        const { fm } = parseFm(h.files.get(CHAR_A)!);
        expect(fm['entity_status']).toBe('active');
        expect(fm['entity_last_seen_at']).toBe(CHAP_NAME);
        // 无失败时不应携带失败字段
        expect(second.lightFailures).toBeUndefined();
    });

    it('无失败时不携带 lightPartial / lightFailures', async () => {
        const h = makeHarness(seedAll());
        const result = await h.engine.settleLight(PROJECT, CHAP_DIR, CHAP_NAME, '甲和乙同行。', {
            involvedChars: ['甲', '乙'],
        });
        expect(result.mode).toBe('light');
        expect(result.lightPartial).toBeUndefined();
        expect(result.lightFailures).toBeUndefined();
        expect(result.updatedChars).toBe(2);
    });
});
