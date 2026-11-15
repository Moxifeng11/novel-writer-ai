/**
 * ledger-migration-service.ts — 时间线/伏笔迁移执行（M14）
 *
 * 流程：读看板/伏笔库 → 生成计划 → 分配正式 ID → 备份原文件 →
 * 写条目卡（每事件/每伏笔一文件）→ 原文件替换为派生视图。
 * dry-run 只返回计划，不写盘。
 */

import { App, TFile, TFolder } from 'obsidian';
import { createLogger } from '@/shared/logger';
import { assignLedgerIds, planLedgerMigration, type LedgerMigrationPlan } from '@/shared/ledger-migration-model';
import type { ForeshadowCard, TimelineEventCard } from '@/shared/ledger-card-model';

const log = createLogger('LedgerMigration');

/** 迁移结果 */
export interface LedgerMigrationResult {
    dryRun: boolean;
    summary: string;
    /** 写入的卡片文件 */
    cards: string[];
    /** 备份文件 */
    backups: string[];
    /** 失败项 */
    failures: Array<{ path: string; reason: string }>;
}

/** ID 分配器 */
export type LedgerIdAllocator = (type: 'timeline' | 'foreshadow', path: string) => Promise<string>;

/**
 * 时间线/伏笔迁移服务。
 */
/** 事务写入通道（由插件侧注入 FileTxService） */
export interface LedgerWriteTx {
    run(project: string, writes: ReadonlyArray<{ path: string; content: string }>): Promise<unknown>;
}

/**
 * 时间线/伏笔迁移服务。
 */
export class LedgerMigrationService {
    /**
     * @param app - Obsidian 应用
     * @param allocate - ID 分配器（接 ID 登记表）
     */
    constructor(
        private readonly app: App,
        private readonly allocate: LedgerIdAllocator,
        private readonly tx?: LedgerWriteTx,
    ) {}

    /**
     * 生成迁移计划（dry-run）。
     *
     * @param project - 项目路径
     * @returns 计划与摘要
     */
    async plan(project: string): Promise<{ plan: LedgerMigrationPlan; summary: string }> {
        const timelineText = await this.readText(this.timelinePath(project));
        const foreshadowText = await this.readText(this.foreshadowPath(project));
        const plan = planLedgerMigration({ timelineText, foreshadowText });
        return { plan, summary: plan.summary };
    }

    /**
     * 执行迁移。
     *
     * @param project - 项目路径
     * @param dryRun - 是否只预览
     * @returns 迁移结果
     */
    async migrate(project: string, dryRun = true): Promise<LedgerMigrationResult> {
        const { plan, summary } = await this.plan(project);
        const cards: string[] = [];
        const backups: string[] = [];
        const failures: LedgerMigrationResult['failures'] = [];

        const timelineIds: string[] = [];
        for (const card of plan.timelineCards) {
            timelineIds.push(await this.allocate('timeline', this.timelineCardPath(project, card)));
        }
        const foreshadowIds: string[] = [];
        for (const card of plan.foreshadowCards) {
            foreshadowIds.push(await this.allocate('foreshadow', this.foreshadowCardPath(project, card)));
        }
        const assigned = assignLedgerIds(plan, { timeline: timelineIds, foreshadow: foreshadowIds });
        if (dryRun) {
            return { dryRun: true, summary, cards: [], backups: [], failures: [] };
        }

        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const pending: Array<{ path: string; content: string }> = [];
        const cardPaths: string[] = [];
        for (const card of assigned.timelineCards) {
            const path = this.timelineCardPath(project, card);
            try {
                pending.push({ path, content: this.renderTimelineCard(card) });
                cardPaths.push(path);
            } catch (error) {
                failures.push({ path, reason: String(error) });
            }
        }
        for (const card of assigned.foreshadowCards) {
            const path = this.foreshadowCardPath(project, card);
            try {
                pending.push({ path, content: this.renderForeshadowCard(card) });
                cardPaths.push(path);
            } catch (error) {
                failures.push({ path, reason: String(error) });
            }
        }
        // 原文件备份 + 替换为派生视图
        for (const [original, derived] of [
            [this.timelinePath(project), assigned.derived.timeline],
            [this.foreshadowPath(project), assigned.derived.foreshadow],
        ] as const) {
            if (!derived) continue;
            const backup = `${project}/_versions/migration/${stamp}/${original.split('/').pop() ?? 'ledger.md'}`;
            try {
                const text = await this.readText(original);
                if (text) {
                    pending.push({ path: backup, content: text });
                    backups.push(backup);
                }
                pending.push({ path: original, content: derived });
            } catch (error) {
                failures.push({ path: original, reason: String(error) });
            }
        }

        // C5：多文件写入走事务（注入 FileTxService 时失败自动回滚）
        try {
            await this.ensureDirs(pending.map(write => write.path));
            if (this.tx) await this.tx.run(project, pending);
            else for (const write of pending) await this.writeFile(write.path, write.content);
            cards.push(...cardPaths);
        } catch (error) {
            failures.push({ path: '(事务)', reason: String(error) });
            cards.length = 0;
            backups.length = 0;
        }

        log.info(`时间线/伏笔迁移完成：卡片 ${cards.length}，备份 ${backups.length}，失败 ${failures.length}`);
        return { dryRun: false, summary, cards, backups, failures };
    }

    /** 事务写入前先建好目标目录（FileTx 只写文件，不建目录） */
    private async ensureDirs(paths: readonly string[]): Promise<void> {
        const dirs = new Set<string>();
        for (const path of paths) {
            const dir = path.split('/').slice(0, -1).join('/');
            if (dir) dirs.add(dir);
        }
        for (const dir of dirs) {
            if (!this.app.vault.getAbstractFileByPath(dir)) {
                // silent-ok: 并发/已存在时创建失败可忽略
                await this.app.vault.createFolder(dir).catch(() => undefined);
            }
        }
    }

    /** 读文本 */
    private async readText(path: string): Promise<string> {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) return '';
        try {
            return await this.app.vault.read(file);
        } catch { // silent-ok: 读不到按空处理，迁移会跳过
            return '';
        }
    }

    /** 写文本（自动建目录） */
    private async writeFile(path: string, content: string): Promise<void> {
        const dir = path.split('/').slice(0, -1).join('/');
        if (dir && !this.app.vault.getAbstractFileByPath(dir)) {
            await this.app.vault.createFolder(dir);
        }
        const existing = this.app.vault.getAbstractFileByPath(path);
        if (existing instanceof TFile) await this.app.vault.modify(existing, content);
        else await this.app.vault.create(path, content);
    }

    /** 时间线看板路径 */
    private timelinePath(project: string): string {
        return `${project}/02-时间线与伏笔/时间线看板.md`;
    }

    /** 伏笔库路径 */
    private foreshadowPath(project: string): string {
        return `${project}/02-时间线与伏笔/伏笔库.md`;
    }

    /** 事件卡路径 */
    private timelineCardPath(project: string, card: TimelineEventCard): string {
        const safe = (card.event || '未命名事件').replace(/[\\/:*?"<>|]/g, '_').slice(0, 40);
        return `${project}/02-时间线与伏笔/时间线事件/${card.id}_${safe}.md`;
    }

    /** 伏笔卡路径 */
    private foreshadowCardPath(project: string, card: ForeshadowCard): string {
        const safe = (card.name || '未命名伏笔').replace(/[\\/:*?"<>|]/g, '_').slice(0, 40);
        return `${project}/02-时间线与伏笔/伏笔/${card.id}_${safe}.md`;
    }

    /** 渲染事件卡 */
    private renderTimelineCard(card: TimelineEventCard): string {
        const lines = [
            '---',
            `id: ${card.id}`,
            'type: timeline',
            `时间: ${card.time}`,
            `章节: ${card.chapter}`,
            `地点: ${card.location}`,
            `涉及人物: [${card.characters.join(', ')}]`,
            `类型: ${card.kind}`,
            'tags: [nw/设定/时间线]',
            '---',
            '',
            `# ${card.event || card.id}`,
            '',
            card.event ? `事件：${card.event}` : '',
        ];
        return `${lines.filter(line => line !== '').join('\n')}\n`;
    }

    /** 渲染伏笔卡 */
    private renderForeshadowCard(card: ForeshadowCard): string {
        const lines = [
            '---',
            `id: ${card.id}`,
            'type: foreshadow',
            `当前状态: ${card.status || 'planted'}`,
            `埋设章节: ${card.plantedChapter}`,
            `计划回收: ${card.plannedReveal}`,
            `回收章节: ${card.actualReveal}`,
            `重要程度: ${card.importance}`,
            `相关人物: [${card.characters.join(', ')}]`,
            'tags: [nw/设定/伏笔]',
            '---',
            '',
            `# ${card.name}`,
        ];
        return `${lines.filter(line => line !== '').join('\n')}\n`;
    }
}
