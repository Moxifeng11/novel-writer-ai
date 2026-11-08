import { describe, it, expect, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * check-secrets 门禁自测（v4.79.0，用户 2026-11-09 要求确保 push 不泄露 Key）。
 *
 * 用临时 git 仓库夹具跑真实脚本，钉住：
 *  - 被跟踪文件里的真实密钥形态必须报错；
 *  - 报错输出必须**脱敏**（不打印完整密钥）；
 *  - data.json 等禁止入库路径一旦被跟踪必须报错。
 */

const REPO_ROOT = path.resolve(__dirname, '../../..');
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'check-secrets.mjs');

interface RunResult {
    code: number;
    stdout: string;
    stderr: string;
}

const fixtures: string[] = [];

function makeRepo(files: Record<string, string>): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nw-secrets-'));
    fixtures.push(dir);
    spawnSync('git', ['init', '-q'], { cwd: dir });
    for (const [rel, content] of Object.entries(files)) {
        const abs = path.join(dir, rel);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, content, 'utf8');
    }
    spawnSync('git', ['add', '-A'], { cwd: dir });
    return dir;
}

function run(root: string): RunResult {
    const result = spawnSync(process.execPath, [SCRIPT, '--root', root], { encoding: 'utf8', timeout: 20_000 });
    return { code: result.status ?? -1, stdout: result.stdout || '', stderr: result.stderr || '' };
}

afterAll(() => {
    for (const dir of fixtures) fs.rmSync(dir, { recursive: true, force: true });
});

describe('check:secrets 门禁', () => {
    it('普通代码通过（短占位符不误报）', () => {
        const root = makeRepo({
            'src/a.ts': "export const placeholder = 'sk-test';\nexport const hint = 'Bearer x';\n",
        });
        const result = run(root);
        expect(result.code).toBe(0);
        expect(result.stdout).toContain('门禁通过');
    });

    it('被跟踪文件出现真实密钥形态必须失败，且输出脱敏', () => {
        // 运行时拼接，避免门禁扫到测试文件自身（否则自测夹具会被 check:secrets 命中）
        const secret = ['sk', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ012345'].join('-');
        const root = makeRepo({ 'src/leak.ts': `export const k = '${secret}';\n` });
        const result = run(root);
        expect(result.code).toBe(1);
        expect(result.stderr).toContain('openai-key');
        expect(result.stderr).toContain('src/leak.ts');
        // 绝不把完整密钥写进日志
        expect(result.stderr).not.toContain(secret);
        expect(result.stderr).toContain('***');
    });

    it('真实密文载荷（v2）必须失败', () => {
        const payload = 'a'.repeat(64);
        const root = makeRepo({ 'src/c.ts': `const c = 'aes256v2:210000:salt:iv:${payload}';\n` });
        const result = run(root);
        expect(result.code).toBe(1);
        expect(result.stderr).toContain('ciphertext-v2');
    });

    it('data.json 一旦被跟踪必须失败', () => {
        const root = makeRepo({ 'data.json': '{"apiKey":"short"}\n' });
        const result = run(root);
        expect(result.code).toBe(1);
        expect(result.stderr).toContain('forbidden-path');
    });
});
