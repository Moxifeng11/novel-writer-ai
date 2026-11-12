/**
 * S1 架构约束：断言抽取层**不得引入 AI 调用**
 *
 * MVP 计划里 S1 的硬验收之一就是「零新增 AI 调用」——断言必须从既有数据
 * 规则化抽取，否则每加一章就要多付一次模型费用，且抽取结果不稳定。
 *
 * 这条测试直接读源码做静态断言：只要有人在 assertion-extract / assertion-model /
 * narrative-number 里 import 了 AI 客户端，立刻变红。
 */

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/** 受约束的文件（相对仓库根） */
const GUARDED_FILES = [
    'engine/consistency/assertion-extract.ts',
    'engine/consistency/assertion-model.ts',
    'shared/narrative-number.ts',
];

/** 禁止出现的 AI 相关符号 */
const FORBIDDEN = [/AIApiClient/, /callAI/, /callAIStream/, /ai-engine/];

describe('S1 断言层 · 不得引入 AI 调用', () => {
    for (const file of GUARDED_FILES) {
        it(`${file} 不含 AI 调用`, () => {
            const full = path.resolve(process.cwd(), file);
            expect(fs.existsSync(full), `${file} 不存在`).toBe(true);
            const source = fs.readFileSync(full, 'utf8');
            for (const pattern of FORBIDDEN) {
                expect(pattern.test(source), `${file} 出现了被禁止的 ${pattern}`).toBe(false);
            }
        });
    }

    it('断言层不依赖 Obsidian App（纯数据，可在任何环境跑）', () => {
        for (const file of GUARDED_FILES) {
            const source = fs.readFileSync(path.resolve(process.cwd(), file), 'utf8');
            // 只允许 import type 形式的 Obsidian 类型（当前一个都没有），不允许运行期 import
            const runsObsidian = /^import\s+\{[^}]*\}\s+from\s+['"]obsidian['"]/m.test(source);
            expect(runsObsidian, `${file} 不应运行期 import obsidian`).toBe(false);
        }
    });
});
