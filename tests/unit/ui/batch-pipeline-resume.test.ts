import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../main', () => ({
    default: class NovelWriterPlugin {},
    DEFAULT_PROVIDERS: {},
    resolveProviderSourceType: () => 'cloud',
}));

import { TFile, TFolder } from 'obsidian';
import { BatchPipelineRunner } from '../../../ui/full-writer/batch-pipeline-runner';
import { pjBodyFile } from '../../../shared/paths';

describe('BatchPipelineRunner — v4 续跑读取', () => {
    it('从 pjBodyFile 读取正文，而不是只查 chapDir', async () => {
        const project = '书甲';
        const chapDir = '书甲/03-大纲与章节/步骤结果/第1卷/第1章';
        const bodyPath = pjBodyFile(project, 1, 1);
        const body = '# 第1章 试炼\n\n' + '他抬手。'.repeat(600);
        const outline = '# 大纲\n\n核心冲突：试炼。';

        const files = new Map<string, string>([
            [bodyPath, body],
            [`${chapDir}/第1章_大纲摘要.md`, outline],
        ]);
        const fileObjects = new Map<string, TFile>();
        for (const path of files.keys()) {
            const file = new TFile();
            file.path = path;
            file.name = path.split('/').pop() || '';
            file.basename = file.name.replace(/\.md$/, '');
            fileObjects.set(path, file);
        }
        const folder = new TFolder();
        folder.path = chapDir;
        folder.name = '第1章';
        // 真实 vault 里目录有 children；补全后路径遍历（listFolderFiles）才能命中步骤结果文件
        folder.children = [fileObjects.get(`${chapDir}/第1章_大纲摘要.md`)!];

        const app = {
            vault: {
                getAbstractFileByPath: (path: string) => path === chapDir ? folder : fileObjects.get(path) ?? null,
                getFiles: () => Array.from(fileObjects.values()),
                read: async (file: TFile) => files.get(file.path) || '',
            },
        };
        const plugin = {
            aiEngine: {},
            engineRegistry: { get: () => ({}) },
            settings: {},
        };
        const runner = new BatchPipelineRunner(app as never, plugin as never);

        const results = await (runner as unknown as {
            loadStepResults: (
                chapDir: string,
                chapterName: string,
                project: string,
                volumeNum: number,
                chapterNum: number,
            ) => Promise<Record<string, string>>;
        }).loadStepResults(chapDir, '第1章', project, 1, 1);

        expect(results['bodyGeneration']).toBe(body);
        expect(results['outline']).toBe(outline);
    });
});
