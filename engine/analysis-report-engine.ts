import { App, TFile, TFolder } from 'obsidian';
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
    pjForeshadowDB
} from '../shared/paths';

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

    constructor(app: App, aiEngine: AIEngine, contextManager: ContextManager) {
        this.app = app;
        this.aiEngine = aiEngine;
        this.contextManager = contextManager;
    }

    /**
     * 执行完整分析流程
     */
    async executeFullAnalysis(
        project: string,
        chapterText: string,
        chapterName: string,
        chapterNum: number,
        volume: string
    ): Promise<FullAnalysisReport> {
        const startTime = Date.now();
        const wordCount = chapterText.length;

        console.log(`[AnalysisReportEngine] 开始分析第${chapterNum}章: ${chapterName}`);

        // 并行执行各项分析（简化版：先用mock数据保证流程通）
        const [
            entityAnalysis,
            foreshadowAnalysis,
            timelineAnalysis,
            emotionAnalysis
        ] = await Promise.all([
            this.mockEntityAnalysis(),
            this.mockForeshadowAnalysis(),
            this.mockTimelineAnalysis(chapterNum),
            this.mockEmotionAnalysis()
        ]);

        // 汇总报告
        const report: FullAnalysisReport = {
            meta: {
                project,
                chapterName,
                chapterNum,
                volume,
                wordCount,
                timestamp: new Date().toISOString(),
                aiModel: 'mock',
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

        console.log(`[AnalysisReportEngine] 分析完成，耗时 ${report.meta.processingTimeMs}ms`);
        return report;
    }

    /**
     * 将分析报告的变更写入项目文件（需用户确认后调用）
     * @returns 变更摘要 { applied: 已应用的项, pending: 需手动处理的项 }
     */
    async applyReportChanges(project: string, report: FullAnalysisReport): Promise<{ success: boolean; applied: string[]; pending: string[]; details: string }> {
        console.log('[AnalysisReportEngine] 开始应用报告变更...');
        const applied: string[] = [];
        const pending: string[] = [];

        try {
            // 1. 更新实体状态（待实现：生成待手动应用的清单）
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
            console.log('[AnalysisReportEngine] 变更应用完成:', applied.length, '项已应用,', pending.length, '项待手动处理');
            return { success: true, applied, pending, details };
        } catch (e) {
            console.error('[AnalysisReportEngine] 应用变更失败:', e);
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
    // 内部实现（v6.0第一阶段先用mock，保证流程通）
    // ============================================================

    private async mockEntityAnalysis(): Promise<FullAnalysisReport['entities']> {
        return {
            characters: [
                { name: '李逍遥', category: 'character', changeType: 'status_updated', oldValue: '健康', newValue: '重伤', isMajor: true } as EntityChange,
                { name: '赵灵儿', category: 'character', changeType: 'appeared', isMajor: false } as EntityChange
            ],
            locations: [
                { name: '锁妖塔', category: 'location', changeType: 'appeared', isMajor: false } as EntityChange
            ],
            factions: [],
            items: [],
            summary: '检测到 2 个人物，1 个地点'
        };
    }

    private async mockForeshadowAnalysis(): Promise<FullAnalysisReport['foreshadows']> {
        return {
            planted: [],
            recovered: [{ name: '女娲血脉', changeType: 'recovered' } as ForeshadowChange],
            mentioned: [],
            summary: '本章回收 1 个伏笔'
        };
    }

    private async mockTimelineAnalysis(chapterNum: number): Promise<FullAnalysisReport['timeline']> {
        return {
            events: [
                { chapter: chapterNum, order: 1, event: '李逍遥闯入锁妖塔', importance: 'high' } as TimelineEvent,
                { chapter: chapterNum, order: 2, event: '赵灵儿觉醒女娲血脉', importance: 'high' } as TimelineEvent
            ],
            summary: '提取到 2 个关键事件'
        };
    }

    private async mockEmotionAnalysis(): Promise<FullAnalysisReport['emotionCurve']> {
        return {
            points: [],
            avgIntensity: 75,
            peakIntensity: 95,
            valleyIntensity: 30,
            inflectionPoints: 2,
            summary: '情绪强度较高，高潮章节'
        };
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
        console.log('[AnalysisReportEngine] 实体状态变更需手动应用（共', count, '项）');
        return { applied: false, pending: true, count };
    }

    private async applyForeshadowChanges(
        project: string, 
        foreshadows: FullAnalysisReport['foreshadows'], 
        chapterNum: number
    ): Promise<{ applied: boolean; pending: boolean; count: number }> {
        const count = (foreshadows?.planted?.length || 0) + (foreshadows?.recovered?.length || 0);
        if (count === 0) return { applied: false, pending: false, count: 0 };
        console.log('[AnalysisReportEngine] 伏笔库变更需手动应用（共', count, '项）');
        return { applied: false, pending: true, count };
    }

    private async applyTimelineChanges(project: string, timeline: FullAnalysisReport['timeline']): Promise<{ applied: boolean; pending: boolean; count: number }> {
        const count = timeline?.events?.length || 0;
        if (count === 0) return { applied: false, pending: false, count: 0 };
        console.log('[AnalysisReportEngine] 时间线变更需手动应用（共', count, '项）');
        return { applied: false, pending: true, count };
    }
}
