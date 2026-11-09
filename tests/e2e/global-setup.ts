/**
 * global-setup.ts — Playwright 全局启动钩子（C-9）
 *
 * 唯一职责：运行 scripts/check-e2e-fresh.mjs，确保 E2E 不会静默跑在旧构建产物上。
 * 放在 globalSetup 而非 package.json 前置，是为了覆盖 test:e2e / :ui / :headed
 * 全部入口；`playwright test --list` 不执行 globalSetup，CI verify 零回归。
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

export default function globalSetup(): void {
    const root = path.resolve(process.cwd(), 'scripts', 'check-e2e-fresh.mjs');
    execFileSync(process.execPath, [root], { cwd: process.cwd(), stdio: 'inherit' });
}
