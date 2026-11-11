import { describe, expect, it, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * check:obsidian-api 空扫描门禁回归（DSH-20261112-05）。
 *
 * 旧实现扫描到 0 个文件时所有规则计数为 0，与基线（0）相等 → 恒通过，
 * 目录写错/构建产物缺失时门禁静默空转。现要求：
 * - 空目录默认 exit 1 且输出含「扫描到 0 个文件」；
 * - 只有显式 --allow-empty 才豁免；
 * - 正常夹具仍 exit 0，违规夹具仍 exit 1（棘轮语义不变）。
 */

const REPO_ROOT = path.resolve(__dirname, '../../..');
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'check-obsidian-api.mjs');

interface RunResult {
    code: number;
    stdout: string;
    stderr: string;
}

const fixtures: string[] = [];

function makeFixture(files: Record<string, string> = {}): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nw-obsidian-api-empty-'));
    fixtures.push(dir);
    for (const [rel, content] of Object.entries(files)) {
        const abs = path.join(dir, rel);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, content, 'utf8');
    }
    return dir;
}

function run(root: string, extra: string[] = []): RunResult {
    const result = spawnSync(
        process.execPath,
        [SCRIPT, '--root', root, '--baseline', path.join(root, '.baseline.json'), ...extra],
        { encoding: 'utf8', timeout: 20_000 },
    );
    return { code: result.status ?? -1, stdout: result.stdout || '', stderr: result.stderr || '' };
}

afterAll(() => {
    for (const dir of fixtures) fs.rmSync(dir, { recursive: true, force: true });
});

describe('check:obsidian-api 空扫描', () => {
    it('空目录默认失败，并明确提示「扫描到 0 个文件」', () => {
        const root = makeFixture();
        const result = run(root);
        expect(result.code).toBe(1);
        expect(result.stderr).toContain('扫描到 0 个文件');
        expect(result.stderr).toContain('--allow-empty');
    });

    it('--allow-empty 显式豁免后通过', () => {
        const root = makeFixture();
        const result = run(root, ['--allow-empty']);
        expect(result.code).toBe(0);
        expect(result.stdout).toContain('已显式允许空扫描');
    });

    it('空目录即使 --json 也不能假通过', () => {
        const root = makeFixture();
        const result = run(root, ['--json']);
        expect(result.code).toBe(1);
        expect(result.stderr).toContain('扫描到 0 个文件');
    });

    it('正常夹具（有文件、无违规）仍通过，且 --json 报告扫描数', () => {
        const root = makeFixture({
            'ui/clean.ts': "import { requestUrl } from 'obsidian';\nexport const url = 'https://example.com';\n",
        });
        const ok = run(root);
        expect(ok.code).toBe(0);
        expect(ok.stdout).toContain('门禁通过');

        const json = run(root, ['--json']);
        expect(json.code).toBe(0);
        expect(JSON.parse(json.stdout).scanned).toBe(1);
    });

    it('违规夹具仍失败（空扫描修复没有放过真实违规）', () => {
        const root = makeFixture({
            'services/bad.ts': "export const p = '.obsidian/plugins/novel-writer-ai/data/x.json';\n",
        });
        const result = run(root);
        expect(result.code).toBe(1);
        expect(result.stderr).toContain('plugin-path-hardcoded');
    });

    it('空目录 --update-baseline 也被拒绝（防止写入全 0 假基线）', () => {
        const root = makeFixture();
        const result = run(root, ['--update-baseline', '--note', '空目录基线']);
        expect(result.code).toBe(1);
        expect(result.stderr).toContain('扫描到 0 个文件');
    });
});
