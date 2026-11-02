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
} from '../../engine/agent/harness/session-snapshot';
import { createLogger } from '../../shared/logger';

const log = createLogger('AgentSession');

export const SESSION_ROOT = '.sessions/agent';
/** 存档体积上限：超过后重写为单行（会话日志本身已由压缩控制长度） */
const MAX_STORE_BYTES = 512 * 1024;
/** 写盘节流（dsh 默认 1s）：连续多个回合只写最后一次快照 */
const SAVE_THROTTLE_MS = 1000;

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

export function createAgentSessionStore(app: App, scope: () => string): AgentSessionStore {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let pending: HarnessSessionSnapshot | null = null;
    let writing: Promise<void> = Promise.resolve();

    const pathOf = (): string => `${SESSION_ROOT}/${slug(scope()) || 'default'}.jsonl`;

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
                await app.vault.adapter.write(path, line);
            } else {
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