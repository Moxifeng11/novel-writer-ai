/**
 * program-status.mjs 的基线校验自测。
 *
 * 用 `--root` 指向临时目录，验证四类行为：
 * 1. baseline.version 必须精确等于 package.json 的 version；
 * 2. baseline.tests.files 与实测 *.test.ts 数量偏差超过 10% 必须失败；
 * 3. 偏差在 10% 内允许通过（测试数每批都在变）；
 * 4. 原有「MD 与 JSON 同步」校验仍然生效。
 */
import { afterAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SCRIPT = path.resolve(__dirname, '../../../scripts/program-status.mjs');

const roots: string[] = [];

function run(root: string | null, ...flags: string[]) {
    const args = root === null ? [SCRIPT, ...flags] : [SCRIPT, '--root', root, ...flags];
    return spawnSync(process.execPath, args, {
        encoding: 'utf8',
        cwd: path.resolve(__dirname, '../../..'),
    });
}

function writeJson(file: string, data: unknown) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

interface FixtureOptions {
    packageVersion?: string | null;
    baselineVersion?: string;
    baselineFiles?: number;
    actualFiles?: number;
}

function makeRoot(options: FixtureOptions = {}) {
    const {
        packageVersion = '1.2.3',
        baselineVersion = '1.2.3',
        baselineFiles = 20,
        actualFiles = 20,
    } = options;
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'program-status-'));
    roots.push(root);

    if (packageVersion !== null) {
        writeJson(path.join(root, 'package.json'), { name: 'fixture', version: packageVersion });
    }
    writeJson(path.join(root, 'docs/progress/program-status.json'), {
        program: 'fixture',
        rev: 'v-fixture',
        updatedAt: '2026-01-01T00:00:00+08:00',
        baseline: { version: baselineVersion, tests: { files: baselineFiles, cases: 0 }, e2e: 0 },
        groups: [],
    });

    // 故意分两层目录，顺带覆盖递归计数。
    for (let i = 0; i < actualFiles; i += 1) {
        const dir = i % 2 === 0 ? 'tests/unit' : 'tests/e2e';
        const file = path.join(root, dir, `case-${i}.test.ts`);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, 'export {};\n', 'utf8');
    }

    return root;
}

afterAll(() => {
    for (const root of roots) {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

describe('program-status 基线校验', () => {
    it('版本与测试数都一致时渲染成功', () => {
        const root = makeRoot();
        const result = run(root);
        expect(result.status).toBe(0);
        expect(result.stderr).toBe('');
    });

    it('baseline.version 与 package.json 不一致时失败并输出两个版本号', () => {
        const root = makeRoot({ packageVersion: '1.2.3', baselineVersion: '9.9.9' });
        const result = run(root);
        expect(result.status).toBe(1);
        expect(result.stderr).toContain('version');
        expect(result.stderr).toContain('9.9.9');
        expect(result.stderr).toContain('1.2.3');
    });

    it('测试文件数偏差超过 10% 时失败并输出偏差百分比', () => {
        const root = makeRoot({ baselineFiles: 1, actualFiles: 20 });
        const result = run(root);
        expect(result.status).toBe(1);
        expect(result.stderr).toContain('偏差');
        expect(result.stderr).toContain('95.0%');
        expect(result.stderr).toContain('20');
    });

    it('测试文件数偏差在 10% 以内时允许通过', () => {
        const root = makeRoot({ baselineFiles: 19, actualFiles: 20 });
        const result = run(root);
        expect(result.status).toBe(0);
        expect(result.stderr).toBe('');
    });

    it('渲染产物包含真实基线版本与文件数', () => {
        const root = makeRoot();
        const result = run(root);
        expect(result.status).toBe(0);
        const md = fs.readFileSync(path.join(root, 'docs/progress/PROGRAM-STATUS.md'), 'utf8');
        expect(md).toContain('v1.2.3');
        expect(md).toContain('20 文件 / 0 用例');
    });

    it('MD 与 JSON 不同步时 --check 失败', () => {
        const root = makeRoot();
        expect(run(root).status).toBe(0);

        const jsonPath = path.join(root, 'docs/progress/program-status.json');
        const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
        data.rev = 'v-fixture-changed';
        writeJson(jsonPath, data);

        const result = run(root, '--check');
        expect(result.status).toBe(1);
        expect(result.stderr).toContain('不同步');
    });

    it('渲染后 --check 通过（MD 已同步）', () => {
        const root = makeRoot();
        expect(run(root).status).toBe(0);
        const result = run(root, '--check');
        expect(result.status).toBe(0);
        expect(result.stdout).toContain('一致');
    });

    it('--root 缺少目录参数时以退出码 2 报错', () => {
        const result = run(null, '--root');
        expect(result.status).toBe(2);
        expect(result.stderr).toContain('--root');
    });

    it('缺少 package.json 时失败并提示文件路径', () => {
        const root = makeRoot({ packageVersion: null });
        const result = run(root);
        expect(result.status).toBe(1);
        expect(result.stderr).toContain('package.json');
    });
});
