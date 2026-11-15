/**
 * knowledge-migration-service.ts — 世界观/设定库迁移（M13/M14 收尾）
 *
 * 单份 md（多级 H2）→ 条目卡 + 派生视图；dry-run 只出计划。
 */

import { App, TFile } from 'obsidian';
import { createLogger } from '@/shared/logger';
import {
    parseKnowledgeEntries,
    renderKnowledgeCard,
    renderSettingLib,
    renderWorldview,
    type KnowledgeEntryCard,
} from '@/shared/knowledge-card-model';

const log = createLogger('KnowledgeMigration');

/** 迁移结果 */
export interface KnowledgeMigrationResult {
    dryRun: boolean;
    /** 世界观条目数 */
    worldview: number;
    /** 设定条目数 */
    setting: number;
    /** 写入的卡片文件 */
    cards: string[];
    /** 备份文件 */
    backups: string[];
    /** 失败项 */
    failures: Array<{ path: string; reason: string }>;
    /** 摘要 */
    summary: string;
}

/** ID 分配器（pathFor 由调用方用最终 ID 生成路径） */
export type KnowledgeIdAllocator = (
    type: 'worldview' | 'setting',
    pathFor: (id: string) => string,
) => Promise<string>;

/**
 * 世界观/设定库迁移服务。
 */
export class KnowledgeMigrationService {
    /**
     * @param app - Obsidian 应用
     * @param allocate - ID 分配器
     */
    constructor(
        private readonly app: App,
        private readonly allocate: KnowledgeIdAllocator,
    ) {}

    /**
     * 预览迁移计划。
     *
     * @param project - 项目路径
     * @returns 条目与摘要
     */
    async plan(project: string): Promise<{ worldview: KnowledgeEntryCard[]; setting: KnowledgeEntryCard[]; summary: string }> {
        const worldview = parseKnowledgeEntries(await this.readText(this.worldviewPath(project)), 'WLD');
        const setting = parseKnowledgeEntries(await this.readText(this.settingPath(project)), 'SET');
        return {
            worldview,
            setting,
            summary: `世界观条目 ${worldview.length} 条；设定条目 ${setting.length} 条`,
        };
    }

    /**
     * 执行迁移。
     *
     * @param project - 项目路径
     * @param dryRun - 是否只预览
     * @returns 迁移结果
     */
    async migrate(project: string, dryRun = true): Promise<KnowledgeMigrationResult> {
        const { worldview, setting, summary } = await this.plan(project);
        const cards: string[] = [];
        const backups: string[] = [];
        const failures: KnowledgeMigrationResult['failures'] = [];
        if (dryRun) {
            return { dryRun: true, worldview: worldview.length, setting: setting.length, cards, backups, failures, summary };
        }

        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const writtenWorldview: KnowledgeEntryCard[] = [];
        for (const card of worldview) {
            try {
                const id = await this.allocate('worldview', (nextId) => this.cardPathWithId(project, 'worldview', nextId, card));
                const path = this.cardPathWithId(project, 'worldview', id, card);
                await this.writeFile(path, renderKnowledgeCard({ ...card, id }, {
                    id,
                    type: 'worldview',
                    tags: '[nw/设定/世界观]',
                }));
                cards.push(path);
                writtenWorldview.push({ ...card, id });
            } catch (error) {
                failures.push({ path: this.cardPathWithId(project, 'worldview', '?', card), reason: String(error) });
            }
        }
        const writtenSetting: KnowledgeEntryCard[] = [];
        for (const card of setting) {
            try {
                const id = await this.allocate('setting', (nextId) => this.cardPathWithId(project, 'setting', nextId, card));
                const path = this.cardPathWithId(project, 'setting', id, card);
                await this.writeFile(path, renderKnowledgeCard({ ...card, id }, {
                    id,
                    type: 'setting',
                    tags: '[nw/设定/设定库]',
                }));
                cards.push(path);
                writtenSetting.push({ ...card, id });
            } catch (error) {
                failures.push({ path: this.cardPathWithId(project, 'worldview', '?', card), reason: String(error) });
            }
        }

        for (const [original, derived] of [
            [this.worldviewPath(project), writtenWorldview.length > 0 ? renderWorldview(writtenWorldview) : ''],
            [this.settingPath(project), writtenSetting.length > 0 ? renderSettingLib(writtenSetting) : ''],
        ] as const) {
            if (!derived) continue;
            const backup = `${project}/_versions/migration/${stamp}/${original.split('/').pop() ?? 'doc.md'}`;
            try {
                const text = await this.readText(original);
                if (!text) continue;
                await this.writeFile(backup, text);
                backups.push(backup);
                await this.writeFile(original, derived);
            } catch (error) {
                failures.push({ path: original, reason: String(error) });
            }
        }

        log.info(`世界观/设定迁移完成：卡片 ${cards.length}，备份 ${backups.length}，失败 ${failures.length}`);
        return {
            dryRun: false,
            worldview: writtenWorldview.length,
            setting: writtenSetting.length,
            cards,
            backups,
            failures,
            summary,
        };
    }

    /** 世界观总览路径 */
    private worldviewPath(project: string): string {
        return `${project}/01-世界架构/世界观总览.md`;
    }

    /** 设定库路径 */
    private settingPath(project: string): string {
        return `${project}/01-世界架构/设定库.md`;
    }

    /** 条目卡路径（用最终 ID） */
    private cardPathWithId(project: string, kind: 'worldview' | 'setting', id: string, card: KnowledgeEntryCard): string {
        const dir = kind === 'worldview' ? '世界观' : '设定';
        const safe = (card.title || '未命名').replace(/[\\/:*?"<>|]/g, '_').slice(0, 40);
        return `${project}/01-世界架构/${dir}/${id}_${safe}.md`;
    }

    /** 读文本 */
    private async readText(path: string): Promise<string> {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) return '';
        try {
            return await this.app.vault.read(file);
        } catch { // silent-ok: 读不到按空处理，迁移跳过
            return '';
        }
    }

    /** 写文件（自动建目录） */
    private async writeFile(path: string, content: string): Promise<void> {
        const dir = path.split('/').slice(0, -1).join('/');
        if (dir && !this.app.vault.getAbstractFileByPath(dir)) await this.app.vault.createFolder(dir);
        const existing = this.app.vault.getAbstractFileByPath(path);
        if (existing instanceof TFile) await this.app.vault.modify(existing, content);
        else await this.app.vault.create(path, content);
    }
}
