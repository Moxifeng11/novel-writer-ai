/**
 * id-registry-service.ts — 唯一 ID 登记表读写
 *
 * 落盘：<项目>/04-项目总控/ID登记表.json（走 FileTx 原子写）。
 */

import { App, TFile } from 'obsidian';
import { createLogger } from '@/shared/logger';
import { pjIdRegistryFile } from '@/shared/paths';
import type { FileTxService } from './file-tx';
import {
    allocate,
    emptyRegistry,
    findById,
    findByPath,
    normalizeRegistry,
    rename,
    retire,
    validateRegistry,
    type IdRegistry,
    type IdRegistryEntry,
} from '@/shared/id-registry-model';
import type { EntityType } from '@/shared/project-index-model';

const log = createLogger('IdRegistry');

/**
 * ID 登记表服务。
 */
export class IdRegistryService {
    /**
     * @param app - Obsidian 应用
     * @param fileTx - 文件事务服务
     */
    constructor(private readonly app: App, private readonly fileTx: FileTxService) {}

    /**
     * 读取登记表（不存在返回空表）。
     *
     * @param project - 项目路径
     * @returns 登记表
     */
    async load(project: string): Promise<IdRegistry> {
        const file = this.app.vault.getAbstractFileByPath(pjIdRegistryFile(project));
        if (!(file instanceof TFile)) return emptyRegistry();
        try {
            return normalizeRegistry(JSON.parse(await this.app.vault.read(file)));
        } catch (error) { // silent-ok: 登记表损坏按空表处理，迁移命令会重建
            log.warn('ID 登记表解析失败，按空表处理:', error);
            return emptyRegistry();
        }
    }

    /**
     * 保存登记表。
     *
     * @param project - 项目路径
     * @param registry - 登记表
     * @returns 完成 Promise
     */
    async save(project: string, registry: IdRegistry): Promise<void> {
        await this.fileTx.run(project, [{
            path: pjIdRegistryFile(project),
            content: JSON.stringify(registry, null, 2) + '\n',
        }]);
    }

    /**
     * 为路径分配 ID 并落盘（已存在则返回既有 ID）。
     *
     * @param project - 项目路径
     * @param type - 要素类型
     * @param path - 文件路径
     * @returns ID
     */
    async ensureId(project: string, type: EntityType, path: string): Promise<string> {
        const registry = await this.load(project);
        const existing = findByPath(registry, path);
        if (existing) return existing.id;
        const result = allocate(registry, type, path);
        await this.save(project, result.registry);
        return result.id;
    }

    /**
     * 改名（ID 不变）。
     *
     * @param project - 项目路径
     * @param id - ID
     * @param nextPath - 新路径
     * @returns 完成 Promise
     */
    async renamePath(project: string, id: string, nextPath: string): Promise<void> {
        const registry = await this.load(project);
        if (!findById(registry, id)) return;
        await this.save(project, rename(registry, id, nextPath));
    }

    /**
     * 退休（删除文件后调用）。
     *
     * @param project - 项目路径
     * @param id - ID
     * @returns 完成 Promise
     */
    async retireId(project: string, id: string): Promise<void> {
        const registry = await this.load(project);
        if (!findById(registry, id)) return;
        await this.save(project, retire(registry, id));
    }

    /**
     * 校验登记表与磁盘一致性。
     *
     * @param project - 项目路径
     * @returns 问题列表
     */
    async validate(project: string): Promise<string[]> {
        const registry = await this.load(project);
        const problems = validateRegistry(registry);
        for (const entry of registry.entries) {
            if (entry.retired) continue;
            if (!this.app.vault.getAbstractFileByPath(entry.path)) problems.push(`文件不存在：${entry.id} → ${entry.path}`);
        }
        return problems;
    }

    /**
     * 全部条目。
     *
     * @param project - 项目路径
     * @returns 条目
     */
    async entries(project: string): Promise<IdRegistryEntry[]> {
        return (await this.load(project)).entries;
    }
}
