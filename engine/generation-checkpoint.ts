/**
 * generation-checkpoint.ts — 生成断点 + 局部重试存储
 * 对应 spec: story-quality-closed-loop-optimization Task 7。
 *
 * 蓝本参考 services/checkpoint-manager.ts（拆书断点）的存储模式，
 * 但字段面向章节/场景生成语义（project+chapter+scene+promptHash 四元组隔离）。
 *
 * 口径衔接：promptHash 一律来自 p0-api-efficiency-optimization 交付的
 * computePromptHash（engine/prompt-hash.ts，唯一口径源）。
 *
 * 存储端口注入式（write/read/remove 三函数），生产侧接 Obsidian vault，
 * 测试侧内存 mock——Store 自身零 obsidian 依赖，可离线单测。
 * 落盘失败 catch 返回 false，不抛未捕获异常（TR-7.4）。
 */

import { createLogger } from '@/shared/logger';

const log = createLogger('GenerationCheckpoint');

/** 生成断点数据（失败/中断时的现场快照） */
export interface GenerationCheckpoint {
    projectId: string;
    chapter: string;
    sceneNum: number;
    /** 由 computePromptHash 计算——断点与 P0 缓存共用口径 */
    promptHash: string;
    /** 已生成的部分正文（含已接受与未接受内容） */
    content: string;
    /** 最后一个用户已接受段落——resume 从此续写，不重复 */
    lastAcceptedParagraph: string;
    /** 中断原因（api_timeout / aborted / network_error 等） */
    finishReason: string;
    savedAt: number;
    version?: number;
}

/** 断点定位四元组 */
export interface CheckpointLocator {
    projectId: string;
    chapter: string;
    sceneNum: number;
    promptHash: string;
}

/** 存储端口（write/read/remove by key；list 可选——恢复面板数据源） */
export interface CheckpointStoragePort {
    write(key: string, json: string): Promise<void>;
    read(key: string): Promise<string | null>;
    remove(key: string): Promise<void>;
    /** 列出某项目的全部断点（可选实现；未实现时 listCheckpoints 降级空数组） */
    list?(projectId: string): Promise<GenerationCheckpoint[]>;
}

/**
 * 检查点版本常量。
 */
export const CHECKPOINT_VERSION = 1;

/**
 * 断点 key：project::chapter::scene::promptHash（TR-7.3 多章多场景隔离）
 *
 * @param projectId - 项目ID
 * @param chapter - 章节
 * @param sceneNum - 场景编号
 * @param promptHash - 提示词哈希
 * @returns 文本结果
 */
export function makeCheckpointKey(
    projectId: string,
    chapter: string,
    sceneNum: number,
    promptHash: string
): string {
    return `${projectId}::${chapter}::${sceneNum}::${promptHash}`;
}

/**
 * GenerationCheckpointStore 类。
 */
export class GenerationCheckpointStore {
    constructor(private readonly port: CheckpointStoragePort) {}

    /**
     * 保存断点；落盘失败 catch 返回 false（TR-7.4）
     *
     * @param input - 输入
     * @returns 是否成功
     */
    async save(input: Omit<GenerationCheckpoint, 'savedAt' | 'version'>): Promise<boolean> {
        const key = makeCheckpointKey(input.projectId, input.chapter, input.sceneNum, input.promptHash);
        const checkpoint: GenerationCheckpoint = {
            ...input,
            savedAt: Date.now(),
            version: CHECKPOINT_VERSION,
        };
        try {
            await this.port.write(key, JSON.stringify(checkpoint));
            return true;
        } catch (e) {
            // 落盘失败不阻断主流程：断点是恢复性增强，写不进去只影响"可恢复"，不影响当前生成
            log.warn('断点落盘失败:', e);
            return false;
        }
    }

    /**
     * 读取断点；不存在返回 null
     *
     * @param locator - 定位器
      * @returns GenerationCheckpoint 或 null
     */
    async get(locator: CheckpointLocator): Promise<GenerationCheckpoint | null> {
        try {
            const key = makeCheckpointKey(locator.projectId, locator.chapter, locator.sceneNum, locator.promptHash);
            const raw = await this.port.read(key);
            if (!raw) return null;
            const parsed = JSON.parse(raw) as GenerationCheckpoint;
            return parsed && typeof parsed.content === 'string' ? parsed : null;
        } catch (e) {
            log.warn('断点读取失败:', e);
            return null;
        }
    }

    /**
     * 放弃断点（用户选择"放弃本次/使用已有结果"时清除）
     *
     * @param locator - 定位器
     */
    async discard(locator: CheckpointLocator): Promise<void> {
        try {
            const key = makeCheckpointKey(locator.projectId, locator.chapter, locator.sceneNum, locator.promptHash);
            await this.port.remove(key);
        } catch (e) {
            log.warn('断点清除失败:', e);
        }
    }

    /**
     * 列出某项目的全部断点（Task 10 恢复面板数据源）。
     * 端口未实现 list 或读取失败时降级空数组，不阻塞向导打开。
     * @param projectId - 项目ID
     * @returns 结果数组
     */
    async listCheckpoints(projectId: string): Promise<GenerationCheckpoint[]> {
        try {
            if (typeof this.port.list !== 'function') return [];
            const list = await this.port.list(projectId);
            return Array.isArray(list)
                ? list.filter((c) => c && typeof c.content === 'string')
                : [];
        } catch (e) {
            log.warn('断点列出失败:', e);
            return [];
        }
    }
}
