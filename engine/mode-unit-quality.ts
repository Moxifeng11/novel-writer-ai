/**
 * mode-unit-quality.ts — 短篇/剧本单元质检
 *
 * 用与长篇相同的 QualityScoreEngine 六维评分，再叠加模式专属的“可拍/钩子”检查，
 * 把结果写进单元 frontmatter 与 `04-质检`/`05-质检` 报告。这里不调 AI，纯本地。
 */
import { App, TFile } from 'obsidian';
import type { CreationMode } from '@/shared/creation-mode';
import { modeContentDir } from '@/shared/mode-content';
import { SHORT_DIRS, SCRIPT_DIRS } from '@/shared/mode-content';
import { gradeFromScore } from '@/shared/quality-grade';
import {
    MODE_QUALITY_DIMENSION_LABELS,
    MODE_QUALITY_PROFILES,
    type ModeQualityDimension,
} from '@/shared/quality-profile';
import { countUnitWords } from './mode-unit-writer';
import type { EvaluationContext, QualityScore } from './quality/quality-score-engine';
import { DIMENSION_LABELS } from './quality/quality-score-engine';
import { ObsidianFrontmatter, writeVaultText } from '@/shared/file-system-port';
import { createLogger } from '@/shared/logger';

const log = createLogger('ModeUnitQuality');

/** 一个模式专属检查项。 */
export interface UnitQualityExtra {
    key: string;
    label: string;
    value: string;
    passed: boolean;
    blocking: boolean;
    detail: string;
}

/** 单元质检报告。 */
export interface UnitQualityReport {
    mode: CreationMode;
    overallScore: number;
    grade: string;
    passed: boolean;
    dimensions: Array<{ key: ModeQualityDimension; label: string; score: number; issueCount: number }>;
    extras: UnitQualityExtra[];
    issues: string[];
    wordCount: number;
    checkedAt: number;
}

/** 质量评估端口（由 HeavyTaskWorkerManager 或测试注入，避免单元模块自建引擎实例）。 */
export interface UnitQualityEvaluator {
    evaluate(text: string, context: EvaluationContext, signal?: AbortSignal): Promise<QualityScore>;
}

function scriptExtras(body: string): UnitQualityExtra[] {
    const lines = body.split('\n').map(line => line.trim()).filter(Boolean);
    const sceneCount = lines.filter(line => /^(?:第\d+场|场景|内景|外景|[日夜]\s*[内外]|[日夜]\s*[·／/]\s*[内外])/.test(line)).length;
    const actionLines = lines.filter(line => /^(?:△|▲|【画面】|画面[:：])/.test(line)).length;
    const dialogueLines = lines.filter(line => /^[^：:\n]{1,14}[：:]/.test(line) || /^[（(].+[）)]/.test(line)).length;
    const actionRatio = lines.length > 0 ? actionLines / lines.length : 0;
    const dialogueRatio = lines.length > 0 ? dialogueLines / lines.length : 0;
    return [
        {
            key: 'scenes',
            label: '场次可拍',
            value: `${sceneCount} 场`,
            passed: sceneCount > 0,
            blocking: true,
            detail: sceneCount > 0 ? '检测到场次标题' : '没有场次标题（如「第1场 日 内 咖啡馆」），无法直接拍摄',
        },
        {
            key: 'dialogue',
            label: '对白占比',
            value: `${Math.round(dialogueRatio * 100)}%`,
            passed: dialogueRatio >= 0.25,
            blocking: false,
            detail: dialogueRatio >= 0.25 ? '对白密度可用' : '对白偏少，短剧需要更高密度的对话推进',
        },
        {
            key: 'action',
            label: '动作行',
            value: `${Math.round(actionRatio * 100)}%`,
            passed: actionRatio >= 0.1,
            blocking: true,
            detail: actionRatio >= 0.1 ? '有可拍的动作/画面行' : '动作行不足，画面容易变成纯对白',
        },
    ];
}

function shortExtras(body: string): UnitQualityExtra[] {
    const opening = body.slice(0, 300);
    const ending = body.slice(-200);
    const openingHook = /[“"「」]|：|！|？|\?|!/.test(opening);
    const endingHook = /[？?！!…]|悬念|没想到|直到|竟然|忽然/.test(ending);
    return [
        {
            key: 'opening',
            label: '开篇钩子',
            value: openingHook ? '有' : '弱',
            passed: openingHook,
            blocking: true,
            detail: openingHook ? '开篇有对话/冲突/提问' : '开篇 300 字缺少对话、提问或冲突信号',
        },
        {
            key: 'ending',
            label: '结尾兑现',
            value: endingHook ? '有' : '弱',
            passed: endingHook,
            blocking: false,
            detail: endingHook ? '结尾有钩子或兑现信号' : '结尾偏平，建议留反转/未解问题',
        },
    ];
}

/**
 * 评估一个短篇「节」/剧本「集」。
 *
 * @param options - 模式、正文、人物名与大纲
 * @returns 质检报告
 */
export async function evaluateModeUnitQuality(options: {
    mode: CreationMode;
    body: string;
    title?: string;
    outline?: string;
    characterNames?: string[];
    signal?: AbortSignal;
    /** 质量评估器；生产传 HeavyTaskWorkerManager.evaluateQuality 包装 */
    evaluator: UnitQualityEvaluator;
}): Promise<UnitQualityReport> {
    const { mode, body } = options;
    const profile = MODE_QUALITY_PROFILES[mode];
    const wordCount = countUnitWords(body);
    const score = await options.evaluator.evaluate(
        body,
        {
            chapterTitle: options.title,
            chapterOutline: options.outline,
            characterNames: options.characterNames,
        },
        options.signal,
    );

    const dimensions = profile.dimensions.map(key => ({
        key,
        label: MODE_QUALITY_DIMENSION_LABELS[key] || DIMENSION_LABELS[key],
        score: score.dimensions[key]?.score ?? 0,
        issueCount: score.dimensions[key]?.issues.length ?? 0,
    }));
    const extras = mode === 'script' ? scriptExtras(body) : shortExtras(body);
    const dimensionsPassed = dimensions.every(item => item.score >= profile.minDimension);
    const extrasPassed = extras.filter(item => item.blocking).every(item => item.passed);
    const passed = wordCount >= (mode === 'script' ? 300 : 100)
        && score.overallScore >= profile.minOverall
        && dimensionsPassed
        && extrasPassed;
    const issues = [
        ...score.issues.map(issue => `[${MODE_QUALITY_DIMENSION_LABELS[issue.dimension] || issue.dimension}] ${issue.description}`),
        ...extras.filter(item => !item.passed).map(item => `[${item.label}] ${item.detail}`),
    ].slice(0, 12);

    return {
        mode,
        overallScore: score.overallScore,
        grade: gradeFromScore(score.overallScore),
        passed,
        dimensions,
        extras,
        issues,
        wordCount,
        checkedAt: score.evaluatedAt || Date.now(),
    };
}

/**
 * 保存质检报告并回写单元 frontmatter。
 *
 * @param app - Obsidian 应用实例
 * @param project - 项目 ID
 * @param unitPath - 单元文件路径
 * @param unitName - 单元显示名
 * @param report - 质检报告
 * @returns 报告文件路径
 */
export async function saveUnitQualityReport(
    app: App,
    project: string,
    unitPath: string,
    unitName: string,
    report: UnitQualityReport,
): Promise<string> {
    const mode = report.mode;
    const reviewDir = mode === 'short' ? SHORT_DIRS.review : SCRIPT_DIRS.review;
    const path = `${modeContentDir(project, mode)}/${reviewDir}/${unitName}_质检.md`;
    const checked = new Date(report.checkedAt).toISOString();
    const lines = [
        '---',
        'tags: [质检]',
        `mode: ${mode}`,
        `unit: "${unitName}"`,
        `quality_score: ${report.overallScore}`,
        `quality_grade: ${report.grade}`,
        `quality_passed: ${report.passed}`,
        `checked_at: ${checked}`,
        '---',
        '',
        `# ${unitName} · ${MODE_QUALITY_PROFILES[mode].label}`,
        '',
        `- 综合分：${report.overallScore}（${report.grade}）`,
        `- 结论：${report.passed ? '通过' : '未通过'}`,
        `- 字数：${report.wordCount}`,
        '',
        '## 六维',
        '',
        '| 维度 | 分数 | 问题数 |',
        '|---|---:|---:|',
        ...report.dimensions.map(item => `| ${item.label} | ${item.score} | ${item.issueCount} |`),
        '',
        '## 模式检查',
        '',
        ...report.extras.map(item => `- ${item.passed ? '✅' : '⚠️'} ${item.label}：${item.value}（${item.detail}）`),
        '',
        '## 问题',
        '',
        ...(report.issues.length > 0 ? report.issues.map(issue => `- ${issue}`) : ['- 未发现明显问题']),
    ];
    await writeVaultText(app, path, `${lines.join('\n')}\n`);

    const file = app.vault.getAbstractFileByPath(unitPath);
    if (file instanceof TFile) {
        try {
            await new ObsidianFrontmatter(app).processFrontmatter(file, fm => {
                fm['quality_score'] = report.overallScore;
                fm['quality_grade'] = report.grade;
                fm['quality_passed'] = report.passed;
                fm['quality_checked_at'] = checked;
            });
        } catch (error) {
            log.warn('回写单元质检 frontmatter 失败', error);
        }
    }
    return path;
}
