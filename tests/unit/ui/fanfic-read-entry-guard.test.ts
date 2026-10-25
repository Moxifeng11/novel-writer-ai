/**
 * 同人约束读取入口守卫（源码级不变量）。
 *
 * `ui` 层所有「读取同人约束并注入 prompt」的入口都必须走
 * `ui/fanfic-prompt-notice.ts#readFanficPromptBlockWithNotice`：
 * 直接拼 `formatFanficRulesForPrompt(await readFanficRules(...))` 时，
 * 设定未绑定 / 文件不存在 / 读取失败 / 内容全空都会得到空串且没有任何提示，
 * 用户无法区分「原创项目」与「同人约束已失效」。
 *
 * 这条守卫覆盖未来新增入口：只要在 ui 层写出该调用形态就会失败。
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const UI_ROOT = resolve(process.cwd(), 'ui');
const DIRECT_CALL = 'formatFanficRulesForPrompt(await readFanficRules(';

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

/** 去掉注释后再匹配，避免「说明反例」的文档注释被误判成真实调用 */
function stripComments(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

describe('同人约束读取入口守卫', () => {
    it('ui 层不得直接拼 formatFanficRulesForPrompt(await readFanficRules(...))', () => {
        const files = listTsFiles(UI_ROOT);
        // 防止路径错误导致空集「假绿」
        expect(files.length).toBeGreaterThan(40);

        const offenders = files.filter((file) => stripComments(readFileSync(file, 'utf8')).includes(DIRECT_CALL));
        expect(offenders.map((file) => file.slice(UI_ROOT.length + 1))).toEqual([]);
    });
});
