/**
 * single-ai-engine-instance.test.ts — AIEngine 只能由 registry 持有（审计 C#20）
 *
 * 背景：main.ts 曾有三处 `new AIEngine(this)` 临时实例
 * （`generateChapterBySceneLoop` / `autoReviseChapter` / `runBaselineProbe`），
 * 与 `engineRegistry` 单例并行存在——各自持有独立的调用状态/缓存，口径不一致。
 * 这里做源码级棘轮：引擎实例只允许在 `engine/engine-registry.ts` 里 new。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function source(file: string): string {
    return readFileSync(resolve(process.cwd(), file), 'utf8');
}

function stripComments(src: string): string {
    return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

describe('AIEngine 单实例（P2 #20）', () => {
    it('main.ts 不再直接 new AIEngine，改用 this.aiEngine', () => {
        const src = stripComments(source('main.ts'));
        expect(src).not.toMatch(/new AIEngine\(/);
        expect(src).toMatch(/get aiEngine\(\): AIEngine \{\s*\n\s*return this\.engineRegistry\.get\(ENGINE_NAMES\.AI_ENGINE\);/);
    });

    it('三个原临时实例方法都走 registry 单例', () => {
        const src = stripComments(source('main.ts'));
        for (const method of [
            'generateChapterBySceneLoop(project: string, chapterName: string, dryRun = true)',
            'autoReviseChapter(project: string, chapterName: string',
            'runBaselineProbe(project: string, chapterName: string, model?: string)',
        ]) {
            const at = src.indexOf(method);
            expect(at, `未找到方法签名：${method}`).toBeGreaterThan(-1);
            const body = src.slice(at, at + 900);
            expect(body).toContain('const engine = this.aiEngine;');
            expect(body).not.toContain('new AIEngine(');
        }
    });

    it('唯一构造点在 engine-registry 的懒注册里', () => {
        const registry = stripComments(source('engine/engine-registry.ts'));
        expect(registry).toMatch(/registerLazy\(ENGINE_NAMES\.AI_ENGINE, \(\) => new AIEngine\(plugin\)\)/);
    });

    it('ui/ 与 engine/ 其余文件不直接构造 AIEngine', () => {
        const files = ['ui/full-writer-view.ts', 'ui/co-writing-view.ts', 'engine/co-writer-engine.ts'];
        for (const file of files) {
            expect(stripComments(source(file)), file).not.toMatch(/new AIEngine\(/);
        }
    });
});
