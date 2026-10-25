import { describe, it, expect, vi } from 'vitest';

// main.ts 是插件入口（运行时 import obsidian），单测只需它的类型/实例占位
vi.mock('../../../main', () => ({ default: class {} }));

import { BatchPipelineRunner } from '../../../ui/full-writer/batch-pipeline-runner';
import { buildBatchTargets } from '../../../ui/full-writer/batch-targets';

function makeRunner(): BatchPipelineRunner {
    const plugin = {
        aiEngine: {},
        engineRegistry: { get: () => ({}) },
    };
    return new BatchPipelineRunner({} as never, plugin as never);
}

describe('A6 批量流水线取消', () => {
    it('signal 已取消时，不启动任何章节', async () => {
        const runner = makeRunner();
        const controller = new AbortController();
        controller.abort();

        const started: string[] = [];
        const results = await runner.run(
            '测试项目',
            buildBatchTargets('第1卷', 1, 1, 3),
            {
                signal: controller.signal,
                onChapterStart: (target) => started.push(target.chapterName),
            },
        );

        expect(started).toEqual([]);
        expect(results).toEqual([]);
    });

    it('中途取消后不再开始下一章', async () => {
        const runner = makeRunner();
        const controller = new AbortController();
        const started: string[] = [];

        await runner.run(
            '测试项目',
            buildBatchTargets('第1卷', 1, 1, 3),
            {
                signal: controller.signal,
                onChapterStart: (target) => {
                    started.push(target.chapterName);
                    // 第 1 章一开始就取消：后续章节不得再进入
                    if (started.length === 1) controller.abort();
                },
            },
        );

        expect(started).toEqual(['第1章']);
    });
});
