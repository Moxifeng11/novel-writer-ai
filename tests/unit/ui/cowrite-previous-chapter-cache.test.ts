import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../main', () => ({
    default: class NovelWriterPlugin {},
}));

import { TFile } from 'obsidian';
import { RealtimeQualityController, type RealtimeQualityHost } from '../../../ui/cowrite/realtime-quality-controller';

const BODY_ROOT = '书甲/03-大纲与章节/正文/第1卷';
const CH1 = `${BODY_ROOT}/第1章_正文.md`;
const CH2 = `${BODY_ROOT}/第2章_正文.md`;

interface FakeStore {
    contents: Map<string, string>;
    mtimes: Map<string, number>;
}

function makeFile(path: string, store: FakeStore): TFile {
    const file = new TFile();
    file.path = path;
    file.name = path.split('/').pop() ?? path;
    file.stat.mtime = store.mtimes.get(path) ?? 1000;
    file.stat.size = (store.contents.get(path) ?? '').length;
    return file;
}

function makeController(store: FakeStore, files: TFile[]) {
    let resolvable = true;
    const cachedRead = vi.fn(async (file: TFile) => store.contents.get(file.path) ?? '');
    const vault = {
        getFiles: () => files,
        getAbstractFileByPath: (path: string) => {
            if (!resolvable) return null;
            return files.find((file) => file.path === path) ?? null;
        },
        cachedRead,
    };
    const app = { vault, metadataCache: { getFileCache: () => null } };
    const host: RealtimeQualityHost = {
        app: app as never,
        getText: () => '',
        getProject: () => '书甲',
        getVolume: () => '第1卷',
        getChapterNum: () => 3,
        getChapterName: () => '第3章',
        getBodyPath: () => CH1,
        getChapterBrief: () => null,
        getChapPlan: () => undefined,
        loadCharacterInfos: async () => [],
        loadForeshadows: async () => [],
        createMonitor: () => {
            throw new Error('前文缓存测试不应创建 monitor');
        },
    };
    return {
        controller: new RealtimeQualityController(host),
        cachedRead,
        setResolvable: (v: boolean) => { resolvable = v; },
    };
}

function load(controller: RealtimeQualityController): Promise<Array<{ chapterNum: number; text: string }>> {
    return (controller as unknown as {
        loadPreviousChapterContext: () => Promise<Array<{ chapterNum: number; text: string }>>;
    }).loadPreviousChapterContext();
}

/**
 * 前文缓存此前只按路径做 key：同一次协同会话里改完上一章再写本章，
 * 矛盾/时间线检测会继续使用旧正文。缓存键必须带上文件签名（mtime + size）。
 * D2 后窗口构建位于 RealtimeQualityController。
 */
describe('RealtimeQualityController — 前文章节缓存按文件签名失效', () => {
    it('文件未变化时复用缓存，不重复读盘', async () => {
        const store: FakeStore = {
            contents: new Map([[CH1, '第一章正文。'], [CH2, '第二章正文。']]),
            mtimes: new Map([[CH1, 1000], [CH2, 2000]]),
        };
        const files = [makeFile(CH1, store), makeFile(CH2, store)];
        const { controller, cachedRead } = makeController(store, files);

        const first = await load(controller);
        const second = await load(controller);

        expect(first.map((item) => item.chapterNum)).toEqual([2, 1]);
        expect(cachedRead).toHaveBeenCalledTimes(2);
        expect(second).toBe(first);
    });

    it('上一章被修改后重新读取，矛盾检测不再拿到旧正文', async () => {
        const store: FakeStore = {
            contents: new Map([[CH1, '第一章正文。'], [CH2, '第二章：主角是黑发。']]),
            mtimes: new Map([[CH1, 1000], [CH2, 2000]]),
        };
        const files = [makeFile(CH1, store), makeFile(CH2, store)];
        const { controller, cachedRead } = makeController(store, files);

        const before = await load(controller);
        expect(before[0].text).toContain('黑发');

        // 用户在协同会话里改上一章：内容、mtime、size 同时变化
        store.contents.set(CH2, '第二章：主角改成了白发。');
        store.mtimes.set(CH2, 4000);
        files[1].stat.mtime = 4000;
        files[1].stat.size = store.contents.get(CH2)!.length;

        const after = await load(controller);
        expect(cachedRead).toHaveBeenCalledTimes(4);
        expect(after[0].text).toContain('白发');
        expect(after[0].text).not.toContain('黑发');
    });

    it('前文文件被移走后不再返回缓存里的旧正文', async () => {
        const store: FakeStore = {
            contents: new Map([[CH1, '第一章正文。'], [CH2, '第二章正文。']]),
            mtimes: new Map([[CH1, 1000], [CH2, 2000]]),
        };
        const files = [makeFile(CH1, store), makeFile(CH2, store)];
        const { controller, setResolvable } = makeController(store, files);

        await load(controller);
        setResolvable(false);

        await expect(load(controller)).resolves.toEqual([]);
    });
});
