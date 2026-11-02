/**
 * checkpoint-manager.ts — 断点续传管理器
 *
 * 功能：管理拆解任务的检查点，支持中断后恢复、文件完整性校验、自动清理。
 *
 * 设计原则：
 * - 每段完成后保存检查点，不频繁写盘
 * - checksum 校验确保数据完整性
 * - 原文变更时自动放弃检查点，从头开始
 * - 任务完成/取消后清理检查点
 * - 支持流式恢复（从字节偏移继续）
 */

import { FileSystemPort } from '../shared/file-system-port';
import { yieldToUI } from '../shared/yield';

/**
 * 检查点状态。
 */
export interface CheckpointState {
    taskId: string;
    bookId: string;
    bookName: string;
    filePath?: string;
    bytesProcessed: number;
    currentDimension: string;
    dimensionProgress: number;
    completedSegments: number;
    totalSegments: number;
    partialResults: Record<string, unknown>;
    startedAt: number;
    lastSavedAt: number;
    checksum: string;
    sourceChecksum: string;
    version: string;
}

/**
 * 恢复选项。
 */
export interface ResumeOptions {
    force?: boolean;
    maxAgeMs?: number;
}

/**
 * 检查点信息。
 */
export interface CheckpointInfo {
    exists: boolean;
    valid: boolean;
    state?: CheckpointState;
    reason?: string;
}

const CHECKPOINT_VERSION = '1.0';
const MAX_CHECKPOINT_AGE = 24 * 60 * 60 * 1000;

function computeChecksum(text: string): string {
    let hash = 0;
    if (text.length === 0) return '00000000';
    for (let i = 0; i < text.length; i++) {
        const char = text.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return Math.abs(hash).toString(16).padStart(8, '0');
}

/**
 * 检查点管理器。
 */
export class CheckpointManager {
    private fs: FileSystemPort;

    constructor(fs: FileSystemPort) {
        this.fs = fs;
    }

    /**
     * 保存检查点。
     *
     * @param state - 参数
     * @param sourceText? - 参数
     */
    async saveCheckpoint(state: Omit<CheckpointState, 'checksum' | 'lastSavedAt' | 'sourceChecksum' | 'version'>, sourceText?: string): Promise<void> {
        const fullState: CheckpointState = {
            ...state,
            version: CHECKPOINT_VERSION,
            lastSavedAt: Date.now(),
            sourceChecksum: sourceText ? computeChecksum(sourceText) : '',
            checksum: computeChecksum(JSON.stringify({
                bytesProcessed: state.bytesProcessed,
                currentDimension: state.currentDimension,
                completedSegments: state.completedSegments,
                partialResults: state.partialResults,
            })),
        };

        const content = this.serializeCheckpoint(fullState);
        const path = this.getCheckpointPath(state.bookId);

        await this.fs.write(path, content);
    }

    /**
     * 读取检查点。
     *
     * @param bookId - 参数
     * @returns 检查点或 null
     */
    async getCheckpoint(bookId: string): Promise<CheckpointInfo> {
        const path = this.getCheckpointPath(bookId);

        try {
            const content = await this.fs.read(path);
            if (!content) {
                return { exists: false, valid: false };
            }

            const state = this.deserializeCheckpoint(content);
            if (!state) {
                return { exists: true, valid: false, reason: '序列化格式错误' };
            }

            if (state.version !== CHECKPOINT_VERSION) {
                return { exists: true, valid: false, reason: '版本不兼容' };
            }

            if (!this.verifyChecksum(state)) {
                return { exists: true, valid: false, reason: '校验和不匹配' };
            }

            return { exists: true, valid: true, state };
        } catch {
            return { exists: false, valid: false };
        }
    }

    /**
     * 从检查点恢复。
     *
     * @param bookId - 参数
     * @param options - 参数
     * @returns 恢复结果
     */
    async resumeFromCheckpoint(bookId: string, options: ResumeOptions = {}): Promise<CheckpointState | null> {
        const info = await this.getCheckpoint(bookId);

        if (!info.exists) {
            return null;
        }

        if (!info.valid && !options.force) {
            return null;
        }

        if (!info.state) {
            return null;
        }

        const maxAge = options.maxAgeMs ?? MAX_CHECKPOINT_AGE;
        if (Date.now() - info.state.lastSavedAt > maxAge && !options.force) {
            return null;
        }

        return info.state;
    }

    /**
     * 删除检查点。
     *
     * @param bookId - 参数
     * @returns 是否删除
     */
    async deleteCheckpoint(bookId: string): Promise<void> {
        const path = this.getCheckpointPath(bookId);
        try {
            await this.fs.delete(path);
        } catch {
        }
    }

    /**
     * 清理旧检查点。
     *
     * @param maxAgeMs - 参数
     * @returns 清理数量
     */
    async cleanupOldCheckpoints(maxAgeMs: number = MAX_CHECKPOINT_AGE): Promise<number> {
        let cleanedCount = 0;
        const now = Date.now();

        try {
            const files = await this.fs.listFiles('checkpoints');
            for (const file of files) {
                if (file.name?.endsWith('.checkpoint.md')) {
                    try {
                        const content = await this.fs.read(file.path);
                        const state = this.deserializeCheckpoint(content);
                        if (state && now - state.lastSavedAt > maxAgeMs) {
                            await this.fs.delete(file.path);
                            cleanedCount++;
                            await yieldToUI();
                        }
                    } catch {
                        await this.fs.delete(file.path);
                        cleanedCount++;
                    }
                }
            }
        } catch {
        }

        return cleanedCount;
    }

    /**
     * 校验来源是否匹配。
     *
     * @param bookId - 参数
     * @param sourceText - 参数
     * @returns 布尔值
     */
    async verifySourceMatch(bookId: string, sourceText: string): Promise<boolean> {
        const info = await this.getCheckpoint(bookId);
        if (!info.exists || !info.state) {
            return true;
        }

        if (!info.state.sourceChecksum) {
            return true;
        }

        const sourceChecksum = computeChecksum(sourceText);
        return sourceChecksum === info.state.sourceChecksum;
    }

    private getCheckpointPath(bookId: string): string {
        return `checkpoints/${bookId}.checkpoint.md`;
    }

    private serializeCheckpoint(state: CheckpointState): string {
        const frontmatter = {
            taskId: state.taskId,
            bookId: state.bookId,
            bookName: state.bookName,
            filePath: state.filePath,
            bytesProcessed: state.bytesProcessed,
            currentDimension: state.currentDimension,
            dimensionProgress: state.dimensionProgress,
            completedSegments: state.completedSegments,
            totalSegments: state.totalSegments,
            startedAt: state.startedAt,
            lastSavedAt: state.lastSavedAt,
            checksum: state.checksum,
            sourceChecksum: state.sourceChecksum,
            version: state.version,
        };

        const yaml = Object.entries(frontmatter)
            .map(([key, value]) => {
                if (value === undefined) return '';
                if (typeof value === 'string') {
                    return `${key}: "${value}"`;
                }
                return `${key}: ${value}`;
            })
            .filter(Boolean)
            .join('\n');

        const json = JSON.stringify(state.partialResults, null, 2);

        return `---\n${yaml}\n---\n\n# 增量结果\n\`\`\`json\n${json}\n\`\`\``;
    }

    private deserializeCheckpoint(content: string): CheckpointState | null {
        try {
            // 文件可能被外部编辑器/同步盘改成 CRLF，统一换行后再解析
            const normalized = content.replace(/\r\n/g, '\n');
            const match = normalized.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
            if (!match) return null;

            const yamlContent = match[1];
            const body = match[2];

            const frontmatter: Record<string, unknown> = {};
            for (const line of yamlContent.split('\n')) {
                // 只按第一个 `: ` 切分：值本身可能含 `: `（如 filePath、bookName）
                const sep = line.indexOf(': ');
                if (sep <= 0) continue;
                const key = line.slice(0, sep).trim();
                const value = line.slice(sep + 2);
                if (!key) continue;
                const trimmed = value.trim();
                if (trimmed === '') {
                    frontmatter[key] = '';
                } else if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
                    frontmatter[key] = trimmed.slice(1, -1);
                } else if (!isNaN(Number(trimmed))) {
                    frontmatter[key] = Number(trimmed);
                } else {
                    frontmatter[key] = trimmed;
                }
            }

            let partialResults: Record<string, unknown> = {};
            const jsonMatch = body.match(/```json\n([\s\S]*?)\n```/);
            if (jsonMatch) {
                partialResults = JSON.parse(jsonMatch[1]);
            }

            return {
                taskId: frontmatter.taskId as string,
                bookId: frontmatter.bookId as string,
                bookName: frontmatter.bookName as string,
                filePath: frontmatter.filePath as string | undefined,
                bytesProcessed: frontmatter.bytesProcessed as number,
                currentDimension: frontmatter.currentDimension as string,
                dimensionProgress: frontmatter.dimensionProgress as number,
                completedSegments: frontmatter.completedSegments as number,
                totalSegments: frontmatter.totalSegments as number,
                partialResults,
                startedAt: frontmatter.startedAt as number,
                lastSavedAt: frontmatter.lastSavedAt as number,
                checksum: frontmatter.checksum as string,
                sourceChecksum: frontmatter.sourceChecksum as string,
                version: frontmatter.version as string,
            };
        } catch {
            return null;
        }
    }

    private verifyChecksum(state: CheckpointState): boolean {
        const expected = computeChecksum(JSON.stringify({
            bytesProcessed: state.bytesProcessed,
            currentDimension: state.currentDimension,
            completedSegments: state.completedSegments,
            partialResults: state.partialResults,
        }));
        return expected === state.checksum;
    }
}
