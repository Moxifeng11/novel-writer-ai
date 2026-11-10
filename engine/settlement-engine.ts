/**
 * settlement-engine.ts — 章节结算引擎
 *
 * 职责：解析分析报告 → 更新实体状态 → 更新伏笔库 → 更新时间线 → 写入文件
 *
 * 平台解耦：
 * - 本文件 ~19 处 this.notifier.showNotice() 调用，全部通过 Notifier 抽象接口（shared/types.ts）
 * - 调用方注入实现（实参为 NOOP_NOTIFIER 或 Obsidian Notice 封装），引擎层无 new Notice() 直接调用
 * - 已满足"引擎层零 UI 依赖"约束，无需再引入额外 Callbacks 层（参见 docs/审计报告_v4.5.1_2026-06-30.md §13）
 */

import { TFile, TFolder } from 'obsidian';
import { splitTableCells } from '@/shared/chapter-table';
import { parseForeshadowRevealState } from '@/shared/foreshadow-status';
import { getChapterFileName, findChapterFile, getChapterFile , findBodyFileByChapterNum } from './chapter-utils';
import { CHARACTER_DISPLAY_KEYS } from '@/shared/format-constants';
import { withWriteLock } from '@/shared/write-lock';
import { writeInfoDebtBoard } from '@/shared/info-debt-board';
import type { SettlementJournal } from './settlement/settlement-journal';
import { loadRelationshipStates, extractRelationshipChanges, applyRelationshipChanges, saveRelationshipStates, getRelationshipFilePath } from './relationship-engine';
import { consumePendingRelationshipChanges, loadPendingRelationshipChanges } from './relationship-change-queue';
import { writeChapterDigestFromProject } from './memory/chapter-digest';
import { scheduleGraphValidation } from './graph/graph-validation-trigger';
import { pjBodyDir, pjBodyFile, pjCharFile, pjLocFile, pjFactionFile, pjItemFile, pjForeshadowDB, pjTimelineBoard, pjTimelineDir, pjOutlineDir, pjInfoDebtBoard, pjPromiseLedger, pjCharacterArcTable } from '@/shared/paths';
import { DEFAULT_PROMISE_LEDGER, applyPromiseInstruction, formatPromiseLedger, parsePromiseLedger } from './promise-ledger';
import { applyArcInstruction, buildArcRowsFromCharacters, formatCharacterArcTable, parseCharacterArcTable } from './character-arc';
import type { Notifier } from '@/shared/types';
import { NOOP_NOTIFIER } from '@/shared/types';
import { FileSystemPort, FrontmatterPort, VaultMetaPort, ObsidianFileSystem, ObsidianFrontmatter, ObsidianVaultMeta } from '@/shared/file-system-port';
import { listFolderFiles } from '@/shared/vault-tree';
import { entityDir, listEntityFiles } from '@/shared/entity-reader';
import { NOTICE_ERROR, NOTICE_WARNING, NOTICE_CRITICAL } from '@/shared/thresholds';
import type { Instructions, FrontMatter } from './settlement/settlement-types';
import { parseReport, parseFrontmatterFromText, parseFmList, resolveForceRevealNames } from './settlement/report-parser';
import { appendEventToContent, appendForeshadowToContent, moveForeshadowToRevealedInContent } from './ledger/ledger-write';
import { invalidateStoryLedger } from './ledger/ledger-io';
import { createSettleContext, type SettleContext } from './settlement/settle-context';
import { parseInfoPlanFields } from '@/shared/info-plan-fields';
import { getValidFrontmatterKeys } from '@/shared/entity-field-mappings';
import { getLinkPolicy, formatSingleLinkValue, formatListLinkValue, parseLinkValue } from '@/shared/entity-links';
import type { EntityCategory } from '@/shared/entity-models';
import { verifyForeshadowLoop, type ForeshadowLoopCheck } from '@/shared/foreshadow-loop';
import {
    parseBehaviorLog,
    mergeBehaviorRows,
    formatBehaviorLog,
    buildChapterBehaviorRows,
    type BehaviorRow,
} from '@/shared/behavior-log';
import { CHAPTER_FILE_TYPES } from './chapter-utils';
import { createLogger } from '@/shared/logger';
import { evaluateHumanFeatures } from '@/shared/human-feature-rubric';


const log = createLogger('SettlementEngine');

/** 连续性账本字段（v4.25）：结算写入用「追加 + 来源章」语义，不用覆盖 */
const CONTINUITY_APPEND_FIELDS = new Set(['已知信息', '伤势', '持有物品']);

function chapterNameOf(ctx: SettleContext): string {
    const num = ctx.chapDir.match(/第(\d+)章$/)?.[1] || '';
    return ctx.chapName || (num ? `第${num}章` : '');
}

/**
 * 结算选项列表结构定义。
 */
export interface SettlementOptions {
    forceReveal?: string[];
    involvedChars?: string[];
    involvedLocs?: string[];
    involvedFactions?: string[];
    involvedItems?: string[];
}

/**
 * 结算结果结构定义。
 */
export interface SettlementResult {
    /** 回滚统计（仅 hasPartialFailure 时出现） */
    rollback?: { reverted: number; failed: number };
    /** 回滚不完整标记：产物需标 settlement_partial，提示用户手动检查 */
    settlementPartial?: boolean;
    /**
     * 回滚终态之后的附加写入失败（V2 关系 / 承诺账本 / 角色弧线）。
     *
     * 这些步骤在 journal 清空后执行，失败无法回滚；必须让调用方按「未完成」处理，
     * 否则会写出「已完成」结算表并让后续步骤/批量误以为本章已结算（D3-7）。
     */
    partialFailure?: string[];
    /**
     * 轻结算失败聚合（仅 mode=light 且发生失败时出现）。
     * 轻结算语义为 best-effort 出场确认，不做整次事务；每次写入幂等，
     * 失败后**直接重跑 settleLight 即可修复**。
     */
    lightFailures?: { entities: string[]; foreshadow: boolean; bodyFrontmatter: boolean };
    /** 轻结算部分失败标记（与 lightFailures 同时出现） */
    lightPartial?: boolean;
    /**
     * 本次结算形态：
     * - full：完整结算（可写关系/伏笔/时间线/成长/情绪/账本）
     * - light：出场确认（只写 entity_status / entity_last_seen_at）
     * - empty：分析报告解析出 0 条可应用指令，未执行任何写入
     */
    mode?: 'full' | 'light' | 'empty';
    updated: number;
    created: number;
    updatedChars: number;
    updatedForeshadows: number;
    /** 伏笔闭环核对结果（章纲计划 vs 结算指令，v4.20） */
    foreshadowLoop?: ForeshadowLoopCheck;
    /** 被字段白名单拒绝的更新（v4.20 结算守卫） */
    rejectedFields: Array<{ category: string; name: string; field: string; value: string }>;
    /** 目标实体文件不存在而被搁置的更新（v4.20 结算守卫） */
    missingEntities: Array<{ category: string; name: string; field: string }>;
    /** 链接化字段写入数（v4.20 实体链接化） */
    linkFieldWrites: number;
    /** 本次写入「出场记录」的行为摘要条数（v4.20） */
    recordedBehaviors?: number;
    updatedFactions: number;
    updatedLocations: number;
    updatedItems: number;
    updatedRelations: number;
    updatedGrowth: number;
    updatedEmotions: number;
    createdChars: number;
    createdLocs: number;
    createdFactions: number;
    createdItems: number;
    createdForeshadows: number;
    createdTimelines: number;
    chars: string[];
    locs: string[];
    factions: string[];
    items: string[];
}

/** 指令类型与 FrontMatter 已外迁至 ./settlement/settlement-types.ts */

interface SettlementEngineDeps {
    fs?: FileSystemPort;
    frontmatter?: FrontmatterPort;
    vaultMeta?: VaultMetaPort;
    notifier?: Notifier;
}

/**
 * 结算引擎。
 *
 * @example
 * ```ts
 * const engine = new SettlementEngine(app);
 * const result = await engine.settle(project, chapDir, chapterName, report, bodyText);
 * if (result.hasPartialFailure) console.warn(result.rollback);
 * ```
 */
export class SettlementEngine {
    private app: import('obsidian').App;
    private notifier: Notifier;
    private fs: FileSystemPort | null = null;
    private frontmatter: FrontmatterPort | null = null;
    private vaultMeta: VaultMetaPort | null = null;

    constructor(app: import('obsidian').App, deps?: SettlementEngineDeps);
    constructor(app: import('obsidian').App, notifier?: Notifier);
    constructor(app: import('obsidian').App, depsOrNotifier?: SettlementEngineDeps | Notifier) {
        this.app = app;
        if (depsOrNotifier && 'showNotice' in depsOrNotifier) {
            this.notifier = depsOrNotifier;
        } else if (depsOrNotifier) {
            this.notifier = depsOrNotifier.notifier || NOOP_NOTIFIER;
            this.fs = depsOrNotifier.fs || null;
            this.frontmatter = depsOrNotifier.frontmatter || null;
            this.vaultMeta = depsOrNotifier.vaultMeta || null;
        } else {
            this.notifier = NOOP_NOTIFIER;
        }
    }

    private getFS(): FileSystemPort {
        if (!this.fs) {
            this.fs = new ObsidianFileSystem(this.app);
        }
        return this.fs;
    }

    private getFrontmatter(): FrontmatterPort {
        if (!this.frontmatter) {
            this.frontmatter = new ObsidianFrontmatter(this.app);
        }
        return this.frontmatter;
    }

    private getVaultMeta(): VaultMetaPort {
        if (!this.vaultMeta) {
            this.vaultMeta = new ObsidianVaultMeta(this.app);
        }
        return this.vaultMeta;
    }

    /**
     * 标记「回滚终态之后的附加步骤」失败（D3-7）。
     *
     * 这些步骤跑在 journal 清空之后，失败无法回滚；把标签写进 result，
     * 让产物/步骤/批量按未完成处理（重跑结算幂等可补齐）。
     *
     * @param ctx - 结算上下文
     * @param label - 失败步骤名（用于提示与产物警告）
     */
    private markPostStepFailure(ctx: SettleContext, label: string): void {
        ctx.hasPartialFailure = true;
        const labels = ctx.result.partialFailure ?? [];
        if (!labels.includes(label)) labels.push(label);
        ctx.result.partialFailure = labels;
    }

    /** 更新承诺账本：PROMISE_* 指令 -> 固定表。 */
    private async settleStep_updatePromiseLedger(ctx: SettleContext): Promise<void> {
        if (!ctx.instr.promise?.length) return;
        const path = pjPromiseLedger(ctx.project);
        const fs = this.getFS();
        try {
            // P1-3 遗留：整表读-改-写在锁外会与协同/批量结算互相覆盖，锁内重读最新内容再合并
            await withWriteLock(path, async () => {
                const existed = await fs.exists(path);
                let content = existed ? await fs.read(path) : DEFAULT_PROMISE_LEDGER;
                let items = parsePromiseLedger(content);
                for (const instruction of ctx.instr.promise) {
                    items = applyPromiseInstruction(items, {
                        ...instruction,
                        chapter: instruction.chapter || ctx.chapName,
                    });
                }
                const dir = path.slice(0, path.lastIndexOf('/'));
                await fs.mkdir(dir);
                await this.recordWholeFileBefore(ctx, path, existed ? content : null);
                await fs.write(path, formatPromiseLedger(items));
            });
            // F-3 修复：承诺账本已纳入台账缓存签名（ledger-io），写后显式失效，
            // 否则同轮结算的章节摘要 openPromises 读到空/陈旧承诺
            invalidateStoryLedger(ctx.project);
            log.info(`[SettlementEngine] 承诺账本更新 ${ctx.instr.promise.length} 条`);
        } catch (e) {
            log.warn('[SettlementEngine] 承诺账本更新失败（不影响结算）:', e);
            this.markPostStepFailure(ctx, '承诺账本');
        }
    }

    /** 更新角色弧线表：ARC 指令 -> 固定表；首次用角色 frontmatter 建骨架。 */
    private async settleStep_updateCharacterArcs(ctx: SettleContext): Promise<void> {
        const path = pjCharacterArcTable(ctx.project);
        const fs = this.getFS();
        try {
            // P1-3 遗留：弧线表是整表覆盖写，必须锁内重读后再合并，否则并发结算丢条目
            const written = await withWriteLock(path, async () => {
                const existed = await fs.exists(path);
                let content = existed ? await fs.read(path) : '';
                let rows = content ? parseCharacterArcTable(content) : [];
                if (rows.length === 0) {
                    rows = buildArcRowsFromCharacters(this.readCharacterArcSeeds(ctx.project));
                }
                for (const arc of ctx.instr.arc || []) {
                    rows = applyArcInstruction(rows, arc, ctx.chapName);
                }
                if (rows.length === 0) return false;
                const dir = path.slice(0, path.lastIndexOf('/'));
                await fs.mkdir(dir);
                await this.recordWholeFileBefore(ctx, path, existed ? content : null);
                await fs.write(path, formatCharacterArcTable(rows));
                return true;
            });
            if (written && ctx.instr.arc?.length) {
                log.info(`[SettlementEngine] 角色弧线更新 ${ctx.instr.arc.length} 条`);
            }
        } catch (e) {
            log.warn('[SettlementEngine] 角色弧线更新失败（不影响结算）:', e);
            this.markPostStepFailure(ctx, '角色弧线');
        }
    }

    private readCharacterArcSeeds(project: string): Array<{
        name: string; motivation?: string; fear?: string; weakness?: string; stage?: string;
    }> {
        try {
            // 只读本项目的角色目录：全库 getFiles() 在结算热路径上是 O(全库)
            return listFolderFiles<TFile>(this.app.vault, entityDir(project, 'characters'))
                .map(file => {
                    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter || {};
                    return {
                        name: String(fm['姓名'] || fm['name'] || file.basename || ''),
                        motivation: String(fm['核心动机'] || ''),
                        fear: String(fm['恐惧'] || fm['性格弱点'] || ''),
                        weakness: String(fm['弱点'] || ''),
                        stage: String(fm['弧线阶段'] || ''),
                    };
                })
                .filter(c => c.name);
        } catch {
            return [];
        }
    }

    /**
     * settleLight 方法。
     * @param project - 项目（路径或对象）
     * @param chapDir - 参数值
     * @param chapName - 参数值
     * @param bodyText - 参数值
     * @param options - 配置项
      * @returns SettlementResult 实例
     */
    async settleLight(
        project: string,
        chapDir: string,
        chapName: string,
        bodyText: string,
        options?: SettlementOptions
    ): Promise<SettlementResult> {
        // 数据一致性审计 C-5：同一项目的轻/重结算必须串行，否则任一 run 回滚
        // 会用运行前快照覆盖另一 run 已提交的伏笔/时间线/关系/账本写入。
        return withWriteLock(`settlement:${project}`, () =>
            this.settleLightUnlocked(project, chapDir, chapName, bodyText, options));
    }

    private async settleLightUnlocked(
        project: string,
        chapDir: string,
        chapName: string,
        bodyText: string,
        options?: SettlementOptions
    ): Promise<SettlementResult> {
        const result: SettlementResult = {
            updated: 0,
            created: 0,
            updatedChars: 0,
            updatedForeshadows: 0,
            updatedFactions: 0,
            updatedLocations: 0,
            updatedItems: 0,
            updatedRelations: 0,
            updatedGrowth: 0,
            updatedEmotions: 0,
            createdChars: 0,
            createdLocs: 0,
            createdFactions: 0,
            createdItems: 0,
            createdForeshadows: 0,
            createdTimelines: 0,
            chars: [],
            locs: [],
            factions: [],
            items: [],
            rejectedFields: [],
            missingEntities: [],
            linkFieldWrites: 0,
        };

        const fm = parseFrontmatterFromText(bodyText);
        // 轻结算失败聚合：各写入点仍独立加锁 + 幂等，这里只负责「失败可见」
        const lightFailures = { entities: [] as string[], foreshadow: false, bodyFrontmatter: false };

        const involvedChars = parseFmList(fm['涉及人物']);
        const involvedLocs = parseFmList(fm['涉及地点']);
        const involvedFactions = parseFmList(fm['涉及势力']);
        const involvedItems = parseFmList(fm['涉及物品功法']);

        if (options?.involvedChars) involvedChars.push(...options.involvedChars);
        if (options?.involvedLocs) involvedLocs.push(...options.involvedLocs);
        if (options?.involvedFactions) involvedFactions.push(...options.involvedFactions);
        if (options?.involvedItems) involvedItems.push(...options.involvedItems);

        const uniqueChars = [...new Set(involvedChars)].filter(Boolean);
        const uniqueLocs = [...new Set(involvedLocs)].filter(Boolean);
        const uniqueFactions = [...new Set(involvedFactions)].filter(Boolean);
        const uniqueItems = [...new Set(involvedItems)].filter(Boolean);

        for (const name of uniqueChars) {
            const fp = pjCharFile(project, name);
            const file = this.getVaultMeta().getAbstractFileByPath(fp);
            if (file instanceof TFile) {
                try {
                    await withWriteLock(fp, () =>
                        this.getFrontmatter().processFrontmatter(file, (fmObj: FrontMatter) => {
                            if (fmObj['entity_status'] == null || fmObj['entity_status'] === '') {
                                fmObj['entity_status'] = 'active';
                            }
                            fmObj['entity_last_seen_at'] = chapName;
                        })
                    );
                    result.updatedChars++;
                    result.chars.push(name);
                } catch (e) {
                    log.warn('[SettlementEngine] 轻量结算更新人物失败:', name, e);
                    lightFailures.entities.push(name);
                }
            }
        }

        for (const name of uniqueLocs) {
            const fp = pjLocFile(project, name);
            const file = this.getVaultMeta().getAbstractFileByPath(fp);
            if (file instanceof TFile) {
                try {
                    await withWriteLock(fp, () =>
                        this.getFrontmatter().processFrontmatter(file, (fmObj: FrontMatter) => {
                            if (fmObj['entity_status'] == null || fmObj['entity_status'] === '') {
                                fmObj['entity_status'] = 'active';
                            }
                            fmObj['entity_last_seen_at'] = chapName;
                        })
                    );
                    result.updatedLocations++;
                    result.locs.push(name);
                } catch (e) {
                    log.warn('[SettlementEngine] 轻量结算更新地点失败:', name, e);
                    lightFailures.entities.push(name);
                }
            }
        }

        for (const name of uniqueFactions) {
            const fp = pjFactionFile(project, name);
            const file = this.getVaultMeta().getAbstractFileByPath(fp);
            if (file instanceof TFile) {
                try {
                    await withWriteLock(fp, () =>
                        this.getFrontmatter().processFrontmatter(file, (fmObj: FrontMatter) => {
                            if (fmObj['entity_status'] == null || fmObj['entity_status'] === '') {
                                fmObj['entity_status'] = 'active';
                            }
                            fmObj['entity_last_seen_at'] = chapName;
                        })
                    );
                    result.updatedFactions++;
                    result.factions.push(name);
                } catch (e) {
                    log.warn('[SettlementEngine] 轻量结算更新势力失败:', name, e);
                    lightFailures.entities.push(name);
                }
            }
        }

        for (const name of uniqueItems) {
            const fp = pjItemFile(project, name);
            const file = this.getVaultMeta().getAbstractFileByPath(fp);
            if (file instanceof TFile) {
                try {
                    await withWriteLock(fp, () =>
                        this.getFrontmatter().processFrontmatter(file, (fmObj: FrontMatter) => {
                            if (fmObj['entity_status'] == null || fmObj['entity_status'] === '') {
                                fmObj['entity_status'] = 'active';
                            }
                            fmObj['entity_last_seen_at'] = chapName;
                        })
                    );
                    result.updatedItems++;
                    result.items.push(name);
                } catch (e) {
                    log.warn('[SettlementEngine] 轻量结算更新物品失败:', name, e);
                    lightFailures.entities.push(name);
                }
            }
        }

        if (options?.forceReveal && options.forceReveal.length > 0) {
            const forceRevealSet = new Set(options.forceReveal);
            const fp = pjForeshadowDB(project);
            const ff = this.getVaultMeta().getAbstractFileByPath(fp);
            if (ff instanceof TFile) {
                try {
                    await withWriteLock(fp, async () => {
                        let content = await this.getFS().read(fp);
                        let changed = false;
                        for (const name of forceRevealSet) {
                            const newContent = this.moveForeshadowToRevealed(content, name, chapName);
                            if (newContent) {
                                content = newContent;
                                changed = true;
                                result.updatedForeshadows++;
                            }
                        }
                        if (changed) { await this.getFS().write(fp, content); }
                    });
                } catch (e) {
                    log.warn('[SettlementEngine] 轻量结算更新伏笔库失败:', e);
                    lightFailures.foreshadow = true;
                }
            }
        }

        let bodyFile: TFile | null = null;
        const v4Match = chapDir.match(/^(.+?)\/03-大纲与章节\/步骤结果\/第(\d+)卷\/第(\d+)章$/);
        if (v4Match) {
            const v4Proj = v4Match[1];
            const v4VolN = parseInt(v4Match[2], 10);
            const v4ChapN = parseInt(v4Match[3], 10);
            // 与主结算一致：优先命中「第N章_标题_正文.md」，不能只查裸文件名。
            const bodyDir = pjBodyDir(v4Proj, v4VolN);
            const existingBody = findBodyFileByChapterNum(
                listFolderFiles<TFile>(this.getVaultMeta(), bodyDir),
                `${bodyDir}/`,
                v4ChapN,
                chapName,
            );
            const tf = existingBody ?? this.getVaultMeta().getAbstractFileByPath(pjBodyFile(v4Proj, v4VolN, v4ChapN));
            if (tf instanceof TFile) {
                bodyFile = tf;
            }
        } else {
            const chapFolder = this.getVaultMeta().getAbstractFileByPath(chapDir);
            bodyFile = chapFolder instanceof TFolder ? (getChapterFile(chapFolder, '正文') as TFile | null) : null;
        }
        if (bodyFile) {
            try {
                await withWriteLock(bodyFile.path, () =>
                    this.getFrontmatter().processFrontmatter(bodyFile as TFile, (fmObj: FrontMatter) => {
                        fmObj['status'] = 'settled';
                        if (uniqueChars.length > 0 && !fmObj['涉及人物']) {
                            fmObj['涉及人物'] = uniqueChars;
                        }
                        if (uniqueLocs.length > 0 && !fmObj['涉及地点']) {
                            fmObj['涉及地点'] = uniqueLocs;
                        }
                        if (uniqueFactions.length > 0 && !fmObj['涉及势力']) {
                            fmObj['涉及势力'] = uniqueFactions;
                        }
                        if (uniqueItems.length > 0 && !fmObj['涉及物品功法']) {
                            fmObj['涉及物品功法'] = uniqueItems;
                        }
                    })
                );
            } catch (e) {
                log.warn('[SettlementEngine] 轻量结算 body frontmatter回写失败:', e);
                lightFailures.bodyFrontmatter = true;
            }
        }

        await this.refreshInfoDebt(project);

        result.updated = result.updatedChars + result.updatedForeshadows + result.updatedFactions + result.updatedLocations + result.updatedItems;
        result.chars = [...new Set(result.chars)];
        result.locs = [...new Set(result.locs)];
        result.factions = [...new Set(result.factions)];
        result.items = [...new Set(result.items)];
        // 轻结算 = 出场确认：只有 entity_status / entity_last_seen_at，不写关系/伏笔/时间线
        result.mode = 'light';
        if (lightFailures.entities.length > 0 || lightFailures.foreshadow || lightFailures.bodyFrontmatter) {
            result.lightFailures = lightFailures;
            result.lightPartial = true;
            log.warn('[SettlementEngine] 轻结算部分失败（写入幂等，重跑 settleLight 可修复）:', JSON.stringify(lightFailures));
        }

        return result;
    }

    /**
     * parseFrontmatterFromText / parseFmList 已外迁至 ./settlement/report-parser.ts
     */

    /**
     * 执行一次结算：解析报告 → 写实体/伏笔/时间线/关系/正文状态 → 失败按 journal 回滚。
     *
     * @param project - 项目路径（`长篇小说/书名`）
     * @param chapDir - 章节目录（步骤结果目录）
     * @param chapName - 章名（用于溯源与去重）
     * @param report - 模型输出的结算报告文本
     * @param bodyText - 本章正文（用于人味指标与长度判断）
     * @param options - 结算选项（模式、强制揭示、来源等）
     * @returns 结算结果；`rollback` 存在表示发生了部分失败回滚
     * @throws 仅在参数非法等编程错误时抛出；业务失败通过 result 表达
     */
    async settle(
        project: string,
        chapDir: string,
        chapName: string,
        report: string,
        bodyText: string,
        options?: SettlementOptions
    ): Promise<SettlementResult> {
        // 数据一致性审计 C-5：重结算与轻结算共用项目级串行锁；不同文件锁 key，
        // 不会触发 write-lock 的不可重入限制。回滚因此不会覆盖并发 run 的已提交写入。
        return withWriteLock(`settlement:${project}`, () =>
            this.settleUnlocked(project, chapDir, chapName, report, bodyText, options));
    }

    private async settleUnlocked(
        project: string,
        chapDir: string,
        chapName: string,
        report: string,
        bodyText: string,
        options?: SettlementOptions
    ): Promise<SettlementResult> {
        const instr = parseReport(report);
        const ctx = createSettleContext(project, chapDir, chapName, bodyText, report, instr, options);

        // 空指令集守卫：报告里没有任何 UPDATE_/NEW_/RELATION/GROWTH/EMOTION/DELETE
        // 且没有强制揭示时，不得「什么都不写却标记已结算」——交给调用方决定改用轻结算。
        const hasInstruction = Object.values(instr).some(list => Array.isArray(list) && list.length > 0)
            || (options?.forceReveal?.length ?? 0) > 0;
        if (!hasInstruction) {
            log.warn('[SettlementEngine] 分析报告未解析出可应用指令，结算未执行（mode=empty）');
            ctx.result.mode = 'empty';
            return ctx.result;
        }

        // ─── 1-4: UPDATE_* 系列（带回滚快照 + 写入锁）───
        await this.settleStep_updateCharacters(ctx);
        await this.settleStep_updateFactions(ctx);
        await this.settleStep_updateLocations(ctx);
        await this.settleStep_updateItems(ctx);

        // ─── 5: 伏笔库 UPDATE + 强制揭示 ───
        await this.settleStep_updateForeshadows(ctx);

        // ─── 6-9: NEW_* 系列（实体创建，含完整模板）───
        await this.settleStep_createCharacters(ctx);
        await this.settleStep_createLocations(ctx);
        await this.settleStep_createFactions(ctx);
        await this.settleStep_createItems(ctx);

        // ─── 10-11: 伏笔库 NEW + 时间线 NEW ───
        await this.settleStep_createForeshadows(ctx);
        await this.settleStep_createTimelines(ctx);

        // ─── 11.5: 伏笔闭环核对 + 角色行为摘要（v4.20 数据级反 AI）───
        await this.settleStep_verifyForeshadowLoop(ctx);
        await this.settleStep_recordBehaviors(ctx);

        // ─── 12-14: 关系 / 成长 / 情绪 ───
        await this.settleStep_updateRelations(ctx);
        await this.settleStep_updateGrowth(ctx);
        await this.settleStep_updateEmotions(ctx);

        // ─── 15: 回写正文 frontmatter ───
        await this.settleStep_updateBodyFrontmatter(ctx);

        // ─── 16: 删除实体（v1.4.0）───
        await this.settleStep_deleteEntities(ctx);

        // ─── 17: 刷新信息债看板（v1.3.0）───
        await this.refreshInfoDebt(ctx.project);

        // ─── 18: 结算守卫汇总（v4.20：拒绝/搁置一次性告知）───
        this.settleStep_reportGuards(ctx);

        // ─── 汇总 + 回滚（hasPartialFailure 时）───
        this.settleStep_aggregateAndMaybeRollback(ctx);
        // 异步部分（回滚 / V2 关系）放到独立方法，避免上面同步汇总后再 await
        await this.settleStep_finalizeRollback(ctx);
        // D-3（2026-11-10 交叉审计）：回滚后 journal 已清空，此时再写 V2 关系/
        // 承诺账本/角色弧线，会把「已回滚」的章节状态又被部分改写且永不可回滚。
        // 部分失败的结算一律跳过这三个附加写入，用户重跑结算即可补齐（幂等）。
        if (ctx.hasPartialFailure) {
            log.warn('[SettlementEngine] 本次结算部分失败' +
                (ctx.result.rollback ? '且已回滚' : '') +
                '，跳过 V2 关系/承诺账本/角色弧线写入（重跑结算可补齐）');
        } else {
            await this.settleStep_updateV2Relations(ctx);
            await this.settleStep_updatePromiseLedger(ctx);
            await this.settleStep_updateCharacterArcs(ctx);
        }

        // ─── 19: 剧情记忆摘要（派生数据；失败不影响结算）───
        if (!ctx.hasPartialFailure && !ctx.rollbackFailed) {
            try {
                await writeChapterDigestFromProject(this.app, this.getFS(), ctx.project, ctx.chapName, ctx.bodyText);
            } catch (e) {
                log.warn('[SettlementEngine] 章节摘要生成失败（不影响结算）:', e);
            }
            // 图谱兜底：只读校验，5 秒防抖；报告只写诊断文件
            try {
                scheduleGraphValidation(this.app, ctx.project);
            } catch (e) {
                log.warn('[SettlementEngine] 图谱校验调度失败（不影响结算）:', e);
            }
        }

        ctx.result.mode = 'full';
        return ctx.result;
    }

    // ================================================================
    // 回滚快照工具（settle 内部使用，从原内嵌闭包提取）
    // ================================================================
    /**
     * 记录「整份文件前值」：只有确认不存在才登记为本次新建（回滚阶段删除）。
     *
     * v4.79.0（交叉审计 ②）修复：旧实现把「存在但读失败」也当成新建 → 回滚时
     * `createdFiles` 会**永久删除用户已有文件**。现在：
     * - 调用方已读过内容时传 `knownBefore`（null = 确认不存在），避免二次读与 TOCTOU；
     * - 未传时若 exists=true 而 read 抛错，只标记 `snapshotIncomplete`（回滚时转 partial），
     *   绝不再登记 createdFiles。
     *
     * @param ctx - 结算上下文
     * @param path - 文件路径
     * @param knownBefore - 调用方已读到的内容；`null` 表示确认文件不存在
     * @returns 记录到的原内容（不存在时为空串）
     */
    private async recordWholeFileBefore(
        ctx: SettleContext,
        path: string,
        knownBefore?: string | null,
    ): Promise<string> {
        if (knownBefore !== undefined) {
            if (knownBefore === null) {
                ctx.createdFiles.push(path);
                return '';
            }
            ctx.journal.recordWholeFile(path, knownBefore);
            return knownBefore;
        }
        try {
            const fs = this.getFS();
            if (!(await fs.exists(path))) {
                ctx.createdFiles.push(path);
                return '';
            }
            const before = await fs.read(path);
            ctx.journal.recordWholeFile(path, before);
            return before;
        } catch (e) {
            log.warn('[SettlementEngine] 记录文件前值失败（将标记回滚不完整）:', path, e);
            ctx.snapshotIncomplete = true;
            return '';
        }
    }

    private async snapshotField(ctx: SettleContext, file: TFile, field: string): Promise<void> {
        if (!ctx.snapshots.has(file.path)) ctx.snapshots.set(file.path, new Map());
        if (ctx.snapshots.get(file.path)!.has(field)) return;
        let origVal: unknown = '';
        try {
            // 不做 String()：list 型字段（涉及人物/持有物品）回滚时要恢复成 list，
            // 否则 YAML 类型会从数组退化为字符串（F2）
            await this.getFrontmatter().processFrontmatter(file, (fm: FrontMatter) => { origVal = fm[field] ?? ''; });
            // 统一进 journal：失败回滚时与追加类条目一起按逆序恢复
            ctx.journal.recordField(file.path, field, origVal);
        } catch (e) {
            log.warn('[SettlementEngine] 快照失败:', e);
            this.notifier.showNotice('SettlementEngine：数据读取异常，部分功能可能受限');
        }
        ctx.snapshots.get(file.path)!.set(field, origVal);
    }

    private async restoreSnapshots(ctx: SettleContext): Promise<void> {
        for (const [filePath, fields] of ctx.snapshots) {
            const file = this.getVaultMeta().getAbstractFileByPath(filePath);
            if (!file) continue;
            try {
                await withWriteLock(filePath, () => this.getFrontmatter().processFrontmatter(file as TFile, (fm: FrontMatter) => {
                    for (const [field, value] of fields) {
                        fm[field] = value as FrontMatter[string];
                    }
                }));
            } catch (e) {
                log.warn('[SettlementEngine] 回滚失败:', filePath, e);
                this.notifier.showNotice(`⚠️ 结算回滚失败：${filePath.split('/').pop()}，数据可能处于不一致状态`, NOTICE_CRITICAL);
                ctx.rollbackFailed = true;
            }
        }
    }

    // ================================================================
    // §1-4: UPDATE_* 系列实体 frontmatter 更新
    // 共用模式：snapshot → withWriteLock → processFrontmatter → 计数++ / 失败时 hasPartialFailure=true
    // ================================================================

    /**
     * §1-4 共用的实体字段回写（v4.20 结算守卫）：
     * - 字段白名单：人物 = 旧 CHARACTER_DISPLAY_KEYS 超集 + 映射表全集；势力/地点/物品 = 映射表全集；
     *   非法字段记入 rejectedFields 聚合提示，不再静默丢弃；
     * - 目标实体文件不存在记入 missingEntities，结算结束统一提示；
     * - 链接字段（所属势力/当前位置/所属归属等）自动把实体名转 [[wiki-link]]（单侧写入，反查靠图谱）。
     */
    private async applyEntityFieldUpdate(
        ctx: SettleContext,
        category: EntityCategory,
        name: string,
        field: string,
        rawValue: string,
        resolvePath: (project: string, name: string) => string,
    ): Promise<'applied' | 'rejected' | 'missing' | 'error'> {
        const validFields = getValidFrontmatterKeys(category);
        if (!validFields.has(field)) {
            ctx.result.rejectedFields.push({ category, name, field, value: rawValue });
            return 'rejected';
        }
        const fp = resolvePath(ctx.project, name);
        const file = this.getVaultMeta().getAbstractFileByPath(fp);
        if (!(file instanceof TFile)) {
            ctx.result.missingEntities.push({ category, name, field });
            return 'missing';
        }

        // 链接字段：实体名 → [[wiki-link]]（single 取第一个；list 全量去重）
        let value: string | string[] = rawValue;
        const policy = getLinkPolicy(category, field);
        if (policy) {
            const names = parseLinkValue(rawValue);
            if (policy.cardinality === 'list') value = formatListLinkValue(names);
            else value = formatSingleLinkValue(names);
            ctx.result.linkFieldWrites++;
        }

        try {
            // P1-3（v4.27）：快照读必须与写入同锁。processFrontmatter 会写盘，
            // 若在锁外先读旧值，锁内写入前原值可能已被其他写入者改掉，回滚会写回过期值。
            await withWriteLock(fp, async () => {
                await this.snapshotField(ctx, file as TFile, field);
                // F3：写字段时总会顺带改这两个溯源字段；不快照的话回滚后
                // 「最后变更章/时间」会指向一个已被回滚的章节。
                await this.snapshotField(ctx, file as TFile, 'entity_last_changed_at');
                await this.snapshotField(ctx, file as TFile, 'entity_last_changed_chapter');
                await this.getFrontmatter().processFrontmatter(file as TFile, (fm: FrontMatter) => {
                    if (CONTINUITY_APPEND_FIELDS.has(field)) {
                        // v4.25 连续性账本：已知信息/伤势/持有物品 追加语义 + 来源章，
                        // 覆盖语义会丢历史（上一章知道的事不会因为本章更新而消失）
                        const prev = String(fm[field] || '').trim();
                        const addition = `${value}（${ctx.chapName}）`;
                        // 重复结算时同章同值不再追加（此前会写两遍「（第N章）」）
                        if (!prev.includes(addition)) {
                            fm[field] = prev ? `${prev}；${addition}` : addition;
                            ctx.journal.recordAppend(file.path, addition, field);
                        }
                    } else {
                        fm[field] = value;
                    }
                    // v4.25 溯源：任何字段都带「最后结算时间 + 来源章」，供最新优先判断
                    fm['entity_last_changed_at'] = new Date().toISOString();
                    fm['entity_last_changed_chapter'] = ctx.chapName;
                });
            });
            return 'applied';
        } catch (e) {
            const errMsg = e instanceof Error ? e.message : String(e);
            log.warn(`[SettlementEngine] 更新${category}失败:`, name, field, e);
            this.notifier.showNotice(`❌ 更新${category}「${name}」的 ${field} 失败：${errMsg}`, NOTICE_ERROR);
            ctx.hasPartialFailure = true;
            return 'error';
        }
    }

    /** §1 更新人物 frontmatter（v4.20：白名单超集 + 链接化 + 守卫） */
    private async settleStep_updateCharacters(ctx: SettleContext): Promise<void> {
        for (const u of ctx.instr.uc) {
            const outcome = await this.applyEntityFieldUpdate(ctx, 'character', u.name, u.field, u.value, pjCharFile);
            if (outcome === 'applied') {
                ctx.result.updatedChars++;
                ctx.result.chars.push(u.name);
            }
        }
    }

    /** §2 更新势力 frontmatter（v4.20：接入守卫 + 领袖字段链接化） */
    private async settleStep_updateFactions(ctx: SettleContext): Promise<void> {
        for (const u of ctx.instr.ufa) {
            const outcome = await this.applyEntityFieldUpdate(ctx, 'faction', u.name, u.field, u.value, pjFactionFile);
            if (outcome === 'applied') {
                ctx.result.updatedFactions++;
                ctx.result.factions.push(u.name);
            }
        }
    }

    /** §3 更新地点 frontmatter（v4.20：接入守卫 + 区域字段链接化） */
    private async settleStep_updateLocations(ctx: SettleContext): Promise<void> {
        for (const u of ctx.instr.uloc) {
            const outcome = await this.applyEntityFieldUpdate(ctx, 'location', u.name, u.field, u.value, pjLocFile);
            if (outcome === 'applied') {
                ctx.result.updatedLocations++;
                ctx.result.locs.push(u.name);
            }
        }
    }

    /** §4 更新物品功法 frontmatter（v4.20：接入守卫 + 所属/归属链接化，所有权单侧写入） */
    private async settleStep_updateItems(ctx: SettleContext): Promise<void> {
        for (const u of ctx.instr.uitem) {
            const outcome = await this.applyEntityFieldUpdate(ctx, 'item', u.name, u.field, u.value, pjItemFile);
            if (outcome === 'applied') {
                ctx.result.updatedItems++;
                ctx.result.items.push(u.name);
            }
        }
    }

    /** 结算守卫汇总提示（v4.20）：被拒绝/被搁置的更新一次性告知，不再静默 */
    private settleStep_reportGuards(ctx: SettleContext): void {
        if (ctx.result.rejectedFields.length > 0) {
            const samples = ctx.result.rejectedFields
                .slice(0, 3)
                .map((item) => `${item.name}·${item.field}`)
                .join('、');
            log.warn('[SettlementEngine] 字段白名单拒绝:', JSON.stringify(ctx.result.rejectedFields));
            this.notifier.showNotice(
                `⚠️ ${ctx.result.rejectedFields.length} 条更新的字段不在设定模板内被拒绝（如 ${samples}）；已计入结算结果，不写入文件`,
                NOTICE_WARNING,
            );
        }
        if (ctx.result.missingEntities.length > 0) {
            const uniqueNames = [...new Set(ctx.result.missingEntities.map((item) => `${item.category}:${item.name}`))];
            const samples = uniqueNames.slice(0, 5).join('、');
            log.warn('[SettlementEngine] 目标实体不存在:', JSON.stringify(ctx.result.missingEntities));
            this.notifier.showNotice(
                `⚠️ ${uniqueNames.length} 个实体文件不存在，${ctx.result.missingEntities.length} 条更新被搁置：${samples}。请确认实体卡是否被移动/重命名，或先由 NEW_ 指令创建`,
                NOTICE_WARNING,
            );
        }
    }

    /** §5 处理伏笔库：UPDATE_FORESHADOW + options.forceReveal 强制揭示 */
    private async settleStep_updateForeshadows(ctx: SettleContext): Promise<void> {
        const forceRevealSet = resolveForceRevealNames(ctx.instr.uf, ctx.options?.forceReveal);

        if (ctx.instr.uf.length === 0 && forceRevealSet.size === 0) return;

        const fp = pjForeshadowDB(ctx.project);
        const ff = this.getVaultMeta().getAbstractFileByPath(fp);
        if (!(ff instanceof TFile)) return;

        try {
            // v3.4.6 跨模块写入保护：伏笔库也加锁
            await withWriteLock(fp, async () => {
                let content = await this.getFS().read(fp);
                const originalContent = content;
                let changed = false;

                // v4.24 修复：旧实现遍历所有 UPDATE_FORESHADOW 并一律 move，
                // 于是「计划回收/状态」这类只改字段的指令也会把伏笔标成已回收（且不可回滚）。
                // 只对「确实要求揭示」的名字（forceRevealSet）执行移动；其余仅留日志。
                for (const name of forceRevealSet) {
                    const newContent = this.moveForeshadowToRevealed(content, name, ctx.chapName);
                    if (newContent) {
                        content = newContent;
                        changed = true;
                        ctx.result.updatedForeshadows++;
                    }
                }

                const skipped = ctx.instr.uf.filter(u => !forceRevealSet.has(u.name));
                if (skipped.length > 0) {
                    log.info('[SettlementEngine] 伏笔字段更新未做回收（仅记录，不改状态）:',
                        skipped.map(u => `${u.name}:${u.field}=${u.value}`).join('；'));
                }

                if (changed) {
                    ctx.journal.recordWholeFile(fp, originalContent);
                    await this.getFS().write(fp, content);
                }
            });
        } catch (e) { log.warn('[SettlementEngine] 更新伏笔库失败:', e); ctx.hasPartialFailure = true; }
        // D3-9：回收/揭示会改写伏笔库，显式失效台账缓存（内容 hash 之外的双保险）
        invalidateStoryLedger(ctx.project);
    }

    // ================================================================
    // §6-9: NEW_* 系列实体创建（完整模板写入 + createdFiles 记录用于回滚）
    // ================================================================

    /**
     * 伏笔闭环核对（v4.20）：章纲「伏笔操作」计划 vs 结算指令。
     * 数据级反 AI——回收/埋设不达标直接进结算提示，不靠模型自觉。
     * 核对失败不阻塞结算（旧项目没有章纲计划时只查数量）。
     */
    private async settleStep_verifyForeshadowLoop(ctx: SettleContext): Promise<void> {
        try {
            let plan: { recycle: string[]; plant: string[] } | undefined;
            const infoPlanPath = `${ctx.chapDir}/${getChapterFileName(ctx.chapName, CHAPTER_FILE_TYPES.infoPlan)}`;
            if (this.getVaultMeta().getAbstractFileByPath(infoPlanPath) instanceof TFile) {
                const raw = await this.getFS().read(infoPlanPath);
                const fields = parseInfoPlanFields(raw);
                plan = { recycle: fields.foreshadowRecycle, plant: fields.foreshadowPlant };
            }
            const check = verifyForeshadowLoop({
                updates: ctx.instr.uf,
                newForeshadows: ctx.instr.nfs.map((item) => item.name),
                plan,
            });
            ctx.result.foreshadowLoop = check;
            if (!check.pass) {
                this.notifier.showNotice(`⚠️ ${check.summary}`, NOTICE_WARNING);
            }
            log.info('[SettlementEngine]', check.summary);
        } catch (e) {
            log.warn('[SettlementEngine] 伏笔闭环核对失败:', e);
        }
    }

    /**
     * 角色按章行为摘要（v4.20）：把分析报告的 CHARACTER_BEHAVIOR 指令
     * 合并进 01-世界架构/人物/出场记录.md（按 章节+角色 去重，重跑结算覆盖旧摘要）。
     */
    private async settleStep_recordBehaviors(ctx: SettleContext): Promise<void> {
        const incoming: BehaviorRow[] = buildChapterBehaviorRows(ctx.chapName, ctx.instr.behavior || []);
        if (incoming.length === 0) return;
        const dir = entityDir(ctx.project, 'characters');
        const path = `${dir}/出场记录.md`;
        try {
            await this.getFS().mkdir(dir);
            await withWriteLock(path, async () => {
                let rows: BehaviorRow[] = [];
                let rawBefore: string | null = null;
                if (this.getVaultMeta().getAbstractFileByPath(path) instanceof TFile) {
                    rawBefore = await this.getFS().read(path);
                    rows = parseBehaviorLog(rawBefore);
                }
                const merged = mergeBehaviorRows(rows, incoming);
                await this.recordWholeFileBefore(ctx, path, rawBefore);
                await this.getFS().write(path, formatBehaviorLog(merged));
            });
            ctx.result.recordedBehaviors = incoming.length;
        } catch (e) {
            log.warn('[SettlementEngine] 记录角色行为摘要失败:', e);
        }
    }

    /** §6 创建新人物 — v1.3.2 完整模板 */
    private async settleStep_createCharacters(ctx: SettleContext): Promise<void> {
        for (const nc of ctx.instr.nc) {
            const fp = pjCharFile(ctx.project, nc.name);
            try {
                // v4.79.0（交叉审计 C-4）：存在性判断与写入同锁——并发结算不再双写同一路径，
                // 也不会各自登记 createdFiles 导致一方回滚时删掉另一方合法新建的文件。
                const created = await withWriteLock(fp, async () => {
                    if (this.getVaultMeta().getAbstractFileByPath(fp)) return false;
                    await this.getFS().mkdir(entityDir(ctx.project, 'characters'));
                const content = `---
tags: [人物, nw/实体/人物]
姓名: ${nc.name}
年龄: 
身份: 
人物背景: 
外貌特征: 
当前目标: 
核心动机: 
核心驱动力_软肋: 
习惯性小动作: 
当前状态: 初次登场
当前情绪: 
性格标签: 
金手指/特殊能力: 
功法/技能树: 
所属势力: 
---

# ${nc.name}

${nc.description || '暂无描述'}

## 确定性设定（已揭露，不可违背）
- 外貌：
- 核心性格：
- 关键背景：

## 不确定性（未解之谜 / 角色弧光）
- 内心矛盾：
- 隐藏秘密：
- 未来可能的成长方向：

## 与其他角色的互信息

## 自信息事件储备（低概率但合理的惊喜行为）
- 可能做出的出人意料举动：
- 在极端压力下的可能反应：

## 功法/技能树
- 修为：
- 武技：
- 法术：

## 变更记录
- ${ctx.chapName} | 首次登场 | ${nc.description || '新角色登场'} | 由分析报告自动创建
`;
                    await this.getFS().write(fp, content);
                    return true;
                });
                if (!created) continue;
                ctx.createdFiles.push(fp);
                ctx.result.createdChars++;
                ctx.result.chars.push(nc.name);
            } catch (e) { const errMsg = e instanceof Error ? e.message : String(e); log.warn('[SettlementEngine] 新建人物失败:', nc.name, e); this.notifier.showNotice(`❌ 新建人物「${nc.name}」失败：${errMsg}`, NOTICE_ERROR); ctx.hasPartialFailure = true; }
        }
    }

    /** §7 创建新地点 — v1.3.2 完整模板 */
    private async settleStep_createLocations(ctx: SettleContext): Promise<void> {
        for (const nl of ctx.instr.nl) {
            const fp = pjLocFile(ctx.project, nl.name);
            try {
                // v4.79.0（交叉审计 C-4）：存在性判断与写入同锁——并发结算不再双写同一路径，
                // 也不会各自登记 createdFiles 导致一方回滚时删掉另一方合法新建的文件。
                const created = await withWriteLock(fp, async () => {
                    if (this.getVaultMeta().getAbstractFileByPath(fp)) return false;
                    await this.getFS().mkdir(entityDir(ctx.project, 'locations'));
                const content = `---
tags: [地点, nw/实体/地点]
名称: ${nl.name}
别称: 
类型: 
所在世界/区域: 
描述: 
重要程度: 
地理特征: 
主要居民/势力: 
---

# ${nl.name}

${nl.description || '暂无描述'}

## 确定性设定（已揭露，不可违背）

## 不确定性（未解之谜 / 剧情潜力）

## 与其他元素的互信息

## 自信息事件储备（低概率但合理的剧情发展）

## 变更记录
- ${ctx.chapName} | 首次登场 | ${nl.description || '新地点'} | 由分析报告自动创建
`;
                    await this.getFS().write(fp, content);
                    return true;
                });
                if (!created) continue;
                ctx.createdFiles.push(fp);
                ctx.result.createdLocs++;
                ctx.result.locs.push(nl.name);
            } catch (e) { const errMsg = e instanceof Error ? e.message : String(e); log.warn('[SettlementEngine] 新建地点失败:', nl.name, e); this.notifier.showNotice(`❌ 新建地点「${nl.name}」失败：${errMsg}`, NOTICE_ERROR); ctx.hasPartialFailure = true; }
        }
    }

    /** §8 创建新势力 — v1.3.2 完整模板 */
    private async settleStep_createFactions(ctx: SettleContext): Promise<void> {
        for (const nf of ctx.instr.nf) {
            const fp = pjFactionFile(ctx.project, nf.name);
            try {
                // v4.79.0（交叉审计 C-4）：存在性判断与写入同锁——并发结算不再双写同一路径，
                // 也不会各自登记 createdFiles 导致一方回滚时删掉另一方合法新建的文件。
                const created = await withWriteLock(fp, async () => {
                    if (this.getVaultMeta().getAbstractFileByPath(fp)) return false;
                    await this.getFS().mkdir(entityDir(ctx.project, 'factions'));
                const content = `---
tags: [势力, nw/实体/势力]
名称: ${nf.name}
别称: 
类型: 
描述: 
领袖: 
地位/排名: 
---

# ${nf.name}

${nf.description || '暂无描述'}

## 确定性设定（已揭露，不可违背）

## 不确定性（未解之谜 / 剧情潜力）

## 与其他元素的互信息

## 自信息事件储备（低概率但合理的剧情发展）

## 变更记录
- ${ctx.chapName} | 首次登场 | ${nf.description || '新势力'} | 由分析报告自动创建
`;
                    await this.getFS().write(fp, content);
                    return true;
                });
                if (!created) continue;
                ctx.createdFiles.push(fp);
                ctx.result.createdFactions++;
                ctx.result.factions.push(nf.name);
            } catch (e) { const errMsg = e instanceof Error ? e.message : String(e); log.warn('[SettlementEngine] 新建势力失败:', nf.name, e); this.notifier.showNotice(`❌ 新建势力「${nf.name}」失败：${errMsg}`, NOTICE_ERROR); ctx.hasPartialFailure = true; }
        }
    }

    /** §9 创建新物品功法 — v1.3.2 完整模板 */
    private async settleStep_createItems(ctx: SettleContext): Promise<void> {
        for (const ni of ctx.instr.ni) {
            const fp = pjItemFile(ctx.project, ni.name);
            try {
                // v4.79.0（交叉审计 C-4）：存在性判断与写入同锁——并发结算不再双写同一路径，
                // 也不会各自登记 createdFiles 导致一方回滚时删掉另一方合法新建的文件。
                const created = await withWriteLock(fp, async () => {
                    if (this.getVaultMeta().getAbstractFileByPath(fp)) return false;
                    await this.getFS().mkdir(entityDir(ctx.project, 'items'));
                const content = `---
tags: [物品功法, nw/实体/物品]
名称: ${ni.name}
类型: 
品阶/等级: 
描述: 
效果: 
所属/归属: 
当前状态: 
---

# ${ni.name}

${ni.description || '暂无描述'}

## 确定性设定（已揭露，不可违背）

## 不确定性（未解之谜 / 剧情潜力）

## 与其他元素的互信息

## 自信息事件储备（低概率但合理的剧情发展）

## 变更记录
- ${ctx.chapName} | 首次登场 | ${ni.description || '新物品/功法'} | 由分析报告自动创建
`;
                    await this.getFS().write(fp, content);
                    return true;
                });
                if (!created) continue;
                ctx.createdFiles.push(fp);
                ctx.result.createdItems++;
                ctx.result.items.push(ni.name);
            } catch (e) { const errMsg = e instanceof Error ? e.message : String(e); log.warn('[SettlementEngine] 新建物品功法失败:', ni.name, e); this.notifier.showNotice(`❌ 新建物品功法「${ni.name}」失败：${errMsg}`, NOTICE_ERROR); ctx.hasPartialFailure = true; }
        }
    }

    /** §10 新增伏笔到伏笔库「未回收伏笔」表格 — 表头感知（ledger-write） */
    private async settleStep_createForeshadows(ctx: SettleContext): Promise<void> {
        for (const nf of ctx.instr.nfs) {
            try {
                const fp = pjForeshadowDB(ctx.project);
                // S-1（v4.27）：伏笔库读-检查-写整段进锁
                // v4.39：文件是否存在也必须在锁内判断，避免锁外读到「不存在」后覆盖刚建好的库
                let created = false;
                await withWriteLock(fp, async () => {
                    const fresh = this.getVaultMeta().getAbstractFileByPath(fp);
                    const exists = fresh instanceof TFile;
                    const c = exists ? await this.getFS().read(fp) : '';
                    const written = appendForeshadowToContent(c, {
                        name: nf.name,
                        buryChapter: nf.chapter || ctx.chapName,
                        plannedReveal: nf.reveal || '待定',
                        relatedChars: nf.relatedChars || '',
                        mainline: nf.relatedPlotline || '',
                    });
                    if (!written.changed) {
                        if (written.reason === 'no-table') {
                            // D3-9：缺少「未回收伏笔」表格时新伏笔会被静默丢弃，必须可见
                            log.warn('[SettlementEngine] 伏笔库缺少未回收表格，新增伏笔未写入:', nf.name);
                            this.markPostStepFailure(ctx, '伏笔库结构');
                            return;
                        }
                        log.info('[SettlementEngine] 伏笔已存在，跳过:', nf.name);
                        return;
                    }
                    if (exists) ctx.journal.recordWholeFile(fp, c);
                    else ctx.createdFiles.push(fp);
                    if (!exists) await this.getFS().mkdir(pjTimelineDir(ctx.project)).catch(() => {});
                    await this.getFS().write(fp, written.content);
                    created = true;
                });
                if (created) ctx.result.createdForeshadows++;
            } catch (e) { log.warn('[SettlementEngine] 追加伏笔失败:', e); this.notifier.showNotice('[SettlementEngine] 数据操作失败，部分功能可能受限'); ctx.hasPartialFailure = true; }
        }
        invalidateStoryLedger(ctx.project);
    }

    /** §11 新增时间线事件 — v1.3.1 区分背景纪元/主线纪元 */
    private async settleStep_createTimelines(ctx: SettleContext): Promise<void> {
        for (const nt of ctx.instr.nt) {
            const tlPath = pjTimelineBoard(ctx.project);
            try {
                // 时间线看板有三个写入方（结算/分析报告/关联索引），此前的幂等守卫只防重复，
                // 不防并发覆盖：必须整段加锁，并在锁内重读最新内容再做幂等比对。
                const appended = await withWriteLock(tlPath, async () => {
                const tlF = this.getVaultMeta().getAbstractFileByPath(tlPath);
                const previous = tlF instanceof TFile ? await this.getFS().read(tlPath) : '';
                const isBackground = /背景纪元|纪元前|年前|上古|远古|传说|肇始/.test(nt.desc);
                const written = appendEventToContent(previous, {
                    name: nt.event,
                    time: nt.desc,
                    chapterKey: ctx.chapName,
                    era: isBackground ? 'background' : 'main',
                    importance: 'medium',
                    source: 'settlement',
                });
                if (!written.changed) {
                    if (written.reason === 'no-table') {
                        // D3-9：缺少时间线表格时新事件会被静默丢弃，必须可见
                        log.warn('[SettlementEngine] 时间线看板缺少表格，新增事件未写入:', nt.desc, nt.event);
                        this.markPostStepFailure(ctx, '时间线看板结构');
                        return false;
                    }
                    log.info('[SettlementEngine] 时间线事件已存在，跳过:', nt.desc, nt.event);
                    return false;
                }
                if (tlF instanceof TFile) ctx.journal.recordWholeFile(tlPath, previous);
                else ctx.createdFiles.push(tlPath);
                if (!(tlF instanceof TFile)) await this.getFS().mkdir(pjTimelineDir(ctx.project)).catch(() => {});
                await this.getFS().write(tlPath, written.content);
                return true;
                });
                if (appended) ctx.result.createdTimelines++;
            } catch (e) { log.warn('[SettlementEngine] 追加时间线失败:', e); this.notifier.showNotice('[SettlementEngine] 数据操作失败，部分功能可能受限'); ctx.hasPartialFailure = true; }
        }
        invalidateStoryLedger(ctx.project);
    }

    /** §12 更新实体关系 — 写入双方实体的互信息章节（v1.3.0） */
    private async settleStep_updateRelations(ctx: SettleContext): Promise<void> {
        for (const r of ctx.instr.rel) {
            try {
                await this.updateRelation(ctx.project, r.entityA, r.entityB, r.relType, r.desc, ctx.chapName, ctx.journal);
                ctx.result.updatedRelations++;
            } catch (e) { log.warn('[SettlementEngine] 更新关系失败:', r.entityA, r.entityB, e); ctx.hasPartialFailure = true; }
        }
    }

    /** §13 更新人物成长（v1.3.0） */
    private async settleStep_updateGrowth(ctx: SettleContext): Promise<void> {
        for (const g of ctx.instr.growth) {
            try {
                const fp = pjCharFile(ctx.project, g.name);
                const file = this.getVaultMeta().getAbstractFileByPath(fp);
                if (!(file instanceof TFile)) continue;
                const growthEntry = `- ${ctx.chapName} | ${g.type} | ${g.value} | ${g.desc}\n`;
                // 重复结算会重复 append 成长行：按「章 + 类型 + 新值」去重，且整段读改写加锁
                const dedupeKey = `- ${ctx.chapName} | ${g.type} | ${g.value} |`;
                const appended = await withWriteLock(fp, async () => {
                    let content = await this.getFS().read(fp);
                    if (content.includes(dedupeKey)) return false;
                    // 在「变更记录」区块末尾追加
                    if (content.includes('## 变更记录')) {
                        const idx = content.lastIndexOf('## 变更记录');
                        const afterHeader = content.indexOf('\n', idx);
                        content = content.slice(0, afterHeader + 1) + growthEntry + content.slice(afterHeader + 1);
                    } else {
                        content += `\n## 变更记录\n${growthEntry}`;
                    }
                    // D3-15：先登记 marker 再写盘；写一半失败也能按标记回滚
                    ctx.journal.recordAppend(fp, growthEntry.trim());
                    await this.getFS().write(fp, content);
                    return true;
                });
                if (appended) {
                    ctx.result.updatedGrowth++;
                }
            } catch (e) { log.warn('[SettlementEngine] 更新成长失败:', g.name, e); ctx.hasPartialFailure = true; }
        }
    }

    /** §14 更新人物情绪状态（v1.3.0） */
    private async settleStep_updateEmotions(ctx: SettleContext): Promise<void> {
        for (const e of ctx.instr.emotion) {
            try {
                const fp = pjCharFile(ctx.project, e.name);
                const file = this.getVaultMeta().getAbstractFileByPath(fp);
                if (!file) continue;
                // D-6（2026-11-10 审计）：情绪四字段此前不进 journal——部分失败回滚
                // 时人物卡停在半失败态。与正文步骤同模式：快照读与写入同锁。
                // item6-a（同日审计）：entity_last_changed_at 统一 ISO 语义，
                // 章名写入 entity_last_changed_chapter（与 §4 主路径 800-801 行对齐）。
                await withWriteLock(fp, async () => {
                    await this.snapshotField(ctx, file as TFile, '当前情绪');
                    await this.snapshotField(ctx, file as TFile, 'entity_status');
                    await this.snapshotField(ctx, file as TFile, 'entity_last_changed_at');
                    await this.snapshotField(ctx, file as TFile, 'entity_last_changed_chapter');
                    await this.snapshotField(ctx, file as TFile, 'entity_last_changed_reason');
                    await this.getFrontmatter().processFrontmatter(file as TFile, (fm: FrontMatter) => {
                        fm['当前情绪'] = e.emotion;
                        // v4.0: 实体状态追踪
                        if (fm['entity_status'] == null || fm['entity_status'] === '') fm['entity_status'] = 'active';
                        fm['entity_last_changed_at'] = new Date().toISOString();
                        fm['entity_last_changed_chapter'] = ctx.chapName;
                        fm['entity_last_changed_reason'] = `结算：情绪更新为${e.emotion}`;
                    });
                });
                ctx.result.updatedEmotions++;
            } catch (err) { log.warn('[SettlementEngine] 更新情绪失败:', e.name, err); ctx.hasPartialFailure = true; }
        }
    }

    /**
     * §15 回写正文 frontmatter：涉及人物、地点、势力、物品功法
     * v3.4.9: 改用 getChapterFile(TFolder) 与 restoreChapterState 统一查找逻辑
     * v4.0: chapDir = 步骤结果/第X卷/第Y章；正文位于 正文/第X卷/第Y章_正文.md
     */
    private async settleStep_updateBodyFrontmatter(ctx: SettleContext): Promise<void> {
        let bodyFile: TFile | null = null;
        const v4Match = ctx.chapDir.match(/^(.+?)\/03-大纲与章节\/步骤结果\/第(\d+)卷\/第(\d+)章$/);
        if (v4Match) {
            const v4Proj = v4Match[1];
            const v4VolN = parseInt(v4Match[2], 10);
            const v4ChapN = parseInt(v4Match[3], 10);
            // v4.25：与落盘一致——优先命中「带章名」的现有章文件。
            // 旧实现固定 pjBodyFile 无章名路径：同章存在遗留裸文件时，
            // settled/涉及人物会写到裸文件，真章文件永远停在 pending。
            const existingBody = findBodyFileByChapterNum(
                listFolderFiles<TFile>(this.getVaultMeta(), pjBodyDir(v4Proj, v4VolN)),
                `${pjBodyDir(v4Proj, v4VolN)}/`,
                v4ChapN,
                chapterNameOf(ctx),
            );
            const tf = existingBody ?? this.getVaultMeta().getAbstractFileByPath(pjBodyFile(v4Proj, v4VolN, v4ChapN));
            if (tf instanceof TFile) {
                bodyFile = tf;
            } else {
                // 兜底：在该卷正文目录里查找含「第N章_正文」的文件
                const dir = this.getVaultMeta().getAbstractFileByPath(pjBodyDir(v4Proj, v4VolN));
                if (dir instanceof TFolder) {
                    const files = await this.getFS().listFiles(pjBodyDir(v4Proj, v4VolN));
                    for (const child of files) {
                        if (child.name.startsWith(`第${v4ChapN}章`) && child.name.includes('正文')) {
                            bodyFile = child;
                            break;
                        }
                    }
                }
            }
        } else {
            // 回退到旧逻辑（兼容仍以章节目录传入的调用方）
            const chapFolder = this.getVaultMeta().getAbstractFileByPath(ctx.chapDir);
            bodyFile = chapFolder instanceof TFolder ? (getChapterFile(chapFolder, '正文') as TFile | null) : null;
        }
        if (!bodyFile) return;
        try {
            const allCharNames = [...new Set([...ctx.instr.uc.map(c => c.name), ...ctx.instr.nc.map(c => c.name)])];
            const allLocNames = ctx.instr.nl.map(l => l.name);
            const allFactionNames = ctx.instr.nf.map(f => f.name);
            const allItemNames = ctx.instr.ni.map(i => i.name);
            const human = (ctx.bodyText || ctx.result.chars?.length)
                ? evaluateHumanFeatures(ctx.bodyText || '')
                : null;
            const humanApplies = !!human && human.metrics.chars >= 500;

            // 回滚快照：正文 status/涉及* 是结算的核心产物，旧实现没进 journal，
            // 部分失败时正文会永久停在 settled（实测 G7-6）。
            // P1-3（v4.27）：快照与写入同锁，避免快照读到后被并发写入改掉。
            await withWriteLock(bodyFile.path, async () => {
                await this.snapshotField(ctx, bodyFile, 'status');
                if (allCharNames.length > 0) await this.snapshotField(ctx, bodyFile, '涉及人物');
                if (allLocNames.length > 0) await this.snapshotField(ctx, bodyFile, '涉及地点');
                if (allFactionNames.length > 0) await this.snapshotField(ctx, bodyFile, '涉及势力');
                if (allItemNames.length > 0) await this.snapshotField(ctx, bodyFile, '涉及物品功法');
                if (humanApplies) {
                    for (const key of ['对话占比', '口语密度', '时间锚点', '人味分']) {
                        await this.snapshotField(ctx, bodyFile, key);
                    }
                }

                await this.getFrontmatter().processFrontmatter(bodyFile as TFile, (fm: FrontMatter) => {
                    // v4.0: 结算完成 → settled（旧值 '已完稿' 保留兼容）
                    fm['status'] = 'settled';
                    if (allCharNames.length > 0) {
                        fm['涉及人物'] = allCharNames;
                    }
                    if (allLocNames.length > 0) {
                        fm['涉及地点'] = allLocNames;
                    }
                    if (allFactionNames.length > 0) {
                        fm['涉及势力'] = allFactionNames;
                    }
                    if (allItemNames.length > 0) {
                        fm['涉及物品功法'] = allItemNames;
                    }

                    // v4.23：人味指标回写（对话占比/口语密度/时间锚点/人味分），
                    // 让「这一章像不像人写」变成可追踪的数据，而不是每次凭感觉。
                    if (human && humanApplies) {
                        fm['对话占比'] = Math.round(human.metrics.dialogueRatio * 1000) / 1000;
                        fm['口语密度'] = Math.round(human.metrics.colloquialPerKilo * 10) / 10;
                        fm['时间锚点'] = human.metrics.timeAnchors;
                        fm['人味分'] = Math.round(human.score * 100);
                    }
                });
            });
        } catch (e) {
            // F3：正文 frontmatter 是结算核心产物，写失败必须进入 partial 并触发回滚；
            // 旧实现只提示，实体更新保留而正文停在 written，协调器仍写「已完成」结算表。
            ctx.hasPartialFailure = true;
            log.warn('[SettlementEngine] body frontmatter回写失败:', e);
            this.notifier.showNotice('⚠️ 章节 frontmatter 回写失败：涉及人物/地点/势力/物品字段可能未更新', NOTICE_ERROR);
        }
    }

    /** §16 删除实体（v1.4.0 — 连贯性审查后的清理） */
    private async settleStep_deleteEntities(ctx: SettleContext): Promise<void> {
        for (const d of ctx.instr.del) {
            await this.deleteEntity(ctx, d.entityType, d.entityName);
        }
    }

    /**
     * 汇总同步部分：去重统计 / 计算 result.updated 与 result.created。
     * 不能 async，因为我们后续在 settleStep_finalizeRollback 中读 hasPartialFailure 决定是否回滚。
     */
    private settleStep_aggregateAndMaybeRollback(ctx: SettleContext): void {
        ctx.result.updated = ctx.result.updatedChars + ctx.result.updatedForeshadows + ctx.result.updatedFactions + ctx.result.updatedLocations + ctx.result.updatedItems + ctx.result.updatedRelations + ctx.result.updatedGrowth + ctx.result.updatedEmotions;
        ctx.result.created = ctx.result.createdChars + ctx.result.createdLocs + ctx.result.createdFactions + ctx.result.createdItems + ctx.result.createdForeshadows + ctx.result.createdTimelines;
        ctx.result.chars = [...new Set(ctx.result.chars)];
        ctx.result.locs = [...new Set(ctx.result.locs)];
        ctx.result.factions = [...new Set(ctx.result.factions)];
        ctx.result.items = [...new Set(ctx.result.items)];
    }

    /**
     * 回滚阶段：hasPartialFailure 时恢复 snapshots + 删除 createdFiles + 清零 updated 计数；
     * rollbackFailed 时通知用户存在脏态。
     */
    private async settleStep_finalizeRollback(ctx: SettleContext): Promise<void> {
        if (ctx.hasPartialFailure) {
            const journalSize = ctx.journal.size;
            if (journalSize > 0) {
                log.warn(`[SettlementEngine] 检测到部分失败，按 journal 回滚 ${journalSize} 条`);
                // v4.39：回滚的每个读/写都按文件加锁，避免与协同保存/其它结算交错写同一文件。
                const fsPort = {
                    read: (p: string) => withWriteLock(p, () => this.getFS().read(p)),
                    write: (p: string, content: string) => withWriteLock(p, () => this.getFS().write(p, content)),
                    exists: (p: string) => this.getFS().exists(p),
                };
                const fmPort = {
                    readField: async (path: string, field: string): Promise<string> => withWriteLock(path, async () => {
                        const file = this.getVaultMeta().getAbstractFileByPath(path);
                        if (!(file instanceof TFile)) return '';
                        let value = '';
                        await this.getFrontmatter().processFrontmatter(file, (fm: FrontMatter) => {
                            value = String(fm[field] ?? '');
                        });
                        return value;
                    }),
                    restoreField: async (path: string, field: string, value: unknown): Promise<void> => withWriteLock(path, async () => {
                        const file = this.getVaultMeta().getAbstractFileByPath(path);
                        if (!(file instanceof TFile)) return;
                        await this.getFrontmatter().processFrontmatter(file, (fm: FrontMatter) => {
                            fm[field] = value as FrontMatter[string];
                        });
                    }),
                };
                const report = await ctx.journal.rollback(fsPort, fmPort);
                ctx.result.rollback = { reverted: report.reverted, failed: report.failed };
                if (report.failed > 0) ctx.rollbackFailed = true;
                // 快照读取失败过 → 无法保证恢复完整性，按回滚不完整处理（可见化）
                if (ctx.snapshotIncomplete) ctx.rollbackFailed = true;
            }

            // 清理 NEW 操作创建的文件
            for (const fp of ctx.createdFiles) {
                try {
                    await withWriteLock(fp, () => this.getFS().delete(fp));
                } catch (e) {
                    log.warn('[SettlementEngine] 清理新建文件失败:', fp, e);
                }
            }

            // 将 updated / created 计数清零（已回滚，否则结算表仍会报「新建 N 项」）
            ctx.result.updated = 0;
            ctx.result.created = 0;
            ctx.result.createdChars = 0;
            ctx.result.createdLocs = 0;
            ctx.result.createdFactions = 0;
            ctx.result.createdItems = 0;
            ctx.result.createdForeshadows = 0;
            ctx.result.createdTimelines = 0;
            ctx.result.updatedChars = 0;
            ctx.result.updatedFactions = 0;
            ctx.result.updatedLocations = 0;
            ctx.result.updatedItems = 0;
            ctx.result.updatedRelations = 0;
            ctx.result.updatedGrowth = 0;
            ctx.result.updatedEmotions = 0;
        }

        // R3-3: 回滚失败 → 标记 settlement_partial，产物可自证「数据可能半改半回滚」
        if (ctx.rollbackFailed) {
            ctx.result.settlementPartial = true;
            this.notifier.showNotice(
                '⚠️ 结算回滚不完整！部分文件未能恢复，产物已标记 settlement_partial，请用章节版本历史手动核对',
                10000,
            );
        }
    }

    /**
     * V2 关系状态更新（独立通道，无快照参与）：
     * 从分析报告 extractRelationshipChanges 提取，写回 关系状态.md。
     * 与 V1 的 instr.rel 通道并行，最终 result.updatedRelations 取两路较大值（避免重复计数）。
     */
    private async settleStep_updateV2Relations(ctx: SettleContext): Promise<void> {
        let v2RelationCount = 0;
        try {
            const reportChanges = extractRelationshipChanges(ctx.report);
            const pending = await loadPendingRelationshipChanges(this.app, ctx.project);
            const changes = [
                ...reportChanges,
                ...pending.map((change) => ({
                    charA: change.charA,
                    charB: change.charB,
                    dimension: change.dimension,
                    delta: change.delta,
                    reason: change.reason,
                    chapter: change.chapter,
                    source: 'explicit' as const,
                })),
            ];
            if (changes.length > 0) {
                // P1-3 遗留：关系状态.md 是整表覆盖写，load→apply→save 必须同锁，
                // 否则并发结算会用旧快照覆盖对方刚写入的关系条目。
                await withWriteLock(getRelationshipFilePath(ctx.project), async () => {
                    const relations = await loadRelationshipStates(this.app, ctx.project);
                    const outcome = applyRelationshipChanges(relations, changes, ctx.chapName);
                    // 关系状态是整表覆盖写入：先记整文件前值，失败时可整体恢复
                    await this.recordWholeFileBefore(ctx, getRelationshipFilePath(ctx.project));
                    await saveRelationshipStates(this.app, ctx.project, outcome.relations, ctx.chapName);
                    v2RelationCount = outcome.applied;
                    if (outcome.skipped > 0) {
                        log.info(`[SettlementEngine] V2 关系幂等跳过 ${outcome.skipped} 条（同章同原因，重跑结算不二次累加）`);
                    }
                });
                // 队列已成功写入权威文件后清空；保存失败会走 catch，队列保留可重试
                if (pending.length > 0) {
                    await consumePendingRelationshipChanges(this.app, ctx.project);
                }
                log.info(`[SettlementEngine] V2 关系更新: ${v2RelationCount}/${changes.length} 条变更已写入关系状态.md`);
            }
        } catch (e) {
            log.warn('[SettlementEngine] V2 关系状态更新失败（已跳过）:', e);
            this.markPostStepFailure(ctx, '关系状态');
            this.notifier.showNotice('⚠️ 关系状态更新失败，但不影响其他结算步骤。', NOTICE_ERROR);
        }
        // 合计（V1+V2 避免重复——V2 解析器可能捕获与 V1 相同的 RELATION 行）
        ctx.result.updatedRelations = Math.max(ctx.result.updatedRelations, v2RelationCount);
    }


    // ================================================================
    // 指令解析（parseReport）已外迁至 ./settlement/report-parser.ts
    // ================================================================

    // ================================================================
    // 伏笔库双表操作（v1.4.0 统一为 8 列表头）
    //   未回收伏笔: | # | 伏笔名称 | 重要程度 | 埋设章节 | 计划回收 | 相关人物 | 关联主线 | 当前状态 |
    //   已回收伏笔: | # | 伏笔名称 | 重要程度 | 埋设章节 | 相关人物 | 关联主线 | 回收章节 | 回收方式 |
    // ================================================================

    /** 将伏笔从未回收表移到已回收表（表头感知，见 ledger-write） */
    private moveForeshadowToRevealed(content: string, name: string, chapName: string): string | null {
        const result = moveForeshadowToRevealedInContent(content, name, chapName);
        return result.changed ? result.content : null;
    }

    /**
     * appendAfterSectionHeader / renumberTable / getNextRowNumInSection
     * 已外迁至 ./settlement/markdown-table-utils.ts
     */

    // ================================================================
    // 双向关系更新（v1.3.0 新增，对齐 shared_utils.js updateRelation）
    // ================================================================
    private async updateRelation(
        project: string,
        entityA: string,
        entityB: string,
        relType: string,
        desc: string,
        chapName: string,
        journal?: SettlementJournal
    ): Promise<void> {
        const entry = `- [[${entityB}]] | ${relType} | ${desc} | ${chapName}`;
        const entryB = `- [[${entityA}]] | ${relType} | ${desc} | ${chapName}`;

        // 更新实体A
        const candidatesA = this.findEntityFiles(project, entityA);
        if (candidatesA.length > 0) {
            await this.appendToMutualSection(candidatesA[0], entry, journal);
        }
        // 更新实体B
        const candidatesB = this.findEntityFiles(project, entityB);
        if (candidatesB.length > 0) {
            await this.appendToMutualSection(candidatesB[0], entryB, journal);
        }
    }

    /** 在实体文件中查找实体 */
    private findEntityFiles(project: string, name: string): TFile[] {
        const checks = [
            pjCharFile(project, name),
            pjFactionFile(project, name),
            pjLocFile(project, name),
            pjItemFile(project, name)
        ];
        const results: TFile[] = [];
        for (const fp of checks) {
            const file = this.getVaultMeta().getAbstractFileByPath(fp);
            if (file) results.push(file as TFile);
        }
        return results;
    }

    /** 在实体文件的「互信息」区块追加条目 */
    private async appendToMutualSection(file: TFile, entry: string, journal?: SettlementJournal): Promise<void> {
        try {
            // 实体卡被结算/分析报告/实体管理多处读改写：整段加锁并在锁内重读
            await withWriteLock(file.path, async () => {
            let content = await this.getFS().read(file.path);
            // 互信息只是「人读日志」，关系权威源是 关系状态.md（见 docs/design/g1-authority-decisions.md）。
            // 按整行去重：重复结算不再堆同一行，避免实体卡无限增长。
            const normalizedEntry = entry.trim();
            const alreadyLogged = content.split('\n').some(line => line.trim() === normalizedEntry);
            if (alreadyLogged) return;
            if (content.includes('## 与其他元素的互信息')) {
                const idx = content.lastIndexOf('## 与其他元素的互信息');
                const afterHeader = content.indexOf('\n', idx);
                content = content.slice(0, afterHeader + 1) + entry + '\n' + content.slice(afterHeader + 1);
            } else if (content.includes('## 与其他角色的互信息')) {
                const idx = content.lastIndexOf('## 与其他角色的互信息');
                const afterHeader = content.indexOf('\n', idx);
                content = content.slice(0, afterHeader + 1) + entry + '\n' + content.slice(afterHeader + 1);
            }
            // D3-15：先登记再写，写一半失败也能回滚
            journal?.recordAppend(file.path, entry.trim());
            await this.getFS().write(file.path, content);
            });
        } catch (e) { log.warn('[SettlementEngine] 追加互信息失败:', file.path, e); }
    }

    // ================================================================
    // 实体删除 — v1.4.0 新增, 对齐 shared_utils.js confirmDelete 三重确认
    // ================================================================
    private async deleteEntity(ctx: SettleContext, entityType: string, entityName: string): Promise<void> {
        const project = ctx.project;
        try {
            if (entityType === '人物') {
                const fp = pjCharFile(project, entityName);
                // v4.79.0（交叉审计 ②）：删除前把整文件前值记入 journal——否则部分失败回滚后文件永久消失
                await withWriteLock(fp, async () => {
                    const file = this.getVaultMeta().getAbstractFileByPath(fp);
                    if (!(file instanceof TFile)) return;
                    const content = await this.getFS().read(fp);
                    if (content.includes(entityName)) {  // 三重确认: 文件名匹配 + 内容匹配
                        ctx.journal.recordWholeFile(fp, content);
                        await this.getFS().delete(fp);
                        log.info(`[SettlementEngine] 删除人物: ${entityName}`);
                    }
                });
            } else if (entityType === '伏笔') {
                const fp = pjForeshadowDB(project);
                const ff = this.getVaultMeta().getAbstractFileByPath(fp);
                if (ff instanceof TFile) {
                    // P1-3 遗留：删行也是读-改-写，锁内重读可避免把并发新增的伏笔行一起覆盖掉
                    await withWriteLock(fp, async () => {
                        const fc = await this.getFS().read(fp);
                        const lines = fc.split('\n');
                        const targetIdx = lines.findIndex(line =>
                            line.startsWith('|') && line.includes(`| ${entityName} |`)
                        );
                        if (targetIdx !== -1) {
                            ctx.journal.recordWholeFile(fp, fc);
                            lines.splice(targetIdx, 1);
                            await this.getFS().write(fp, lines.join('\n'));
                            log.info(`[SettlementEngine] 从伏笔库删除: ${entityName}`);
                        }
                    });
                }
            } else if (entityType === '时间线') {
                const fp = pjTimelineBoard(project);
                const ff = this.getVaultMeta().getAbstractFileByPath(fp);
                if (ff instanceof TFile) {
                    // P1-3 遗留：同上，时间线看板删行与结算/分析报告追加共用一把锁
                    await withWriteLock(fp, async () => {
                        const fc = await this.getFS().read(fp);
                        const lines = fc.split('\n');
                        const targetIdx = lines.findIndex(line =>
                            line.startsWith('|') && line.includes(entityName)
                        );
                        if (targetIdx !== -1) {
                            ctx.journal.recordWholeFile(fp, fc);
                            lines.splice(targetIdx, 1);
                            await this.getFS().write(fp, lines.join('\n'));
                        }
                    });
                }
            } else if (entityType === '地点') {
                await this.deleteEntityFileWithJournal(ctx, pjLocFile(project, entityName));
            } else if (entityType === '势力') {
                await this.deleteEntityFileWithJournal(ctx, pjFactionFile(project, entityName));
            } else if (entityType === '物品' || entityType === '设定') {
                await this.deleteEntityFileWithJournal(ctx, pjItemFile(project, entityName));
            }
        } catch (e) { log.warn('[SettlementEngine] 删除实体失败:', entityType, entityName, e); ctx.hasPartialFailure = true; }
    }

    /**
     * 删除实体文件：锁内读前值 → journal → 删除（回滚可重建）。
     *
     * @param ctx - 结算上下文
     * @param path - 实体文件路径
     */
    private async deleteEntityFileWithJournal(ctx: SettleContext, path: string): Promise<void> {
        await withWriteLock(path, async () => {
            const file = this.getVaultMeta().getAbstractFileByPath(path);
            if (!file) return;
            const content = await this.getFS().read(path);
            ctx.journal.recordWholeFile(path, content);
            await this.getFS().delete(path);
        });
    }

    // ================================================================
    // 信息债看板完整刷新（v1.3.1 重写，对齐 shared_utils.js refreshInfoDebt）
    // ================================================================
    private async refreshInfoDebt(project: string): Promise<void> {
        try {
            const charFiles = listEntityFiles(this.app, project, 'characters');
            const chapFiles = listFolderFiles<TFile>(this.getVaultMeta(), pjOutlineDir(project), { recursive: true })
                .filter(f => f.name.includes('正文'));

            // 1. 伏笔统计（遍历两表）
            let unrevealed = 0, revealed = 0, abandoned = 0;
            try {
                const fsFile = this.getVaultMeta().getAbstractFileByPath(pjForeshadowDB(project));
                if (fsFile instanceof TFile) {
                    const content = await this.getFS().read(pjForeshadowDB(project));
                    for (const line of content.split('\n')) {
                        if (!line.match(/^\|.*\|/)) continue;
                        const cols = splitTableCells(line);
                        if (cols.length === 0) continue;
                        if (cols[0] === '#' || cols[0].includes('---') || cols[0] === '伏笔') continue;
                        const state = parseForeshadowRevealState(cols[cols.length - 1]);
                        if (state === 'unrevealed') unrevealed++;
                        else if (state === 'revealed') revealed++;
                        else abandoned++;
                    }
                }
            } catch (e) { log.warn('[SettlementEngine] 伏笔统计失败:', e); }

            // 2. 章节进度
            const chapCount = chapFiles.length;
            const completedChaps = new Set<string>();
            for (const f of chapFiles) {
                try {
                    const cache = this.app.metadataCache.getFileCache(f);
                    const fm = cache?.frontmatter;
                    const status = fm?.status;
                    if (status === 'written' || status === 'settled') {
                        completedChaps.add(f.name);
                    }
                } catch (e) { log.warn("[小说工坊] 操作异常:", e instanceof Error ? e.message : e); }
            }

            // 3. 人物卡状态
            let charStateOk = 0, charStateMissing = 0;
            for (const f of charFiles) {
                try {
                    const c = await this.getFS().read(f.path);
                    const fm = c.match(/^---\n([\s\S]*?)\n---/);
                    if (fm && fm[1].includes('当前状态:')) charStateOk++; else charStateMissing++;
                } catch (e) { charStateMissing++; }
            }

            // 4. 健康度
            const debtLevel = Math.min(15, unrevealed);
            let debtEmoji = '';
            if (unrevealed <= 5) debtEmoji = '🟢'.repeat(Math.max(1, debtLevel)) + '🔴'.repeat(15 - debtLevel);
            else if (unrevealed <= 10) debtEmoji = '🟡'.repeat(Math.max(1, debtLevel)) + '🔴'.repeat(15 - debtLevel);
            else debtEmoji = '🔴'.repeat(Math.max(1, debtLevel)) + '🟢'.repeat(15 - debtLevel);

            let healthNote = '';
            if (unrevealed <= 5) healthNote = '🟢 健康';
            else if (unrevealed <= 10) healthNote = '🟡 需注意';
            else healthNote = '🔴 信息债过高';

            const now = new Date().toLocaleString('zh-CN');

            const content = `---
tags: [看板]
---

# 📊 信息债看板

> 自动刷新时间：${now}

## 章节进度
- 总章节文件：${chapCount}
- 已完成正文：${completedChaps.size}

## 伏笔态势
- 未揭示伏笔：${unrevealed} ${unrevealed > 5 ? '⚠️ 偏高（建议尽快回收）' : '✅ 正常'}
- 已揭示伏笔：${revealed}
- 已废弃：${abandoned}

## 健康度
- 信息债等级：${debtEmoji} (${debtLevel}/15)
  - 未揭示 ≤ 5: 🟢 健康
  - 未揭示 6-10: 🟡 需注意
  - 未揭示 ≥ 11: 🔴 信息债过高

## 人物卡状态
- 已填写当前状态：${charStateOk}
- 状态待更新：${charStateMissing}

## 提醒
- ${unrevealed <= 5 ? '✅ 伏笔生态健康' : unrevealed <= 10 ? '⚠️ 建议近章回收部分伏笔' : '🔴 信息债过高，下章必须强制揭示'}
- ${charStateMissing > 0 ? `⚠️ ${charStateMissing}个人物未填写当前状态` : '✅ 所有人物状态已更新'}
`;

            const fp = pjInfoDebtBoard(project);
            // D3-17：与批量/伏笔管理器共用同一路径锁
            await writeInfoDebtBoard(fp, content, (path, text) => this.getFS().write(path, text));
        } catch (e) { log.warn('[SettlementEngine] 刷新信息债看板失败:', e); }
    }

    // ================================================================
    // Markdown 表格工具方法（getNextRowNum / hasTableSeparator / appendAfterSeparator）
    // 已外迁至 ./settlement/markdown-table-utils.ts
    // ================================================================

    // v3.5.0: 结算后生成叙事总览
    /**
     * generateNarrativeOverview 方法。
     * @param project - 项目（路径或对象）
     * @returns 文本结果
     */
    async generateNarrativeOverview(project: string): Promise<string> {
        const baseDir = pjOutlineDir(project);
        const charDir = entityDir(project, 'characters');
        const factionDir = entityDir(project, 'factions');
        const locDir = entityDir(project, 'locations');
        const itemDir = entityDir(project, 'items');
        const foreshadowPath = pjForeshadowDB(project);
        const timelinePath = pjTimelineBoard(project);

        let completed = 0, drafts = 0;
        // 只遍历本项目的大纲/正文目录（递归），不再全库 getFiles()
        const chapterFiles = listFolderFiles<TFile>(this.getVaultMeta(), baseDir, { recursive: true })
            .filter(f => f.name.includes('正文'));

        // 统计章节进度
        for (const f of chapterFiles) {
            try {
                const raw = await this.getFS().read(f.path);
                // v4.0: 章节状态优先匹配新值 settled/written；旧值 '已完稿' 仅保留兼容
                if (raw.includes('status: settled') || raw.includes('status: written') || raw.includes('status: 已完稿')) completed++;
                else drafts++;
            } catch (e) {
                log.warn('[SettlementEngine] 叙事总览失败:', e);
                this.notifier.showNotice('SettlementEngine：数据读取异常，部分功能可能受限');
            }
        }

        // 收集实体摘要
        const collectEntities = async (dir: string, field: string): Promise<string> => {
            const rows: string[] = [];
            for (const f of listFolderFiles<TFile>(this.getVaultMeta(), dir, { recursive: true })) {
                try {
                    const raw = await this.getFS().read(f.path);
                    const fm = raw.match(/^---\n([\s\S]*?)\n---/);
                    if (!fm) continue;
                    const name = (fm[1].match(new RegExp(`^${field}:\\s*(.+)$`, 'm')) || [])[1]?.trim() || f.basename;
                    const status = (fm[1].match(/^状态:\s*(.+)$/m) || [])[1]?.trim() || '-';
                    rows.push(`| ${name} | ${status} | - |`);
                } catch (e) {
                    log.warn('[SettlementEngine] 叙事总览失败:', e);
                    this.notifier.showNotice('SettlementEngine：数据读取异常，部分功能可能受限');
                }
            }
            return rows.join('\n');
        };

        const charRows = await collectEntities(charDir, '名称');
        const factionRows = await collectEntities(factionDir, '名称');
        const locRows = await collectEntities(locDir, '名称');
        const itemRows = await collectEntities(itemDir, '名称');

        // 伏笔状态
        let foreshadowRows = '';
        try {
            const fsFile = this.getVaultMeta().getAbstractFileByPath(foreshadowPath);
            if (fsFile instanceof TFile) {
                const fsRaw = await this.getFS().read(foreshadowPath);
                const fsLines = fsRaw.split('\n').filter(l => l.startsWith('|') && l.includes('|') && !l.includes('---'));
                foreshadowRows = fsLines.slice(-20).join('\n');
            }
        } catch (e) {
            log.warn('[SettlementEngine] 叙事总览失败:', e);
            this.notifier.showNotice('SettlementEngine：数据读取异常，部分功能可能受限');
        }

        // 时间线
        let timelineRows = '';
        try {
            const tlFile = this.getVaultMeta().getAbstractFileByPath(timelinePath);
            if (tlFile instanceof TFile) {
                const tlRaw = await this.getFS().read(timelinePath);
                const tlLines = tlRaw.split('\n').filter(l => l.startsWith('|') && l.includes('|') && !l.includes('---'));
                timelineRows = tlLines.slice(-20).join('\n');
            }
        } catch (e) {
            log.warn('[SettlementEngine] 叙事总览失败:', e);
            this.notifier.showNotice('SettlementEngine：数据读取异常，部分功能可能受限');
        }

        const now = new Date().toLocaleString();
        return `---
tags: [总览]
自动生成: true
最近更新: "${now}"
---

# 叙事总览

> 结算时自动生成

## 章节进度

| 已完稿 | 草稿 | 待规划 |
|--------|------|--------|
| ${completed} | ${drafts} | - |

## 实体状态树

### 人物
| 名称 | 状态 | 最近变更章 |
|------|------|-----------|
${charRows || '| - | - | - |'}

### 势力
| 名称 | 状态/排名 |
|------|----------|
${factionRows || '| - | - |'}

### 地点
| 名称 | 主要特征 |
|------|---------|
${locRows || '| - | - |'}

### 物品功法
| 名称 | 归属 |
|------|------|
${itemRows || '| - | - |'}

## 伏笔生命周期
| 伏笔名 | 状态 | 埋入章 | 计划揭示章 |
|--------|------|--------|-----------|
${foreshadowRows || '| - | - | - | - |'}

## 时间线事件流（最近 20 条）
| 时间点 | 事件 | 来源章 |
|--------|------|--------|
${timelineRows || '| - | - | - |'}

---
*自动生成于 ${now}*
`;
    }
}
