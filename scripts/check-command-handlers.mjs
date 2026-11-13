#!/usr/bin/env node
/**
 * check-command-handlers.mjs — 命令执行体完整性门禁
 *
 * 拦的是「命令显示已执行、实际什么也没发生」这类静默失效：
 * `exec(CommandIds.X)` 依赖 registry 里已有执行体；若既没 `r.register(X)`
 * 也没有 `ui/command-ui-executor.ts` 的 `case CommandIds.X:`，点击后无声无息。
 *
 * 2026-11-13 实踩：一致性审核命令正是这样「执行了但没反应」，排查耗时不短。
 *
 * 用法：node scripts/check-command-handlers.mjs [--json]
 * 退出码：0 通过 / 1 有缺失 / 2 解析异常（量具自检失败）
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
    collectExecUsedIds,
    collectExecutorCases,
    collectRegisteredIds,
    evaluateCommandHandlers,
} from './lib/command-handlers-lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REGISTRY = path.join(ROOT, 'core', 'command-registry.ts');
const EXECUTOR = path.join(ROOT, 'ui', 'command-ui-executor.ts');
const JSON_OUT = process.argv.includes('--json');

/**
 * 读取源码；缺失即视为环境异常。
 *
 * @param {string} file - 绝对路径
 * @returns {string} 源码
 */
function readSource(file) {
    if (!fs.existsSync(file)) {
        console.error(`[check:command-handlers] ❌ 缺少文件：${path.relative(ROOT, file)}`);
        process.exit(2);
    }
    return fs.readFileSync(file, 'utf8');
}

const registrySource = readSource(REGISTRY);
const executorSource = readSource(EXECUTOR);

const execUsed = collectExecUsedIds(registrySource);
const registered = collectRegisteredIds(registrySource);
const executorCases = collectExecutorCases(executorSource);
const verdict = evaluateCommandHandlers({ execUsed, registered, executorCases });

if (JSON_OUT) {
    console.log(JSON.stringify({ verdict, execUsed, registered: { direct: [...registered.direct], uiListed: [...registered.uiListed] }, executorCases: [...executorCases] }, null, 2));
} else if (verdict.ok) {
    console.log(
        `[check:command-handlers] ✅ ${execUsed.length} 个 exec 命令均有执行体`
        + `（直连注册 ${registered.direct.size} / UI 列表 ${registered.uiListed.size} / UI 分支 ${executorCases.size}）`,
    );
} else {
    console.error(`[check:command-handlers] ❌ ${verdict.reason}`);
    console.error('修复：在 core/command-registry.ts 加 r.register(...)，或在 ui/command-ui-executor.ts 加 case 分支。');
}

process.exit(verdict.ok ? 0 : (execUsed.length === 0 ? 2 : 1));
