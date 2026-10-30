/**
 * agent-spill-store.ts — 宿主侧的 spill 落盘实现
 *
 * 写到插件自己的 `.sessions/spill/agent/<项目>/`，不进项目正文目录，
 * 也不会被文件树/搜索当成用户资料。read_file 对 `.sessions/` 有读取白名单，
 * 因此模型可以按定位符取回原文；超过保留期的存档在会话启动时清理。
 */
import type { App } from 'obsidian';
import type { SpillSink } from '../../engine/agent/harness/spill-store';
import { createLogger } from '../../shared/logger';

const log = createLogger('AgentSpill');

/** spill 存放根目录（隐藏目录，不参与 Bases/标签体系） */
export const SPILL_ROOT = '.sessions/spill/agent';
/** 存档保留天数：超过后在下次会话启动时清理 */
const SPILL_KEEP_DAYS = 7;

function slug(text: string): string {
    return String(text || '')
        .replace(/[\\/:*?"<>|#^[\]]/g, '-')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^[-.]+|[-.]+$/g, '')
        .slice(0, 60);
}

async function ensureFolder(app: App, folder: string): Promise<void> {
    const parts = folder.split('/').filter(Boolean);
    let current = '';
    for (const part of parts) {
        current = current ? `${current}/${part}` : part;
        if (!(await app.vault.adapter.exists(current))) {
            await app.vault.adapter.mkdir(current);
        }
    }
}

/**
 * 创建 spill 写入器。
 * @param scope 当前项目的读取函数（每次写入时求值，切换项目后自动分目录）
 */
export function createVaultSpillSink(app: App, scope: () => string): SpillSink {
    return {
        write: async (name, content) => {
            try {
                const folder = `${SPILL_ROOT}/${slug(scope()) || 'default'}`;
                await ensureFolder(app, folder);
                const base = slug(name) || 'spill';
                const stamp = Date.now().toString(36);
                let path = `${folder}/${base}-${stamp}.md`;
                let seq = 1;
                while (await app.vault.adapter.exists(path)) {
                    path = `${folder}/${base}-${stamp}-${seq++}.md`;
                }
                await app.vault.adapter.write(path, content);
                return path;
            } catch (e) {
                log.warn('[AgentSpill] 写入失败:', e);
                return null;
            }
        },
    };
}

/**
 * 清理过期存档（只删 `.sessions/spill/agent/` 下、超过保留期的文件）。
 * 会话启动时调用一次；失败静默（清理不该影响对话）。
 */
export async function pruneSpillArchive(app: App, keepDays = SPILL_KEEP_DAYS): Promise<number> {
    const cutoff = Date.now() - Math.max(1, keepDays) * 24 * 60 * 60 * 1000;
    let removed = 0;
    const walk = async (folder: string): Promise<void> => {
        let listed: { files: string[]; folders: string[] };
        try {
            listed = await app.vault.adapter.list(folder);
        } catch {
            return;
        }
        for (const file of listed.files) {
            try {
                const stat = await app.vault.adapter.stat(file);
                if (stat && stat.mtime < cutoff) {
                    await app.vault.adapter.remove(file);
                    removed++;
                }
            } catch {
                // 单个文件失败继续
            }
        }
        for (const child of listed.folders) {
            await walk(child);
        }
    };
    if (!(await app.vault.adapter.exists(SPILL_ROOT))) return 0;
    await walk(SPILL_ROOT);
    if (removed > 0) log.info(`[AgentSpill] 已清理 ${removed} 份过期存档`);
    return removed;
}