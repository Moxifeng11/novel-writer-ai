import { describe, expect, it } from 'vitest';
import {
    WritingStatsService,
    countBodyChars,
    projectOfFile,
    type StatsFileLike,
} from '../../../services/writing-stats-service';

const NOW = new Date(2026, 10, 1, 12, 0, 0).getTime();

interface FakeFile extends StatsFileLike {
    wordCount?: number;
    content?: string;
}

const LISTINGS = new WeakMap<object, FakeFile[]>();

function makeApp(files: FakeFile[]) {
    const disk = new Map<string, string>();
    const list = new Map(files.map(file => [file.path, file]));
    const app = {
        vault: {
            read: async (target: StatsFileLike) => {
                const file = list.get(target.path);
                return file?.content ?? '';
            },
            adapter: {
                exists: async (path: string) => disk.has(path),
                read: async (path: string) => {
                    const value = disk.get(path);
                    if (value === undefined) throw new Error(`missing ${path}`);
                    return value;
                },
                write: async (path: string, data: string) => { disk.set(path, data); },
                mkdir: async () => undefined,
            },
        },
        metadataCache: {
            getFileCache: (target: StatsFileLike) => {
                const file = list.get(target.path);
                if (!file) return null;
                return file.wordCount === undefined
                    ? { frontmatter: {} }
                    : { frontmatter: { word_count: file.wordCount } };
            },
        },
    };
    LISTINGS.set(app, files);
    return { app, disk, list };
}

function makeService(app: ReturnType<typeof makeApp>['app'], ledgerPath = 'data/writing-stats.json') {
    return new WritingStatsService({
        app: app as never,
        ledgerPath,
        isBodyPath: path => path.includes('_正文.md'),
        // G6-4 后必填：生产注入 listChapterBodyFiles，测试用同一份内存文件清单
        listBodyFiles: () => (LISTINGS.get(app) ?? []).map(file => ({ path: file.path, stat: file.stat })),
        now: () => NOW,
    });
}

const dayNow = '2026-11-01';

describe('WritingStatsService', () => {
    it('首次扫描把正文按 mtime 归日，并落盘台账', async () => {
        const { app, disk } = makeApp([
            { path: '长篇小说/书A/03-大纲与章节/正文/第1卷/第1章_正文.md', stat: { mtime: NOW }, wordCount: 3200 },
            { path: '长篇小说/书A/03-大纲与章节/正文/第1卷/第2章_正文.md', stat: { mtime: NOW - 86_400_000 }, wordCount: 2800 },
            { path: '长篇小说/书A/02-时间线与伏笔/伏笔库.md', stat: { mtime: NOW }, wordCount: 999 },
        ]);
        const service = makeService(app);
        await service.scan();

        const report = service.getReport();
        expect(report.global.today).toBe(3200);
        expect(report.global.total).toBe(6000);
        expect(report.byProject['长篇小说/书A'].total).toBe(6000);

        // 非正文文件不统计
        expect(service.getData().files['长篇小说/书A/02-时间线与伏笔/伏笔库.md']).toBeUndefined();

        service.dispose();
        await new Promise(resolve => setTimeout(resolve, 0));
        const ledger = disk.get('data/writing-stats.json');
        expect(ledger).toBeTruthy();
        expect(JSON.parse(ledger!).days[dayNow]).toBe(3200);
    });

    it('mtime 未变化时跳过，不重复计数', async () => {
        const { app } = makeApp([
            { path: 'p/第1章_正文.md', stat: { mtime: NOW }, wordCount: 1000 },
        ]);
        const service = makeService(app);
        await service.scan();
        await service.scan();
        expect(service.getReport().global.today).toBe(1000);
    });

    it('modify 事件按增量累加', async () => {
        const { app, list } = makeApp([
            { path: 'p/第1章_正文.md', stat: { mtime: NOW }, wordCount: 1000 },
        ]);
        const service = makeService(app);
        await service.scan();

        const file = list.get('p/第1章_正文.md')!;
        // 事件路径按正文内容计数（不依赖 frontmatter）
        file.content = '字'.repeat(1500);
        file.stat = { mtime: NOW + 60_000 };
        await service.handleFileChange({ path: file.path, stat: file.stat });

        expect(service.getReport().global.today).toBe(1500);
    });

    it('modify 事件忽略陈旧的 word_count（metadataCache 可能还没更新）', async () => {
        const { app, list } = makeApp([
            { path: 'p/第1章_正文.md', stat: { mtime: NOW }, content: '字'.repeat(500) },
        ]);
        const service = makeService(app);
        await service.scan();

        const file = list.get('p/第1章_正文.md')!;
        file.content = '字'.repeat(800);
        file.wordCount = 9999; // 陈旧元数据：若被采信会记成 +9499
        file.stat = { mtime: NOW + 60_000 };
        await service.handleFileChange({ path: file.path, stat: file.stat });

        expect(service.getReport().global.today).toBe(800);
    });

    it('无 word_count 时用正文字符数兜底', async () => {
        const content = `---\ntitle: 测试\n---\n\n${'字'.repeat(120)}`;
        const { app } = makeApp([
            { path: 'p/第1章_正文.md', stat: { mtime: NOW }, content },
        ]);
        const service = makeService(app);
        await service.scan();
        expect(service.getReport().global.today).toBe(120);
    });

    it('删除文件只清快照，历史日产出保留', async () => {
        const { app, list } = makeApp([
            { path: 'p/第1章_正文.md', stat: { mtime: NOW }, wordCount: 800 },
        ]);
        const service = makeService(app);
        await service.scan();
        list.delete('p/第1章_正文.md');
        service.handleFileDelete('p/第1章_正文.md');
        expect(service.getData().files['p/第1章_正文.md']).toBeUndefined();
        expect(service.getReport().global.today).toBe(800);
    });

    it('重启后从磁盘台账恢复', async () => {
        const first = makeApp([
            { path: 'p/第1章_正文.md', stat: { mtime: NOW }, wordCount: 700 },
        ]);
        const serviceA = makeService(first.app);
        await serviceA.scan();
        serviceA.dispose();
        await new Promise(resolve => setTimeout(resolve, 0));

        // 同一份磁盘数据，新的服务实例
        const second = makeApp([]);
        for (const [key, value] of first.disk) second.disk.set(key, value);
        const serviceB = makeService(second.app);
        await serviceB.load();
        expect(serviceB.getReport().global.total).toBe(700);
    });

    it('台账损坏时按空台账继续，不抛错', async () => {
        const { app, disk } = makeApp([]);
        disk.set('data/writing-stats.json', '{broken');
        const service = makeService(app);
        await expect(service.load()).resolves.toBeUndefined();
        expect(service.getReport().global.total).toBe(0);
    });
});

describe('辅助函数', () => {
    it('countBodyChars 去掉 frontmatter 并按非空白计数', () => {
        expect(countBodyChars('---\na: 1\n---\n\n你 好\n世界')).toBe(4);
    });

    it('projectOfFile 取前两级', () => {
        expect(projectOfFile('长篇小说/书A/03-大纲与章节/正文/第1卷/第1章_正文.md')).toBe('长篇小说/书A');
        expect(projectOfFile('单层.md')).toBe('单层.md');
    });
});
