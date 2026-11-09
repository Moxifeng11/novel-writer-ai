import { describe, expect, it } from 'vitest';
import { TFile } from '../../__mocks__/obsidian';
import { AnalysisReportEngine } from '../../../engine/analysis-report-engine';
import { pjForeshadowDB, pjTimelineBoard } from '../../../shared/paths';
import type { FileSystemPort, VaultMetaPort } from '../../../shared/file-system-port';

/**
 * F-2（2026-11-10 审计）回归：分析报告「应用变更」此前无 journal、无项目锁——
 * 写失败会让半成品残留，且结算回滚会清掉 apply 刚写入的行。
 * 本文件验证：① 写失败按 journal 恢复伏笔库；② 新建时间线写失败删除半成品；
 * ③ 成功路径不误伤。
 */

const PROJECT = '长篇小说/测试书';

const FORESHADOW_SEED = `# 伏笔库

## 未回收伏笔

| # | 伏笔名称 | 重要程度 | 埋设章节 | 计划回收 | 相关人物 | 关联主线 | 当前状态 |
|---|---------|---------|---------|---------|---------|---------|---------|
| 1 | 旧线 | 低 | 第1章 | 第5章 | 林深 | 主线 | 未揭示 |

## 已回收伏笔

| # | 伏笔名称 | 重要程度 | 埋设章节 | 相关人物 | 关联主线 | 回收章节 | 回收方式 |
|---|---------|---------|---------|---------|---------|---------|---------|
`;

function makeHarness(failWrite?: (path: string, content: string) => boolean) {
    const files = new Map<string, string>();
    const fileObjs = new Map<string, TFile>();
    const folders = new Set<string>();

    const ensureFileObj = (path: string): TFile => {
        let file = fileObjs.get(path);
        if (!file) {
            file = new TFile();
            file.path = path;
            file.name = path.split('/').pop() || path;
            fileObjs.set(path, file);
        }
        return file;
    };

    const fs: FileSystemPort & { deleteFile: (path: string) => void } = {
        read: async (path) => {
            const content = files.get(path);
            if (content === undefined) throw new Error(`ENOENT: ${path}`);
            return content;
        },
        write: async (path, content) => {
            if (failWrite?.(path, content)) throw new Error(`模拟写入失败: ${path}`);
            files.set(path, content);
            ensureFileObj(path);
        },
        exists: async (path) => files.has(path) || folders.has(path),
        getFile: async (path) => fileObjs.get(path) || null,
        getFolder: async (path) => (folders.has(path) ? ({} as never) : null),
        listFiles: async () => Array.from(fileObjs.values()),
        listFolders: async () => [],
        mkdir: async (path) => { folders.add(path); },
        delete: async (path) => { files.delete(path); fileObjs.delete(path); },
        listAll: async () => [],
        rename: async () => undefined,
        deleteFile: (path) => { files.delete(path); fileObjs.delete(path); },
    };

    const vaultMeta: VaultMetaPort = {
        getFiles: () => Array.from(fileObjs.values()),
        getFolders: () => [],
        getAbstractFileByPath: (path) => fileObjs.get(path) || (folders.has(path) ? ({} as never) : null),
    };

    const app = {
        vault: { getFiles: () => Array.from(fileObjs.values()), getAbstractFileByPath: () => null },
        metadataCache: { getFileCache: () => null },
    };

    const engine = new AnalysisReportEngine(app as never, { callAI: async () => ({ content: '[]' }) } as never, {} as never);
    const whitebox = engine as unknown as { fs: FileSystemPort | null; vaultMeta: VaultMetaPort | null };
    whitebox.fs = fs;
    whitebox.vaultMeta = vaultMeta;

    return { files, ensureFileObj, engine };
}

function makeReport(overrides: {
    planted?: Array<{ name: string }>;
    recovered?: Array<{ name: string }>;
    timelineEvents?: Array<{ chapter: number; event: string; time?: string; importance?: 'high' | 'medium' | 'low' }>;
}) {
    return {
        meta: { project: PROJECT, chapterName: '第1章', chapterNum: 1, volume: '第1卷', wordCount: 100, timestamp: '', aiModel: '', processingTimeMs: 0 },
        entities: { characters: [], locations: [], factions: [], items: [], summary: '' },
        foreshadows: {
            planted: (overrides.planted ?? []).map((f) => ({ name: f.name, changeType: 'planted' as const, plantedChapter: '第1章', context: '' })),
            recovered: (overrides.recovered ?? []).map((f) => ({ name: f.name, changeType: 'recovered' as const, context: '正文揭示' })),
            mentioned: [],
            summary: '',
        },
        timeline: { events: overrides.timelineEvents ?? [], summary: '' },
        emotionCurve: { points: [], avgIntensity: 0, peakIntensity: 0, valleyIntensity: 0, inflectionPoints: 0, summary: '' },
        summary: '',
        majorChanges: [],
        warnings: [],
        suggestions: [],
    } as never;
}

describe('AnalysisReportEngine.applyReportChanges — journal 回滚（F-2）', () => {
    it('伏笔库写失败：journal 恢复到 apply 前内容，结果记 pending', async () => {
        const { files, ensureFileObj, engine } = makeHarness(
            (path, content) => path === pjForeshadowDB(PROJECT) && content.includes('钥匙X'),
        );
        const seed = FORESHADOW_SEED;
        files.set(pjForeshadowDB(PROJECT), seed);
        ensureFileObj(pjForeshadowDB(PROJECT));

        const result = await engine.applyReportChanges(PROJECT, makeReport({ planted: [{ name: '钥匙X' }] }));

        expect(result.success).toBe(true);
        expect(result.applied).toHaveLength(0);
        expect(result.pending.join('\n')).toContain('伏笔库');
        // 回滚恢复：半成品的「钥匙X」行不残留
        expect(files.get(pjForeshadowDB(PROJECT))).toBe(seed);
    });

    it('新建时间线写失败：半成品看板被删除，不残留', async () => {
        const { files, engine } = makeHarness(
            (path, content) => path === pjTimelineBoard(PROJECT) && content.includes('码头X'),
        );

        const result = await engine.applyReportChanges(PROJECT, makeReport({
            timelineEvents: [{ chapter: 1, event: '码头X', importance: 'high' }],
        }));

        expect(result.success).toBe(true);
        expect(result.pending.join('\n')).toContain('时间线');
        expect(files.has(pjTimelineBoard(PROJECT))).toBe(false);
    });

    it('成功路径不误伤：planted/recovered 与时间线照常写入', async () => {
        const { files, ensureFileObj, engine } = makeHarness();
        files.set(pjForeshadowDB(PROJECT), FORESHADOW_SEED);
        ensureFileObj(pjForeshadowDB(PROJECT));

        const result = await engine.applyReportChanges(PROJECT, makeReport({
            planted: [{ name: '钥匙X' }],
            recovered: [{ name: '旧线' }],
            timelineEvents: [{ chapter: 1, event: '码头遇袭', importance: 'high' }],
        }));

        expect(result.applied.join('\n')).toContain('伏笔库更新');
        expect(result.applied.join('\n')).toContain('时间线更新');
        expect(files.get(pjForeshadowDB(PROJECT))).toContain('钥匙X');
        expect(files.get(pjTimelineBoard(PROJECT))).toContain('码头遇袭');
    });
});
