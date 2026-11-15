/**
 * plugin-worker-url.ts — Worker 资源路径解析
 *
 * 观察到的现场问题（FR-F-03）：Obsidian 插件运行时文档 URL 不位于插件目录，
 * 直接使用 `workers/xxx.js` 这类相对路径会按文档基准解析，导致 Worker 加载失败。
 * 统一通过 vault adapter 的 getResourcePath 把「vault 内相对路径」转成可被
 * `new Worker(url)` 使用的绝对 URL；桌面端缺少该 API 时回退到 FileSystemAdapter 的 getBasePath。
 *
 * 社区目录只下发 3 个文件（无 workers/ 目录）时改走内联 Worker：
 * 内联源码是 **gzip + base64**（855KB → 339KB），启动时用 DecompressionStream
 * 解压并缓存 Blob URL（`warmInlineWorkerUrls`）。解压是异步的，因此：
 * - 启动后尽早 warm，之后同步 resolve 直接命中缓存；
 * - warm 未完成/宿主不支持 DecompressionStream → 返回 null，调用方退回主线程。
 */

import { getDegradationNotifier } from './degradation-notifier';
import { INLINE_WORKER_COMPRESSION, INLINE_WORKER_GZIP_SOURCES } from './workers-inline.generated';
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

/** 解压是否已尝试完成（避免重复 warm） */
let warmStarted = false;

/** 宿主是否支持 DecompressionStream（gzip 内联方案的前提） */
function supportsDecompression(): boolean {
    return typeof DecompressionStream !== 'undefined';
}

/**
 * base64 gzip → 文本（浏览器/Node 通用）。
 *
 * @param base64 - gzip 数据的 base64
 * @returns 解压后的源码文本
 */
async function gunzipBase64(base64: string): Promise<string> {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return await new Response(stream).text();
}

/**
 * 提前解压内联 Worker 源码并缓存 Blob URL（启动时调用一次）。
 *
 * 只在社区 3 文件安装（磁盘无 workers/）且宿主支持 DecompressionStream 时执行；
 * 失败不抛错（调用方会退回主线程并触发降级通知）。
 *
 * @returns 成功缓存的 Worker 数量
 */
export async function warmInlineWorkerUrls(): Promise<number> {
    if (warmStarted) return inlineWorkerUrls.size;
    warmStarted = true;
    if (INLINE_WORKER_COMPRESSION !== 'gzip+base64') return 0;
    if (!supportsDecompression()) return 0;
    if (typeof Blob === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return 0;
    let warmed = 0;
    for (const [workerFile, base64] of Object.entries(INLINE_WORKER_GZIP_SOURCES)) {
        try {
            const source = await gunzipBase64(base64);
            if (!source) continue;
            const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
            inlineWorkerUrls.set(workerFile, url);
            warmed += 1;
        } catch { // silent-ok: 单个 worker 解压失败按不可用处理（其余 worker 继续）
        }
    }
    return warmed;
}

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
        } catch { // silent-ok: 单文件探测失败按不存在处理（整体仍可走内联）
            return false;
        }
    };
    try {
        const base = pluginRootDirPath();
        const hasDeconstruction = await exists(`${base}/workers/deconstruction-worker.js`);
        const hasQuality = await exists(`${base}/workers/quality-worker.js`);
        workersOnDiskAvailable = hasDeconstruction || hasQuality;
        return workersOnDiskAvailable === true;
    } catch { // silent-ok: 探测失败按未知处理（resolve 仍会尝试文件路径，不行再退回主线程）
        workersOnDiskAvailable = null;
        return false;
    }
}

/**
 * 取内联 Worker 的 Blob URL（需先 warm；未就绪返回 null）。
 *
 * @param workerFile - worker 文件名
 * @returns Blob URL；未解压/不支持时 null
 */
export function resolveInlineWorkerUrl(workerFile: string): string | null {
    if (!INLINE_WORKER_GZIP_SOURCES[workerFile]) return null;
    return inlineWorkerUrls.get(workerFile) ?? null;
}

/** 释放内联 Worker 的 Blob URL（插件卸载时调用，避免内存泄漏） */
export function disposeInlineWorkerUrls(): void {
    if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
        for (const url of inlineWorkerUrls.values()) {
            try {
                URL.revokeObjectURL(url);
            } catch { // silent-ok: 已 revoke/宿主不支持时忽略
            }
        }
    }
    inlineWorkerUrls.clear();
    warmStarted = false;
}

/**
 * 当前 Worker 运行模式（自检页展示用）。
 *
 * @returns worker=磁盘 worker；worker-inline=内联 Blob worker；main-thread=完全不可用
 */
export function getWorkerRuntimeMode(): 'worker' | 'worker-inline' | 'main-thread' {
    if (workersOnDiskAvailable === true) return 'worker';
    const hasInline = Object.keys(INLINE_WORKER_GZIP_SOURCES).length > 0
        && (inlineWorkerUrls.size > 0 || (
            supportsDecompression()
            && typeof Blob !== 'undefined'
            && typeof URL !== 'undefined'
            && typeof URL.createObjectURL === 'function'
        ));
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
 *
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

    // 已探测到磁盘没有 workers/（社区 3 文件安装）：直接走内联 Blob（需已 warm）
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
