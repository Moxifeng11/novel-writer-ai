/**
 * project-index-service.ts — 项目索引服务（索引与全文分离）
 *
 * 借鉴催更姬 infrastructure/persistence：列目录/查候选只读索引摘要，
 * 正文按需单读。索引落在 `<项目>/04-项目总控/索引.json`，随项目走。
 *
 * 失效策略：vault 事件（创建/修改/删除/改名）把项目标记为脏，下次 ensure 时重建；
 * 未变化时直接命中缓存，不重复扫描。
 */

import { App, TFile, TFolder } from 'obsidian';
import { createLogger } from '@/shared/logger';
import { pjIndexFile } from '@/shared/paths';
import {
    buildProjectIndex,
    isIndexStale,
    PROJECT_INDEX_VERSION,
    type ProjectIndex,
} from '@/shared/project-index-model';

const log = createLogger('ProjectIndex');

/** 文件摘要（扫描结果，不含正文） */
interface FileSummary {
    path: string;
    name: string;
    size: number;
    mtime: number;
}

/**
 * 项目索引服务。
 */
export class ProjectIndexService {
    private readonly app: App;
    private readonly cache = new Map<string, ProjectIndex>();
    private readonly dirty = new Set<string>();

    constructor(app: App) {
        this.app = app;
    }

    /**
     * 取项目索引（缓存优先；脏或过期时重建并落盘）。
     *
     * @param project - 项目路径
     * @returns 项目索引；项目目录不存在时返回空索引
     */
    async ensure(project: string): Promise<ProjectIndex> {
        const cached = this.cache.get(project);
        if (cached && !this.dirty.has(project)) {
            const files = this.scan(project);
            if (!isIndexStale(cached, files)) return cached;
        }
        const files = this.scan(project);
        const index = buildProjectIndex(project, files);
        this.cache.set(project, index);
        this.dirty.delete(project);
        await this.save(index);
        return index;
    }

    /**
     * 标记项目索引为脏（vault 事件触发）。
     *
     * @param project - 项目路径；省略表示全部
     */
    invalidate(project?: string): void {
        if (project) {
            this.dirty.add(project);
            return;
        }
        for (const key of this.cache.keys()) this.dirty.add(key);
    }

    /**
     * 由文件路径推断所属项目（两级路径：`长篇小说/书名`）。
     *
     * @param path - vault 相对路径
     * @returns 项目路径；无法判断返回 null
     */
    projectOfPath(path: string): string | null {
        const parts = String(path || '').replace(/\\/g, '/').split('/');
        if (parts.length < 3) return null;
        const root = parts[0];
        if (root !== '长篇小说' && root !== '短篇小说' && root !== '剧本' && root !== '短剧剧本') return null;
        return `${parts[0]}/${parts[1]}`;
    }

    /**
     * 清空缓存（测试或项目切换用）。
     */
    clear(): void {
        this.cache.clear();
        this.dirty.clear();
    }

    /** 扫描项目目录，只取 size/mtime，不读正文 */
    private scan(project: string): FileSummary[] {
        const folder = this.app.vault.getAbstractFileByPath(project);
        if (!(folder instanceof TFolder)) return [];
        const results: FileSummary[] = [];
        const stack: TFolder[] = [folder];
        while (stack.length > 0) {
            const current = stack.pop();
            if (!current) continue;
            for (const child of current.children) {
                if (child instanceof TFolder) {
                    stack.push(child);
                } else if (child instanceof TFile && child.extension === 'md') {
                    results.push({
                        path: child.path,
                        name: child.basename,
                        size: child.stat.size,
                        mtime: child.stat.mtime,
                    });
                }
            }
        }
        return results;
    }

    /** 落盘索引（失败不阻断，索引可重建） */
    private async save(index: ProjectIndex): Promise<void> {
        const target = pjIndexFile(index.project);
        try {
            const payload = `${JSON.stringify(index, null, 2)}\n`;
            const existing = this.app.vault.getAbstractFileByPath(target);
            if (existing instanceof TFile) {
                await this.app.vault.modify(existing, payload);
            } else {
                await this.app.vault.create(target, payload);
            }
        } catch (error) { // silent-ok: 索引是派生数据，落盘失败不影响写作，下次 ensure 会重建
            log.warn('索引落盘失败（下次会重建）:', error);
        }
    }

    /**
     * 读取已落盘的索引（不重建，用于诊断）。
     *
     * @param project - 项目路径
     * @returns 索引；不存在或损坏返回 null
     */
    async read(project: string): Promise<ProjectIndex | null> {
        const target = pjIndexFile(project);
        const file = this.app.vault.getAbstractFileByPath(target);
        if (!(file instanceof TFile)) return null;
        try {
            const parsed = JSON.parse(await this.app.vault.read(file)) as ProjectIndex;
            if (parsed?.version !== PROJECT_INDEX_VERSION) return null;
            return parsed;
        // silent-ok: 索引文件损坏等价于「无索引」，调用方会重建，不阻断写作
        } catch { // silent-ok: 索引文件损坏等价于「无索引」，调用方会重建，不阻断写作
            // silent-ok: 索引文件损坏等价于「无索引」，调用方会重建，不阻断写作
            return null;
        }
    }
}
