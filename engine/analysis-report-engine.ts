import { App, TFile } from 'obsidian';
import { splitTableCells } from '../shared/chapter-table';
import { listEntityFiles } from '../shared/entity-reader';
import { AIEngine } from './ai-engine';
import { ContextManager } from './context-manager';
import { 
    FullAnalysisReport, 
    EntityChange, 
    ForeshadowChange, 
    TimelineEvent, 
    EmotionCurvePoint 
} from '../shared/types';
import {
    pjCharsDir,
    pjLocsDir,
    pjFactionsDir,
    pjItemsDir,
    pjForeshadowDB,
    pjTimelineBoard
} from '../shared/paths';
import { CharacterConsistencyChecker, ConsistencyCheckResult } from './character-consistency-checker';
import { withWriteLock } from '../shared/write-lock';
import { VectorEnhancer } from './vector-enhancer';
import { 
    hasTableSeparator, 
    appendAfterSeparator, 
    getNextRowNum, 
    mkdirp 
} from '../utils/helpers';
import { ObsidianFileSystem, ObsidianVaultMeta } from '../shared/file-system-port';
import { setFrontmatterValue } from '../shared/frontmatter';
import type { FileSystemPort, VaultMetaPort } from '../shared/file-system-port';
import { createLogger } from '../shared/logger';
import { resolveTaskModelConfig } from '../shared/task-model';
import { resolveProviderSourceType } from '../shared/model-source';
import { parseReport } from './settlement/report-parser';


const log = createLogger('AnalysisReportEngine');
/** 分析子任务（角色状态/时间线提取）送入模型的正文上限；超过部分不再参与检测 */
const ANALYSIS_BODY_SLICE = 12_000;
/**
 * v6.0 智能分析报告引擎
 * 
 * 核心职责：
 * 1. 从正文中提取实体（人物/地点/势力/物品）并检测状态变化
 * 2. 自动识别伏笔埋入与回收，更新伏笔生命周期
 * 3. 提取本章关键事件，追加到时间线
 * 4. 生成情绪曲线分析数据
 */
export class AnalysisReportEngine {
    private app: App;
    private aiEngine: AIEngine;
    private contextManager: ContextManager;
    private characterConsistencyChecker: CharacterConsistencyChecker;
    private fs: FileSystemPort | null = null;
    private vaultMeta: VaultMetaPort | null = null;

    constructor(
        app: App,
        aiEngine: AIEngine,
        contextManager: ContextManager,
        vectorEnhancer?: VectorEnhancer,
        /** 共享的 CharacterConsistencyChecker；若不提供将延迟到首次 check 时抛错。
         *  推荐：由 EngineRegistry 注入共享实例，避免多实例状态不同步。 */
        characterConsistencyChecker?: CharacterConsistencyChecker,
    ) {
        this.app = app;
        this.aiEngine = aiEngine;
        this.contextManager = contextManager;
        // 仅使用注入的共享实例；不再内部 new 以避免多实例状态不同步。
        // vectorEnhancer 参数保留用于向后兼容（旧调用方可能传递），但不再用于创建 CharacterConsistencyChecker。
        void vectorEnhancer;
        this.characterConsistencyChecker = characterConsistencyChecker
            ?? (null as unknown as CharacterConsistencyChecker);
    }

    private getFS(): FileSystemPort {
        if (!this.fs) {
            this.fs = new ObsidianFileSystem(this.app);
        }
        return this.fs;
    }

    private getVaultMeta(): VaultMetaPort {
        if (!this.vaultMeta) {
            this.vaultMeta = new ObsidianVaultMeta(this.app);
        }
        return this.vaultMeta;
    }

    /**
     * 执行完整分析流程
     * @param project - 项目（路径或对象）
     * @param chapterText - 章节文本
     * @param chapterName - 章节名
     * @param chapterNum - 章号
     * @param volume - 卷
     * @param existingReport - 已有报告
      * @returns FullAnalysisReport 实例
     */
    async executeFullAnalysis(
        project: string,
        chapterText: string,
        chapterName: string,
        chapterNum: number,
        volume: string,
        existingReport?: string,
    ): Promise<FullAnalysisReport> {
        const startTime = Date.now();
        const wordCount = chapterText.length;

        // 步骤 9 已经产出分析报告时，优先解析已有指令，避免再用 2 次 AI 重复抽取实体/时间线。
        // 只有“确实含结构化指令”才跳过 AI：旧报告/叙述型报告没有 UPDATE_ 等指令，
        // 直接解析会得到全空实体/时间线，属于静默数据丢失，必须回退 AI 抽取。
        if (existingReport && existingReport.trim()) {
            const instructions = parseReport(existingReport);
            if (this.hasStructuredInstructions(instructions)) {
                return this.analyzeFromReport(project, existingReport, chapterName, chapterNum, volume, wordCount, startTime);
            }
            log.info('[AnalysisReportEngine] 已有报告不含结构化指令，回退 AI 抽取', { chapterNum });
        }

        log.info(`[AnalysisReportEngine] 开始分析第${chapterNum}章: ${chapterName}`);

        const [
            entityAnalysis,
            foreshadowAnalysis,
            timelineAnalysis,
            emotionAnalysis
        ] = await Promise.all([
            this.analyzeEntities(project, chapterText, chapterNum, chapterName),
            this.analyzeForeshadows(project, chapterText, chapterNum),
            this.analyzeTimeline(chapterText, chapterNum),
            this.analyzeEmotion(chapterText)
        ]);

        const report: FullAnalysisReport = {
            meta: {
                project,
                chapterName,
                chapterNum,
                volume,
                wordCount,
                timestamp: new Date().toISOString(),
                aiModel: 'ai-powered',
                processingTimeMs: Date.now() - startTime
            },
            entities: entityAnalysis,
            foreshadows: foreshadowAnalysis,
            timeline: timelineAnalysis,
            emotionCurve: emotionAnalysis,
            summary: this.generateSummary(entityAnalysis, foreshadowAnalysis, timelineAnalysis, emotionAnalysis),
            majorChanges: this.collectMajorChanges(entityAnalysis, foreshadowAnalysis),
            warnings: [],
            suggestions: []
        };

        log.info(`[AnalysisReportEngine] 分析完成，耗时 ${report.meta.processingTimeMs}ms`);
        return report;
    }

    /**
     * 运行人设一致性检测
     * @param chapterText 章节正文
     * @param characterInfos 人物信息列表
     * @returns 一致性检测结果
     */
    /**
     * 从步骤 9 的报告文本构建结构化结果（无 AI 调用）。
     *
     * @param project - 项目（路径或对象）
     * @param reportText - 报告文本
     * @param chapterName - 章节名
     * @param chapterNum - 章号
     * @param volume - 卷
     * @param wordCount - 词语数量
     * @param startTime - 起始时间
      * @returns FullAnalysisReport 实例
     */
    analyzeFromReport(
        project: string,
        reportText: string,
        chapterName: string,
        chapterNum: number,
        volume: string,
        wordCount: number,
        startTime: number,
    ): FullAnalysisReport {
        const instr = parseReport(reportText);
        const toEntity = (
            name: string,
            category: 'character' | 'location' | 'faction' | 'item',
            changeType: 'status_updated' | 'created',
            newValue?: string,
        ): EntityChange => ({
            name,
            category,
            changeType,
            newValue: newValue || '',
            isMajor: /死亡|陨落|牺牲|重伤|突破|觉醒|飞升|重生/.test(newValue || ''),
        });
        const characters = [
            ...instr.uc.map(u => toEntity(u.name, 'character', 'status_updated', u.value)),
            ...instr.nc.map(n => toEntity(n.name, 'character', 'created', n.description)),
            ...instr.emotion.map(e => toEntity(e.name, 'character', 'status_updated', e.emotion)),
        ];
        const locations = [
            ...instr.uloc.map(u => toEntity(u.name, 'location', 'status_updated', u.value)),
            ...instr.nl.map(n => toEntity(n.name, 'location', 'created', n.description)),
        ];
        const factions = [
            ...instr.ufa.map(u => toEntity(u.name, 'faction', 'status_updated', u.value)),
            ...instr.nf.map(n => toEntity(n.name, 'faction', 'created', n.description)),
        ];
        const items = [
            ...instr.uitem.map(u => toEntity(u.name, 'item', 'status_updated', u.value)),
            ...instr.ni.map(n => toEntity(n.name, 'item', 'created', n.description)),
        ];
        const planted = instr.nfs.map(n => ({
            name: n.name, changeType: 'planted' as const, plantedChapter: n.chapter, context: n.reveal,
        }));
        const recovered = instr.uf
            .filter(u => /已揭示|回收|revealed/i.test(u.value))
            .map(u => ({ name: u.name, changeType: 'recovered' as const, context: u.value }));
        const mentioned = instr.uf
            .filter(u => !/已揭示|回收|revealed/i.test(u.value))
            .map(u => ({ name: u.name, changeType: 'mentioned' as const, context: u.value }));
        const timeline = instr.nt.map((n, idx) => ({
            chapter: chapterNum,
            order: idx + 1,
            time: n.desc,
            event: n.event,
            involvedEntities: [],
            importance: 'medium' as const,
        }));
        const entitySummary = `人物 ${characters.length} / 地点 ${locations.length} / 势力 ${factions.length} / 物品 ${items.length}`;
        const foreshadowSummary = `新埋 ${planted.length} / 回收 ${recovered.length} / 提及 ${mentioned.length}`;
        return {
            meta: {
                project,
                chapterName,
                chapterNum,
                volume,
                wordCount,
                timestamp: new Date().toISOString(),
                aiModel: 'parsed-step-report',
                processingTimeMs: Date.now() - startTime,
            },
            entities: {
                characters, locations, factions, items,
                summary: entitySummary,
            },
            foreshadows: {
                planted, recovered, mentioned,
                summary: foreshadowSummary,
            },
            timeline: {
                events: timeline,
                summary: `解析到 ${timeline.length} 个时间线事件`,
            },
            emotionCurve: {
                points: [],
                avgIntensity: 0,
                peakIntensity: 0,
                valleyIntensity: 0,
                inflectionPoints: 0,
                summary: '已有分析报告未包含情绪曲线，跳过重复 AI 抽取',
            },
            summary: `${entitySummary}；${foreshadowSummary}；时间线 ${timeline.length} 条（来自步骤 9 报告）`,
            majorChanges: [...characters, ...locations, ...factions, ...items]
                .filter(e => e.isMajor)
                .map(e => `${e.name}：${e.newValue || '状态重大变化'}`),
            warnings: [],
            suggestions: [],
        };
    }

    private hasStructuredInstructions(instructions: ReturnType<typeof parseReport>): boolean {
        return Object.values(instructions).some(value => Array.isArray(value) && value.length > 0);
    }

    /**
     * 检查角色一致性。
     * @param chapterText - 参数值
     * @param characterInfos - 参数值
      * @returns ConsistencyCheckResult 实例
     */
    async checkCharacterConsistency(
        chapterText: string,
        characterInfos: Array<{
            name: string;
            personality?: string;
            appearance?: string;
            abilities?: string;
            background?: string;
        }>
    ): Promise<ConsistencyCheckResult> {
        log.info('[AnalysisReportEngine] 开始执行人设一致性检测');
        const result = await this.characterConsistencyChecker.check(
            chapterText,
            characterInfos
        );
        log.info(`[AnalysisReportEngine] 人设一致性检测完成，得分 ${result.overallScore}`);
        return result;
    }

    /**
     * 将人设一致性检测结果附加到分析报告中
     * @param report 分析报告
     * @param chapterText 章节正文
     * @param characterInfos 人物信息列表
     * @returns 更新后的报告
     */
    async attachCharacterConsistencyToReport(
        report: FullAnalysisReport,
        chapterText: string,
        characterInfos: Array<{
            name: string;
            personality?: string;
            appearance?: string;
            abilities?: string;
            background?: string;
        }>
    ): Promise<FullAnalysisReport> {
        try {
            const consistencyResult = await this.checkCharacterConsistency(chapterText, characterInfos);
            
            report.characterConsistency = consistencyResult;
            
            const totalIssues = Object.values(consistencyResult.characterResults).reduce(
                (sum, r) => sum + r.inconsistencies.length, 0
            );
            
            if (totalIssues > 0) {
                const highIssues = Object.values(consistencyResult.characterResults).reduce(
                    (sum, r) => sum + r.inconsistencies.filter(i => i.severity === 'high').length, 0
                );
                
                if (highIssues > 0) {
                    report.warnings.push(`人设一致性警告：发现 ${highIssues} 处严重不一致，请查看详情`);
                }
                
                report.suggestions.push(`人设一致性得分 ${consistencyResult.overallScore} 分，共 ${totalIssues} 处待确认`);
            }
            
            return report;
        } catch (e) {
            log.warn('[AnalysisReportEngine] 人设一致性检测失败，跳过', e);
            return report;
        }
    }

    /**
     * 将分析报告的变更写入项目文件（需用户确认后调用）
     * @param project - 项目（路径或对象）
     * @param report - 报告
     * @returns 变更摘要 { applied: 已应用的项, pending: 需手动处理的项 }
     */
    async applyReportChanges(project: string, report: FullAnalysisReport): Promise<{ success: boolean; applied: string[]; pending: string[]; details: string }> {
        log.info('[AnalysisReportEngine] 开始应用报告变更...');
        const applied: string[] = [];
        const pending: string[] = [];

        try {
            // 1. 更新实体状态（自动应用 + 生成待手动处理清单）
            const entityResult = await this.applyEntityChanges(project, report.entities);
            if (entityResult.applied) applied.push(`实体状态更新（${entityResult.count} 项）`);
            if (entityResult.pending) pending.push(`实体状态手动更新（${entityResult.count} 项）`);

            // 2. 更新伏笔库
            const foreshadowResult = await this.applyForeshadowChanges(project, report.foreshadows, report.meta.chapterNum);
            if (foreshadowResult.applied) applied.push(`伏笔库更新（${foreshadowResult.count} 项）`);
            if (foreshadowResult.pending) pending.push(`伏笔库手动更新（${foreshadowResult.count} 项）`);

            // 3. 更新时间线
            const timelineResult = await this.applyTimelineChanges(project, report.timeline);
            if (timelineResult.applied) applied.push(`时间线更新（${timelineResult.count} 项）`);
            if (timelineResult.pending) pending.push(`时间线手动更新（${timelineResult.count} 项）`);

            const details = this.buildChangeSummary(applied, pending);
            log.info('[AnalysisReportEngine] 变更应用完成:', applied.length, '项已应用,', pending.length, '项待手动处理');
            return { success: true, applied, pending, details };
        } catch (e) {
            log.error('[AnalysisReportEngine] 应用变更失败:', e);
            return { success: false, applied, pending, details: `应用失败: ${e}` };
        }
    }

    private buildChangeSummary(applied: string[], pending: string[]): string {
        const lines: string[] = [];
        if (applied.length > 0) {
            lines.push('### ✅ 已自动应用');
            applied.forEach(a => lines.push(`- ${a}`));
        }
        if (pending.length > 0) {
            lines.push('');
            lines.push('### ⚠️ 需手动应用（暂不支持自动写入）');
            pending.forEach(p => lines.push(`- ${p}`));
            lines.push('');
            lines.push('> 请根据分析报告中的详细建议，手动更新对应文件。');
        }
        return lines.join('\n');
    }

    // ============================================================
    // 实体分析
    // ============================================================

    private async analyzeEntities(
        project: string,
        chapterText: string,
        chapterNum: number,
        chapterName: string
    ): Promise<FullAnalysisReport['entities']> {
        const characters = await this.analyzeCharacterEntities(project, chapterText);
        const locations = this.analyzeLocationEntities(project, chapterText);
        const factions = this.analyzeFactionEntities(project, chapterText);
        const items = this.analyzeItemEntities(project, chapterText);

        const totalCount = characters.length + locations.length + factions.length + items.length;
        const summary = `检测到 ${characters.length} 个人物，${locations.length} 个地点，${factions.length} 个势力，${items.length} 个物品`;

        return { characters, locations, factions, items, summary };
    }

    private async analyzeCharacterEntities(
        project: string,
        chapterText: string
    ): Promise<EntityChange[]> {
        const changes: EntityChange[] = [];
        const charFiles = listEntityFiles(this.app, project, 'characters');

        const charNames: string[] = [];
        const charStates: Record<string, { oldStatus?: string; file: TFile }> = {};

        for (const f of charFiles) {
            const fm = this.app.metadataCache.getFileCache(f)?.frontmatter;
            if (!fm) continue;
            const name = fm['姓名'] || fm['名称'] || fm['name'] || '';
            if (!name) continue;
            charNames.push(name);
            charStates[name] = {
                oldStatus: fm['当前状态'] || undefined,
                file: f as TFile
            };
        }

        const appearedChars: string[] = [];
        for (const name of charNames) {
            const pattern = new RegExp(`(\\[\\[${name}\\]\\]|${this.escapeRegex(name)})`, 'g');
            if (pattern.test(chapterText)) {
                appearedChars.push(name);
            }
        }

        if (appearedChars.length === 0) return [];

        try {
            const statusChanges = await this.detectCharacterStateChanges(chapterText, appearedChars);
            for (const sc of statusChanges) {
                const oldStatus = charStates[sc.entityName]?.oldStatus;
                const isMajor = this.isMajorStatusChange(sc.newStatus);
                changes.push({
                    name: sc.entityName,
                    category: 'character',
                    changeType: 'status_updated',
                    oldValue: oldStatus,
                    newValue: sc.newStatus,
                    isMajor,
                    context: sc.reason
                });
            }

            const detectedNames = new Set(statusChanges.map(s => s.entityName));
            for (const name of appearedChars) {
                if (!detectedNames.has(name)) {
                    changes.push({
                        name,
                        category: 'character',
                        changeType: 'appeared',
                        isMajor: false
                    });
                }
            }
        } catch (e) {
            log.warn('[AnalysisReportEngine] 角色状态检测失败，降级为出现检测:', e);
            for (const name of appearedChars) {
                changes.push({
                    name,
                    category: 'character',
                    changeType: 'appeared',
                    isMajor: false
                });
            }
        }

        return changes;
    }

    /**
     * 结构化提取（角色状态/时间线）的任务级调用。
     *
     * 旧实现把 'flash' 当模型名传给 API：它不是任何供应商的真实模型，
     * 4xx 不会触发模型回退，结果被 catch 吞掉后返回空数组。
     * 这里统一走 analysis 任务的真实模型，并把输出限制在结构化提取的合理上限。
     */
    private async callAnalysisExtraction(prompt: string, temperature: number) {
        const plugin = this.aiEngine.getPlugin();
        const config = resolveTaskModelConfig(
            plugin.settings,
            'analysis',
            (model, endpoint) => plugin.resolveModelLimits(model, endpoint),
        );
        const provider = (plugin.settings.customProviders || []).find(p =>
            Array.isArray(p.models)
            && p.models.includes(config.model)
            && resolveProviderSourceType({ id: p.id, endpoint: p.endpoint, sourceType: p.sourceType }) === 'local',
        );
        const route = provider
            ? {
                endpoint: provider.endpoint,
                apiKey: plugin.settings.providerKeys?.[provider.id] || 'ollama',
                disableFallback: true,
            }
            : {};
        return this.aiEngine.callAI(
            '',
            prompt,
            config.model,
            temperature,
            Math.min(config.maxOutput, 8192),
            {
                ...route,
                thinkingMode: config.thinkingMode,
                thinkingBudget: config.thinkingBudget,
            },
        );
    }

    private async detectCharacterStateChanges(
        chapterText: string,
        charNames: string[]
    ): Promise<Array<{ entityName: string; newStatus: string; reason: string; confidence: number }>> {
        const prompt = `你是一个小说实体状态变更检测器。

【任务】分析以下正文内容，检测每位角色的状态是否发生变化。
输出 JSON 数组（不要加 \`\`\` 包裹）：
[
  { "entityName": "角色名", "newStatus": "新状态描述", "reason": "变更原因简述", "confidence": 0.9 }
]

【规则】
1. 只有状态确实发生变化时才输出（战斗受伤、情绪重大改变、位置迁移、境界突破等）
2. 无明显变化的不输出
3. 一次最多检测 8 个角色
4. confidence：0.9=非常确定，0.7=比较确定，0.5=可能
5. newStatus 应简洁（≤30字）

【涉及角色】${charNames.join('、')}

【正文内容】（前 12000 字）：
${chapterText.slice(0, ANALYSIS_BODY_SLICE)}

【输出】仅输出 JSON 数组：`;

        try {
            const response = await this.callAnalysisExtraction(prompt, 0.7);
            if (response.error) {
                log.warn(`[AnalysisReportEngine] 角色状态提取失败: ${response.error}`);
                return [];
            }
            const text = (response.content || '').trim();
            const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/) || text.match(/([\[{][\s\S]*)/);
            const jsonStr = jsonMatch ? jsonMatch[1] || jsonMatch[0] : text;
            const parsed = JSON.parse(jsonStr);
            const changes = Array.isArray(parsed) ? parsed : (parsed.changes || []);
            return changes
                .filter((c: any) => c.entityName && c.newStatus && charNames.includes(c.entityName))
                .map((c: any) => ({
                    entityName: c.entityName,
                    newStatus: c.newStatus,
                    reason: c.reason || '',
                    confidence: c.confidence || 0.8
                }));
        } catch (e) {
            log.warn('[AnalysisReportEngine] AI状态检测失败:', e);
            return [];
        }
    }

    private isMajorStatusChange(status: string): boolean {
        const majorKeywords = ['死亡', '陨落', '牺牲', '重伤', '濒死', '突破', '觉醒', '入魔', '飞升', '重生'];
        return majorKeywords.some(k => status.includes(k));
    }

    private analyzeLocationEntities(project: string, chapterText: string): EntityChange[] {
        const changes: EntityChange[] = [];
        const locFiles = listEntityFiles(this.app, project, 'locations');

        for (const f of locFiles) {
            const fm = this.app.metadataCache.getFileCache(f)?.frontmatter;
            if (!fm) continue;
            const name = fm['名称'] || fm['name'] || '';
            if (!name) continue;
            const pattern = new RegExp(`(\\[\\[${name}\\]\\]|${this.escapeRegex(name)})`, 'g');
            if (pattern.test(chapterText)) {
                changes.push({
                    name,
                    category: 'location',
                    changeType: 'appeared',
                    isMajor: false
                });
            }
        }

        return changes;
    }

    private analyzeFactionEntities(project: string, chapterText: string): EntityChange[] {
        const changes: EntityChange[] = [];
        const factionFiles = listEntityFiles(this.app, project, 'factions');

        for (const f of factionFiles) {
            const fm = this.app.metadataCache.getFileCache(f)?.frontmatter;
            if (!fm) continue;
            const name = fm['名称'] || fm['name'] || '';
            if (!name) continue;
            const pattern = new RegExp(`(\\[\\[${name}\\]\\]|${this.escapeRegex(name)})`, 'g');
            if (pattern.test(chapterText)) {
                changes.push({
                    name,
                    category: 'faction',
                    changeType: 'appeared',
                    isMajor: false
                });
            }
        }

        return changes;
    }

    private analyzeItemEntities(project: string, chapterText: string): EntityChange[] {
        const changes: EntityChange[] = [];
        const itemFiles = listEntityFiles(this.app, project, 'items');

        for (const f of itemFiles) {
            const fm = this.app.metadataCache.getFileCache(f)?.frontmatter;
            if (!fm) continue;
            const name = fm['名称'] || fm['name'] || '';
            if (!name) continue;
            const pattern = new RegExp(`(\\[\\[${name}\\]\\]|${this.escapeRegex(name)})`, 'g');
            if (pattern.test(chapterText)) {
                changes.push({
                    name,
                    category: 'item',
                    changeType: 'appeared',
                    isMajor: false
                });
            }
        }

        return changes;
    }

    private escapeRegex(str: string): string {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    // ============================================================
    // 伏笔分析
    // ============================================================

    private async analyzeForeshadows(
        project: string,
        chapterText: string,
        chapterNum: number
    ): Promise<FullAnalysisReport['foreshadows']> {
        const planted: ForeshadowChange[] = [];
        const recovered: ForeshadowChange[] = [];
        const mentioned: ForeshadowChange[] = [];

        const unrevealedForeshadows = await this.getUnrevealedForeshadows(project);

        for (const fs of unrevealedForeshadows) {
            const pattern = new RegExp(this.escapeRegex(fs.name), 'g');
            if (pattern.test(chapterText)) {
                const context = this.extractContext(chapterText, fs.name);
                const isRecovered = this.isForeshadowRecovered(chapterText, fs.name);
                if (isRecovered) {
                    recovered.push({
                        id: fs.id,
                        name: fs.name,
                        changeType: 'recovered',
                        plantedChapter: fs.buryChapter,
                        context
                    });
                } else {
                    mentioned.push({
                        id: fs.id,
                        name: fs.name,
                        changeType: 'mentioned',
                        plantedChapter: fs.buryChapter,
                        context
                    });
                }
            }
        }

        const newPlanted = this.detectNewForeshadows(chapterText, chapterNum);
        planted.push(...newPlanted);

        const summary = `本章埋入 ${planted.length} 个伏笔，回收 ${recovered.length} 个，提及 ${mentioned.length} 个`;
        return { planted, recovered, mentioned, summary };
    }

    private async getUnrevealedForeshadows(project: string): Promise<Array<{ id: string; name: string; buryChapter: string; status: string }>> {
        const items: Array<{ id: string; name: string; buryChapter: string; status: string }> = [];
        try {
            const fp = pjForeshadowDB(project);
            const ff = this.getVaultMeta().getAbstractFileByPath(fp);
            if (!(ff instanceof TFile)) return items;

            const content = await this.getFS().read(fp);
            const parsed = this.parseForeshadowTable(content);
            for (const item of parsed) {
                const s = item.status || '';
                if (s.includes('未揭示') || s === '') {
                    items.push({
                        id: item.id,
                        name: item.name,
                        buryChapter: item.buryChapter,
                        status: item.status
                    });
                }
            }
        } catch (e) {
            log.warn('[AnalysisReportEngine] 读取伏笔库失败:', e);
        }
        return items;
    }

    private parseForeshadowTable(content: string): Array<{ id: string; name: string; buryChapter: string; status: string }> {
        const lines = content.split('\n');
        let headerIdx = -1;
        const colMap: Record<string, number> = {};

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line.match(/^\|.*\|$/)) continue;
            const cols = splitTableCells(line);
            if (cols.length < 2) continue;
            const lowerCols = cols.map(c => c.toLowerCase());
            const hasId = lowerCols.some(c => c === '#' || c === '编号' || c === 'id' || c === '序号');
            const hasName = lowerCols.some(c => c.includes('伏笔') || c === '名称' || c === '名字' || c === '内容');
            if (hasId && hasName) {
                headerIdx = i;
                for (let j = 0; j < cols.length; j++) {
                    const col = lowerCols[j];
                    if (col === '#' || col === '编号' || col === 'id' || col === '序号') colMap['id'] = j;
                    else if (col.includes('伏笔') || col === '名称' || col === '名字' || col === '内容') colMap['name'] = j;
                    else if (col.includes('埋设') || col.includes('埋入') || col.includes('出现') || col === '章节') {
                        if (!colMap['buryChapter']) colMap['buryChapter'] = j;
                    }
                    else if (col.includes('状态') || col === 'status') colMap['status'] = j;
                }
                if (!colMap['status']) colMap['status'] = cols.length - 1;
                break;
            }
        }

        if (headerIdx === -1) return [];

        const items: Array<{ id: string; name: string; buryChapter: string; status: string }> = [];
        for (let i = headerIdx + 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line.match(/^\|.*\|$/)) continue;
            const cols = splitTableCells(line);
            if (cols.length < 2) continue;
            if (cols[0].includes('---')) continue;

            const status = colMap['status'] !== undefined ? (cols[colMap['status']] || '') : (cols[cols.length - 1] || '');
            items.push({
                id: colMap['id'] !== undefined ? (cols[colMap['id']] || String(items.length + 1)) : String(items.length + 1),
                name: colMap['name'] !== undefined ? (cols[colMap['name']] || '') : (cols[1] || ''),
                buryChapter: colMap['buryChapter'] !== undefined ? (cols[colMap['buryChapter']] || '') : (cols[3] || ''),
                status: status || '未揭示'
            });
        }
        return items;
    }

    private extractContext(text: string, keyword: string): string {
        const idx = text.indexOf(keyword);
        if (idx === -1) return '';
        const start = Math.max(0, idx - 30);
        const end = Math.min(text.length, idx + keyword.length + 30);
        let excerpt = text.slice(start, end).replace(/\n/g, ' ');
        if (start > 0) excerpt = '...' + excerpt;
        if (end < text.length) excerpt = excerpt + '...';
        return excerpt;
    }

    private isForeshadowRecovered(text: string, name: string): boolean {
        const recoveryPatterns = [
            `${name}.*终于`,
            `${name}.*原来`,
            `揭开.*${name}`,
            `${name}.*真相`,
            `${name}.*揭晓`,
            `揭晓.*${name}`,
            `${name}.*秘密`,
        ];
        for (const p of recoveryPatterns) {
            if (new RegExp(p).test(text)) return true;
        }
        return false;
    }

    private detectNewForeshadows(text: string, chapterNum: number): ForeshadowChange[] {
        const results: ForeshadowChange[] = [];
        const seen = new Set<string>();

        const patterns = [
            { pattern: /那东西/g, category: '物件' },
            { pattern: /神秘人/g, category: '人物' },
            { pattern: /黑衣人/g, category: '人物' },
            { pattern: /传说中的[^，。；！？\s]{1,6}/g, category: '设定' },
            { pattern: /据说/g, category: '设定' },
            { pattern: /传闻/g, category: '设定' },
            { pattern: /那件事/g, category: '事件' },
            { pattern: /当年的事/g, category: '事件' },
            { pattern: /总有一天/g, category: '事件' },
            { pattern: /三年后/g, category: '事件' },
            { pattern: /五年后/g, category: '事件' },
        ];

        const paragraphs = text.split(/\n{2,}/).map(p => p.trim()).filter(p => p.length > 0);

        for (let i = 0; i < paragraphs.length; i++) {
            const para = paragraphs[i];
            for (const { pattern, category } of patterns) {
                let match;
                while ((match = pattern.exec(para)) !== null) {
                    const content = match[0];
                    if (!seen.has(content)) {
                        seen.add(content);
                        const context = this.extractContext(para, content);
                        results.push({
                            name: content,
                            changeType: 'planted',
                            plantedChapter: `第${chapterNum}章`,
                            context
                        });
                    }
                }
            }
        }

        return results.slice(0, 10);
    }

    // ============================================================
    // 时间线分析
    // ============================================================

    private async analyzeTimeline(
        chapterText: string,
        chapterNum: number
    ): Promise<FullAnalysisReport['timeline']> {
        try {
            const events = await this.extractTimelineEvents(chapterText, chapterNum);
            const summary = `提取到 ${events.length} 个关键事件`;
            return { events, summary };
        } catch (e) {
            log.warn('[AnalysisReportEngine] 时间线提取失败:', e);
            return { events: [], summary: '时间线提取失败' };
        }
    }

    private async extractTimelineEvents(
        chapterText: string,
        chapterNum: number
    ): Promise<TimelineEvent[]> {
        const prompt = `你是一个小说关键事件提取器。

【任务】从以下正文中提取本章的关键事件，生成时间线。
输出 JSON 数组（不要加 \`\`\` 包裹）：
[
  {
    "order": 1,
    "event": "事件描述（20字以内）",
    "time": "时间标记（如：黄昏/三日后/子时，没有则留空）",
    "location": "地点（没有则留空）",
    "involvedEntities": ["角色A", "角色B"],
    "importance": "high|medium|low"
  }
]

【规则】
1. 只提取本章中实际发生的重要事件
2. 按时间顺序排列
3. 每章提取 3-8 个关键事件
4. importance: high=主线重大事件, medium=重要支线, low=次要事件
5. event 描述简洁，不超过20字

【正文内容】（前 12000 字）：
${chapterText.slice(0, ANALYSIS_BODY_SLICE)}

【输出】仅输出 JSON 数组：`;

        try {
            const response = await this.callAnalysisExtraction(prompt, 0.6);
            if (response.error) {
                log.warn(`[AnalysisReportEngine] 时间线提取失败: ${response.error}`);
                return this.extractTimelineByRule(chapterText, chapterNum);
            }
            const text = (response.content || '').trim();
            const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/) || text.match(/([\[{][\s\S]*)/);
            const jsonStr = jsonMatch ? jsonMatch[1] || jsonMatch[0] : text;
            const parsed = JSON.parse(jsonStr);
            const events = Array.isArray(parsed) ? parsed : (parsed.events || []);

            return events
                .filter((e: any) => e.event)
                .map((e: any, idx: number) => ({
                    chapter: chapterNum,
                    order: e.order || idx + 1,
                    event: e.event,
                    time: e.time || undefined,
                    location: e.location || undefined,
                    involvedEntities: e.involvedEntities || [],
                    importance: this.normalizeImportance(e.importance)
                }));
        } catch (e) {
            log.warn('[AnalysisReportEngine] AI时间线提取失败:', e);
            return this.extractTimelineByRule(chapterText, chapterNum);
        }
    }

    private normalizeImportance(imp: string): 'low' | 'medium' | 'high' {
        if (!imp) return 'medium';
        const lower = imp.toLowerCase();
        if (lower.includes('high') || lower.includes('高') || lower.includes('重大')) return 'high';
        if (lower.includes('low') || lower.includes('低') || lower.includes('次要')) return 'low';
        return 'medium';
    }

    private extractTimelineByRule(chapterText: string, chapterNum: number): TimelineEvent[] {
        const events: TimelineEvent[] = [];
        const timeMarkers = [
            /次日/g, /翌日/g, /三日后/g, /五日后/g, /十日后/g,
            /子时/g, /丑时/g, /寅时/g, /卯时/g, /辰时/g, /巳时/g,
            /午时/g, /未时/g, /申时/g, /酉时/g, /戌时/g, /亥时/g,
            /清晨/g, /早晨/g, /上午/g, /中午/g, /下午/g, /黄昏/g, /傍晚/g, /深夜/g, /夜里/g,
        ];

        const sentences = chapterText.split(/[。！？]/).filter(s => s.trim().length > 10);
        let order = 1;

        for (const sentence of sentences) {
            const trimmed = sentence.trim();
            if (trimmed.length < 15 || trimmed.length > 60) continue;

            let hasTime = false;
            let timeMark = '';
            for (const tm of timeMarkers) {
                const match = trimmed.match(tm);
                if (match) {
                    hasTime = true;
                    timeMark = match[0];
                    break;
                }
            }

            const actionKeywords = /(闯入|到达|发现|击败|杀死|救出|逃离|相遇|告别|突破|觉醒|进入|离开)/;
            if (actionKeywords.test(trimmed) || hasTime) {
                const importance = hasTime ? 'medium' : 'low';
                events.push({
                    chapter: chapterNum,
                    order: order++,
                    event: trimmed.slice(0, 30),
                    time: timeMark || undefined,
                    involvedEntities: [],
                    importance
                });
                if (events.length >= 5) break;
            }
        }

        return events;
    }

    // ============================================================
    // 情绪曲线分析
    // ============================================================

    private async analyzeEmotion(chapterText: string): Promise<FullAnalysisReport['emotionCurve']> {
        if (!chapterText || chapterText.length < 200) {
            return {
                points: [],
                avgIntensity: 50,
                peakIntensity: 50,
                valleyIntensity: 50,
                inflectionPoints: 0,
                summary: '文本过短，无法分析'
            };
        }

        const segments = this.segmentEmotionText(chapterText, 600);
        const points: EmotionCurvePoint[] = [];
        let pos = 0;

        for (let i = 0; i < segments.length; i++) {
            const seg = segments[i];
            try {
                const result = await this.analyzeEmotionSegment(seg, i, pos);
                points.push(result);
            } catch (e) {
                log.warn(`[AnalysisReportEngine] 情绪片段 ${i} 分析失败:`, e);
                points.push({
                    segment: i,
                    startIndex: pos,
                    endIndex: pos + seg.length,
                    intensity: 50,
                    valence: 'neutral',
                    dominantEmotion: '平静',
                    isInflection: false
                });
            }
            pos += seg.length;
        }

        const intensities = points.map(p => p.intensity);
        const avgIntensity = intensities.length > 0
            ? Math.round(intensities.reduce((a, b) => a + b, 0) / intensities.length)
            : 50;
        const peakIntensity = intensities.length > 0 ? Math.max(...intensities) : 50;
        const valleyIntensity = intensities.length > 0 ? Math.min(...intensities) : 50;
        const inflectionPoints = this.countInflectionPoints(points);

        let summary = '';
        if (avgIntensity >= 70) summary = '情绪强度较高，高潮章节';
        else if (avgIntensity >= 40) summary = '情绪强度适中，叙事平稳';
        else summary = '情绪强度较低，铺垫章节';

        return { points, avgIntensity, peakIntensity, valleyIntensity, inflectionPoints, summary };
    }

    private segmentEmotionText(text: string, targetLength: number): string[] {
        const segments: string[] = [];
        let start = 0;

        while (start < text.length) {
            let end = Math.min(start + targetLength, text.length);
            if (end < text.length) {
                const lastPeriod = text.lastIndexOf('。', end);
                const lastExclaim = text.lastIndexOf('！', end);
                const lastQuestion = text.lastIndexOf('？', end);
                const breakPoint = Math.max(lastPeriod, lastExclaim, lastQuestion);
                if (breakPoint > start + targetLength / 2) {
                    end = breakPoint + 1;
                }
            }
            segments.push(text.slice(start, end));
            start = end;
        }

        return segments;
    }

    private async analyzeEmotionSegment(
        text: string,
        index: number,
        startPos: number
    ): Promise<EmotionCurvePoint> {
        const baseTension = this.estimateBaseTension(text);

        let intensity = baseTension;
        let valence: 'positive' | 'neutral' | 'negative' = 'neutral';
        let dominantEmotion = '平静';

        const positivePatterns = /(喜悦|开心|高兴|幸福|温暖|希望|振奋|激动|欣喜|释然)/;
        const negativePatterns = /(悲伤|痛苦|绝望|恐惧|愤怒|仇恨|悲伤|难过|委屈|焦虑)/;
        const tensionPatterns = /(紧张|惊险|危机|危险|战斗|厮杀|追杀|逃亡|对峙)/;

        if (positivePatterns.test(text)) {
            valence = 'positive';
            dominantEmotion = '喜悦';
            intensity = Math.min(100, intensity + 20);
        } else if (negativePatterns.test(text)) {
            valence = 'negative';
            dominantEmotion = '悲伤';
            intensity = Math.min(100, intensity + 15);
        }

        if (tensionPatterns.test(text)) {
            intensity = Math.min(100, intensity + 25);
            if (valence === 'neutral') {
                valence = 'negative';
                dominantEmotion = '紧张';
            }
        }

        return {
            segment: index,
            startIndex: startPos,
            endIndex: startPos + text.length,
            intensity,
            valence,
            dominantEmotion,
            isInflection: false
        };
    }

    private estimateBaseTension(text: string): number {
        const tensionKeywords = /[危险死亡威胁紧张恐惧惊恐愤怒仇恨杀战斗打冲]/g;
        const matches = text.match(tensionKeywords);
        const matchCount = matches ? matches.length : 0;
        const density = (matchCount / Math.max(text.length, 1)) * 100;
        return Math.min(100, 30 + density * 50);
    }

    private countInflectionPoints(points: EmotionCurvePoint[]): number {
        if (points.length < 3) return 0;
        let count = 0;
        for (let i = 1; i < points.length - 1; i++) {
            const prev = points[i - 1].intensity;
            const curr = points[i].intensity;
            const next = points[i + 1].intensity;
            if ((curr > prev && curr > next) || (curr < prev && curr < next)) {
                points[i].isInflection = true;
                count++;
            }
        }
        return count;
    }

    private generateSummary(
        entities: FullAnalysisReport['entities'],
        foreshadows: FullAnalysisReport['foreshadows'],
        timeline: FullAnalysisReport['timeline'],
        emotion: FullAnalysisReport['emotionCurve']
    ): string {
        const totalEntities = entities.characters.length + entities.locations.length;
        return `本章共检测到 ${totalEntities} 个实体，${foreshadows.recovered.length} 个伏笔回收，${timeline.events.length} 个关键事件，平均情绪强度 ${emotion.avgIntensity}%。`;
    }

    private collectMajorChanges(
        entities: FullAnalysisReport['entities'],
        foreshadows: FullAnalysisReport['foreshadows']
    ): string[] {
        const changes: string[] = [];
        entities.characters.filter(c => c.isMajor).forEach(c => {
            changes.push(`⚠️ 人物重大变更: ${c.name} ${c.oldValue ? c.oldValue + ' → ' : ''}${c.newValue}`);
        });
        foreshadows.recovered.forEach(f => {
            changes.push(`🔮 伏笔回收: ${f.name}`);
        });
        return changes;
    }

    private async applyEntityChanges(project: string, entities: FullAnalysisReport['entities']): Promise<{ applied: boolean; pending: boolean; count: number }> {
        const count = (entities?.characters?.length || 0) + (entities?.factions?.length || 0) + (entities?.locations?.length || 0) + (entities?.items?.length || 0);
        if (count === 0) return { applied: false, pending: false, count: 0 };

        let appliedCount = 0;

        try {
            const statusChanges = entities.characters.filter(c => c.changeType === 'status_updated' && c.newValue);
            for (const change of statusChanges) {
                const success = await this.applySingleCharacterStatusChange(project, change);
                if (success) appliedCount++;
            }

            log.info('[AnalysisReportEngine] 实体状态更新完成:', appliedCount, '/', statusChanges.length, '项');
            return {
                applied: appliedCount > 0,
                pending: appliedCount < statusChanges.length,
                count: statusChanges.length
            };
        } catch (e) {
            log.error('[AnalysisReportEngine] 实体状态更新失败:', e);
            return { applied: false, pending: true, count };
        }
    }

    private async applySingleCharacterStatusChange(project: string, change: EntityChange): Promise<boolean> {
        try {
            const files = listEntityFiles(this.app, project, 'characters');

            let targetFile: TFile | null = null;
            for (const f of files) {
                const fm = this.app.metadataCache.getFileCache(f)?.frontmatter;
                if (!fm) continue;
                const name = fm['姓名'] || fm['名称'] || fm['name'] || '';
                if (name === change.name) {
                    targetFile = f as TFile;
                    break;
                }
            }

            if (!targetFile) return false;

            const filePath = targetFile.path;
            let content = await this.getFS().read(filePath);
            const now = new Date().toISOString();

            content = this.updateFrontmatterField(content, '当前状态', change.newValue || '');
            content = this.updateFrontmatterField(content, 'entity_last_changed_at', change.context || `第${change.name}章`);
            content = this.updateFrontmatterField(content, 'entity_last_changed_reason', change.context || '');
            if (!content.match(/^entity_status:/m)) {
                content = this.updateFrontmatterField(content, 'entity_status', 'active');
            }
            if (!content.match(/^entity_created_at:/m)) {
                content = this.updateFrontmatterField(content, 'entity_created_at', now);
            }

            await this.getFS().write(filePath, content);
            return true;
        } catch (e) {
            log.warn('[AnalysisReportEngine] 人物状态更新失败:', change.name, e);
            return false;
        }
    }

    private updateFrontmatterField(content: string, fieldName: string, value: string): string {
        // 统一走 shared/frontmatter：空值行与历史重复键都能正确收敛（旧实现会插出重复键）
        return setFrontmatterValue(content, fieldName, value);
    }

    private async applyForeshadowChanges(
        project: string,
        foreshadows: FullAnalysisReport['foreshadows'],
        chapterNum: number
    ): Promise<{ applied: boolean; pending: boolean; count: number }> {
        const count = (foreshadows?.planted?.length || 0) + (foreshadows?.recovered?.length || 0);
        if (count === 0) return { applied: false, pending: false, count: 0 };

        let appliedCount = 0;

        try {
            const fp = pjForeshadowDB(project);
            const ff = this.getVaultMeta().getAbstractFileByPath(fp);
            if (!(ff instanceof TFile)) {
                return { applied: false, pending: true, count };
            }

            // P1-1（v4.27）：伏笔库读-改-写整段进锁，防止与结算/协同互相覆盖
            let appliedCount2 = 0;
            await withWriteLock(fp, async () => {
                let content = await this.getFS().read(fp);
                let changed = false;

                const chapterName = `第${chapterNum}章`;

                if (foreshadows.recovered && foreshadows.recovered.length > 0) {
                    for (const f of foreshadows.recovered) {
                        const newContent = this.moveForeshadowToRevealed(content, f.name, chapterName);
                        if (newContent !== content) {
                            content = newContent;
                            changed = true;
                            appliedCount2++;
                        }
                    }
                }

                if (foreshadows.planted && foreshadows.planted.length > 0) {
                    for (const f of foreshadows.planted) {
                        const newRow = `| ${getNextRowNum(content)} | ${f.name} | 中 | 第${chapterNum}章 | 待定 | 未揭示 |`;
                        if (hasTableSeparator(content)) {
                            content = appendAfterSeparator(content, newRow);
                            changed = true;
                            appliedCount2++;
                        }
                    }
                }

                if (changed) {
                    await this.getFS().write(fp, content);
                    log.info('[AnalysisReportEngine] 伏笔库更新完成:', appliedCount2, '项');
                }
            });
            appliedCount += appliedCount2;

            return {
                applied: appliedCount > 0,
                pending: appliedCount < count,
                count
            };
        } catch (e) {
            log.error('[AnalysisReportEngine] 伏笔库更新失败:', e);
            return { applied: false, pending: true, count };
        }
    }

    private moveForeshadowToRevealed(content: string, name: string, revealChapter: string): string {
        const lines = content.split('\n');
        let foundRow = -1;
        let foundCols: string[] | null = null;

        for (let i = 0; i < lines.length; i++) {
            const l = lines[i];
            if (l.match(/^\|.*\|/)) {
                const cols = splitTableCells(l);
                if (cols.length >= 6 && cols[1] === name && !cols[cols.length - 1].includes('已揭示') && !cols[cols.length - 1].includes('揭示')) {
                    foundRow = i;
                    foundCols = cols;
                }
            }
        }

        if (foundRow === -1 || !foundCols) return content;

        lines.splice(foundRow, 1);

        let sepIdx = -1;
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].includes('已揭示') || lines[i].includes('已回收')) {
                for (let j = i + 1; j < lines.length; j++) {
                    if (lines[j].match(/^\|[- ]+\|/)) {
                        sepIdx = j;
                        break;
                    }
                }
                break;
            }
        }

        if (sepIdx !== -1) {
            const newRowNum = getNextRowNum(lines.join('\n'));
            const newRow = `| ${newRowNum} | ${foundCols[1]} | ${foundCols[2] || '中'} | ${foundCols[3] || ''} | ${foundCols[4] || ''} | ${revealChapter} | 已揭示 |`;
            lines.splice(sepIdx + 1, 0, newRow);
        }

        return lines.join('\n');
    }

    private async applyTimelineChanges(project: string, timeline: FullAnalysisReport['timeline']): Promise<{ applied: boolean; pending: boolean; count: number }> {
        const count = timeline?.events?.length || 0;
        if (count === 0) return { applied: false, pending: false, count: 0 };

        let appliedCount = 0;

        try {
            const fp = pjTimelineBoard(project);
            // 时间线看板被结算/分析报告/关联索引三方读改写，必须整段加锁并在锁内重读，
            // 否则并发时后写方拿旧内容覆盖，丢行。
            appliedCount = await withWriteLock(fp, async () => {
                let applied = 0;
                const ff = this.getVaultMeta().getAbstractFileByPath(fp);

                let content = '';
                if (ff instanceof TFile) {
                    content = await this.getFS().read(fp);
                } else {
                    const timelineDir = project + '/02-时间线与伏笔';
                    await mkdirp(this.app, timelineDir, this.getFS());
                    content = `# 时间线看板\n\n| # | 事件名称 | 时间 | 地点 | 涉及人物 | 章节 | 类型 |\n|---|---|---|---|---|---|---|\n`;
                }

                const highImportanceEvents = timeline.events.filter(e => e.importance === 'high' || e.importance === 'medium');

                for (const event of highImportanceEvents) {
                    const rowNum = getNextRowNum(content);
                    const involved = event.involvedEntities && event.involvedEntities.length > 0
                        ? event.involvedEntities.join('、')
                        : '';
                    const newRow = `| ${rowNum} | ${event.event} | ${event.time || ''} | ${event.location || ''} | ${involved} | 第${event.chapter}章 | ${event.importance === 'high' ? '主线' : '支线'} |`;

                    if (hasTableSeparator(content)) {
                        content = appendAfterSeparator(content, newRow);
                        applied++;
                    }
                }

                if (applied > 0) {
                    await this.getFS().write(fp, content);
                    log.info('[AnalysisReportEngine] 时间线更新完成:', applied, '项');
                }
                return applied;
            });

            return {
                applied: appliedCount > 0,
                pending: appliedCount < count,
                count
            };
        } catch (e) {
            log.error('[AnalysisReportEngine] 时间线更新失败:', e);
            return { applied: false, pending: true, count };
        }
    }
}
