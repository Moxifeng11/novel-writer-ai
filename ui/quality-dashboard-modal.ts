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
import type { Editor } from 'obsidian';
import NovelWriterPlugin from '@/main';
import {
    QualityScoreEngine,
    DIMENSION_LABELS,
    QUALITY_DIMENSIONS,
} from '@/engine/quality/quality-score-engine';
import type { QualityScore, EvaluationContext } from '@/engine/quality/quality-score-engine';
import { createWritingQualityEngine } from '@/engine/quality/quality-engine-factory';
import { exportTextFile } from '@/shared/export-file';
import { radarChart } from './svg-charts';
import type { RadarDataItem } from './svg-charts';
import { getChaptersForProject } from './project-utils';
import { createEmptyState } from './components/empty-state';
import { toCharacterContextInfos } from '@/engine/character-context';
import { findChapterFile, CHAPTER_FILE_TYPES } from '@/engine/chapter-utils';
import { pjStepDir } from '@/shared/paths';
import { DEVIATION_CHARACTER_INFO_TTL_MS } from '@/shared/thresholds';
import { stripFrontmatter } from '@/utils/helpers';
import { createLogger } from '@/shared/logger';

const log = createLogger('QualityDashboard');
const CHAPTER_OUTLINE_MAX_CHARS = 1200;

type QualityDimensionKey = (typeof QUALITY_DIMENSIONS)[number];
type QualityIssueType = QualityScore['issues'][number];
type ChapterRange = 'current' | 'recent3' | 'recent5' | 'all';

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

/**
 * QualityDashboardModal 类。
 */
export class QualityDashboardModal extends Modal {
    private plugin: NovelWriterPlugin;
    private engine: QualityScoreEngine;
    private project = '';
    private chapters: ChapterEntry[] = [];
    private range: ChapterRange = 'current';
    private activeDimension: QualityDimensionKey | null = null;
    /** 实例级缓存：命令每次打开都新建 Modal，关闭后随实例释放；单次打开内跨范围/维度切换复用 */
    private qualityCache = new Map<string, QualityScore>();
    private currentScores: ChapterQualityEntry[] = [];
    /** 人物名册按项目缓存 60s：看板一次评估多章，逐章读盘没有必要 */
    private characterNameCache: { project: string; at: number; names: string[] } | null = null;

    // UI 引用（联动重渲染用）
    private radarEl?: HTMLElement;
    private dimListEl?: HTMLElement;
    private issuesTitleEl?: HTMLElement;
    private issuesEl?: HTMLElement;

    constructor(app: App, plugin: NovelWriterPlugin, engine?: QualityScoreEngine) {
        super(app);
        this.plugin = plugin;
        this.engine = engine ?? new QualityScoreEngine({ v1Engine: createWritingQualityEngine() });
    }

    /**
     * onOpen 方法。
     */
    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h2', { text: '📊 章节质量仪表盘' });

        // 1. 定位章节：优先活动文件，fallback 工作台当前章节
        const located = this.locateChapter();
        if (!located) {
            contentEl.appendChild(createEmptyState({
                icon: 'chart',
                title: '无法定位章节',
                description: '请先在工作台打开一个章节，或打开章节正文文件；也可以先新建项目与章节。',
                actionText: '打开写作工作台',
                onAction: () => { this.close(); this.plugin.openFullWriterView(); },
            }));
            return;
        }
        this.project = located.project;

        // 2. 扫描项目章节
        this.chapters = this.scanChapters();
        if (this.chapters.length === 0) {
            contentEl.appendChild(createEmptyState({
                icon: 'book',
                title: '项目下未找到章节正文',
                description: '当前项目还没有正文文件。请先在工作台批量建章或导入大纲，再回来查看质量评分。',
                actionText: '打开写作工作台',
                onAction: () => { this.close(); this.plugin.openFullWriterView(); },
            }));
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

    /** 定位章节：统一走命令层章节目标（工作台上下文 > 正文文件 > 步骤目录），不再自建解析 */
    private locateChapter(): { project: string; chapterNum: number; volume: string } | null {
        const target = this.plugin.getActiveChapterTarget();
        if (target) {
            return { project: target.project, chapterNum: target.chapterNum, volume: target.volume };
        }
        // 非章节文件（世界观/大纲等）：只取所属项目，仪表盘按全书范围展示
        const project = this.plugin.getActiveProject();
        if (project) return { project, chapterNum: 0, volume: '' };
        return null;
    }

    private scanChapters(): ChapterEntry[] {
        const list = getChaptersForProject(this.app, this.project);
        return list
            .filter((c) => c.file instanceof TFile)
            .map((c) => ({
                chapter: c.chapter,
                volume: c.volume,
                chapterNum: parseInt(c.chapter.match(/\d+/)?.[0] || '0', 10),
                title: c.title,
                file: c.file as TFile,
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
            const cacheKey = this.qualityCacheKey(e);
            let score = this.qualityCache.get(cacheKey);
            if (!score) {
                const text = await this.app.vault.read(e.file);
                // C2：与协同写作同源传上下文，否则同一段正文在看板与顶栏的人物维度不同
                score = await this.engine.evaluate(text, await this.buildQualityContext(e));
                this.qualityCache.set(cacheKey, score);
            }
            scores.push({ ...e, score });
        }
        this.currentScores = scores;
        this.renderCharts(scores);
    }

    /** 缓存键必须带 mtime：同一弹窗内改稿后再次刷新不能命中旧分 */
    private qualityCacheKey(entry: ChapterEntry): string {
        return `${entry.file.path}:${entry.file.stat.mtime}`;
    }

    /**
     * 构建单章评估上下文：人物名册（按项目 60s 缓存）+ 本章大纲摘要。
     * QSE 注入 v1Engine 后人物维度只认 characterNames，不传就只能靠「X说」正则估算。
     */
    private async buildQualityContext(entry: ChapterEntry): Promise<EvaluationContext> {
        const [characterNames, chapterOutline] = await Promise.all([
            this.loadCharacterNames(),
            this.loadChapterOutline(entry),
        ]);
        return { characterNames, chapterOutline };
    }

    private async loadCharacterNames(): Promise<string[]> {
        if (!this.project) return [];
        const now = Date.now();
        const cached = this.characterNameCache;
        if (cached && cached.project === this.project && now - cached.at < DEVIATION_CHARACTER_INFO_TTL_MS) {
            return cached.names;
        }

        let names: string[] = [];
        try {
            const data = await this.plugin.ctxManager.gatherCharacterState(this.project);
            names = toCharacterContextInfos(
                (data.character_state || []) as Array<Record<string, unknown>>,
            ).map(c => c.name);
        } catch (e) {
            log.warn('[QualityDashboard] 读取人物设定失败:', e);
        }
        this.characterNameCache = { project: this.project, at: now, names };
        return names;
    }

    private async loadChapterOutline(entry: ChapterEntry): Promise<string | undefined> {
        const volN = parseInt(entry.volume.match(/\d+/)?.[0] ?? '0', 10);
        if (!this.project || volN <= 0 || entry.chapterNum <= 0) return undefined;

        const basePath = pjStepDir(this.project, volN, entry.chapterNum);
        const outlineFile = findChapterFile(this.app.vault.getFiles(), basePath, CHAPTER_FILE_TYPES.outline);
        if (!outlineFile) return undefined;

        try {
            const content = stripFrontmatter(await this.app.vault.read(outlineFile)).trim();
            return content ? content.slice(0, CHAPTER_OUTLINE_MAX_CHARS) : undefined;
        } catch (e) {
            log.warn('[QualityDashboard] 读取章节大纲失败:', e);
            return undefined;
        }
    }

    private renderCharts(scores: ChapterQualityEntry[]): void {
        // 聚合六维评分（范围内章节平均）
        const aggDims = QUALITY_DIMENSIONS.map((dim) => {
            const avg = scores.length
                ? scores.reduce((s, e) => s + (e.score.dimensions[dim]?.score ?? 0), 0) / scores.length
                : 0;
            return { dim, avg: Math.round(avg) };
        });
        // C2：总分取各章综合分（V1 加权口径）的均值，而不是六维均值——
        // 六维雷达里 readability / languageTexture 都源自语言质量，再平均会把语言质量算两遍。
        const overall = scores.length
            ? Math.round(scores.reduce((s, e) => s + e.score.overallScore, 0) / scores.length)
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
            for (const { issue, chapter, file } of filtered) {
                const line = issue.location?.line;
                const pos = line !== undefined ? `（第 ${line} 行）` : '';
                const sev = issue.severity === 'high' ? '🔴' : issue.severity === 'medium' ? '🟡' : '🟢';
                const row = this.issuesEl.createEl('div', { cls: 'nw-qd-issue nw-qd-issue-clickable' });
                row.createEl('span', { text: `${sev} [${DIMENSION_LABELS[issue.dimension]}] ${chapter} ` });
                row.createEl('span', { text: `${issue.description}${pos}` });
                row.setAttribute('title', '点击定位到正文');
                row.addEventListener('click', () => {
                    void openFileAtLine(this.app, file, line).then((ok) => {
                        if (ok) this.close();
                    });
                });
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
                const score = this.qualityCache.get(this.qualityCacheKey(e));
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

    /**
     * onClose 方法。
     */
    onClose(): void {
        this.contentEl.empty();
    }
}

/**
 * 打开章节文件并定位到指定行（1-based）。
 * 无行号时仅打开文件；定位失败会给出提示，不抛出异常。
 * @param app - Obsidian 应用实例
 * @param file - 文件
 * @param line - 行
 * @returns 是否成功
 */
export async function openFileAtLine(app: App, file: TFile, line?: number): Promise<boolean> {
    try {
        const leaf = app.workspace.getLeaf('tab');
        await leaf.openFile(file);
        if (line === undefined || line < 1) return true;

        const editor = (leaf.view as unknown as { editor?: Editor }).editor;
        if (!editor) return true;

        const target = Math.min(line - 1, Math.max(0, editor.lineCount() - 1));
        const pos = { line: target, ch: 0 };
        editor.setCursor(pos);
        editor.scrollIntoView({ from: pos, to: pos }, true);
        return true;
    } catch (e) {
        new Notice(`❌ 无法打开章节：${e instanceof Error ? e.message : String(e)}`, 4000);
        return false;
    }
}
