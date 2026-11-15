/**
 * cowrite-snapshot-service.ts — 协同写作注入快照（会话内）
 *
 * 记录「本会话已向模型注入过哪些 kind:id」，同场景重复请求只补差异。
 * 纯内存：切换项目/章节或会话结束即失效，不落盘。
 */

import {
    computeDelta,
    createSnapshot,
    shouldInject,
    type CowriteDelta,
    type InjectedSnapshot,
} from '@/shared/cowrite-delta-model';

/** 一次差异计算结果 */
export interface CowriteDeltaResult {
    /** 差异 */
    delta: CowriteDelta;
    /** 是否需要注入 */
    inject: boolean;
    /** 本次更新后的快照 */
    snapshot: InjectedSnapshot;
}

/**
 * 协同写作注入快照服务。
 */
export class CowriteSnapshotService {
    private snapshots = new Map<string, InjectedSnapshot>();
    /** 当前会话键（项目/章节切换时变化） */
    private sessionKey = '';

    /**
     * 计算差异并更新快照。
     *
     * @param sceneKey - 场景键
     * @param keys - 本次需要的条目 key
     * @param now - 时间
     * @returns 差异结果
     */
    compute(sceneKey: string, keys: readonly string[], now: number = Date.now()): CowriteDeltaResult {
        const previous = this.snapshots.get(sceneKey) ?? null;
        const delta = computeDelta(previous, keys, sceneKey);
        const snapshot = createSnapshot(sceneKey, keys, now);
        this.snapshots.set(sceneKey, snapshot);
        return { delta, inject: shouldInject(delta), snapshot };
    }

    /**
     * 切换会话（清空快照）。
     *
     * @param sessionKey - 新的会话键（如项目路径 + 章号）
     */
    setSession(sessionKey: string): void {
        if (this.sessionKey === sessionKey) return;
        this.sessionKey = sessionKey;
        this.snapshots.clear();
    }

    /**
     * 当前会话键。
     *
     * @returns 会话键
     */
    getSessionKey(): string {
        return this.sessionKey;
    }

    /**
     * 清空全部快照。
     */
    clear(): void {
        this.snapshots.clear();
    }

    /**
     * 已记录快照数（调试用）。
     *
     * @returns 数量
     */
    size(): number {
        return this.snapshots.size;
    }
}
