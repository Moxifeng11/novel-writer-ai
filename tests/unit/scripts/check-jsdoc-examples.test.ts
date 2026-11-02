/**
 * check-jsdoc.mjs 的 @example 门禁自测。
 *
 * 用 `--root` 指向临时目录，验证三类行为：
 * 1. 白名单文件新增可执行导出时，没有 @example 必须失败；
 * 2. 已有 @example 被删除时必须失败；
 * 3. 非白名单文件不受示例门禁影响。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SCRIPT = path.resolve(__dirname, '../../../scripts/check-jsdoc.mjs');

let root = '';

function run(...flags: string[]) {
    return spawnSync(process.execPath, [SCRIPT, '--root', root, '--no-report', ...flags], {
        encoding: 'utf8',
        cwd: path.resolve(__dirname, '../../..'),
    });
}

function write(rel: string, content: string) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf8');
}

const STORE_WITH_EXAMPLE = `/**
 * 创建 store。
 *
 * @example
 * \`\`\`ts
 * const store = createStore();
 * \`\`\`
 */
export function createStore() {
    return {};
}
`;

const STORE_WITHOUT_EXAMPLE = `/**
 * 创建 store。
 */
export function createStore() {
    return {};
}
`;

describe('check-jsdoc @example 门禁', () => {
    beforeAll(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'jsdoc-example-'));
    });

    afterAll(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    it('基线记录缺口后放行；新增无示例的公共入口导出则失败', () => {
        write('shared/store/createStore.ts', STORE_WITHOUT_EXAMPLE);
        expect(run('--update-baseline').status).toBe(0);
        expect(run().status).toBe(0);

        fs.appendFileSync(
            path.join(root, 'shared/store/createStore.ts'),
            '\n/**\n * 订阅状态。\n */\nexport function subscribe() {\n    return () => {};\n}\n',
            'utf8',
        );
        const failed = run();
        expect(failed.status).toBe(1);
        expect(failed.stderr).toContain('缺 @example');
    });

    it('补上 @example 后通过；删除已有示例则失败', () => {
        write('shared/store/createStore.ts', STORE_WITH_EXAMPLE);
        expect(run('--update-baseline').status).toBe(0);
        expect(run().status).toBe(0);

        write('shared/store/createStore.ts', STORE_WITHOUT_EXAMPLE);
        const failed = run();
        expect(failed.status).toBe(1);
        expect(failed.stderr).toContain('已有 @example');
    });

    it('非白名单文件不受示例门禁影响', () => {
        // 上一用例故意留下「基线有示例、文件已删除示例」的状态，这里先恢复一致
        write('shared/store/createStore.ts', STORE_WITH_EXAMPLE);
        expect(run('--update-baseline').status).toBe(0);

        write(
            'engine/example-helper.ts',
            '/**\n * 内部工具。\n */\nexport function helper() {\n    return 1;\n}\n',
        );
        expect(run().status).toBe(0);
    });
});
