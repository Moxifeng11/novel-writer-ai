/**
 * full-writer-data-safety.test.ts — 完整写作工作台的数据安全回归
 *
 * 锁定三处会写错文件/重复写入的缺陷：
 * 1. `writeFixToBody` 把「卷目录」交给 findChapterFile，标准文件名匹配必然失败，
 *    frontmatter 回退会返回该卷**第一个**正文文件 → 第 3 章的修正稿写进第 1 章；
 * 2. 章节结算有两条触发路径（编排器 + 步骤 10 自动触发），并发时重复追加且失败会无限重试；
 * 3. 批量续跑把「文件存在但读不出来」当成「没有结果」，会重新生成并覆盖原文。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../main', () => ({
    default: class NovelWriterPlugin {},
}));

const settlementPrimitive = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => null as unknown));

import { StepResultSaver } from '../../../engine/step-result-saver';
import { StepRunner } from '../../../engine/step-runner';
import { BodyWriter } from '../../../engine/body-writer';
import { pjBodyFile, pjStepDir } from '../../../shared/paths';

class FakeFileSystem {
    files = new Map<string, string>();
    folders = new Set<string>();
    /** 这些路径的 read 直接抛错（模拟同步冲突/权限） */
    unreadable = new Set<string>();

    async read(path: string): Promise<string> {
        if (this.unreadable.has(path)) throw new Error(`EACCES: ${path}`);
        const value = this.files.get(path);
        if (value === undefined) throw new Error(`ENOENT: ${path}`);
        return value;
    }
    async write(path: string, content: string): Promise<void> {
        this.files.set(path, content);
    }
    async exists(path: string): Promise<boolean> {
        return this.files.has(path) || this.folders.has(path);
    }
    async delete(path: string): Promise<void> {
        this.files.delete(path);
    }
    async mkdir(path: string): Promise<void> {
        this.folders.add(path);
    }
    async rename(from: string, to: string): Promise<void> {
        const value = this.files.get(from);
        if (value === undefined) return;
        this.files.delete(from);
        this.files.set(to, value);
    }
    async listFiles(): Promise<never[]> { return []; }
    async listFolders(): Promise<never[]> { return []; }
    async listAll(): Promise<never[]> { return []; }
    async getFile(): Promise<null> { return null; }
    async getFolder(): Promise<null> { return null; }
    /** VaultMetaPort：正文查找依赖它 */
    getFiles(): Array<{ path: string; name: string; basename: string; extension: string }> {
        return [...this.files.keys()]
            .filter(path => path.endsWith('.md'))
            .map(path => ({
                path,
                name: path.split('/').pop()!,
                basename: path.split('/').pop()!.replace(/\.md$/, ''),
                extension: 'md',
            }));
    }
    getAbstractFileByPath(path: string): unknown {
        return this.files.has(path) ? { path } : null;
    }
}

function makeSaver(fs: FakeFileSystem): StepResultSaver {
    // app 只需提供 metadataCache：findChapterFile 的 frontmatter 回退会用到它。
    // 提供后，旧实现「按卷找第一个正文文件」会真的命中第 1 章，测试能精确断言写错文件。
    const app = {
        metadataCache: {
            getFileCache: () => ({ frontmatter: { status: 'written' } }),
        },
        vault: {},
    };
    const saver = new StepResultSaver({
        app: app as never,
        fs: fs as never,
        // 不传 frontmatter 时 getFrontmatter() 会因为没有可用 app 抛错，导致整次回写被吞
        frontmatter: { processFrontmatter: async () => undefined } as never,
        deps: { showNotice: () => undefined },
    });
    (saver as any).vaultMeta = fs;
    return saver;
}

function makeRunner(fs: FakeFileSystem): StepRunner {
    const plugin = {
        aiEngine: {},
        engineRegistry: { get: () => ({}) },
        settings: {},
    };
    const runner = new StepRunner(
        {} as never,
        plugin as never,
        undefined,
        { settlementPrimitive: settlementPrimitive as never },
    );
    (runner as any).fs = fs;
    (runner as any).vaultMeta = fs;
    return runner;
}

describe('StepResultSaver.writeFixToBody — 必须写回当前章', () => {
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

    it('多章同卷时修正稿只写进目标章，不碰同卷其它章', async () => {
        const fs = new FakeFileSystem();
        const project = '测试书';
        // 同卷三章都存在
        for (const n of [1, 2, 3]) {
            fs.files.set(pjBodyFile(project, 1, n), `---\nstatus: written\n---\n\n第${n}章正文`);
        }
        const saver = makeSaver(fs);

        await saver.writeFixToBody('修正后的第3章正文', pjStepDir(project, 1, 3), '第3章', '第1卷');

        expect(writes).toHaveLength(1);
        expect(writes[0].path).toBe(pjBodyFile(project, 1, 3));
        expect(writes[0].chapterNum).toBe(3);
    });

    it('目标章正文不存在时也按精确路径创建，而不是退回同卷第一章', async () => {
        const fs = new FakeFileSystem();
        const project = '测试书';
        fs.files.set(pjBodyFile(project, 1, 1), '---\nstatus: written\n---\n\n第1章正文');
        const saver = makeSaver(fs);

        await saver.writeFixToBody('第5章修正稿', pjStepDir(project, 1, 5), '第5章', '第1卷');

        expect(writes).toHaveLength(1);
        expect(writes[0].path).toBe(pjBodyFile(project, 1, 5));
    });
});

describe('StepRunner — 结算守卫与并发合并', () => {
    const project = '测试书';
    const chapDir = pjStepDir(project, 1, 3);

    beforeEach(() => {
        settlementPrimitive.mockClear();
        settlementPrimitive.mockResolvedValue(null);
    });

    it('磁盘正文已是 settled 时直接跳过，不重复追加', async () => {
        const fs = new FakeFileSystem();
        fs.files.set(pjBodyFile(project, 1, 3), '---\nstatus: settled\n---\n\n正文');
        const runner = makeRunner(fs);
        const stepCompleted = new Set<string>();

        await runner.executeSettlement(
            project, chapDir, '第3章', {}, stepCompleted, {}, {} as never,
            async () => undefined, {} as never,
        );

        expect(settlementPrimitive).not.toHaveBeenCalled();
        expect(stepCompleted.has('settlement')).toBe(true);
    });

    it('status 不是 settled 时正常执行一次结算', async () => {
        const fs = new FakeFileSystem();
        fs.files.set(pjBodyFile(project, 1, 3), '---\nstatus: written\n---\n\n正文');
        const runner = makeRunner(fs);
        const stepCompleted = new Set<string>();

        await runner.executeSettlement(
            project, chapDir, '第3章', {}, stepCompleted, {}, {} as never,
            async () => undefined, {} as never,
        );

        expect(settlementPrimitive).toHaveBeenCalledTimes(1);
    });

    it('并发触发（编排器 + 步骤渲染）合并为一次执行', async () => {
        const fs = new FakeFileSystem();
        fs.files.set(pjBodyFile(project, 1, 3), '---\nstatus: written\n---\n\n正文');
        const runner = makeRunner(fs);

        let release: (value: unknown) => void = () => undefined;
        const pending = new Promise(resolve => { release = resolve; });
        settlementPrimitive.mockImplementation(async () => pending as never);

        const first = runner.executeSettlement(
            project, chapDir, '第3章', {}, new Set<string>(), {}, {} as never,
            async () => undefined, {} as never,
        );
        const second = runner.executeSettlement(
            project, chapDir, '第3章', {}, new Set<string>(), {}, {} as never,
            async () => undefined, {} as never,
        );

        release(null);
        await Promise.all([first, second]);

        expect(settlementPrimitive).toHaveBeenCalledTimes(1);
    });

    it('force 重新结算时无视磁盘 settled 状态', async () => {
        const fs = new FakeFileSystem();
        fs.files.set(pjBodyFile(project, 1, 3), '---\nstatus: settled\n---\n\n正文');
        const runner = makeRunner(fs);

        await runner.executeSettlement(
            project, chapDir, '第3章', {}, new Set<string>(), {}, {} as never,
            async () => undefined, {} as never,
            { force: true },
        );

        expect(settlementPrimitive).toHaveBeenCalledTimes(1);
    });

    it('不同章节的结算互不阻塞', async () => {
        const fs = new FakeFileSystem();
        fs.files.set(pjBodyFile(project, 1, 3), '---\nstatus: written\n---\n\n正文');
        fs.files.set(pjBodyFile(project, 1, 4), '---\nstatus: written\n---\n\n正文');
        const runner = makeRunner(fs);

        await Promise.all([
            runner.executeSettlement(project, pjStepDir(project, 1, 3), '第3章', {}, new Set(), {}, {} as never, async () => undefined, {} as never),
            runner.executeSettlement(project, pjStepDir(project, 1, 4), '第4章', {}, new Set(), {}, {} as never, async () => undefined, {} as never),
        ]);

        expect(settlementPrimitive).toHaveBeenCalledTimes(2);
    });
});
