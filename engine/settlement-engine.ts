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
import { mkdirp } from '../utils/helpers';
import { getChapterFileName, findChapterFile, getChapterFile } from './chapter-utils';
import { CHARACTER_DISPLAY_KEYS } from '../shared/format-constants';
import { withWriteLock } from './write-lock';
import { loadRelationshipStates, extractRelationshipChanges, applyRelationshipChanges, saveRelationshipStates } from './relationship-engine';
import { pjBodyDir, pjBodyFile, pjCharFile, pjLocFile, pjFactionFile, pjItemFile, pjCharsDir, pjLocsDir, pjFactionsDir, pjItemsDir, pjForeshadowDB, pjTimelineBoard, pjTimelineDir, pjOutlineDir, pjInfoDebtBoard } from '../shared/paths';
import type { Notifier } from '../shared/types';
import { NOOP_NOTIFIER } from '../shared/types';
import { FileSystemPort, FrontmatterPort, VaultMetaPort, ObsidianFileSystem, ObsidianFrontmatter, ObsidianVaultMeta } from '../shared/file-system-port';
import { NOTICE_ERROR, NOTICE_WARNING, NOTICE_CRITICAL } from '../shared/thresholds';
import type { Instructions, FrontMatter } from './settlement/settlement-types';
import { parseReport, parseFrontmatterFromText, parseFmList } from './settlement/report-parser';
import {
    getNextRowNum,
    hasTableSeparator,
    appendAfterSeparator,
    appendAfterSectionHeader,
    renumberTable,
    getNextRowNumInSection,
} from './settlement/markdown-table-utils';
import { createSettleContext, type SettleContext } from './settlement/settle-context';

export interface SettlementOptions {
    forceReveal?: string[];
    involvedChars?: string[];
    involvedLocs?: string[];
    involvedFactions?: string[];
    involvedItems?: string[];
}

export interface SettlementResult {
    updated: number;
    created: number;
    updatedChars: number;
    updatedForeshadows: number;
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

export interface SettlementEngineDeps {
    fs?: FileSystemPort;
    frontmatter?: FrontmatterPort;
    vaultMeta?: VaultMetaPort;
    notifier?: Notifier;
}

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

    async settleLight(
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
        };

        const fm = parseFrontmatterFromText(bodyText);

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
                    console.warn('[SettlementEngine] 轻量结算更新人物失败:', name, e);
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
                    console.warn('[SettlementEngine] 轻量结算更新地点失败:', name, e);
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
                    console.warn('[SettlementEngine] 轻量结算更新势力失败:', name, e);
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
                    console.warn('[SettlementEngine] 轻量结算更新物品失败:', name, e);
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
                    console.warn('[SettlementEngine] 轻量结算更新伏笔库失败:', e);
                }
            }
        }

        let bodyFile: TFile | null = null;
        const v4Match = chapDir.match(/^(.+?)\/03-大纲与章节\/步骤结果\/第(\d+)卷\/第(\d+)章$/);
        if (v4Match) {
            const v4Proj = v4Match[1];
            const v4VolN = parseInt(v4Match[2], 10);
            const v4ChapN = parseInt(v4Match[3], 10);
            const targetPath = pjBodyFile(v4Proj, v4VolN, v4ChapN);
            const tf = this.getVaultMeta().getAbstractFileByPath(targetPath);
            if (tf instanceof TFile) {
                bodyFile = tf;
            }
        } else {
            const chapFolder = this.getVaultMeta().getAbstractFileByPath(chapDir);
            bodyFile = chapFolder instanceof TFolder ? (getChapterFile(chapFolder, '正文') as TFile | null) : null;
        }
        if (bodyFile) {
            try {
                await this.getFrontmatter().processFrontmatter(bodyFile as TFile, (fmObj: FrontMatter) => {
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
                });
            } catch (e) {
                console.warn('[SettlementEngine] 轻量结算 body frontmatter回写失败:', e);
            }
        }

        await this.refreshInfoDebt(project);

        result.updated = result.updatedChars + result.updatedForeshadows + result.updatedFactions + result.updatedLocations + result.updatedItems;
        result.chars = [...new Set(result.chars)];
        result.locs = [...new Set(result.locs)];
        result.factions = [...new Set(result.factions)];
        result.items = [...new Set(result.items)];

        return result;
    }

    /**
     * parseFrontmatterFromText / parseFmList 已外迁至 ./settlement/report-parser.ts
     */

    async settle(
        project: string,
        chapDir: string,
        chapName: string,
        report: string,
        bodyText: string,
        options?: SettlementOptions
    ): Promise<SettlementResult> {
        const instr = parseReport(report);
        const ctx = createSettleContext(project, chapDir, chapName, bodyText, report, instr, options);

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

        // ─── 汇总 + 回滚（hasPartialFailure 时）───
        this.settleStep_aggregateAndMaybeRollback(ctx);
        // 异步部分（回滚 / V2 关系）放到独立方法，避免上面同步汇总后再 await
        await this.settleStep_finalizeRollback(ctx);
        await this.settleStep_updateV2Relations(ctx);

        return ctx.result;
    }

    // ================================================================
    // 回滚快照工具（settle 内部使用，从原内嵌闭包提取）
    // ================================================================
    private async snapshotField(ctx: SettleContext, file: TFile, field: string): Promise<void> {
        if (!ctx.snapshots.has(file.path)) ctx.snapshots.set(file.path, new Map());
        if (ctx.snapshots.get(file.path)!.has(field)) return;
        let origVal = '';
        try {
            await this.getFrontmatter().processFrontmatter(file, (fm: FrontMatter) => { origVal = String(fm[field] ?? ''); });
        } catch (e) {
            console.warn('[SettlementEngine] 快照失败:', e);
            this.notifier.showNotice('SettlementEngine：数据读取异常，部分功能可能受限');
        }
        ctx.snapshots.get(file.path)!.set(field, origVal);
    }

    private async restoreSnapshots(ctx: SettleContext): Promise<void> {
        for (const [filePath, fields] of ctx.snapshots) {
            const file = this.getVaultMeta().getAbstractFileByPath(filePath);
            if (!file) continue;
            try {
                await this.getFrontmatter().processFrontmatter(file as TFile, (fm: FrontMatter) => {
                    for (const [field, value] of fields) {
                        fm[field] = value;
                    }
                });
            } catch (e) {
                console.warn('[SettlementEngine] 回滚失败:', filePath, e);
                this.notifier.showNotice(`⚠️ 结算回滚失败：${filePath.split('/').pop()}，数据可能处于不一致状态`, NOTICE_CRITICAL);
                ctx.rollbackFailed = true;
            }
        }
    }

    // ================================================================
    // §1-4: UPDATE_* 系列实体 frontmatter 更新
    // 共用模式：snapshot → withWriteLock → processFrontmatter → 计数++ / 失败时 hasPartialFailure=true
    // ================================================================

    /** §1 更新人物 frontmatter — v1.5.0: 字段名校验 */
    private async settleStep_updateCharacters(ctx: SettleContext): Promise<void> {
        const validCharFields = new Set<string>(CHARACTER_DISPLAY_KEYS);
        for (const u of ctx.instr.uc) {
            if (!validCharFields.has(u.field)) {
                console.warn(`[SettlementEngine] 跳过无效字段: ${u.field} (人物: ${u.name})`);
                continue;
            }
            const fp = pjCharFile(ctx.project, u.name);
            const file = this.getVaultMeta().getAbstractFileByPath(fp);
            if (!file) continue;
            try {
                await this.snapshotField(ctx, file as TFile, u.field);
                await withWriteLock(fp, () =>
                    this.getFrontmatter().processFrontmatter(file as TFile, (fm: FrontMatter) => {
                        fm[u.field] = u.value;
                    })
                );
                ctx.result.updatedChars++;
                ctx.result.chars.push(u.name);
            } catch (e) { const errMsg = e instanceof Error ? e.message : String(e); console.warn('[SettlementEngine] 更新人物失败:', u.name, e); this.notifier.showNotice(`❌ 更新人物「${u.name}」失败：${errMsg}`, NOTICE_ERROR); ctx.hasPartialFailure = true; }
        }
    }

    /** §2 更新势力 frontmatter（v1.3.0） */
    private async settleStep_updateFactions(ctx: SettleContext): Promise<void> {
        for (const u of ctx.instr.ufa) {
            const fp = pjFactionFile(ctx.project, u.name);
            const file = this.getVaultMeta().getAbstractFileByPath(fp);
            if (!file) continue;
            try {
                await this.snapshotField(ctx, file as TFile, u.field);
                await withWriteLock(fp, () =>
                    this.getFrontmatter().processFrontmatter(file as TFile, (fm: FrontMatter) => {
                        fm[u.field] = u.value;
                    })
                );
                ctx.result.updatedFactions++;
                ctx.result.factions.push(u.name);
            } catch (e) { const errMsg = e instanceof Error ? e.message : String(e); console.warn('[SettlementEngine] 更新势力失败:', u.name, e); this.notifier.showNotice(`❌ 更新势力「${u.name}」失败：${errMsg}`, NOTICE_ERROR); ctx.hasPartialFailure = true; }
        }
    }

    /** §3 更新地点 frontmatter（v1.3.0） */
    private async settleStep_updateLocations(ctx: SettleContext): Promise<void> {
        for (const u of ctx.instr.uloc) {
            const fp = pjLocFile(ctx.project, u.name);
            const file = this.getVaultMeta().getAbstractFileByPath(fp);
            if (!file) continue;
            try {
                await this.snapshotField(ctx, file as TFile, u.field);
                await withWriteLock(fp, () =>
                    this.getFrontmatter().processFrontmatter(file as TFile, (fm: FrontMatter) => {
                        fm[u.field] = u.value;
                    })
                );
                ctx.result.updatedLocations++;
                ctx.result.locs.push(u.name);
            } catch (e) { const errMsg = e instanceof Error ? e.message : String(e); console.warn('[SettlementEngine] 更新地点失败:', u.name, e); this.notifier.showNotice(`❌ 更新地点「${u.name}」失败：${errMsg}`, NOTICE_ERROR); ctx.hasPartialFailure = true; }
        }
    }

    /** §4 更新物品功法 frontmatter（v1.3.0） */
    private async settleStep_updateItems(ctx: SettleContext): Promise<void> {
        for (const u of ctx.instr.uitem) {
            const fp = pjItemFile(ctx.project, u.name);
            const file = this.getVaultMeta().getAbstractFileByPath(fp);
            if (!file) continue;
            try {
                await this.snapshotField(ctx, file as TFile, u.field);
                await withWriteLock(fp, () =>
                    this.getFrontmatter().processFrontmatter(file as TFile, (fm: FrontMatter) => {
                        fm[u.field] = u.value;
                    })
                );
                ctx.result.updatedItems++;
                ctx.result.items.push(u.name);
            } catch (e) { const errMsg = e instanceof Error ? e.message : String(e); console.warn('[SettlementEngine] 更新物品功法失败:', u.name, e); this.notifier.showNotice(`❌ 更新物品功法「${u.name}」失败：${errMsg}`, NOTICE_ERROR); ctx.hasPartialFailure = true; }
        }
    }

    /** §5 处理伏笔库：UPDATE_FORESHADOW + options.forceReveal 强制揭示 */
    private async settleStep_updateForeshadows(ctx: SettleContext): Promise<void> {
        const forceRevealSet = new Set<string>();
        for (const u of ctx.instr.uf) {
            if (u.value.includes('已揭示') || u.value === '揭示') {
                forceRevealSet.add(u.name);
            }
        }
        if (ctx.options?.forceReveal) {
            for (const name of ctx.options.forceReveal) {
                forceRevealSet.add(name);
            }
        }

        if (ctx.instr.uf.length === 0 && forceRevealSet.size === 0) return;

        const fp = pjForeshadowDB(ctx.project);
        const ff = this.getVaultMeta().getAbstractFileByPath(fp);
        if (!(ff instanceof TFile)) return;

        try {
            // v3.4.6 跨模块写入保护：伏笔库也加锁
            await withWriteLock(fp, async () => {
                let content = await this.getFS().read(fp);
                let changed = false;

                for (const u of ctx.instr.uf) {
                    const newContent = this.moveForeshadowToRevealed(content, u.name, ctx.chapName);
                    if (newContent) {
                        content = newContent;
                        changed = true;
                        ctx.result.updatedForeshadows++;
                    }
                }

                for (const name of forceRevealSet) {
                    const newContent = this.moveForeshadowToRevealed(content, name, ctx.chapName);
                    if (newContent) {
                        content = newContent;
                        changed = true;
                        ctx.result.updatedForeshadows++;
                    }
                }

                if (changed) { await this.getFS().write(fp, content); }
            });
        } catch (e) { console.warn('[SettlementEngine] 更新伏笔库失败:', e); ctx.hasPartialFailure = true; }
    }

    // ================================================================
    // §6-9: NEW_* 系列实体创建（完整模板写入 + createdFiles 记录用于回滚）
    // ================================================================

    /** §6 创建新人物 — v1.3.2 完整模板 */
    private async settleStep_createCharacters(ctx: SettleContext): Promise<void> {
        for (const nc of ctx.instr.nc) {
            const fp = pjCharFile(ctx.project, nc.name);
            if (this.getVaultMeta().getAbstractFileByPath(fp)) continue;
            try {
                await this.getFS().mkdir(pjCharsDir(ctx.project));
                const content = `---
tags: [人物]
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
                ctx.createdFiles.push(fp);
                ctx.result.createdChars++;
                ctx.result.chars.push(nc.name);
            } catch (e) { const errMsg = e instanceof Error ? e.message : String(e); console.warn('[SettlementEngine] 新建人物失败:', nc.name, e); this.notifier.showNotice(`❌ 新建人物「${nc.name}」失败：${errMsg}`, NOTICE_ERROR); ctx.hasPartialFailure = true; }
        }
    }

    /** §7 创建新地点 — v1.3.2 完整模板 */
    private async settleStep_createLocations(ctx: SettleContext): Promise<void> {
        for (const nl of ctx.instr.nl) {
            const fp = pjLocFile(ctx.project, nl.name);
            if (this.getVaultMeta().getAbstractFileByPath(fp)) continue;
            try {
                await this.getFS().mkdir(pjLocsDir(ctx.project));
                const content = `---
tags: [地点]
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
                ctx.createdFiles.push(fp);
                ctx.result.createdLocs++;
                ctx.result.locs.push(nl.name);
            } catch (e) { const errMsg = e instanceof Error ? e.message : String(e); console.warn('[SettlementEngine] 新建地点失败:', nl.name, e); this.notifier.showNotice(`❌ 新建地点「${nl.name}」失败：${errMsg}`, NOTICE_ERROR); ctx.hasPartialFailure = true; }
        }
    }

    /** §8 创建新势力 — v1.3.2 完整模板 */
    private async settleStep_createFactions(ctx: SettleContext): Promise<void> {
        for (const nf of ctx.instr.nf) {
            const fp = pjFactionFile(ctx.project, nf.name);
            if (this.getVaultMeta().getAbstractFileByPath(fp)) continue;
            try {
                await this.getFS().mkdir(pjFactionsDir(ctx.project));
                const content = `---
tags: [势力]
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
                ctx.createdFiles.push(fp);
                ctx.result.createdFactions++;
                ctx.result.factions.push(nf.name);
            } catch (e) { const errMsg = e instanceof Error ? e.message : String(e); console.warn('[SettlementEngine] 新建势力失败:', nf.name, e); this.notifier.showNotice(`❌ 新建势力「${nf.name}」失败：${errMsg}`, NOTICE_ERROR); ctx.hasPartialFailure = true; }
        }
    }

    /** §9 创建新物品功法 — v1.3.2 完整模板 */
    private async settleStep_createItems(ctx: SettleContext): Promise<void> {
        for (const ni of ctx.instr.ni) {
            const fp = pjItemFile(ctx.project, ni.name);
            if (this.getVaultMeta().getAbstractFileByPath(fp)) continue;
            try {
                await this.getFS().mkdir(pjItemsDir(ctx.project));
                const content = `---
tags: [物品功法]
名称: ${ni.name}
类型: 
品阶/等级: 
描述: 
效果: 
所属/归属: 
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
                ctx.createdFiles.push(fp);
                ctx.result.createdItems++;
                ctx.result.items.push(ni.name);
            } catch (e) { const errMsg = e instanceof Error ? e.message : String(e); console.warn('[SettlementEngine] 新建物品功法失败:', ni.name, e); this.notifier.showNotice(`❌ 新建物品功法「${ni.name}」失败：${errMsg}`, NOTICE_ERROR); ctx.hasPartialFailure = true; }
        }
    }

    /** §10 新增伏笔到伏笔库「未回收伏笔」表格 — v1.4.0 8列表头 */
    private async settleStep_createForeshadows(ctx: SettleContext): Promise<void> {
        for (const nf of ctx.instr.nfs) {
            try {
                const fp = pjForeshadowDB(ctx.project);
                const ff = this.getVaultMeta().getAbstractFileByPath(fp);
                let c = ff instanceof TFile ? await this.getFS().read(fp) : '';
                const newRow = `| ${getNextRowNum(c)} | ${nf.name} | 中 | ${nf.chapter || ctx.chapName} | ${nf.reveal || '待定'} | ${nf.relatedChars || ''} | ${nf.relatedPlotline || ''} | 未揭示 |`;
                if (c.includes('未回收伏笔')) {
                    c = appendAfterSectionHeader(c, '未回收伏笔', newRow);
                    if (ff) await this.getFS().write(fp, c);
                } else {
                    // 首次创建：8列双表结构
                    const base = `# 伏笔库\n\n> 所有伏笔总览，追踪状态，避免遗漏。\n\n## 未回收伏笔\n\n| # | 伏笔名称 | 重要程度 | 埋设章节 | 计划回收 | 相关人物 | 关联主线 | 当前状态 |\n|---|---------|---------|---------|---------|---------|---------|---------|\n${newRow}\n\n## 已回收伏笔\n\n| # | 伏笔名称 | 重要程度 | 埋设章节 | 相关人物 | 关联主线 | 回收章节 | 回收方式 |\n|---|---------|---------|---------|---------|---------|---------|---------|\n`;
                    if (ff) await this.getFS().write(fp, base);
                    else { await this.getFS().mkdir(pjTimelineDir(ctx.project)).catch(() => {}); await this.getFS().write(fp, base); }
                }
                ctx.result.createdForeshadows++;
            } catch (e) { console.warn('[SettlementEngine] 追加伏笔失败:', e); this.notifier.showNotice('[SettlementEngine] 数据操作失败，部分功能可能受限'); ctx.hasPartialFailure = true; }
        }
    }

    /** §11 新增时间线事件 — v1.3.1 区分背景纪元/主线纪元 */
    private async settleStep_createTimelines(ctx: SettleContext): Promise<void> {
        for (const nt of ctx.instr.nt) {
            const tlPath = pjTimelineBoard(ctx.project);
            try {
                let tlC = '';
                const tlF = this.getVaultMeta().getAbstractFileByPath(tlPath);
                if (tlF instanceof TFile) tlC = await this.getFS().read(tlPath);

                const newRow = `| ${nt.desc} | ${ctx.chapName} | ${nt.event} | |`;

                // 判断应该写入哪个纪元
                const isBackground = nt.desc.match(/背景纪元|纪元前|年前|上古|远古|传说|肇始/);
                const sectionTitle = isBackground ? '背景纪元（故事开始前）' : '主线纪元（故事进行中）';

                if (tlC.includes(sectionTitle)) {
                    tlC = appendAfterSectionHeader(tlC, sectionTitle, newRow);
                    if (tlF) await this.getFS().write(tlPath, tlC);
                    else await this.getFS().write(tlPath, tlC);
                } else {
                    // 首次创建：写双表结构
                    const base = `# 时间线看板\n\n> 按时间顺序排列的关键事件，用于整体把控叙事节奏。\n\n## 纪元 / 时间轴\n\n### 背景纪元（故事开始前）\n\n| 时间 | 对应章节 | 事件 | 影响 |\n|------|---------|------|------|\n${isBackground ? newRow + '\n' : ''}\n### 主线纪元（故事进行中）\n\n| 时间 | 对应章节 | 事件 | 影响 |\n|------|---------|------|------|\n${isBackground ? '' : newRow + '\n'}`;
                    if (tlF) await this.getFS().write(tlPath, base);
                    else { await this.getFS().mkdir(pjTimelineDir(ctx.project)).catch(() => {}); await this.getFS().write(tlPath, base); }
                }
                ctx.result.createdTimelines++;
            } catch (e) { console.warn('[SettlementEngine] 追加时间线失败:', e); this.notifier.showNotice('[SettlementEngine] 数据操作失败，部分功能可能受限'); ctx.hasPartialFailure = true; }
        }
    }

    /** §12 更新实体关系 — 写入双方实体的互信息章节（v1.3.0） */
    private async settleStep_updateRelations(ctx: SettleContext): Promise<void> {
        for (const r of ctx.instr.rel) {
            try {
                await this.updateRelation(ctx.project, r.entityA, r.entityB, r.relType, r.desc, ctx.chapName);
                ctx.result.updatedRelations++;
            } catch (e) { console.warn('[SettlementEngine] 更新关系失败:', r.entityA, r.entityB, e); }
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
                let content = await this.getFS().read(fp);
                // 在「变更记录」区块末尾追加
                if (content.includes('## 变更记录')) {
                    const idx = content.lastIndexOf('## 变更记录');
                    const afterHeader = content.indexOf('\n', idx);
                    content = content.slice(0, afterHeader + 1) + growthEntry + content.slice(afterHeader + 1);
                } else {
                    content += `\n## 变更记录\n${growthEntry}`;
                }
                await this.getFS().write(fp, content);
                ctx.result.updatedGrowth++;
            } catch (e) { console.warn('[SettlementEngine] 更新成长失败:', g.name, e); }
        }
    }

    /** §14 更新人物情绪状态（v1.3.0） */
    private async settleStep_updateEmotions(ctx: SettleContext): Promise<void> {
        for (const e of ctx.instr.emotion) {
            try {
                const fp = pjCharFile(ctx.project, e.name);
                const file = this.getVaultMeta().getAbstractFileByPath(fp);
                if (!file) continue;
                await this.getFrontmatter().processFrontmatter(file as TFile, (fm: FrontMatter) => {
                    fm['当前情绪'] = e.emotion;
                    // v4.0: 实体状态追踪
                    if (fm['entity_status'] == null || fm['entity_status'] === '') fm['entity_status'] = 'active';
                    fm['entity_last_changed_at'] = ctx.chapName;
                    fm['entity_last_changed_reason'] = `结算：情绪更新为${e.emotion}`;
                });
                ctx.result.updatedEmotions++;
            } catch (err) { console.warn('[SettlementEngine] 更新情绪失败:', e.name, err); }
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
            const targetPath = pjBodyFile(v4Proj, v4VolN, v4ChapN);
            const tf = this.getVaultMeta().getAbstractFileByPath(targetPath);
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
            await this.getFrontmatter().processFrontmatter(bodyFile as TFile, (fm: FrontMatter) => {
                // v4.0: 结算完成 → settled（旧值 '已完稿' 保留兼容）
                fm['status'] = 'settled';
                const allCharNames = [...new Set([...ctx.instr.uc.map(c => c.name), ...ctx.instr.nc.map(c => c.name)])];
                if (allCharNames.length > 0) {
                    fm['涉及人物'] = allCharNames;
                }

                const allLocNames = ctx.instr.nl.map(l => l.name);
                if (allLocNames.length > 0) {
                    fm['涉及地点'] = allLocNames;
                }

                const allFactionNames = ctx.instr.nf.map(f => f.name);
                if (allFactionNames.length > 0) {
                    fm['涉及势力'] = allFactionNames;
                }

                const allItemNames = ctx.instr.ni.map(i => i.name);
                if (allItemNames.length > 0) {
                    fm['涉及物品功法'] = allItemNames;
                }
            });
        } catch (e) {
            console.warn('[SettlementEngine] body frontmatter回写失败:', e);
            this.notifier.showNotice('⚠️ 章节 frontmatter 回写失败：涉及人物/地点/势力/物品字段可能未更新', NOTICE_ERROR);
        }
    }

    /** §16 删除实体（v1.4.0 — 连贯性审查后的清理） */
    private async settleStep_deleteEntities(ctx: SettleContext): Promise<void> {
        for (const d of ctx.instr.del) {
            await this.deleteEntity(ctx.project, d.entityType, d.entityName);
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
        // v3.4.6 回滚机制：如果任何 NEW 实体创建失败，恢复所有 UPDATE 的原始值
        if (ctx.hasPartialFailure && ctx.snapshots.size > 0) {
            console.warn(`[SettlementEngine] 检测到部分失败，回滚 ${ctx.snapshots.size} 个文件的 frontmatter`);
            await this.restoreSnapshots(ctx);
            // v3.4.9 P0-3: 清理 NEW 操作创建的文件
            for (const fp of ctx.createdFiles) {
                try {
                    await this.getFS().delete(fp);
                } catch (e) {
                    console.warn('[SettlementEngine] 清理新建文件失败:', fp, e);
                }
            }
            // 将 updated 计数清零（已回滚）
            ctx.result.updated = 0;
            ctx.result.updatedChars = 0;
            ctx.result.updatedFactions = 0;
            ctx.result.updatedLocations = 0;
            ctx.result.updatedItems = 0;
        }

        // R3-3: 回滚失败提示 — 数据可能处于半改半回滚的脏态
        if (ctx.rollbackFailed) {
            this.notifier.showNotice('⚠️ 结算回滚不完整！部分文件 frontmatter 恢复失败，请手动检查相关人物/地点/势力/物品文件的变更记录', 10000);
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
            const changes = extractRelationshipChanges(ctx.report);
            if (changes.length > 0) {
                const relations = await loadRelationshipStates(this.app, ctx.project);
                applyRelationshipChanges(relations, changes, ctx.chapName);
                await saveRelationshipStates(this.app, ctx.project, relations, ctx.chapName);
                v2RelationCount = changes.length;
                console.log(`[SettlementEngine] V2 关系更新: ${changes.length} 条变更已写入关系状态.md`);
            }
        } catch (e) {
            console.warn('[SettlementEngine] V2 关系状态更新失败（已跳过）:', e);
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

    /** 将伏笔从未回收表删除，在已回收表插入新行 — v1.4.0 8列表头 */
    private moveForeshadowToRevealed(content: string, name: string, chapName: string): string | null {
        const lines = content.split('\n');
        let revealedSepIdx = -1;
        let foundRow = -1;
        let foundCols: string[] | null = null;

        for (let i = 0; i < lines.length; i++) {
            const l = lines[i];
            if (l.includes('已回收伏笔')) {
                for (let j = i + 1; j < lines.length && j < i + 10; j++) {
                    if (lines[j].match(/^\|[-\s]+\|/)) { revealedSepIdx = j; break; }
                }
            }
            if (revealedSepIdx === -1 && l.match(/^\|.*\|/)) {
                const cols = l.split('|').map(s => s.trim()).filter(Boolean);
                if (cols.length >= 2 && cols[1] === name) { foundRow = i; foundCols = cols; }
            }
        }
        if (foundRow === -1 || !foundCols) return null;

        lines.splice(foundRow, 1);
        const nextNum = getNextRowNumInSection(lines, revealedSepIdx);
        // 8列已回收: #(0) | 名称(1) | 重要(2) | 埋设(3) | 相关人物(4) | 关联主线(5) | 回收章节(6) | 回收方式(7)
        const newRow = `| ${nextNum} | ${foundCols[1]} | ${foundCols[2] || '中'} | ${foundCols[3] || ''} | ${foundCols[5] || ''} | ${foundCols[6] || ''} | ${chapName} | 正文揭示 |`;
        if (revealedSepIdx !== -1) lines.splice(revealedSepIdx + 1, 0, newRow);
        else {
            lines.push('', '## 已回收伏笔', '',
                '| # | 伏笔名称 | 重要程度 | 埋设章节 | 相关人物 | 关联主线 | 回收章节 | 回收方式 |',
                '|---|---------|---------|---------|---------|---------|---------|---------|', newRow);
        }
        renumberTable(lines, '未回收伏笔');
        return lines.join('\n');
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
        chapName: string
    ): Promise<void> {
        const entry = `- [[${entityB}]] | ${relType} | ${desc} | ${chapName}`;
        const entryB = `- [[${entityA}]] | ${relType} | ${desc} | ${chapName}`;

        // 更新实体A
        const candidatesA = this.findEntityFiles(project, entityA);
        if (candidatesA.length > 0) {
            await this.appendToMutualSection(candidatesA[0], entry);
        }
        // 更新实体B
        const candidatesB = this.findEntityFiles(project, entityB);
        if (candidatesB.length > 0) {
            await this.appendToMutualSection(candidatesB[0], entryB);
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
    private async appendToMutualSection(file: TFile, entry: string): Promise<void> {
        try {
            let content = await this.getFS().read(file.path);
            if (content.includes('## 与其他元素的互信息')) {
                const idx = content.lastIndexOf('## 与其他元素的互信息');
                const afterHeader = content.indexOf('\n', idx);
                content = content.slice(0, afterHeader + 1) + entry + '\n' + content.slice(afterHeader + 1);
            } else if (content.includes('## 与其他角色的互信息')) {
                const idx = content.lastIndexOf('## 与其他角色的互信息');
                const afterHeader = content.indexOf('\n', idx);
                content = content.slice(0, afterHeader + 1) + entry + '\n' + content.slice(afterHeader + 1);
            }
            await this.getFS().write(file.path, content);
        } catch (e) { console.warn('[SettlementEngine] 追加互信息失败:', file.path, e); }
    }

    // ================================================================
    // 实体删除 — v1.4.0 新增, 对齐 shared_utils.js confirmDelete 三重确认
    // ================================================================
    private async deleteEntity(project: string, entityType: string, entityName: string): Promise<void> {
        try {
            if (entityType === '人物') {
                const fp = pjCharFile(project, entityName);
                const file = this.getVaultMeta().getAbstractFileByPath(fp);
                if (file instanceof TFile) {
                    const content = await this.getFS().read(fp);
                    if (content.includes(entityName)) {  // 三重确认: 文件名匹配 + 内容匹配
                        await this.getFS().delete(fp);
                        console.log(`[SettlementEngine] 删除人物: ${entityName}`);
                    }
                }
            } else if (entityType === '伏笔') {
                const fp = pjForeshadowDB(project);
                const ff = this.getVaultMeta().getAbstractFileByPath(fp);
                if (ff instanceof TFile) {
                    const fc = await this.getFS().read(fp);
                    const lines = fc.split('\n');
                    const targetIdx = lines.findIndex(line =>
                        line.startsWith('|') && line.includes(`| ${entityName} |`)
                    );
                    if (targetIdx !== -1) {
                        lines.splice(targetIdx, 1);
                        await this.getFS().write(fp, lines.join('\n'));
                        console.log(`[SettlementEngine] 从伏笔库删除: ${entityName}`);
                    }
                }
            } else if (entityType === '时间线') {
                const fp = pjTimelineBoard(project);
                const ff = this.getVaultMeta().getAbstractFileByPath(fp);
                if (ff instanceof TFile) {
                    const fc = await this.getFS().read(fp);
                    const lines = fc.split('\n');
                    const targetIdx = lines.findIndex(line =>
                        line.startsWith('|') && line.includes(entityName)
                    );
                    if (targetIdx !== -1) {
                        lines.splice(targetIdx, 1);
                        await this.getFS().write(fp, lines.join('\n'));
                    }
                }
            } else if (entityType === '地点') {
                const fp = pjLocFile(project, entityName);
                const file = this.getVaultMeta().getAbstractFileByPath(fp);
                if (file) await this.getFS().delete(fp);
            } else if (entityType === '势力') {
                const fp = pjFactionFile(project, entityName);
                const file = this.getVaultMeta().getAbstractFileByPath(fp);
                if (file) await this.getFS().delete(fp);
            } else if (entityType === '物品' || entityType === '设定') {
                const fp = pjItemFile(project, entityName);
                const file = this.getVaultMeta().getAbstractFileByPath(fp);
                if (file) await this.getFS().delete(fp);
            }
        } catch (e) { console.warn('[SettlementEngine] 删除实体失败:', entityType, entityName, e); }
    }

    // ================================================================
    // 信息债看板完整刷新（v1.3.1 重写，对齐 shared_utils.js refreshInfoDebt）
    // ================================================================
    private async refreshInfoDebt(project: string): Promise<void> {
        try {
            const allFiles = this.getVaultMeta().getFiles();
            const projectFiles = allFiles.filter(f => f.path.startsWith(project + '/'));
            const charFiles = projectFiles.filter(f => f.path.startsWith(pjCharsDir(project) + '/') && f.name.endsWith('.md') && f.name !== '人物模板.md');
            const chapFiles = projectFiles.filter(f => f.path.startsWith(pjOutlineDir(project) + '/') && f.name.includes('正文') && f.name.endsWith('.md'));

            // 1. 伏笔统计（遍历两表）
            let unrevealed = 0, revealed = 0, abandoned = 0;
            try {
                const fsFile = this.getVaultMeta().getAbstractFileByPath(pjForeshadowDB(project));
                if (fsFile instanceof TFile) {
                    const content = await this.getFS().read(pjForeshadowDB(project));
                    for (const line of content.split('\n')) {
                        if (!line.match(/^\|.*\|/)) continue;
                        const cols = line.split('|').map(s => s.trim()).filter(Boolean);
                        if (cols.length === 0) continue;
                        if (cols[0] === '#' || cols[0].includes('---') || cols[0] === '伏笔') continue;
                        const status = cols[cols.length - 1] || '';
                        if (status.includes('未揭示') || status === '') unrevealed++;
                        else if (status.includes('已揭示') || status.includes('揭示') || status.includes('回收')) revealed++;
                        else abandoned++;
                    }
                }
            } catch (e) { console.warn('[SettlementEngine] 伏笔统计失败:', e); }

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
                } catch (e) { console.warn("[小说工坊] 操作异常:", e instanceof Error ? e.message : e); }
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
            await this.getFS().write(fp, content);
        } catch (e) { console.warn('[SettlementEngine] 刷新信息债看板失败:', e); }
    }

    // ================================================================
    // Markdown 表格工具方法（getNextRowNum / hasTableSeparator / appendAfterSeparator）
    // 已外迁至 ./settlement/markdown-table-utils.ts
    // ================================================================

    // v3.5.0: 结算后生成叙事总览
    async generateNarrativeOverview(project: string): Promise<string> {
        const baseDir = pjOutlineDir(project);
        const charDir = pjCharsDir(project);
        const factionDir = pjFactionsDir(project);
        const locDir = pjLocsDir(project);
        const itemDir = pjItemsDir(project);
        const foreshadowPath = pjForeshadowDB(project);
        const timelinePath = pjTimelineBoard(project);

        let completed = 0, drafts = 0;
        const allFiles = this.getVaultMeta().getFiles().filter(f => f.name.endsWith('.md'));

        // 统计章节进度
        for (const f of allFiles) {
            if (!f.path.startsWith(baseDir + '/') || !f.name.includes('正文')) continue;
            try {
                const raw = await this.getFS().read(f.path);
                // v4.0: 章节状态优先匹配新值 settled/written；旧值 '已完稿' 仅保留兼容
                if (raw.includes('status: settled') || raw.includes('status: written') || raw.includes('status: 已完稿')) completed++;
                else drafts++;
            } catch (e) {
                console.warn('[SettlementEngine] 叙事总览失败:', e);
                this.notifier.showNotice('SettlementEngine：数据读取异常，部分功能可能受限');
            }
        }

        // 收集实体摘要
        const collectEntities = async (dir: string, field: string): Promise<string> => {
            const rows: string[] = [];
            for (const f of allFiles) {
                if (!f.path.startsWith(dir + '/')) continue;
                try {
                    const raw = await this.getFS().read(f.path);
                    const fm = raw.match(/^---\n([\s\S]*?)\n---/);
                    if (!fm) continue;
                    const name = (fm[1].match(new RegExp(`^${field}:\\s*(.+)$`, 'm')) || [])[1]?.trim() || f.basename;
                    const status = (fm[1].match(/^状态:\s*(.+)$/m) || [])[1]?.trim() || '-';
                    rows.push(`| ${name} | ${status} | - |`);
                } catch (e) {
                    console.warn('[SettlementEngine] 叙事总览失败:', e);
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
            console.warn('[SettlementEngine] 叙事总览失败:', e);
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
            console.warn('[SettlementEngine] 叙事总览失败:', e);
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
