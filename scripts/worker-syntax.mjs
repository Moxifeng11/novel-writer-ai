/**
 * worker-syntax.mjs — 构建产物 Worker 的语法校验（发布门禁用）
 *
 * PF-3（2026-11-10 包体审计）：check:release 此前只校验 worker 存在且 ≥1KB，
 * 产物损坏但体积正常时仍可进入发布 zip。这里用 `node --check` 解析一遍，
 * 把「能打开」升级为「能被 JS 引擎解析」。
 */
import { execFileSync } from 'node:child_process';

/**
 * 校验一个 JS 产物能否被 Node 解析（只解析，不执行）。
 *
 * @param {string} filePath - 产物绝对或相对路径
 * @returns {{ ok: boolean, error?: string }}
 *
 * @example
 * checkWorkerSyntax('workers/quality-worker.js') // { ok: true }
 */
export function checkWorkerSyntax(filePath) {
    try {
        execFileSync(process.execPath, ['--check', filePath], { stdio: 'pipe' });
        return { ok: true };
    } catch (error) {
        const stderr = error && typeof error === 'object' && 'stderr' in error
            ? String(error.stderr)
            : '';
        const message = stderr.trim() || (error instanceof Error ? error.message : String(error));
        return { ok: false, error: message.slice(0, 400) };
    }
}
