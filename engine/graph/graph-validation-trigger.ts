/**
 * graph-validation-trigger.ts — 图谱兜底校验的触发与节流
 *
 * 结算后自动跑一次只读校验（5 秒防抖，避免连续结算重复扫描）；命令入口直接调用。
 * 校验失败只记录日志，不影响结算/写作。
 */
import type { App } from 'obsidian';
import { ObsidianFileSystem } from '@/shared/file-system-port';
import { createLogger } from '@/shared/logger';
import { validateProjectGraph, writeGraphValidationReport, type GraphValidationReport } from './graph-validator';

const log = createLogger('GraphValidation');

const timers = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * 立即执行校验并写报告。
 *
 * @param app - Obsidian 应用
 * @param project - 项目
 * @returns 报告
 */
export async function runGraphValidation(app: App, project: string): Promise<GraphValidationReport> {
    const report = await validateProjectGraph({ app, project });
    await writeGraphValidationReport(new ObsidianFileSystem(app), project, report);
    return report;
}

/**
 * 结算后延迟校验（同项目只保留最后一次）。
 *
 * @param app - Obsidian 应用
 * @param project - 项目
 * @param delayMs - 延迟
 */
export function scheduleGraphValidation(app: App, project: string, delayMs = 5000): void {
    const existing = timers.get(project);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
        timers.delete(project);
        void runGraphValidation(app, project).catch((e) => {
            log.warn('[GraphValidation] 自动校验失败（不影响结算）:', e);
        });
    }, Math.max(0, delayMs));
    // 测试/CLI 环境下不阻止进程退出
    (timer as unknown as { unref?: () => void }).unref?.();
    timers.set(project, timer);
}
