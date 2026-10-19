/**
 * quality-dashboard-modal.ts — 章节质量仪表盘
 *
 * v4.10.7 联动重构：
 * - 修复章节定位：工作台视图活动时 getActiveFile 返回 null，fallback 到工作台当前章节状态
 * - 时间范围筛选（当前章/最近3章/最近5章/全部章节）→ 图表联动更新
 * - 维度钻取：点击维度横条 → 问题列表过滤
 * - 导出：导出当前「范围 + 维度」筛选后的数据集
 */

import { App, Modal, TFile, Notice } from 'obsidian';
import NovelWriterPlugin from '../main';
import {
    QualityScoreEngine,
    DIMENSION_LABELS,
    QUALITY_DIMENSIONS,
} from '../engine/quality/quality-score-engine';
import type { QualityScore } from '../engine/quality/quality-score-engine';
import { exportTextFile } from '../shared/export-file';
import { radarChart } from './svg-charts';
import type { RadarDataItem } from './svg-charts';
import { getChaptersForProject } from './project-utils';

type QualityDimensionKey = (typeof QUALITY_DIMENSIONS)[number];
type QualityIssueType = QualityScore['issues'][number];
type ChapterRange = 'current' | 'recent3' | 'recent5' | 'all';

// 避免 import full-writer-view 造成循环依赖，用字符串类型 + 运行时方法探测
const FULL_WRITER_VIEW_TYPE = 'novel-writer-full-writer';

const RANGE_LABELS: Record<ChapterRange, string> = {
    current: '当前章节',
    recent3: '最近3章',
    recent5: '最近5章',
    all: '全部章节',
};

interface ChapterEntry {
    chapter: string;
    volume: string;
    chapterNum: number;
    title: string;
    file: TFile;
}

interface ChapterQualityEntry extends ChapterEntry {
    score: QualityScore;
}

interface IssueRow {
    issue: QualityIssueType;
    chapter: string;
    file: TFile;
}

export class QualityDashboardModal extends Modal {
    private plugin: NovelWriterPlugin;
    private engine: QualityScoreEngine;
    private project = '';
    private chapters: ChapterEntry[] = [];
    private range: ChapterRange = 'current';
    private activeDimension: QualityDimensionKey | null = null;
    private qualityCache = new Map<string, QualityScore>();
    private currentScores: ChapterQualityEntry[] = [];

    // UI 引用（联动重渲染用）
    private radarEl?: HTMLElement;
    private dimListEl?: HTMLElement;
    private issuesTitleEl?: HTMLElement;
    private issuesEl?: HTMLElement;

    constructor(app: App, plugin: NovelWriterPlugin, engine?: QualityScoreEngine) {
        super(app);
        this.plugin = plugin;
        this.engine = engine ?? new QualityScoreEngine();
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h2', { text: '📊 章节质量仪表盘' });

        // 1. 定位章节：优先活动文件，fallback 工作台当前章节
        const located = this.locateChapter();
        if (!located) {
            contentEl.createEl('p', { text: '❌ 无法定位章节，请先在工作台打开一个章节，或打开章节正文文件' });
            return;
        }
        this.project = located.project;

        // 2. 扫描项目章节
        this.chapters = this.scanChapters();
        if (this.chapters.length === 0) {
            contentEl.createEl('p', { text: '❌ 项目下未找到章节正文' });
            return;
        }

        // 3. 渲染工具栏（时间范围选择 + 导出）
        this.renderToolbar(contentEl);

        // 4. 渲染图表区（雷达图 + 维度横条 + 问题列表）
        const grid = contentEl.createEl('div', { cls: 'nw-qd-layout' });

        const leftCard = grid.createEl('div');
        this.radarEl = leftCard.createEl('div', { cls: 'nw-qd-chart' });
        this.dimListEl = leftCard.createEl('div', { cls: 'nw-qd-dim-list' });

        const rightCard = grid.createEl('div');
        this.issuesTitleEl = rightCard.createEl('h3');
        this.issuesEl = rightCard.createEl('div', { cls: 'nw-qd-issues' });

        // 5. 首次加载 + 事实面板
        void this.refreshData().then(() => this.renderFactPanel(contentEl));
    }

    /** 定位章节：活动文件 → 工作台当前章节 fallback */
    private locateChapter(): { project: string; chapterNum: number; volume: string } | null {
        const activeFile = this.app.workspace.getActiveFile();
        if (activeFile) {
            const m = activeFile.path.match(/^(.+?)\/03-大纲与章节\/正文\/第(\d+)卷\/第(\d+)章_正文\.md$/);
            if (m) return { project: m[1], volume: `第${m[2]}卷`, chapterNum: parseInt(m[3], 10) };
            const proj = activeFile.path.split('/')[0];
            if (proj) return { project: proj, chapterNum: 0, volume: '' };
        }
        // fallback：工作台当前章节状态（工作台视图活动时 getActiveFile 为 null）
        const leaf = this.app.workspace.getLeavesOfType(FULL_WRITER_VIEW_TYPE)[0];
        const st = (leaf?.view as { getCurrentChapterState?: () => { project: string; chapterNum: number; volume: string } } | null)?.getCurrentChapterState?.();
        if (st?.project && st.chapterNum > 0) {
            return { project: st.project, chapterNum: st.chapterNum, volume: st.volume };
        }
        if (st?.project) {
            return { project: st.project, chapterNum: 0, volume: '' };
        }
        return null;
    }

    private scanChapters(): ChapterEntry[] {
        const list = getChaptersForProject(this.app, this.project);
        return list
            .map((c) => ({
                chapter: c.chapter,
                volume: c.volume,
                chapterNum: parseInt(c.chapter.match(/\d+/)?.[0] || '0', 10),
                title: c.title,
                file: c.file,
            }))
            .filter((c) => c.chapterNum > 0)
            .sort((a, b) => a.chapterNum - b.chapterNum);
    }

    private renderToolbar(contentEl: HTMLElement): void {
        const bar = contentEl.createEl('div', { cls: 'nw-qd-toolbar' });
        bar.createEl('span', { text: '📅 时间范围：', cls: 'nw-qd-toolbar-label' });
        const select = bar.createEl('select', { cls: 'dropdown' });
        (['current', 'recent3', 'recent5', 'all'] as ChapterRange[]).forEach((r) => {
            select.createEl('option', { value: r, text: RANGE_LABELS[r] });
        });
        select.value = this.range;
        select.addEventListener('change', () => {
            this.range = select.value as ChapterRange;
            this.activeDimension = null; // 切换范围重置钻取
            void this.refreshData();
        });

        const exportBtn = bar.createEl('button', { text: '📤 导出数据', cls: 'nw-btn nw-btn-secondary' });
        exportBtn.addEventListener('click', () => { void this.exportData(); });
    }

    private getRangeEntries(): ChapterEntry[] {
        if (this.range === 'all') return this.chapters;
        const n = this.range === 'current' ? 1 : this.range === 'recent3' ? 3 : 5;
        const sorted = [...this.chapters].sort((a, b) => b.chapterNum - a.chapterNum);
        return sorted.slice(0, n).sort((a, b) => a.chapterNum - b.chapterNum);
    }

    private async refreshData(): Promise<void> {
        if (!this.radarEl || !this.dimListEl || !this.issuesEl || !this.issuesTitleEl) return;

        const entries = this.getRangeEntries();
        const scores: ChapterQualityEntry[] = [];
        for (const e of entries) {
            const cacheKey = e.file.path;
            let score = this.qualityCache.get(cacheKey);
            if (!score) {
                const text = await this.app.vault.read(e.file);
                score = await this.engine.evaluate(text);
                this.qualityCache.set(cacheKey, score);
            }
            scores.push({ ...e, score });
        }
        this.currentScores = scores;
        this.renderCharts(scores);
    }

    private renderCharts(scores: ChapterQualityEntry[]): void {
        // 聚合六维评分（范围内章节平均）
        const aggDims = QUALITY_DIMENSIONS.map((dim) => {
            const avg = scores.length
                ? scores.reduce((s, e) => s + (e.score.dimensions[dim]?.score ?? 0), 0) / scores.length
                : 0;
            return { dim, avg: Math.round(avg) };
        });
        const overall = aggDims.length
            ? Math.round(aggDims.reduce((s, a) => s + a.avg, 0) / aggDims.length)
            : 0;

        // 雷达图（聚合评分）
        const radarData: RadarDataItem[] = aggDims.map((a) => ({
            label: DIMENSION_LABELS[a.dim],
            value: a.avg,
        }));
        if (this.radarEl) {
            this.radarEl.innerHTML = radarChart(radarData, { size: 300, title: `聚合评分 ${overall}` });
        }

        // 维度横条（可点击钻取）
        const dimListEl = this.dimListEl;
        if (dimListEl) {
            dimListEl.empty();
            aggDims.forEach((a) => {
                const row = dimListEl.createEl('div', {
                    cls: 'nw-qd-dim-row' + (this.activeDimension === a.dim ? ' nw-qd-dim-row-active' : ''),
                });
                row.createEl('span', { text: DIMENSION_LABELS[a.dim], cls: 'nw-qd-dim-name' });
                const track = row.createEl('div', { cls: 'nw-qd-dim-track' });
                const bar = track.createEl('div', { cls: 'nw-qd-dim-bar' });
                // R2：仅保留运行时宽度参数，其余静态样式由 .nw-qd-dim-bar 接管
                bar.style.width = `${a.avg}%`;
                row.createEl('span', { text: String(a.avg), cls: 'nw-qd-dim-score' });
                row.addEventListener('click', () => {
                    this.activeDimension = this.activeDimension === a.dim ? null : a.dim;
                    this.renderCharts(scores);
                });
            });
        }

        // 问题列表（受维度钻取过滤）
        const allIssues: IssueRow[] = scores.flatMap((e) =>
            e.score.issues.map((issue) => ({ issue, chapter: e.chapter, file: e.file })),
        );
        const filtered = this.activeDimension
            ? allIssues.filter((x) => x.issue.dimension === this.activeDimension)
            : allIssues;

        if (this.issuesTitleEl) {
            const suffix = this.activeDimension ? ` · 维度：${DIMENSION_LABELS[this.activeDimension]}` : '';
            this.issuesTitleEl.setText(`🔍 问题清单（${filtered.length}）${suffix}`);
        }
        if (this.issuesEl) {
            this.issuesEl.empty();
            if (filtered.length === 0) {
                this.issuesEl.createEl('p', { text: '✅ 该维度/范围内未发现明显问题' });
                return;
            }
            for (const { issue, chapter } of filtered) {
                const line = issue.location?.line;
                const pos = line !== undefined ? `（第 ${line} 行）` : '';
                const sev = issue.severity === 'high' ? '🔴' : issue.severity === 'medium' ? '🟡' : '🟢';
                const row = this.issuesEl.createEl('div', { cls: 'nw-qd-issue' });
                row.createEl('span', { text: `${sev} [${DIMENSION_LABELS[issue.dimension]}] ${chapter} ` });
                row.createEl('span', { text: `${issue.description}${pos}` });
            }
        }
    }

    /** 导出当前联动状态（时间范围 + 维度筛选）后的数据集 */
    private async exportData(): Promise<void> {
        const entries = this.getRangeEntries();
        const payload = {
            project: this.project,
            range: this.range,
            rangeLabel: RANGE_LABELS[this.range],
            activeDimension: this.activeDimension,
            activeDimensionLabel: this.activeDimension ? DIMENSION_LABELS[this.activeDimension] : null,
            chapterCount: entries.length,
            exportedAt: new Date().toISOString(),
            chapters: entries.map((e) => {
                const score = this.qualityCache.get(e.file.path);
                return {
                    chapter: e.chapter,
                    volume: e.volume,
                    title: e.title,
                    wordCount: score?.wordCount ?? 0,
                    overallScore: score?.overallScore ?? 0,
                    dimensions: score
                        ? QUALITY_DIMENSIONS.map((d) => ({
                            dimension: d,
                            label: DIMENSION_LABELS[d],
                            score: Math.round(score.dimensions[d]?.score ?? 0),
                        }))
                        : [],
                    issues:
                        score?.issues
                            .filter((i) => !this.activeDimension || i.dimension === this.activeDimension)
                            .map((i) => ({
                                dimension: i.dimension,
                                severity: i.severity,
                                description: i.description,
                                line: i.location?.line,
                            })) ?? [],
                };
            }),
        };

        await exportTextFile(
            this.app,
            `质量报告-${this.project}-${RANGE_LABELS[this.range]}.json`,
            JSON.stringify(payload, null, 2),
            {
                mime: 'application/json',
                successMessage: `✅ 已导出 ${entries.length} 章质量数据（${RANGE_LABELS[this.range]}${this.activeDimension ? ` · ${DIMENSION_LABELS[this.activeDimension]}` : ''}）`,
            }
        );
    }

    private async renderFactPanel(contentEl: HTMLElement): Promise<void> {
        const project = this.project;
        if (!project) return;

        let factIndex;
        try {
            factIndex = await this.plugin.engineRegistry.getFactIndexManager(project);
        } catch {
            return;
        }

        const pending = factIndex.listPending();
        if (pending.length === 0) return;

        const panel = contentEl.createEl('div', { cls: 'nw-qd-facts' });
        panel.createEl('h3', { text: `📋 待确认事实（${pending.length}）` });

        for (const fact of pending) {
            const row = panel.createEl('div', { cls: 'nw-qd-fact' });
            row.createEl('div', {
                text: `【${fact.category}】${fact.name}：${fact.content}（来源：${fact.source}）`,
            });

            const confirmBtn = row.createEl('button', { text: '确认写入', cls: 'nw-btn nw-btn-primary' });
            const ignoreBtn = row.createEl('button', { text: '忽略', cls: 'nw-btn nw-btn-secondary' });

            confirmBtn.onclick = async () => {
                await factIndex.confirm(fact.id);
                row.remove();
                if (factIndex.listPending().length === 0) {
                    panel.empty();
                    panel.createEl('p', { text: '✅ 全部事实已处理' });
                }
            };
            ignoreBtn.onclick = async () => {
                await factIndex.ignore(fact.id);
                row.remove();
                if (factIndex.listPending().length === 0) {
                    panel.empty();
                    panel.createEl('p', { text: '✅ 全部事实已处理' });
                }
            };
        }
    }

    onClose(): void {
        this.contentEl.empty();
    }
}
