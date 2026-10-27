import { App } from 'obsidian';
import { AnalysisReportEngine } from '../../engine/analysis-report-engine';
import { FullAnalysisReport } from '../../shared/types';
import { createLogger } from '../../shared/logger';


const log = createLogger('AnalysisReportPanel');
/**
 * v6.0 智能分析报告展示面板
 * 展示实体变更、伏笔回收、时间线更新、情绪曲线
 */
export class AnalysisReportPanel {
    private app: App;
    private engine: AnalysisReportEngine;
    private container: HTMLElement | null = null;
    private currentReport: FullAnalysisReport | null = null;

    constructor(app: App, engine: AnalysisReportEngine) {
        this.app = app;
        this.engine = engine;
    }

    /**
     * 执行分析并渲染面板
     */
    async analyzeAndRender(
        container: HTMLElement,
        project: string,
        chapterText: string,
        chapterName: string,
        chapterNum: number,
        volume: string,
        existingReport?: string,
    ): Promise<FullAnalysisReport> {
        this.container = container;

        // 显示加载状态
        this.renderLoading();

        try {
            // 执行分析
            const report = await this.engine.executeFullAnalysis(
                project, chapterText, chapterName, chapterNum, volume, existingReport
            );
            this.currentReport = report;

            // 渲染结果
            this.renderReport(report);
            return report;
        } catch (e) {
            log.error('[AnalysisReportPanel] 分析失败:', e);
            this.renderError(e as Error);
            throw e;
        }
    }

    /**
     * 应用报告中的变更到项目文件
     */
    async applyChanges(): Promise<{ success: boolean; applied: string[]; pending: string[]; details: string }> {
        if (!this.currentReport) {
            return { success: false, applied: [], pending: [], details: '无可用分析报告' };
        }
        return await this.engine.applyReportChanges(
            this.currentReport.meta.project,
            this.currentReport
        );
    }

    private renderLoading(): void {
        if (!this.container) return;
        this.container.empty();

        const loading = this.container.createDiv({
            attr: { style: 'padding: 40px 20px; text-align: center;' }
        });
        loading.createEl('h4', { text: '🔄 智能分析中...' });
        loading.createEl('p', {
            text: '正在扫描实体、检测伏笔、提取时间线事件、分析情绪曲线...',
            attr: { style: 'color: var(--text-muted);' }
        });
    }

    private renderError(error: Error): void {
        if (!this.container) return;
        this.container.empty();

        const errorDiv = this.container.createDiv({
            attr: { style: 'padding: 20px; background: rgba(255, 68, 68, 0.1); border-radius: 8px;' }
        });
        errorDiv.createEl('h4', { text: '❌ 分析失败' });
        errorDiv.createEl('p', { text: error.message });
    }

    private renderReport(report: FullAnalysisReport): void {
        if (!this.container) return;
        this.container.empty();

        // 标题
        const header = this.container.createDiv({
            attr: { style: 'margin-bottom: 20px; padding-bottom: 16px; border-bottom: 1px solid var(--background-modifier-border);' }
        });
        header.createEl('h3', { text: '📊 智能分析报告' });
        header.createEl('p', {
            text: report.summary,
            attr: { style: 'color: var(--text-muted); margin: 4px 0;' }
        });

        // 重大变更警告
        if (report.majorChanges.length > 0) {
            const warningBox = this.container.createDiv({
                attr: { style: 'margin: 16px 0; padding: 12px 16px; background: rgba(255, 140, 0, 0.1); border-left: 4px solid #ff8c00; border-radius: 0 8px 8px 0;' }
            });
            warningBox.createEl('h4', { text: '⚠️ 检测到重大变更' });
            report.majorChanges.forEach(change => {
                warningBox.createEl('p', { text: change, attr: { style: 'margin: 4px 0;' } });
            });
        }

        // 创建4个卡片的网格
        const grid = this.container.createDiv({
            attr: { style: 'display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; margin: 20px 0;' }
        });

        // 1. 实体分析卡片
        this.renderEntityCard(grid, report);

        // 2. 伏笔分析卡片
        this.renderForeshadowCard(grid, report);

        // 3. 时间线分析卡片
        this.renderTimelineCard(grid, report);

        // 4. 情绪分析卡片
        this.renderEmotionCard(grid, report);

        // 操作按钮
        const actions = this.container.createDiv({
            attr: { style: 'margin-top: 24px; display: flex; gap: 12px; justify-content: flex-end;' }
        });

        const applyBtn = actions.createEl('button', {
            text: '✅ 确认并应用变更',
            cls: 'mod-cta'
        });
        applyBtn.style.cssText = 'padding: 10px 20px; font-weight: 600;';
        applyBtn.onclick = async () => {
            const result = await this.applyChanges();
            if (result.success) {
                // 触发结算流程
                this.container?.dispatchEvent(new CustomEvent('report-applied', {
                    detail: { report, result },
                    bubbles: true
                }));
            }
        };

        const skipBtn = actions.createEl('button', {
            text: '⏭️ 跳过（手动处理）',
            attr: { style: 'padding: 10px 20px; background: var(--background-secondary);' }
        });
        skipBtn.onclick = () => {
            this.container?.dispatchEvent(new CustomEvent('report-skipped', {
                detail: { report },
                bubbles: true
            }));
        };
    }

    private renderEntityCard(container: HTMLElement, report: FullAnalysisReport): void {
        const card = container.createDiv({
            attr: { style: 'padding: 16px; background: var(--background-secondary); border-radius: 8px;' }
        });
        card.createEl('h4', { text: '👤 实体分析' });

        const stats = card.createDiv({ attr: { style: 'display: flex; gap: 16px; margin: 12px 0;' } });
        stats.createEl('span', { text: `人物: ${report.entities.characters.length}` });
        stats.createEl('span', { text: `地点: ${report.entities.locations.length}` });

        if (report.entities.characters.length > 0) {
            const list = card.createDiv({ attr: { style: 'margin-top: 8px;' } });
            report.entities.characters.forEach(char => {
                const item = list.createDiv({
                    attr: { style: 'padding: 4px 8px; margin: 2px 0; background: var(--background-primary); border-radius: 4px; font-size: 13px;' }
                });
                let text = char.name;
                if (char.changeType === 'status_updated') {
                    text += ` ${char.oldValue || ''} → ${char.newValue || ''}`;
                }
                if (char.isMajor) {
                    text += ' ⚠️';
                }
                item.setText(text);
            });
        }

        card.createEl('p', {
            text: report.entities.summary,
            attr: { style: 'font-size: 12px; color: var(--text-muted); margin-top: 8px;' }
        });
    }

    private renderForeshadowCard(container: HTMLElement, report: FullAnalysisReport): void {
        const card = container.createDiv({
            attr: { style: 'padding: 16px; background: var(--background-secondary); border-radius: 8px;' }
        });
        card.createEl('h4', { text: '🔮 伏笔分析' });

        const stats = card.createDiv({ attr: { style: 'display: flex; gap: 16px; margin: 12px 0;' } });
        stats.createEl('span', { text: `埋入: ${report.foreshadows.planted.length}` });
        stats.createEl('span', { text: `回收: ${report.foreshadows.recovered.length}` });

        if (report.foreshadows.recovered.length > 0) {
            const list = card.createDiv({ attr: { style: 'margin-top: 8px;' } });
            report.foreshadows.recovered.forEach(f => {
                const item = list.createDiv({
                    attr: { style: 'padding: 4px 8px; margin: 2px 0; background: rgba(0, 200, 83, 0.1); border-radius: 4px; font-size: 13px;' }
                });
                item.setText(`✅ ${f.name}`);
            });
        }

        card.createEl('p', {
            text: report.foreshadows.summary,
            attr: { style: 'font-size: 12px; color: var(--text-muted); margin-top: 8px;' }
        });
    }

    private renderTimelineCard(container: HTMLElement, report: FullAnalysisReport): void {
        const card = container.createDiv({
            attr: { style: 'padding: 16px; background: var(--background-secondary); border-radius: 8px;' }
        });
        card.createEl('h4', { text: '📅 时间线分析' });

        if (report.timeline.events.length > 0) {
            const list = card.createDiv({ attr: { style: 'margin-top: 12px;' } });
            report.timeline.events.forEach((event, idx) => {
                const item = list.createDiv({
                    attr: { style: 'padding: 6px 8px; margin: 4px 0; background: var(--background-primary); border-radius: 4px; font-size: 13px;' }
                });
                const importanceColor = event.importance === 'high' ? '#e11d48' : event.importance === 'medium' ? '#f59e0b' : '#6b7280';
                item.createEl('span', {
                    text: `${event.order}. `,
                    attr: { style: `color: ${importanceColor}; font-weight: 600;` }
                });
                item.createSpan({ text: event.event });
            });
        }

        card.createEl('p', {
            text: report.timeline.summary,
            attr: { style: 'font-size: 12px; color: var(--text-muted); margin-top: 8px;' }
        });
    }

    private renderEmotionCard(container: HTMLElement, report: FullAnalysisReport): void {
        const card = container.createDiv({
            attr: { style: 'padding: 16px; background: var(--background-secondary); border-radius: 8px;' }
        });
        card.createEl('h4', { text: '📈 情绪分析' });

        const stats = card.createDiv({ attr: { style: 'margin: 12px 0;' } });

        // 平均情绪强度条
        const barContainer = stats.createDiv({ attr: { style: 'margin: 8px 0;' } });
        barContainer.createEl('span', { text: `平均强度: ${report.emotionCurve.avgIntensity}%` });
        const bar = barContainer.createDiv({
            attr: { style: 'width: 100%; height: 8px; background: var(--background-primary); border-radius: 4px; margin-top: 4px; overflow: hidden;' }
        });
        const fill = bar.createDiv({
            attr: { style: `width: ${report.emotionCurve.avgIntensity}%; height: 100%; background: linear-gradient(90deg, #22c55e, #e11d48); border-radius: 4px;` }
        });

        stats.createEl('p', { text: `峰值: ${report.emotionCurve.peakIntensity}% | 谷值: ${report.emotionCurve.valleyIntensity}% | 拐点: ${report.emotionCurve.inflectionPoints} 处`, attr: { style: 'font-size: 12px; color: var(--text-muted); margin-top: 8px;' } });

        card.createEl('p', {
            text: report.emotionCurve.summary,
            attr: { style: 'font-size: 12px; color: var(--text-muted); margin-top: 8px;' }
        });
    }
}
