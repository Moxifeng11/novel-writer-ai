/**
 * 性能冒烟：真实 Obsidian 渲染进程空闲 5 秒的 CPU 与 JS 堆采样。
 *
 * 需 OBSIDIAN_PATH 且显式 E2E_PERF=1；默认不跑，避免 CI 抖动。
 * 指标来自 CDP Performance 域：
 * - TaskDuration 增量 / 采样时长 ≈ 主线程占用（单核 100% 归一）
 * - JSHeapUsedSize、Nodes 为渲染进程当前值
 *
 * 关键：先测「同版本 Obsidian + 空 vault」基线，再测插件 vault；阈值判定用差值，
 * 避免把 Obsidian 自身重绘/同步算到插件头上。
 */
import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import type { Page } from 'playwright';
import {
    createTestVault,
    describeSkipReason,
    isObsidianE2EEnabled,
    launchObsidian,
    waitForPluginLoaded,
    type ObsidianSession,
} from './utils/obsidian-app';

const CPU_LIMIT_PERCENT = Number(process.env.E2E_PERF_CPU_LIMIT || 5);
const HEAP_DELTA_LIMIT_MB = Number(process.env.E2E_PERF_HEAP_DELTA_MB || 256);

interface Sample {
    cpuPercent: number;
    heapMb: number;
    heapGrowthMb: number;
    nodes: number;
}

async function sample(page: Page): Promise<Sample> {
    await page.waitForTimeout(4_000);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Performance.enable');
    const before = await cdp.send('Performance.getMetrics');
    const startedAt = Date.now();
    await page.waitForTimeout(5_000);
    const after = await cdp.send('Performance.getMetrics');
    const elapsedSec = (Date.now() - startedAt) / 1000;

    const toMap = (result: { metrics: Array<{ name: string; value: number }> }) =>
        Object.fromEntries(result.metrics.map((metric) => [metric.name, metric.value]));
    const b = toMap(before);
    const a = toMap(after);
    const taskDelta = Math.max(0, (a.TaskDuration ?? 0) - (b.TaskDuration ?? 0));
    return {
        cpuPercent: elapsedSec > 0 ? (taskDelta / elapsedSec) * 100 : 0,
        heapMb: (a.JSHeapUsedSize ?? 0) / 1048576,
        heapGrowthMb: ((a.JSHeapUsedSize ?? 0) - (b.JSHeapUsedSize ?? 0)) / 1048576,
        nodes: a.Nodes ?? 0,
    };
}

async function closeAndClean(session: ObsidianSession | undefined): Promise<void> {
    if (!session) return;
    await session.close().catch(() => undefined);
    fs.rmSync(session.vault.path, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}

test.describe('Novel Writer AI · 性能冒烟', () => {
    test.skip(!isObsidianE2EEnabled(), describeSkipReason());
    test.skip(process.env.E2E_PERF !== '1', '未设置 E2E_PERF=1：性能采样默认跳过');

    test('插件空闲开销：主线程增量 < 5%，堆增量在阈值内', async () => {
        let baselineSession: ObsidianSession | undefined;
        let pluginSession: ObsidianSession | undefined;
        try {
            baselineSession = await launchObsidian(createTestVault({ installPlugin: false }));
            const baseline = await sample(baselineSession.page);

            pluginSession = await launchObsidian(createTestVault());
            await waitForPluginLoaded(pluginSession.page);
            const withPlugin = await sample(pluginSession.page);

            const deltaCpu = withPlugin.cpuPercent - baseline.cpuPercent;
            const deltaHeapMb = withPlugin.heapMb - baseline.heapMb;
            console.log('PERF_SMOKE ' + JSON.stringify({
                baseline: {
                    cpuPercent: Number(baseline.cpuPercent.toFixed(2)),
                    heapMb: Number(baseline.heapMb.toFixed(1)),
                    nodes: baseline.nodes,
                },
                withPlugin: {
                    cpuPercent: Number(withPlugin.cpuPercent.toFixed(2)),
                    heapMb: Number(withPlugin.heapMb.toFixed(1)),
                    heapGrowthMb: Number(withPlugin.heapGrowthMb.toFixed(2)),
                    nodes: withPlugin.nodes,
                },
                delta: {
                    cpuPercent: Number(deltaCpu.toFixed(2)),
                    heapMb: Number(deltaHeapMb.toFixed(1)),
                },
                limits: { cpuPercent: CPU_LIMIT_PERCENT, heapDeltaMb: HEAP_DELTA_LIMIT_MB },
            }));

            expect(deltaCpu, '插件空闲主线程 CPU 增量超过阈值').toBeLessThan(CPU_LIMIT_PERCENT);
            expect(deltaHeapMb, '插件 JS 堆增量超过阈值').toBeLessThan(HEAP_DELTA_LIMIT_MB);
            expect(withPlugin.heapGrowthMb, '插件空闲 5 秒堆增长异常').toBeLessThan(20);
        } finally {
            await closeAndClean(pluginSession);
            await closeAndClean(baselineSession);
        }
    });
});
