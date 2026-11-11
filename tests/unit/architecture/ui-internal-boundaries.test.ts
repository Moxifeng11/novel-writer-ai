/**
 * 阶段 D3：UI 内部子层边界（check:deps 的盲区）
 *
 * `scripts/check-dependencies.mjs` 把 `ui/` 当作一个整体，只约束**层间**方向
 * （ui → engine/services/…，engine ↛ ui，shared ↛ 任何业务层）。
 * 但 `ui/` 内部还分了多个子层，**这些方向没有任何门禁**：
 *
 *   ui/services/    门面（UI 数据查询）
 *   ui/components/  通用组件（空态、进度、通知等，应可被任何页面复用）
 *   ui/rendering/   通用渲染（上下文面板等）
 *   ui/views/       具体视图
 *   ui/full-writer/ · ui/co-writing/ · ui/agent-workbench/   功能域
 *
 * 合理约束：
 * - **门面不应依赖视图**（`ui/services` → `ui/views` 会让门面变成视图的附庸）
 * - **通用件不应依赖功能域**（`ui/components`/`ui/rendering` → 具体功能域
 *   会让「通用」名不副实，且形成环形依赖的温床）
 *
 * 本文件把这些方向固化为契约。当前全部为 0 违规——若未来有人破坏，测试立刻失败。
 */

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../../..');

/** 递归收集目录下的 .ts 文件 */
function collectTs(dir: string): string[] {
    const out: string[] = [];
    const walk = (current: string): void => {
        if (!fs.existsSync(current)) return;
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            const full = path.join(current, entry.name);
            if (entry.isDirectory()) {
                walk(full);
            } else if (entry.name.endsWith('.ts')) {
                out.push(full);
            }
        }
    };
    walk(dir);
    return out;
}

/** 读取文件里的 import 目标（只取字符串字面量） */
function importTargets(file: string): string[] {
    const content = fs.readFileSync(file, 'utf8');
    const targets: string[] = [];
    const re = /from\s+['"]([^'"]+)['"]/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(content)) !== null) targets.push(match[1]);
    return targets;
}

/**
 * 统计「某目录下的文件 import 了另一组目录」的违规。
 *
 * @param fromDir - 源目录（仓库相对）
 * @param forbiddenPrefixes - 禁止的 import 前缀（`@/` 形式）
 * @returns 违规列表（文件 → 目标）
 */
function findViolations(fromDir: string, forbiddenPrefixes: string[]): string[] {
    const violations: string[] = [];
    for (const file of collectTs(path.join(ROOT, fromDir))) {
        const rel = path.relative(ROOT, file).replace(/\\/g, '/');
        for (const target of importTargets(file)) {
            if (forbiddenPrefixes.some(prefix => target.startsWith(prefix))) {
                violations.push(`${rel} → ${target}`);
            }
        }
    }
    return violations;
}

describe('D3-1：门面层不依赖视图层', () => {
    it('ui/services/ 不 import ui/views/', () => {
        const violations = findViolations('ui/services', ['@/ui/views', '../views', '../../views']);
        expect(violations).toEqual([]);
    });
});

describe('D3-2：通用件不依赖功能域', () => {
    /** 功能域前缀（具体页面/流程，不应被「通用」件引用） */
    const DOMAIN_PREFIXES = [
        '@/ui/views', '@/ui/full-writer', '@/ui/co-writing', '@/ui/agent-workbench',
        '../views', '../full-writer', '../co-writing', '../agent-workbench',
    ];

    it('ui/components/ 不依赖具体功能域', () => {
        expect(findViolations('ui/components', DOMAIN_PREFIXES)).toEqual([]);
    });

    it('ui/rendering/ 不依赖具体功能域', () => {
        expect(findViolations('ui/rendering', DOMAIN_PREFIXES)).toEqual([]);
    });
});

describe('D3-3：层间边界（与 check:deps 同口径，测试侧再守一道）', () => {
    it('engine/ 不 import ui/', () => {
        expect(findViolations('engine', ['@/ui/', '../ui/', '../../ui/'])).toEqual([]);
    });

    it('services/ 不 import ui/', () => {
        expect(findViolations('services', ['@/ui/', '../ui/'])).toEqual([]);
    });

    it('shared/ 不 import engine / ui / services', () => {
        expect(findViolations('shared', [
            '@/engine/', '@/ui/', '@/services/',
            '../engine/', '../ui/', '../services/',
        ])).toEqual([]);
    });
});

describe('D3-4：纯逻辑下沉范例（阶段 C1）仍然成立', () => {
    it('ui/views/link-status.ts 只做渲染，判定来自 shared', () => {
        const content = fs.readFileSync(path.join(ROOT, 'ui/views/link-status.ts'), 'utf8');
        // 判定函数必须来自 shared，而不是本地重新实现
        expect(content).toContain("@/shared/link-status-compute");
        expect(content).not.toContain('function computeKnowledgeFlowStatus');
    });

    it('engine 侧的诊断工具复用同一份 shared 判定', () => {
        const content = fs.readFileSync(
            path.join(ROOT, 'engine/agent/harness/diagnose-tools.ts'),
            'utf8',
        );
        expect(content).toContain('@/shared/link-status-compute');
        expect(content).not.toContain('@/ui/');
    });
});
