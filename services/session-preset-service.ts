/**
 * session-preset-service.ts — 会话预设快照服务
 *
 * 存储：`<项目>/04-项目总控/会话预设/<sessionId>.json`。
 * 语义：会话首次 ensure 时用「当前预设」建快照并返回；之后同一会话
 * 再次 ensure 一律返回快照（不跟随设置变化），差异通过 diff 提示用户。
 */

import { App, TFile } from 'obsidian';
import { createLogger } from '@/shared/logger';
import { pjSessionPresetDir } from '@/shared/paths';
import { createSnapshot, diffPreset, parseSnapshot, sessionPresetFileName, snapshotApplies, type SessionPresetPayload, type SessionPresetSnapshot } from '@/shared/session-preset-model';
import type { FileTxService } from './file-tx';

const log = createLogger('SessionPreset');

/** ensure 结果 */
export interface SessionPresetResult {
    /** 本会话应使用的预设 */
    snapshot: SessionPresetSnapshot;
    /** 是否本次新建（false = 沿用已有快照） */
    created: boolean;
    /** 与当前设置相比发生变化的字段（用于提示「新会话生效」） */
    changed: string[];
}

/**
 * 会话预设快照服务。
 */
export class SessionPresetService {
    private readonly app: App;
    private readonly fileTx: FileTxService;

    constructor(app: App, fileTx: FileTxService) {
        this.app = app;
        this.fileTx = fileTx;
    }

    /**
     * 取本会话的预设快照；没有则用当前预设创建。
     *
     * @param project - 项目路径
     * @param sessionId - 会话 id
     * @param current - 当前预设
     * @returns 快照与变更信息
     */
    async ensure(project: string, sessionId: string, current: SessionPresetPayload): Promise<SessionPresetResult> {
        const existing = await this.read(project, sessionId);
        if (existing && snapshotApplies(existing, sessionId, project)) {
            return { snapshot: existing, created: false, changed: diffPreset(existing, current) };
        }
        const snapshot = createSnapshot(sessionId, project, current);
        await this.write(project, snapshot);
        return { snapshot, created: true, changed: [] };
    }

    /**
     * 读取快照。
     *
     * @param project - 项目路径
     * @param sessionId - 会话 id
     * @returns 快照或 null
     */
    async read(project: string, sessionId: string): Promise<SessionPresetSnapshot | null> {
        const path = `${pjSessionPresetDir(project)}/${sessionPresetFileName(sessionId)}`;
        const file = this.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) return null;
        try {
            return parseSnapshot(await this.app.vault.read(file));
        } catch (error) { // silent-ok: 快照读取失败按「无快照」处理，会重建，不阻断会话
            log.warn('读取会话预设快照失败:', path, error);
            return null;
        }
    }

    /** 写入快照（原子） */
    private async write(project: string, snapshot: SessionPresetSnapshot): Promise<void> {
        const path = `${pjSessionPresetDir(project)}/${sessionPresetFileName(snapshot.sessionId)}`;
        await this.fileTx.run(project, [{
            path,
            content: JSON.stringify(snapshot, null, 2) + '\n',
        }]);
    }
}
