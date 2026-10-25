/**
 * prompt-injection-guard.test.ts — 知识注入不得绕过预算闸门（源码级不变量）
 *
 * B6：`systemPrompt += knowledge` 与 `prompt += 【写作参考】` 这类直接拼接会让
 * 注入内容落到 system 尾部或 user 主体里。窗口不足时模型从尾部截断，
 * 最先丢掉的恰好是输出约束；调用方也无法把注入层作为「可整段丢弃」处理。
 *
 * 正确入口：
 * - 11 步正文：`ai-prompt-builder#buildChapterPrompts`（知识 = user 可裁剪层）
 * - 场景正文：`KnowledgeInjector#injectForSceneBodyLayers`（必须层进 system）
 * - 场景展开 / 大纲扩写：`fitPromptToContext` 的 `extraTail`
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

const ENGINE_ROOT = resolve(process.cwd(), 'engine');

/** 实体批量生成拼的是「名单」，不是知识注入，允许保留 */
const ALLOW_SYSTEM_CONCAT = new Set(['ai-batch-entity-generator.ts']);

function listTsFiles(dir: string): string[] {
    const files: string[] = [];
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
            files.push(...listTsFiles(full));
            continue;
        }
        if (entry.endsWith('.ts')) files.push(full);
    }
    return files;
}

/** 去掉注释后再匹配，避免「说明反例」的文档注释被误判 */
function stripComments(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

describe('知识注入预算闸门守卫', () => {
    const files = listTsFiles(ENGINE_ROOT);

    it('扫描范围有效（防止路径错误导致假绿）', () => {
        expect(files.length).toBeGreaterThan(100);
    });

    it('engine 层不得用 systemPrompt += 直接拼接注入', () => {
        const offenders = files
            .filter(file => !ALLOW_SYSTEM_CONCAT.has(basename(file)))
            .filter(file => /systemPrompt\s*\+=/.test(stripComments(readFileSync(file, 'utf8'))));
        expect(offenders.map(file => file.slice(ENGINE_ROOT.length + 1))).toEqual([]);
    });

    it('engine 层不得把【写作参考】直接拼进 prompt', () => {
        const offenders = files.filter(file => {
            const source = stripComments(readFileSync(file, 'utf8'));
            return /(?:prompt|userPrompt|systemPrompt)\s*\+=[^\n]*【写作参考】/.test(source);
        });
        expect(offenders.map(file => file.slice(ENGINE_ROOT.length + 1))).toEqual([]);
    });
});
