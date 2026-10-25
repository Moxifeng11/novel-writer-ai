import { App, TFile } from 'obsidian';
import { RealtimeMonitor } from '../../engine/quality/realtime-monitor';
import type { QualityScore } from '../../engine/quality/quality-score-engine';
import type { CharacterContextInfo } from '../../engine/quality/quality-score-engine';
import {
    getDeviationSeverityLabel,
    getDeviationTypeLabel,
    listDeviatedTypes,
    type DeviationContext,
    type ForeshadowTracking,
    type PreviousChapterContext,
} from '../../engine/quality/deviation-detector';
import type { ChapterBrief } from '../../engine/chapter-brief';
import { AdaptiveDebounceManager } from '../../shared/adaptive-debounce-manager';
import {
    DEVIATION_CHARACTER_INFO_TTL_MS,
    QUALITY_LIVE_PERSIST_INTERVAL_MS,
    QUALITY_MIN_EVALUABLE_CHARS,
} from '../../shared/thresholds';
import {
    buildQualityChapterKey,
    isQualitySampleUsable,
    isSameQualityEvalTarget,
    normalizeChapterKey,
} from '../../shared/quality-history';
import { appendQualityHistory } from '../../services/quality-history-store';
import { parseExpectedRhythm } from '../../shared/rhythm-intent';
import {
    buildPreviousChapterWindow,
    selectPreviousChapterFiles,
    type PreviousChapterSource,
} from '../../shared/previous-chapter-window';
import { SUBDIR_BODY_ROOT } from '../../shared/paths';
import { createLogger } from '../../shared/logger';

const log = createLogger('RealtimeQuality');

/** D2：实时质量评估的视图适配层 */
export interface RealtimeQualityHost {
    readonly app: App;
    getText(): string;
    getProject(): string;
    getVolume(): string;
    getChapterNum(): number;
    getChapterName(): string;
    getBodyPath(): string;
    getChapterBrief(): ChapterBrief | null;
    /** 本章规划正文（快照 chapPlan），用于偏离上下文 */
    getChapPlan(): string | undefined;
    loadCharacterInfos(): Promise<CharacterContextInfo[]>;
    loadForeshadows(): Promise<ForeshadowTracking[]>;
    /** 由视图装配评分/偏离内核（composition root），controller 只管生命周期 */
    createMonitor(): RealtimeMonitor;
}

/**
 * D2：协同写作实时质量评估管线。
 * 职责：评估编排（busy/pending）、偏离上下文、顶栏渲染、质量历史落盘节流、
 * 开关与切章重置。视图只提供数据与 DOM 句柄。
 */
export class RealtimeQualityController {
    private monitor: RealtimeMonitor | null = null;
    private enabled = false;
    /**
     * 评估在途时又有新输入：只记一个待办，等本次评估结束再重跑一次。
     * 直接丢弃会让「停手后的最后一次输入」永远不被评估，顶栏长期显示旧文本的分数。
     */
    private pending = false;
    private statusEl: HTMLElement | null = null;
    private readonly debouncer = new AdaptiveDebounceManager({ debug: false });

    private lastLiveQualityPersist: { chapterKey: string; at: number } | null = null;
    private liveQualityPersistInFlight = false;
    /** 偏离检测用的前文窗口缓存（按候选路径列表，避免每次评估重复读盘） */
    private previousChapterCache: { key: string; list: PreviousChapterContext[] } | null = null;

    constructor(private readonly host: RealtimeQualityHost) {}

    attachStatus(el: HTMLElement | null): void {
        this.statusEl = el;
    }

    isEnabled(): boolean {
        return this.enabled;
    }

    /** 开关实时质量；返回新状态供视图同步按钮样式 */
    toggle(): boolean {
        this.enabled = !this.enabled;
        if (!this.enabled) {
            this.debouncer.cancelAll();
            this.monitor?.cancel();
            this.pending = false;
            this.clearStatus();
            return false;
        }
        if (!this.monitor) {
            this.monitor = this.host.createMonitor();
        }
        void this.evaluate();
        return true;
    }

    /** 输入后延迟触发实时质量评估 */
    schedule(): void {
        if (!this.enabled) return;
        this.debouncer.debounceFixed("realtime-quality", () => {
            void this.evaluate();
        }, 2500);
    }

    /**
     * 切章时清空实时质量顶栏并中止在途评估。
     * 顶栏文本只在评估返回时更新，切章本身不产生评估结果：不清空就会在新章
     * 加载期间显示上一章的分数；新章正文不足可评估长度时更会一直停在那份旧分数。
     */
    resetForChapterSwitch(): void {
        this.pending = false;
        this.monitor?.cancel();
        this.clearStatus();
    }

    dispose(): void {
        this.debouncer.dispose();
        this.monitor?.dispose();
        this.monitor = null;
    }

    /** 评估当前正文并刷新顶栏状态 */
    async evaluate(): Promise<void> {
        const monitor = this.monitor;
        if (!monitor || !this.enabled) {
            this.pending = false;
            return;
        }

        const text = this.host.getText().trim();
        if (text.length < QUALITY_MIN_EVALUABLE_CHARS) {
            this.pending = false;
            // 正文不足可评估长度时 WQE/QSE 只返回 0 分空结果：显示出来就是「质量 0」，
            // 把「无法评估」当成了「写得差」。清掉上一份分数并中止在途评估。
            this.monitor?.cancel();
            this.clearStatus();
            return;
        }
        if (monitor.isEvaluating()) {
            this.pending = true;
            return;
        }

        this.statusEl?.setText("质量评估中…");
        // 评估是异步的：先记下发起时的章节身份，返回后若已切章/切项目则丢弃结果
        const evalTarget = {
            project: this.host.getProject(),
            chapterNum: this.host.getChapterNum(),
            bodyPath: this.host.getBodyPath(),
        };
        // 本次评估是否真正释放了 monitor：busy 时由持有者负责消费挂起的重评
        let monitorReleased = false;
        try {
            // 质量与偏离共用同一份上下文：分开各读一次会让人物档案/大纲不同源，
            // 而质量评分走 V1 内核时，人物名单只能从这里进去。
            const deviationContext = await this.buildDeviationContext();
            const result = await monitor.evaluate(text, {
                projectId: evalTarget.project,
                chapterId: evalTarget.bodyPath,
                deviationContext,
                qualityContext: {
                    chapterId: deviationContext.chapterId,
                    chapterOutline: deviationContext.chapterOutline,
                    characterInfos: deviationContext.characterInfos,
                },
            });
            monitorReleased = true;
            if (!this.enabled) return;
            // 旧章节正文的分数不能显示到新章节，更不能写进新章节的质量历史
            if (!isSameQualityEvalTarget(evalTarget, {
                project: this.host.getProject(),
                chapterNum: this.host.getChapterNum(),
                bodyPath: this.host.getBodyPath(),
            })) return;
            // 被取消的评估没有有效结论（切章/删空正文触发）：不要用它覆盖已清空的顶栏
            if (result.cancelled) return;

            const score = result.qualityScore;
            const deviations = result.deviations;
            const failedLabels = this.describeMonitorFailures(result.failures);
            const failureLines = result.failures ?? [];

            // 质量与偏离都失败时不能显示成「质量 --」：那与「正文过短、暂不评估」无法区分，
            // 用户会把「没测」当成「没问题」。失败原因必须显式展示。
            if (!score && !deviations) {
                this.statusEl?.setText(
                    failedLabels.length > 0 ? `质量评估失败（${failedLabels.join("、")}）` : "质量评估失败"
                );
                if (failureLines.length > 0) {
                    this.statusEl?.setAttribute("title", failureLines.join("\n"));
                } else {
                    this.statusEl?.removeAttribute("title");
                }
                return;
            }

            const parts: string[] = [
                score ? `质量 ${score.overallScore} · ${score.issues.length} 问题` : "质量 --",
            ];
            const titleLines: string[] = [];
            if (deviations) {
                const critical = deviations.issues.filter(issue => issue.severity === 'critical').length;
                const warning = deviations.issues.filter(issue => issue.severity === 'warning').length;
                const unevaluated = deviations.unevaluatedTypes;
                // 总评只取最严重的一条，多类型同时偏离的「面」单独展示
                const deviated = listDeviatedTypes(deviations.typeScores, unevaluated);
                parts.push(
                    `偏离 ${deviations.overallScore} · ${critical}严重/${warning}警告`
                    + (deviated.length > 0 ? ` · ${deviated.length}类异常` : "")
                    + (unevaluated.length > 0 ? ` · ${unevaluated.length}类未评估` : "")
                );
                titleLines.push(...deviations.issues.slice(0, 5)
                    .map(issue => `${getDeviationSeverityLabel(issue.severity)}｜${issue.description}`));
                if (deviated.length > 0) {
                    titleLines.push(`异常类型：${deviated.map(getDeviationTypeLabel).join("、")}`);
                }
                if (unevaluated.length > 0) {
                    titleLines.push(
                        `未评估（数据源缺失，不代表无问题）：${unevaluated.map(getDeviationTypeLabel).join("、")}`
                    );
                }
            } else if (failedLabels.length > 0) {
                // 偏离检测失败：不提示的话，「没有偏离信息」会被理解为「无偏离」
                parts.push(failedLabels.join("、"));
            }
            const titleContent = [...titleLines, ...failureLines].join("\n");
            if (titleContent) {
                this.statusEl?.setAttribute("title", titleContent);
            } else if (deviations) {
                this.statusEl?.setAttribute("title", "未检测到偏离");
            } else {
                this.statusEl?.removeAttribute("title");
            }
            this.statusEl?.setText(parts.join(" · "));
            void this.persistLiveQualityIfDue(text, score);
        } catch (e) {
            // 并发守卫：monitor 正在评估时只挂起重评，不把竞态当成评估失败展示给用户
            if (e instanceof Error && e.message.startsWith('busy')) {
                this.pending = true;
                return;
            }
            monitorReleased = true;
            if (this.enabled && isSameQualityEvalTarget(evalTarget, {
                project: this.host.getProject(),
                chapterNum: this.host.getChapterNum(),
                bodyPath: this.host.getBodyPath(),
            })) this.statusEl?.setText("质量评估失败");
            log.warn("[CoWritingView] 实时质量评估失败:", e);
        } finally {
            // 停手后的最后一次输入不能被丢掉：本次评估释放 monitor 后补跑一次
            if (monitorReleased) {
                const pending = this.pending;
                this.pending = false;
                if (pending) void this.evaluate();
            }
        }
    }

    /**
     * 把监控失败项转成用户可读标签（同标签只保留一次）。
     * `RealtimeMonitor` 的 `failures` 形如 `quality: xxx` / `deviations: xxx`；
     * 直接展示原始前缀与错误文本对用户没有意义，但「哪一项没测」必须说清楚。
     */
    private describeMonitorFailures(failures?: string[]): string[] {
        if (!failures || failures.length === 0) return [];
        const labels = new Set<string>();
        for (const failure of failures) {
            if (failure.startsWith("quality:")) labels.add("质量评分失败");
            else if (failure.startsWith("deviations:")) labels.add("偏离检测失败");
            else labels.add("评估异常");
        }
        return [...labels];
    }

    /**
     * 把协同写作的实时质量按节流写入项目质量历史。
     * 此前实时评估只在顶栏显示，历史/基线只统计仪表盘手动评估，导致
     * 「在协同里写完整章」不会进入趋势，基线长期缺样本。
     */
    private async persistLiveQualityIfDue(text: string, qualityScore?: QualityScore | null): Promise<void> {
        const project = this.host.getProject();
        const chapterNum = this.host.getChapterNum();
        if (!project || !chapterNum) return;
        if (!isQualitySampleUsable(text.length)) return;

        // 只复用本次监控评估的 WQE 结果：quality 子任务失败 / 被取消时 result.qualityScore 为空，
        // 这里若再调一次 qualityKernel.evaluate，会往内核 scoreHistory 多记一条并写入一条
        // 与顶栏显示（质量 --）不一致的记录。没有本次结果就不落盘。
        const result = qualityScore?.v1Result;
        if (!result) {
            log.warn('[CoWritingView] 本次实时评估无 WQE 结果，跳过质量历史落盘');
            return;
        }

        // 落盘键与面板 B 的实时评估同源派生，再归一化为「第N章」，避免同一章两种 key
        const chapterKey = normalizeChapterKey(buildQualityChapterKey(project, chapterNum, this.host.getChapterName()));
        // 节流键带项目：切到另一本书的同章号时不应被上一本的 10 分钟窗口挡住
        const throttleKey = `${project}::${chapterKey}`;
        const now = Date.now();
        const last = this.lastLiveQualityPersist;
        if (last && last.chapterKey === throttleKey && now - last.at < QUALITY_LIVE_PERSIST_INTERVAL_MS) return;
        if (this.liveQualityPersistInFlight) return;

        this.liveQualityPersistInFlight = true;
        try {
            await appendQualityHistory(this.host.app, project, {
                chapterKey,
                timestamp: result.evaluatedAt,
                wordCount: result.wordCount,
                overallScore: result.overallScore,
                languageScore: result.languageQuality.score,
                rhythmScore: result.rhythmQuality.score,
                characterScore: result.characterQuality.score,
                plotScore: result.plotQuality.score,
                atmosphereScore: result.atmosphereQuality.score,
                structureScore: result.structureQuality.score,
                grade: result.grade,
                trend: result.trend,
            });
            this.lastLiveQualityPersist = { chapterKey: throttleKey, at: now };
        } catch (e) {
            log.warn('[CoWritingView] 实时质量写入历史失败:', e);
        } finally {
            this.liveQualityPersistInFlight = false;
        }
    }

    /** 构建偏离检测上下文：本章大纲 + 最近几章前文 + 人物设定（真实上下文，不再用空对象） */
    private async buildDeviationContext(): Promise<DeviationContext> {
        const brief = this.host.getChapterBrief();
        const chapPlan = this.host.getChapPlan();
        const outline = (brief?.outlineSummary || chapPlan || "").trim().slice(0, 1200);

        return {
            chapterId: this.host.getBodyPath(),
            chapterNum: this.host.getChapterNum(),
            chapterOutline: outline || undefined,
            // 只认规划里的显式标注（「节奏：快」等）；没有标注就不做节奏偏离，避免误报
            expectedRhythm: parseExpectedRhythm(
                brief?.outlineSummary,
                chapPlan,
                ...(brief?.scenes ?? []).map(s => `${s.objective}\n${s.conflict}\n${s.keyScene}`),
            ),
            previousChapters: await this.loadPreviousChapterContext(),
            characterInfos: await this.host.loadCharacterInfos(),
            foreshadows: await this.host.loadForeshadows(),
        };
    }

    /**
     * 读取最近几章前文（正文 + frontmatter）。
     * 章号跨卷连续（第 291 章在第 3 卷、第 290 章在第 2 卷），
     * 所以按正文根目录扫描文件，而不是在同卷内替换文件名。
     * 按候选路径列表缓存，切书/切卷/切章后自动失效。
     */
    private async loadPreviousChapterContext(): Promise<PreviousChapterContext[]> {
        const project = this.host.getProject();
        const chapterNum = this.host.getChapterNum();
        const volume = this.host.getVolume();
        if (chapterNum <= 1 || !project || !volume) return [];

        const bodyRoot = `${project}/${SUBDIR_BODY_ROOT}/`;
        const files = this.host.app.vault.getFiles()
            .filter(file => file.path.startsWith(bodyRoot))
            .map(file => ({ path: file.path, name: file.name }));
        const candidates = selectPreviousChapterFiles(files, chapterNum);
        if (candidates.length === 0) return [];

        // 缓存键必须含 mtime + size：用户在同一次协同会话里改完上一章再回来写本章时，
        // 只按路径缓存会把旧正文继续喂给矛盾/时间线检测——改过的设定看不到，
        // 已解决的前文矛盾也不会消失。与 LocalVectorStore 的文件签名同口径。
        const filesByPath = new Map<string, TFile>();
        const keyParts: string[] = [];
        for (const candidate of candidates) {
            const file = this.host.app.vault.getAbstractFileByPath(candidate.path);
            if (!(file instanceof TFile)) {
                keyParts.push(`${candidate.path}:missing`);
                continue;
            }
            filesByPath.set(candidate.path, file);
            keyParts.push(`${candidate.path}:${file.stat.mtime}:${file.stat.size}`);
        }
        const cacheKey = keyParts.join('|');
        if (this.previousChapterCache?.key === cacheKey) {
            return this.previousChapterCache.list;
        }

        const sources: PreviousChapterSource[] = [];
        const frontmatters = new Map<number, Record<string, unknown>>();
        for (const candidate of candidates) {
            const file = filesByPath.get(candidate.path);
            if (!file) continue;
            try {
                sources.push({ chapterNum: candidate.chapterNum, raw: await this.host.app.vault.cachedRead(file) });
            } catch (e) {
                log.warn(`[CoWritingView] 读取前文第${candidate.chapterNum}章失败:`, e);
                continue;
            }
            const frontmatter = this.host.app.metadataCache.getFileCache(file)?.frontmatter;
            if (frontmatter) frontmatters.set(candidate.chapterNum, frontmatter as Record<string, unknown>);
        }

        const list: PreviousChapterContext[] = buildPreviousChapterWindow(sources).map(slice => ({
            chapterId: `第${slice.chapterNum}章`,
            chapterNum: slice.chapterNum,
            text: slice.text,
            frontmatter: frontmatters.get(slice.chapterNum),
        }));
        this.previousChapterCache = { key: cacheKey, list };
        return list;
    }

    private clearStatus(): void {
        this.statusEl?.setText("");
        this.statusEl?.removeAttribute("title");
    }
}
