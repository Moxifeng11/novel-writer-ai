import { describe, it, expect } from 'vitest';
import {
    buildScriptUnitSkeleton,
    buildShortUnitSkeleton,
    collectModeManuscript,
    ensureModeContentStructure,
    listModeUnits,
    modeBodyDir,
    modeDocPath,
    modeUnitFileName,
} from '../../../shared/mode-content';

function memoryAdapter() {
    const files = new Map<string, string>();
    const dirs = new Set<string>();
    return {
        files,
        dirs,
        async exists(path: string) { return files.has(path) || dirs.has(path); },
        async read(path: string) { return files.get(path) ?? ''; },
        async write(path: string, content: string) { files.set(path, content); },
        async mkdir(path: string) { dirs.add(path); },
    };
}

function fakeApp(files: Array<{ path: string; name: string; content: string; title?: string; status?: string }>) {
    const map = new Map(files.map(f => [f.path, f]));
    return {
        vault: {
            getFiles: () => files.map(f => ({ path: f.path, name: f.name })),
            read: async (file: { path: string }) => map.get(file.path)?.content ?? '',
        },
        metadataCache: {
            getFileCache: (file: { path: string }) => {
                const f = map.get(file.path);
                return { frontmatter: { 标题: f?.title || '', status: f?.status || '', word_count: 100 } };
            },
        },
    };
}

describe('短篇/剧本独立内容结构', () => {
    it('短篇目录与起始文档不包含长篇 03-大纲与章节', async () => {
        const adapter = memoryAdapter();
        await ensureModeContentStructure(adapter as never, '短篇A', 'short');
        expect(adapter.dirs.has('短篇A/短篇创作/01-故事核')).toBe(true);
        expect(adapter.files.has('短篇A/短篇创作/01-故事核/故事核.md')).toBe(true);
        expect(adapter.files.has('短篇A/短篇创作/02-分节大纲/分节大纲.md')).toBe(true);
        expect([...adapter.files.keys()].some(p => p.includes('03-大纲与章节'))).toBe(false);
        expect(modeBodyDir('短篇A', 'short')).toBe('短篇A/短篇创作/03-正文');
        expect(modeUnitFileName('short', 1)).toBe('第01节.md');
    });

    it('剧本目录包含场景圣经、分集大纲、分镜表', async () => {
        const adapter = memoryAdapter();
        await ensureModeContentStructure(adapter as never, '剧本A', 'script');
        expect(adapter.files.has(modeDocPath('剧本A', 'script', 'bible'))).toBe(true);
        expect(adapter.files.has(modeDocPath('剧本A', 'script', 'outline'))).toBe(true);
        expect(adapter.files.has(modeDocPath('剧本A', 'script', 'storyboard'))).toBe(true);
        expect(modeBodyDir('剧本A', 'script')).toBe('剧本A/剧本创作/03-剧本');
        expect(modeUnitFileName('script', 3)).toBe('第03集.md');
    });

    it('扫描独立正文单元并按集/节输出，不读长篇目录', () => {
        const shortApp = fakeApp([
            { path: '短篇A/短篇创作/03-正文/第02节.md', name: '第02节.md', content: 'x', title: '反转', status: 'written' },
            { path: '短篇A/短篇创作/03-正文/第01节.md', name: '第01节.md', content: 'y', title: '开场', status: 'pending' },
            { path: '短篇A/03-大纲与章节/正文/第1卷/第1章_正文.md', name: '第1章_正文.md', content: 'legacy' },
        ]);
        const shortUnits = listModeUnits(shortApp as never, '短篇A', 'short');
        expect(shortUnits.map(u => u.unitName)).toEqual(['第1节', '第2节']);
        expect(shortUnits[0].title).toBe('开场');
        expect(shortUnits.every(u => !u.legacy)).toBe(true);

        const scriptApp = fakeApp([
            { path: '剧本A/剧本创作/03-剧本/第01集.md', name: '第01集.md', content: 's', title: '开局', status: 'pending' },
        ]);
        expect(listModeUnits(scriptApp as never, '剧本A', 'script')[0].unitName).toBe('第1集');
    });

    it('导出收集按模式正文生成章节结构', async () => {
        const app = fakeApp([
            { path: '短篇A/短篇创作/03-正文/第01节.md', name: '第01节.md', content: '# 第1节\n正文', title: '开场' },
            { path: '短篇A/短篇创作/03-正文/第02节.md', name: '第02节.md', content: '# 第2节\n正文', title: '反转' },
        ]);
        const chapters = await collectModeManuscript(app as never, '短篇A', 'short');
        expect(chapters).toHaveLength(2);
        expect(chapters[0].chapter).toBe('第1节');
        expect(chapters[1].title).toBe('反转');
        expect(chapters.every(c => c.volume === '')).toBe(true);
    });

    it('单元骨架使用节/集标题与模式字段', () => {
        expect(buildShortUnitSkeleton(2)).toContain('# 第2节');
        expect(buildShortUnitSkeleton(2)).toContain('本节目标');
        expect(buildScriptUnitSkeleton(3)).toContain('# 第3集');
        expect(buildScriptUnitSkeleton(3)).toContain('场次');
        expect(buildScriptUnitSkeleton(3)).toContain('3-1 日/内');
    });
});
