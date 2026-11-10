import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * PF-3（2026-11-10 包体审计）：Worker 产物此前只校验「存在且 ≥1KB」，
 * 损坏但体积正常的产物仍可进发布 zip；同时 workers 不在体积棘轮内。
 * 这里验证新门禁的两半：worker-syntax 真的能识别非法 JS，
 * 且 check-bundle / check-release 已把 workers 纳入。
 */
const ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');

type SyntaxChecker = (file: string) => { ok: boolean; error?: string };
let checkWorkerSyntax: SyntaxChecker;
let tmpDir: string;

beforeAll(async () => {
    const mod = await import(pathToFileURL(path.join(ROOT, 'scripts/worker-syntax.mjs')).href);
    checkWorkerSyntax = (mod as { checkWorkerSyntax: SyntaxChecker }).checkWorkerSyntax;
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nw-worker-syntax-'));
});

afterAll(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('worker-syntax 门禁', () => {
    it('合法 CJS 产物通过', () => {
        const file = path.join(tmpDir, 'good.js');
        fs.writeFileSync(file, '"use strict";self.onmessage=function(e){self.postMessage(e.data)};\n');
        expect(checkWorkerSyntax(file)).toEqual({ ok: true });
    });

    it('语法损坏的产物被拒绝（体积正常也不能发版）', () => {
        const file = path.join(tmpDir, 'bad.js');
        fs.writeFileSync(file, 'function broken( {\n');
        const result = checkWorkerSyntax(file);
        expect(result.ok).toBe(false);
        expect(result.error).toBeTruthy();
    });

    it('check:release 对两个 worker 调用语法校验', () => {
        const src = read('scripts/check-release.mjs');
        expect(src).toContain("from './worker-syntax.mjs'");
        expect(src).toContain('checkWorkerSyntax(path.join(rootDir, rel))');
        expect(src).toContain('Worker 语法校验失败');
    });
});

describe('worker 体积棘轮', () => {
    it('check-bundle 把两个 worker 纳入 FILES', () => {
        const src = read('scripts/check-bundle.mjs');
        expect(src).toContain("'workers/deconstruction-worker.js'");
        expect(src).toContain("'workers/quality-worker.js'");
    });

    it('基线已记录 worker 预算', () => {
        const baseline = JSON.parse(read('.bundle-baseline.json')) as {
            files: Record<string, number>;
        };
        expect(baseline.files['workers/deconstruction-worker.js']).toBeGreaterThan(0);
        expect(baseline.files['workers/quality-worker.js']).toBeGreaterThan(0);
    });
});

describe('release tag 路径复核门禁（PF-4）', () => {
    const src = read('.github/workflows/release.yml');

    it('发布工作流在 build 后跑体积/密钥/API 门禁', () => {
        // tag 推送不经过 ci.yml，发布路径必须自行复核，防止绕过体积棘轮
        const buildIdx = src.indexOf('npm run build');
        const bundleIdx = src.indexOf('npm run check:bundle');
        expect(buildIdx).toBeGreaterThan(-1);
        expect(bundleIdx).toBeGreaterThan(buildIdx);
        expect(src).toContain('npm run check:secrets');
        expect(src).toContain('npm run check:obsidian-api');
    });
});
