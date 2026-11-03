import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../main', () => ({
    default: class NovelWriterPlugin {},
}));

import { BodySaveController, type BodySaveHost } from '../../../ui/cowrite/body-save-controller';
import { BodyWriter } from '../../../engine/body-writer';

/**
 * 保存管线（D2 抽取到 BodySaveController）。
 * 核心不变量：入口快照身份，await 期间切章仍写旧章路径；
 * 切章前冲刷必须用旧身份保存且失败可中止。
 */

interface HostState {
    body: string;
    project: string;
    volume: string;
    chapterNum: number;
    chapterName: string;
    bodyPath: string;
    state: string;
    hasPending: boolean;
    titleDelayMs: number;
}

function makeHarness() {
    const host: HostState = {
        body: '他抬手，风从袖口灌进来。'.repeat(10),
        project: 'A书',
        volume: '第1卷',
        chapterNum: 1,
        chapterName: '第1章',
        bodyPath: '/A书/正文/第1章.md',
        state: '',
        hasPending: false,
        titleDelayMs: 0,
    };
    const updateControlState = vi.fn((s: string) => { host.state = s; });
    const onSaved = vi.fn();
    const takePendingAutoSave = vi.fn(() => {
        const pending = host.hasPending;
        host.hasPending = false;
        return pending;
    });
    const scheduleAutoSave = vi.fn(() => { host.hasPending = true; });
    const adapter: BodySaveHost = {
        app: {} as never,
        getBodyText: () => host.body,
        getIdentity: () => ({
            project: host.project,
            volume: host.volume,
            chapterNum: host.chapterNum,
            chapterName: host.chapterName,
            bodyPath: host.bodyPath,
        }),
        updateControlState,
        getChapterTitle: async () => {
            if (host.titleDelayMs > 0) {
                await new Promise(resolve => setTimeout(resolve, host.titleDelayMs));
            }
            return '旧标题';
        },
        isSameChapterIdentity: (identity) => identity.project === host.project
            && identity.chapterNum === host.chapterNum
            && identity.bodyPath === host.bodyPath,
        onSaved,
        takePendingAutoSave,
        scheduleAutoSave,
    };
    return {
        host,
        hostAdapter: adapter,
        controller: new BodySaveController(adapter),
        updateControlState,
        onSaved,
        takePendingAutoSave,
        scheduleAutoSave,
    };
}

describe('BodySaveController — 保存身份快照', () => {
    let writes: Array<Record<string, unknown>>;

    beforeEach(() => {
        writes = [];
        vi.spyOn(BodyWriter.prototype, 'write').mockImplementation(async (req: any) => {
            writes.push(req);
            return { path: req.path, created: false, body: '', wordCount: 0, title: '' };
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('await 期间切章，仍写入旧章路径与旧章身份', async () => {
        const { host, controller, onSaved } = makeHarness();
        // 让取标题挂起，模拟取标题期间发生切章
        host.titleDelayMs = 20;

        const saving = controller.save(false);
        host.chapterNum = 2;
        host.chapterName = '第2章';
        host.project = 'B书';
        host.bodyPath = '/B书/正文/第2章.md';
        await saving;

        expect(writes).toHaveLength(1);
        expect(writes[0].path).toBe('/A书/正文/第1章.md');
        expect(writes[0].chapterNum).toBe(1);
        expect(writes[0].project).toBe('A书');
        // 已切章：不得把「已保存」与刷新写到新章界面
        expect(onSaved).not.toHaveBeenCalled();
    });

    it('身份未变时正常保存并返回 true', async () => {
        const { controller, host, updateControlState, onSaved } = makeHarness();

        await expect(controller.save(false)).resolves.toBe(true);
        expect(writes[0].path).toBe('/A书/正文/第1章.md');
        expect(updateControlState).toHaveBeenLastCalledWith('已保存');
        expect(host.state).toBe('已保存');
        expect(onSaved).toHaveBeenCalledTimes(1);
    });

    it('保存进行中再次调用会排队补写一次，而不是静默返回 false', async () => {
        const { host, controller } = makeHarness();
        host.titleDelayMs = 20;

        const first = controller.save(false);
        // 旧实现这里直接返回 false：调用方（Ctrl+S / 切章冲刷）会以为写盘失败，
        // 而冲刷路径已经取消了防抖定时器 —— 这段输入永久丢失。
        const second = controller.save(false);

        await expect(first).resolves.toBe(true);
        await expect(second).resolves.toBe(true);

        expect(writes).toHaveLength(2);
        // 第二次写盘必须带上排队期间的最新正文
        host.body = '排队期间又写了一句。';
        await expect(controller.save(false)).resolves.toBe(true);
        expect((writes[writes.length - 1] as { raw: string }).raw).toContain('排队期间又写了一句');
    });
});

describe('BodySaveController — 程序化写入与并发冲刷', () => {
    let writes: Array<Record<string, unknown>>;

    beforeEach(() => {
        writes = [];
        vi.spyOn(BodyWriter.prototype, 'write').mockImplementation(async (req: any) => {
            writes.push(req);
            return { path: req.path, created: false, body: '', wordCount: 0, title: '' };
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('markDirty 会排一次自动保存（程序化写入不再依赖 input 事件）', () => {
        const { controller, scheduleAutoSave } = makeHarness();

        controller.markDirty();

        expect(scheduleAutoSave).toHaveBeenCalledTimes(1);
    });

    it('切章冲刷先等在途保存结束，再补写排队中的正文', async () => {
        const { host, controller, takePendingAutoSave } = makeHarness();
        host.titleDelayMs = 20;

        // 在途保存（快照是旧正文）
        const inFlight = controller.save(false);
        // 用户在保存期间继续输入 → 排了一次自动保存
        host.body = '旧正文加新句子。';
        controller.markDirty();
        expect(takePendingAutoSave).not.toHaveBeenCalled();

        const flushed = await controller.flushBeforeChapterSwitch();

        await expect(inFlight).resolves.toBe(true);
        expect(flushed).toBe(true);
        expect(takePendingAutoSave).toHaveBeenCalledTimes(1);
        // 第一笔是旧快照，第二笔必须包含排队期间的输入
        expect(writes.length).toBeGreaterThanOrEqual(2);
        expect((writes[writes.length - 1] as { raw: string }).raw).toContain('旧正文加新句子');
    });

    it('在途保存期间无新输入时，冲刷等待完成后不重复写盘', async () => {
        const { host, controller } = makeHarness();
        host.titleDelayMs = 20;

        const inFlight = controller.save(false);
        const flushed = await controller.flushBeforeChapterSwitch();

        await expect(inFlight).resolves.toBe(true);
        expect(flushed).toBe(true);
        expect(writes).toHaveLength(1);
    });
});

describe('BodySaveController — 切章前冲刷排队保存', () => {
    it('存在待执行自动保存时以旧身份保存一次', async () => {
        const { host, controller, takePendingAutoSave } = makeHarness();
        host.hasPending = true;
        const write = vi.spyOn(BodyWriter.prototype, 'write').mockResolvedValue({
            path: '/A书/正文/第1章.md', created: false, body: '', wordCount: 0, title: '',
        });
        write.mockClear();

        await expect(controller.flushBeforeChapterSwitch()).resolves.toBe(true);

        expect(takePendingAutoSave).toHaveBeenCalledTimes(1);
        expect(write).toHaveBeenCalledTimes(1);
    });

    it('没有待执行保存时不写盘', async () => {
        vi.restoreAllMocks();
        const { controller } = makeHarness();
        const write = vi.spyOn(BodyWriter.prototype, 'write').mockResolvedValue({
            path: '/A书/正文/第1章.md', created: false, body: '', wordCount: 0, title: '',
        });

        await expect(controller.flushBeforeChapterSwitch()).resolves.toBe(true);

        expect(write).not.toHaveBeenCalled();
    });

    it('未绑定章节时不写盘（首次打开视图）', async () => {
        const { host, controller } = makeHarness();
        host.hasPending = true;
        host.project = '';
        host.chapterNum = 0;
        const write = vi.spyOn(BodyWriter.prototype, 'write').mockResolvedValue({
            path: '', created: false, body: '', wordCount: 0, title: '',
        });
        write.mockClear();

        await expect(controller.flushBeforeChapterSwitch()).resolves.toBe(true);

        expect(write).not.toHaveBeenCalled();
    });

    it('保存失败时返回 false，调用方据此中止切章', async () => {
        const { host, controller } = makeHarness();
        host.hasPending = true;
        vi.spyOn(BodyWriter.prototype, 'write').mockRejectedValue(new Error('EACCES'));

        await expect(controller.flushBeforeChapterSwitch()).resolves.toBe(false);
    });
});

describe('BodySaveController — 外部写入冲突保护（P0-6）', () => {
    function makeDiskHarness(initial: string) {
        const h = makeHarness();
        let disk = initial;
        const app = {
            vault: {
                adapter: {
                    exists: async () => true,
                    read: async () => disk,
                },
            },
        } as never;
        const controller = new BodySaveController({ ...h.controller['host'], app } as BodySaveHost);
        return {
            h,
            app,
            controller,
            setDisk: (v: string) => { disk = v; },
            getDisk: () => disk,
        };
    }

    it('磁盘被外部改写时拒绝自动保存，不覆盖新稿', async () => {
        const { h, controller, setDisk, getDisk } = makeDiskHarness('旧正文内容');
        // 首次保存建立基线
        await controller.save(false);
        // 外部（工作台一键成文）写入新稿
        setDisk('---\nstatus: written\n---\n\n# 第1章 新稿\n\n外部生成的全新正文。');
        h.host.body = '协同编辑器里的旧内容';
        const ok = await controller.save(false);
        expect(ok).toBe(false);
        expect(getDisk()).toContain('外部生成的全新正文');
    });

    it('磁盘内容与上次写入一致时判定无冲突', async () => {
        const { controller, setDisk } = makeDiskHarness('旧正文内容');
        const detect = (controller as unknown as {
            detectExternalOverwrite(p: string, next: string): Promise<boolean>;
            lastWritten: Map<string, string>;
        });
        detect.lastWritten.set('/A书/正文/第1章.md', '旧正文内容');
        setDisk(['---', 'status: written', '---', '', '# 第1章', '', '旧正文内容'].join('\n'));
        expect(await detect.detectExternalOverwrite('/A书/正文/第1章.md', '协同编辑后的新内容')).toBe(false);
        setDisk('外部生成的全新正文');
        expect(await detect.detectExternalOverwrite('/A书/正文/第1章.md', '协同编辑后的新内容')).toBe(true);
    });
});
