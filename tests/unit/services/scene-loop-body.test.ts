/**
 * A1：正文步场景循环编排
 */

import { describe, expect, it } from 'vitest';
import { App, Vault } from 'obsidian';
import { SceneLoopBodyService } from '@/services/scene-loop-body-service';
import type { SceneLoopResult } from '@/engine/scene-generation-loop';

const PROJECT = '长篇小说/甲';
const SCENE_PATH = `${PROJECT}/03-大纲与章节/步骤结果/第1卷/第1章/第1章_Scene展开.md`;

const make = (opts: { sceneText?: string; loop?: SceneLoopResult } = {}) => {
    const vault = new Vault() as Vault & { _seedFile(path: string, content: string): unknown };
    const app = new App();
    app.vault = vault;
    const writes: Array<{ chapter: string; body: string }> = [];
    const sceneText = opts.sceneText ?? '## 场景1：开头\n## 场景2：冲突\n';
    if (sceneText) vault._seedFile(SCENE_PATH, sceneText);
    const defaultLoop: SceneLoopResult = {
        scenes: [
            { task: { num: 1 } as never, body: '场景一正文', beatVerify: null, conflicts: [] } as never,
            { task: { num: 2 } as never, body: '场景二正文', beatVerify: null, conflicts: [] } as never,
        ] as never,
        failedScenes: [],
        completedAll: true,
        aborted: false,
    } as SceneLoopResult;
    const service = new SceneLoopBodyService(app, {
        runLoop: async () => opts.loop ?? defaultLoop,
        readText: async (path) => (path === SCENE_PATH ? sceneText : ''),
        writeBody: async (_project, chapter, body) => { writes.push({ chapter, body }); },
        findBySuffix: async (_project, suffix) => (suffix.endsWith('_Scene展开') ? SCENE_PATH : null),
    });
    return { service, writes };
};

describe('SceneLoopBodyService', () => {
    it('dry-run 不落盘但报告场景数与字数', async () => {
        const { service, writes } = make();
        const result = await service.generate(PROJECT, '第1章', { dryRun: true });
        expect(result.dryRun).toBe(true);
        expect(result.scenes).toBe(2);
        expect(result.completedAll).toBe(true);
        expect(result.wrote).toBe(false);
        expect(writes).toHaveLength(0);
        expect(result.chars).toBeGreaterThan(0);
    });

    it('全部成功时合并正文并落盘', async () => {
        const { service, writes } = make();
        const result = await service.generate(PROJECT, '第1章', { dryRun: false });
        expect(result.wrote).toBe(true);
        expect(writes[0].chapter).toBe('第1章');
        expect(writes[0].body).toContain('场景一正文');
        expect(writes[0].body).toContain('场景二正文');
    });

    it('有失败场景时默认不落盘（除非允许部分）', async () => {
        const partial = {
            scenes: [{ task: { num: 1 } as never, body: '第一场', beatVerify: null, conflicts: [] } as never] as never,
            failedScenes: [{ task: { num: 2 } as never, error: '超时' }] as never,
            completedAll: false,
            aborted: false,
        } as SceneLoopResult;
        const { service, writes } = make({ loop: partial });
        const result = await service.generate(PROJECT, '第1章', { dryRun: false });
        expect(result.wrote).toBe(false);
        expect(result.failedScenes).toEqual([2]);
        expect(writes).toHaveLength(0);

        const allow = await service.generate(PROJECT, '第1章', { dryRun: false, allowPartial: true });
        expect(allow.wrote).toBe(true);
    });

    it('没有 Scene 展开时返回明确原因', async () => {
        const { service } = make({ sceneText: '' });
        const result = await service.generate(PROJECT, '第1章', { dryRun: false });
        expect(result.scenes).toBe(0);
        expect(result.summary).toContain('Scene 展开为空');
    });

    it('返回合并正文（供流水线复用，避免重复读取）', async () => {
        const { service } = make();
        const result = await service.generate(PROJECT, '第1章', { dryRun: true });
        expect(result.body).toContain('场景一正文');
        expect(result.body).toContain('场景二正文');
    });

    it('合并时跳过相邻重复段', () => {
        const { service } = make();
        expect(service.mergeBodies(['A段', 'A段', 'B段'])).toBe('A段\n\nB段');
    });
});
