/**
 * session-preset-model.ts — 会话预设快照模型（纯函数）
 *
 * 借鉴催更姬「会话首次读到作品预设时固化快照」：
 * 会话开始后，模型/供应商/字数目标/模式等**预设**被冻结，
 * 之后用户在设置里改预设不会影响进行中的会话（新会话才生效）。
 *
 * 目的：避免「聊到一半模型被换掉」「写到一半字数目标变了」这类静默行为漂移。
 */

/** 会话预设载荷（真正参与生成的字段） */
export interface SessionPresetPayload {
    /** 供应商 id */
    provider: string;
    /** 模型 id */
    model: string;
    /** 单章目标字数 */
    wordTarget: number;
    /** 生成模式（长篇/短篇/剧本） */
    mode: string;
    /** 写作风格 id（可空） */
    writingStyleId: string;
}

/** 会话预设快照 */
export interface SessionPresetSnapshot {
    version: 1;
    /** 会话 id */
    sessionId: string;
    /** 项目路径 */
    project: string;
    /** 创建时间 */
    createdAt: number;
    /** 载荷指纹（用于快速比对变更） */
    fingerprint: string;
    /** 冻结的预设 */
    payload: SessionPresetPayload;
}

/** 快照格式版本 */
export const SESSION_PRESET_VERSION = 1 as const;

/**
 * 计算载荷指纹。
 *
 * @param payload - 预设载荷
 * @returns 指纹字符串
 */
export function presetFingerprint(payload: SessionPresetPayload): string {
    return [
        payload.provider,
        payload.model,
        payload.wordTarget,
        payload.mode,
        payload.writingStyleId,
    ].join('|');
}

/**
 * 创建会话预设快照。
 *
 * @param sessionId - 会话 id
 * @param project - 项目路径
 * @param payload - 当前预设
 * @param now - 时间戳
 * @returns 快照
 */
export function createSnapshot(
    sessionId: string,
    project: string,
    payload: SessionPresetPayload,
    now: number = Date.now(),
): SessionPresetSnapshot {
    return {
        version: SESSION_PRESET_VERSION,
        sessionId,
        project,
        createdAt: now,
        fingerprint: presetFingerprint(payload),
        payload: { ...payload },
    };
}

/**
 * 快照是否仍适用于该会话（会话 id 与项目一致）。
 *
 * @param snapshot - 快照
 * @param sessionId - 会话 id
 * @param project - 项目路径
 * @returns 适用返回 true
 */
export function snapshotApplies(snapshot: SessionPresetSnapshot, sessionId: string, project: string): boolean {
    return snapshot.version === SESSION_PRESET_VERSION
        && snapshot.sessionId === sessionId
        && snapshot.project === project;
}

/**
 * 对比快照与当前预设，返回发生变化的字段（用于提示「新会话才生效」）。
 *
 * @param snapshot - 快照
 * @param current - 当前预设
 * @returns 变化字段名列表（空数组表示无变化）
 */
export function diffPreset(snapshot: SessionPresetSnapshot, current: SessionPresetPayload): string[] {
    const changed: string[] = [];
    if (snapshot.payload.provider !== current.provider) changed.push('供应商');
    if (snapshot.payload.model !== current.model) changed.push('模型');
    if (snapshot.payload.wordTarget !== current.wordTarget) changed.push('目标字数');
    if (snapshot.payload.mode !== current.mode) changed.push('生成模式');
    if (snapshot.payload.writingStyleId !== current.writingStyleId) changed.push('写作风格');
    return changed;
}

/**
 * 解析快照文件；损坏返回 null。
 *
 * @param raw - 原始 JSON
 * @returns 快照或 null
 */
export function parseSnapshot(raw: string): SessionPresetSnapshot | null {
    try {
        const parsed = JSON.parse(raw) as Partial<SessionPresetSnapshot>;
        if (parsed?.version !== SESSION_PRESET_VERSION) return null;
        if (typeof parsed.sessionId !== 'string' || typeof parsed.project !== 'string') return null;
        if (!parsed.payload || typeof parsed.payload.model !== 'string') return null;
        return parsed as SessionPresetSnapshot;
    } catch {
        // silent-ok: 快照损坏等价于「没有快照」，按当前预设重建，不阻断会话
        return null;
    }
}

/**
 * 快照文件路径（相对项目）。
 *
 * @param sessionId - 会话 id
 * @returns 相对路径片段
 */
export function sessionPresetFileName(sessionId: string): string {
    const safe = sessionId.replace(/[^\w.-]/g, '_').slice(0, 80);
    return `${safe}.json`;
}
