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

/** 插件 id（与 manifest.id 一致） */
const PLUGIN_ID = 'novel-writer-ai';

interface WorkerUrlHost {
    vault: {
        configDir?: string;
        adapter?: {
            getResourcePath?(path: string): string;
            getBasePath?(): string;
        };
    };
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
    const configDir = vault.configDir || '.obsidian';
    const pluginRelativePath = `${configDir}/plugins/${PLUGIN_ID}/workers/${workerFile}`;
    const adapter = vault.adapter;
    if (!adapter) return null;

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

    return null;
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
