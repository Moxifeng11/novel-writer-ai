/**
 * fact-index-vault.ts — FactIndexManager 的 Obsidian vault 接线
 * 对应 spec: story-quality-closed-loop-optimization Task 11 数据层接线。
 *
 * 提供 FactStoragePort（JSON 落盘）与 FactWriter（写正式库）的 vault 实现，
 * 通过注入 FileSystemPort 保持平台无关可测。
 */

import type { FileSystemPort } from '../shared/file-system-port';
import {
    pjFactIndexFile,
    pjCharFile,
    pjWorldview,
    pjNarrativeOverview,
} from '../shared/paths';
import type {
    PersistedFactIndex,
    FactStoragePort,
    FactWriter,
    PendingFact,
    FactCategory,
} from './fact-index-manager';

const CATEGORY_LABELS: Record<FactCategory, string> = {
    character: '人物',
    world: '世界观',
    plot: '剧情',
};

/** FactStoragePort 的 vault 实现：事实索引 JSON 落盘（vault 无关，可注入 MockFileSystem 测试） */
export class VaultFactStorage implements FactStoragePort {
    constructor(
        private readonly fs: FileSystemPort,
        private readonly indexPath: string,
    ) {}

    async load(): Promise<PersistedFactIndex | null> {
        try {
            if (!(await this.fs.exists(this.indexPath))) return null;
            const content = await this.fs.read(this.indexPath);
            return JSON.parse(content) as PersistedFactIndex;
        } catch {
            return null; // 文件缺失/损坏时回退空队列，不崩溃
        }
    }

    async save(data: PersistedFactIndex): Promise<void> {
        await this.fs.write(this.indexPath, JSON.stringify(data, null, 2));
    }
}

/**
 * FactWriter 的 vault 实现：确认事实按类别追加写入对应正式库文件。
 * - character → 人物 .md（不存在则新建，含已确认事实小节）
 * - world → 世界观总览.md
 * - plot → 叙事总览.md
 */
export class VaultFactWriter implements FactWriter {
    constructor(
        private readonly fs: FileSystemPort,
        private readonly project: string,
    ) {}

    async writeFact(fact: PendingFact): Promise<void> {
        const path = this.targetPath(fact);
        const existing = await this.safeRead(path);
        const section = [
            '',
            `## 已确认事实：${fact.name}`,
            `- 类别：${CATEGORY_LABELS[fact.category]}`,
            `- 内容：${fact.content}`,
            `- 来源：${fact.source}`,
            '',
        ].join('\n');
        await this.fs.write(path, (existing ?? '') + section);
    }

    private targetPath(fact: PendingFact): string {
        switch (fact.category) {
            case 'character':
                return pjCharFile(this.project, fact.name);
            case 'world':
                return pjWorldview(this.project);
            case 'plot':
                return pjNarrativeOverview(this.project);
        }
    }

    private async safeRead(path: string): Promise<string | null> {
        try {
            return await this.fs.read(path);
        } catch {
            return null;
        }
    }
}

/**
 * 项目事实索引落盘路径
 *
 * @param project - 项目（路径或对象）
 * @returns 文本结果
 */
export function projectFactIndexPath(project: string): string {
    return pjFactIndexFile(project);
}
