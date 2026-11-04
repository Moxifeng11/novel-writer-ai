/**
 * agent-session-store.ts — Agent 会话落盘（JSONL，节流追加）
 *
 * 吸收 dsh `session-persistence-jsonl`：每个回合结束把快照追加一行到
 * `.sessions/agent/<项目>.jsonl`；重新打开工作台时读最后一行恢复。
 * 追加而不是覆盖，保留少量历史快照便于排查；文件超过上限后退化为「只留最新一行」。
 */
import type { App } from 'obsidian';
import {
    parseSnapshotFromJsonl,
    type HarnessSessionSnapshot,
} from '@/engine/agent/harness/session-snapshot';
import { createLogger } from '@/shared/logger';

const log = createLogger('AgentSession');

/**
 * 会话根路径常量。
 */
export const SESSION_ROOT = '.sessions/agent';
/** 存档体积上限：超过后重写为单行（会话日志本身已由压缩控制长度） */
const MAX_STORE_BYTES = 512 * 1024;
/** 写盘节流（dsh 默认 1s）：连续多个回合只写最后一次快照 */
const SAVE_THROTTLE_MS = 1000;

/**
 * AgentSessionStore 类型定义。
 */
export interface AgentSessionStore {
    /**
     * 当前项目的存档路径（库内相对路径）
     *
     * @returns 文本结果
     */
    path(): string;
    load(): Promise<HarnessSessionSnapshot | null>;
    /**
     * 登记快照并节流写入（同步返回，不阻塞对话）
     *
     * @param snapshot - 快照
     */
    save(snapshot: HarnessSessionSnapshot): void;
    /** 立刻写入待保存的快照（关闭视图前调用） */
    flush(): Promise<void>;
    /** 清空存档（「新会话」按钮） */
    clear(): Promise<void>;
}

function slug(text: string): string {
    return String(text || '')
        .replace(/[\\/:*?"<>|#^[\]]/g, '-')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^[-.]+|[-.]+$/g, '')
        .slice(0, 60);
}

/**
 * 计算指定作用域（项目名）的 Agent 会话存档路径。
 *
 * 与 createAgentSessionStore 内部的 path() 同源（同一 slug 规则），
 * 供保留策略把「当前活跃项目的会话」加入 keep 豁免列表。
 *
 * @param scope - 作用域（通常是项目名）
 * @returns 会话存档的库内相对路径
 *
 * @example
 * ```ts
 * const active = plugin.getActiveProject();
 * const keep = active ? [agentSessionPathFor(active)] : [];
 * ```
 */
export function agentSessionPathFor(scope: string): string {
    return `${SESSION_ROOT}/${slug(scope) || 'default'}.jsonl`;
}

/**
 * 列出 `.sessions/agent/` 下的全部会话存档文件（保留策略用）。
 *
 * 只读目录、不解析内容；目录不存在或列举失败时返回空数组（防御式），
 * 不抛错。mtime 取自 adapter.stat，stat 失败时省略（保留策略视为最旧）。
 *
 * @param app - Obsidian 应用实例
 * @returns 会话存档文件列表（路径 + 可选 mtime）
 *
 * @example
 * ```ts
 * const files = await listAgentSessionFiles(app);
 * // → [{ path: '.sessions/agent/我的项目.jsonl', mtime: 1730000000000 }, ...]
 * ```
 */
export async function listAgentSessionFiles(app: App): Promise<Array<{ path: string; mtime?: number }>> {
    try {
        const listing = await app.vault.adapter.list(SESSION_ROOT);
        const files: Array<{ path: string; mtime?: number }> = [];
        for (const path of listing.files ?? []) {
            if (!path.endsWith('.jsonl')) continue;
            try {
                const stat = await app.vault.adapter.stat(path);
                files.push(stat?.mtime !== undefined ? { path, mtime: stat.mtime } : { path });
            } catch {
                files.push({ path });
            }
        }
        return files;
    } catch (e) {
        log.warn('[AgentSession] 列举会话存档失败（按空目录处理）:', e);
        return [];
    }
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
 * createAgentSessionStore 函数。
 * @param app - Obsidian 应用实例
 * @param scope - 作用域
  * @returns AgentSessionStore 实例
 */
export function createAgentSessionStore(app: App, scope: () => string): AgentSessionStore {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let pending: HarnessSessionSnapshot | null = null;
    let writing: Promise<void> = Promise.resolve();

    const pathOf = (): string => agentSessionPathFor(scope());

    const doFlush = async (): Promise<void> => {
        if (!pending) return;
        const snapshot = pending;
        pending = null;
        const path = pathOf();
        try {
            await ensureFolder(app, SESSION_ROOT);
            let size = 0;
            try {
                const stat = await app.vault.adapter.stat(path);
                size = stat?.size ?? 0;
            } catch {
                size = 0;
            }
            const line = `${JSON.stringify(snapshot)}\n`;
            if (size > 0 && size + line.length > MAX_STORE_BYTES) {
                // 只留最新一行：旧快照对恢复没有价值，继续追加会让文件无限增长
                // write-entry-allow: Agent 会话 JSONL，位于 .sessions 点目录。
                await app.vault.adapter.write(path, line);
            } else {
                // write-entry-allow: Agent 会话 JSONL，位于 .sessions 点目录。
                await app.vault.adapter.append(path, line);
            }
        } catch (e) {
            log.warn('[AgentSession] 保存会话失败:', e);
        }
    };

    const schedule = (): void => {
        if (timer) return;
        timer = setTimeout(() => {
            timer = null;
            writing = writing.then(doFlush, doFlush);
        }, SAVE_THROTTLE_MS);
    };

    return {
        path: pathOf,
        load: async () => {
            const path = pathOf();
            try {
                if (!(await app.vault.adapter.exists(path))) return null;
                const content = await app.vault.adapter.read(path);
                return parseSnapshotFromJsonl(content);
            } catch (e) {
                log.warn('[AgentSession] 读取会话失败:', e);
                return null;
            }
        },
        save: (snapshot) => {
            pending = snapshot;
            schedule();
        },
        flush: async () => {
            if (timer) {
                clearTimeout(timer);
                timer = null;
            }
            writing = writing.then(doFlush, doFlush);
            await writing;
        },
        clear: async () => {
            if (timer) {
                clearTimeout(timer);
                timer = null;
            }
            pending = null;
            const path = pathOf();
            try {
                if (await app.vault.adapter.exists(path)) await app.vault.adapter.remove(path);
            } catch (e) {
                log.warn('[AgentSession] 清空会话失败:', e);
            }
        },
    };
}