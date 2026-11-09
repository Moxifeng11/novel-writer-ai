import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * 自动迭代成果台账脚本回归（gate）。
 *
 * 每半小时任务依赖该脚本强制“本轮必须交付具体成果”。如果没有自测，
 * 参数校验/轮次自增/blocked 轮一旦回归，自动任务会悄悄写空成果或直接失败。
 */

const REPO_ROOT = path.resolve(__dirname, '../../..');
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'record-iteration.mjs');

let tempDir: string;
let ledger: string;

function run(args: string[]): { status: number; stdout: string; stderr: string } {
    const result = spawnSync(process.execPath, [SCRIPT, '--ledger', ledger, ...args], {
        encoding: 'utf8',
        timeout: 20_000,
    });
    return {
        status: result.status ?? -1,
        stdout: result.stdout || '',
        stderr: result.stderr || '',
    };
}

function readLedger(): string {
    return fs.existsSync(ledger) ? fs.readFileSync(ledger, 'utf8') : '';
}

function validArgs(overrides: Record<string, string> = {}): string[] {
    const base: Record<string, string> = {
        type: 'code',
        deliverable: '为台账脚本补回归测试',
        files: 'tests/unit/architecture/auto-iteration-ledger.test.ts',
        commit: '5f6ec64',
        tests: '7 passed',
        gates: 'lint=0, preflight:release=0',
        next: '代码/优化批次',
        ...overrides,
    };
    return Object.entries(base).flatMap(([key, value]) => [`--${key}`, value]);
}

beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nw-auto-ledger-'));
    ledger = path.join(tempDir, 'ledger.md');
});

afterAll(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('record-iteration.mjs', () => {
    it('有效 code 记录写入台账', () => {
        const result = run(validArgs());
        expect(result.status).toBe(0);
        const text = readLedger();
        expect(text).toContain('| 1 |');
        expect(text).toContain('为台账脚本补回归测试');
        expect(text).toContain('5f6ec64');
        expect(text).toContain('lint=0, preflight:release=0');
    });

    it('轮次自增', () => {
        expect(run(validArgs({ deliverable: '第二条具体成果记录' })).status).toBe(0);
        const lines = readLedger().split('\n').filter(line => /^\|\s*\d+\s*\|/.test(line));
        expect(lines).toHaveLength(2);
        expect(lines[0]).toContain('| 1 |');
        expect(lines[1]).toContain('| 2 |');
    });

    it('过短成果被拒绝且不写台账', () => {
        const before = readLedger();
        const result = run(validArgs({ deliverable: '调研' }));
        expect(result.status).toBe(1);
        expect(readLedger()).toBe(before);
        expect(result.stderr).toContain('deliverable 太短');
    });

    it('缺少 commit / tests / gates 时拒绝', () => {
        const before = readLedger();
        for (const key of ['commit', 'tests', 'gates']) {
            const args = validArgs();
            const index = args.indexOf(`--${key}`);
            args.splice(index, 2);
            const result = run(args);
            expect(result.status, key).toBe(1);
            expect(readLedger()).toBe(before);
        }
    });

    it('非法 commit SHA 被拒绝', () => {
        const result = run(validArgs({ commit: 'bad' }));
        expect(result.status).toBe(1);
        expect(result.stderr).toContain('git SHA');
    });

    it('blocked 轮允许无 SHA，但必须写 blocker', () => {
        const result = run(['--type', 'blocked', '--blocker', '并发 vitest 进程占用', '--next', '下轮重试']);
        expect(result.status).toBe(0);
        expect(readLedger()).toContain('并发 vitest 进程占用');
    });

    it('blocked 轮缺少 blocker 时拒绝', () => {
        const result = run(['--type', 'blocked', '--next', '下轮重试']);
        expect(result.status).toBe(1);
        expect(result.stderr).toContain('blocker');
    });
});
