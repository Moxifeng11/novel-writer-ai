/**
 * plugin-worker-url.ts — Worker 资源路径解析
 *
 * Obsidian 插件运行时文档 URL 不位于插件目录，直接使用 `workers/xxx.js`
 * 这类相对路径会按文档基准解析，导致 Worker 加载失败（FR-F-03）。
 * 统一通过 vault adapter 的 getResourcePath 把「vault 内相对路径」转成
 * 可被 `new Worker(url)` 使用的绝对 URL；桌面端缺少该 API 时回退到
 * FileSystemAdapter 的 getBasePath。
 */

import { getDegradationNotifier } from './degradation-notifier';
import { INLINE_WORKER_SOURCES } from './workers-inline.generated';
import { pluginRootDirPath } from './paths';

interface WorkerUrlHost {
    vault: {
        configDir?: string;
        adapter?: {
            getResourcePath?(path: string): string;
            getBasePath?(): string;
            /** 文件存在性探测（Obsidian DataAdapter 提供） */
            exists?(path: string): Promise<boolean> | boolean;
        };
    };
}

/** 磁盘上是否带 workers/ 目录（由 probePluginWorkers 在启动时探测；null=未探测） */
let workersOnDiskAvailable: boolean | null = null;

/** 内联 Worker 的 Blob URL 缓存（Worker 复用同一 URL） */
const inlineWorkerUrls = new Map<string, string>();

/**
 * 探测插件目录是否带 workers/（仓库/BRAT 安装有，社区目录 3 文件安装没有）。
 *
 * 只需一次 adapter.exists，启动时调用；结果供同步的 resolvePluginWorkerUrl 决定
 * 走磁盘文件还是内联 Blob。探测失败按「有」处理（保留旧行为，最坏退回主线程）。
 *
 * @param app - Obsidian 应用实例
 * @returns 是否有磁盘 worker 文件
 */
export async function probePluginWorkers(app: WorkerUrlHost): Promise<boolean> {
    const adapter = app?.vault?.adapter;
    if (!adapter || typeof adapter.exists !== 'function') {
        workersOnDiskAvailable = null;
        return false;
    }
    const exists = async (path: string): Promise<boolean> => {
        try {
            return Boolean(await adapter.exists?.(path));
        } catch {
            // silent-ok: 单文件探测失败按不存在处理（整体仍可走内联）
            return false;
        }
    };
    try {
        const base = pluginRootDirPath();
        const hasDeconstruction = await exists(`${base}/workers/deconstruction-worker.js`);
        const hasQuality = await exists(`${base}/workers/quality-worker.js`);
        workersOnDiskAvailable = hasDeconstruction || hasQuality;
        return workersOnDiskAvailable === true;
    } catch {
        // silent-ok: 探测失败按未知处理（resolve 仍会尝试文件路径，不行再退回主线程）
        workersOnDiskAvailable = null;
        return false;
    }
}

/**
 * 用内联源码创建 Blob Worker URL（3 文件安装时的后台线程方案）。
 *
 * @param workerFile - worker 文件名
 * @returns Blob URL；无源码或不支持 Blob 时 null
 */
export function resolveInlineWorkerUrl(workerFile: string): string | null {
    const source = INLINE_WORKER_SOURCES[workerFile];
    if (!source) return null;
    const cached = inlineWorkerUrls.get(workerFile);
    if (cached) return cached;
    if (typeof Blob === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
        return null;
    }
    try {
        const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
        inlineWorkerUrls.set(workerFile, url);
        return url;
    } catch { // silent-ok: Blob/Worker 不可用的宿主退回主线程（由调用方走降级）
        return null;
    }
}

/** 释放内联 Worker 的 Blob URL（插件卸载时调用，避免内存泄漏） */
export function disposeInlineWorkerUrls(): void {
    if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
        for (const url of inlineWorkerUrls.values()) {
            try {
                URL.revokeObjectURL(url);
            } catch {
                // silent-ok: 已 revoke/宿主不支持时忽略
            }
        }
    }
    inlineWorkerUrls.clear();
}

/**
 * 当前 Worker 运行模式（自检页展示用）。
 *
 * @returns worker=磁盘 worker；worker-inline=内联 Blob worker；main-thread=完全不可用
 */
export function getWorkerRuntimeMode(): 'worker' | 'worker-inline' | 'main-thread' {
    if (workersOnDiskAvailable === true) return 'worker';
    const hasInline = Object.keys(INLINE_WORKER_SOURCES).length > 0
        && typeof Blob !== 'undefined'
        && typeof URL !== 'undefined'
        && typeof URL.createObjectURL === 'function';
    if (hasInline) return 'worker-inline';
    return 'main-thread';
}

/** 测试用：重置探测结果 */
export function resetWorkerDiskProbe(): void {
    workersOnDiskAvailable = null;
}

/**
 * 解析插件目录下的 Worker 脚本绝对 URL。
 * 返回 null 表示当前宿主无法解析（调用方应显式降级到主线程）。
 * @param app - Obsidian 应用实例
 * @param workerFile - Worker 文件
  * @returns 文本结果 或 null
 */
export function resolvePluginWorkerUrl(app: WorkerUrlHost, workerFile: string): string | null {
    const vault = app?.vault;
    if (!vault) return null;
    // 路径单源：BRAT 改名/自定义 configDir 下不能再用 configDir+PLUGIN_ID 硬拼
    const pluginRelativePath = `${pluginRootDirPath()}/workers/${workerFile}`;
    const adapter = vault.adapter;
    if (!adapter) return null;

    // 已探测到磁盘没有 workers/（社区 3 文件安装）：直接走内联 Blob
    if (workersOnDiskAvailable === false) {
        return resolveInlineWorkerUrl(workerFile);
    }

    if (typeof adapter.getResourcePath === 'function') {
        try {
            const url = adapter.getResourcePath(pluginRelativePath);
            if (url) return url;
        } catch {
            // 继续尝试 getBasePath
        }
    }

    if (typeof adapter.getBasePath === 'function') {
        try {
            const base = adapter.getBasePath();
            if (base) {
                const normalizedBase = base.replace(/\\/g, '/').replace(/\/+$/, '');
                return `file:///${normalizedBase}/${pluginRelativePath}`;
            }
        } catch {
            // 无法解析
        }
    }

    return resolveInlineWorkerUrl(workerFile);
}

let workerDegradationNotified = false;

/**
 * 发出一次性的 Worker 降级通知（复用统一 degradation notifier）。
 * 会话内只提示一次，避免每个任务重复弹窗。
 * @param reason - 原因
 */
export function notifyWorkerUnavailable(reason: string): void {
    if (workerDegradationNotified) return;
    workerDegradationNotified = true;
    getDegradationNotifier().notify({
        source: 'worker',
        from: 'worker',
        to: 'main-thread',
        reason,
        severity: 'warning',
        recoverable: true,
    });
}

/** 测试用：重置一次性通知标记 */
export function resetWorkerDegradationNotified(): void {
    workerDegradationNotified = false;
}
