/**
 * generation-checkpoint-vault.ts — 生成断点的 Obsidian vault 落盘接线
 * 对应 spec: story-quality-closed-loop-optimization Task 7/10。
 *
 * 提供 CheckpointStoragePort 的 vault 实现：把四元组 key
 * （`${projectId}::${chapter}::${sceneNum}::${promptHash}`）映射到
 * `${projectId}/04-项目总控/断点/<sanitized-key>.json`。
 *
 * 通过注入 FileSystemPort 保持平台无关可测（测试用 MockFileSystem）。
 */

import type { FileSystemPort } from '../shared/file-system-port';
import { pjCheckpointDir } from '../shared/paths';
import type { CheckpointStoragePort, GenerationCheckpoint } from './generation-checkpoint';

export class VaultCheckpointStorage implements CheckpointStoragePort {
    constructor(private readonly fs: FileSystemPort) {}

    /** 四元组 key 中的 projectId 段 */
    private projectIdOf(key: string): string {
        return key.split('::')[0] || 'unknown';
    }

    /** 四元组 key → 断点文件路径（projectId 映射到项目断点目录，key sanitize 为文件名） */
    private keyToPath(key: string): string {
        const projectId = this.projectIdOf(key);
        const safe = key.replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]/g, '_');
        return `${pjCheckpointDir(projectId)}/${safe}.json`;
    }

    async write(key: string, json: string): Promise<void> {
        // 断点目录（04-项目总控/断点）是新建目录，首次落盘时可能不存在，
        // 先确保目录存在（Obsidian vault.create 要求父目录已存在），幂等兜底。
        await this.fs.mkdir(pjCheckpointDir(this.projectIdOf(key))).catch(() => undefined);
        await this.fs.write(this.keyToPath(key), json);
    }

    async read(key: string): Promise<string | null> {
        try {
            return await this.fs.read(this.keyToPath(key));
        } catch {
            return null; // 文件不存在/损坏时返回 null，不崩溃
        }
    }

    async remove(key: string): Promise<void> {
        try {
            await this.fs.delete(this.keyToPath(key));
        } catch {
            // 删除失败静默（断点清除是尽力而为）
        }
    }

    /** 列出项目断点目录下的全部断点（恢复面板数据源）；目录缺失/单文件损坏时跳过 */
    async list(projectId: string): Promise<GenerationCheckpoint[]> {
        try {
            const files = await this.fs.listFiles(pjCheckpointDir(projectId));
            const checkpoints: GenerationCheckpoint[] = [];
            for (const f of files) {
                if (!f.path.endsWith('.json')) continue;
                try {
                    const raw = await this.fs.read(f.path);
                    if (!raw) continue;
                    const parsed = JSON.parse(raw) as GenerationCheckpoint;
                    if (parsed && typeof parsed.content === 'string') {
                        checkpoints.push(parsed);
                    }
                } catch {
                    // 单个断点文件损坏时跳过，不影响其余
                }
            }
            return checkpoints;
        } catch {
            return [];
        }
    }
}
