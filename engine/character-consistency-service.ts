/**
 * character-consistency-service.ts — 项目人物一致性检查的装载与落盘
 *
 * 统一从人物卡 frontmatter 读取 OOC 检测输入，调用 checker，并把结果写成
 * `第N章_一致性检查.md`（步骤产物）。质控、分析报告、质量仪表盘共用。
 */
import type { App } from 'obsidian';
import type { FileSystemPort } from '@/shared/file-system-port';
import { listEntityFiles } from '@/shared/entity-reader';
import { withWriteLock } from '@/shared/write-lock';
import { pjStepDir } from '@/shared/paths';
import { CharacterConsistencyChecker, type ConsistencyCheckResult } from './character-consistency-checker';

/** checker 可注入（测试/复用单一实例） */
export interface CharacterConsistencyOptions {
    checker?: CharacterConsistencyChecker;
    threshold?: number;
}

/** 人物检测输入 */
export interface CharacterInfoInput {
    name: string;
    personality?: string;
    appearance?: string;
    abilities?: string;
    background?: string;
}

/**
 * 读取项目全部人物卡的 OOC 检测输入。
 *
 * @param app - Obsidian 应用
 * @param project - 项目
 * @returns 人物信息
 */
export function loadProjectCharacterInfos(app: App, project: string): CharacterInfoInput[] {
    const infos: CharacterInfoInput[] = [];
    for (const file of listEntityFiles(app, project, 'characters')) {
        const fm = (app.metadataCache.getFileCache(file)?.frontmatter ?? {}) as Record<string, unknown>;
        const text = (key: string): string => (typeof fm[key] === 'string' ? String(fm[key]).trim() : '');
        const name = text('姓名') || text('name') || file.basename;
        if (!name) continue;
        infos.push({
            name,
            personality: text('性格标签'),
            appearance: text('外貌特征'),
            abilities: text('功法/技能树') || text('金手指/特殊能力'),
            background: text('人物背景'),
        });
    }
    return infos;
}

/**
 * 对整章正文跑人物一致性检查。
 *
 * @param app - Obsidian 应用
 * @param project - 项目
 * @param chapterText - 正文
 * @param options - 选项
 * @returns 检查结果
 */
export async function runProjectCharacterConsistency(
    app: App,
    project: string,
    chapterText: string,
    options: CharacterConsistencyOptions = {},
): Promise<ConsistencyCheckResult> {
    const checker = options.checker ?? new CharacterConsistencyChecker(undefined, options.threshold);
    const infos = loadProjectCharacterInfos(app, project);
    return checker.check(chapterText, infos);
}

/**
 * 渲染一致性检查报告（人读 + 机读 frontmatter）。
 *
 * @param result - 检查结果
 * @param chapterKey - 章名
 * @returns Markdown
 */
export function formatConsistencyReport(result: ConsistencyCheckResult, chapterKey: string): string {
    const lines: string[] = [
        '---',
        `tags: [一致性检查, nw/步骤/一致性检查]`,
        `章: ${chapterKey}`,
        `整体得分: ${result.overallScore}`,
        `最严重等级: ${result.worstSeverity}`,
        `高严重度问题: ${result.highSeverityCount}`,
        `通过: ${result.passed}`,
        '---',
        '',
        `# ${chapterKey} 人物一致性检查`,
        '',
        `- 整体得分：${result.overallScore}`,
        `- 最严重等级：${result.worstSeverity}`,
        `- 高严重度问题：${result.highSeverityCount}`,
        '',
    ];
    for (const [name, entry] of Object.entries(result.characterResults)) {
        if (entry.inconsistencies.length === 0) continue;
        lines.push(`## ${name}（${entry.score} 分）`, '');
        for (const issue of entry.inconsistencies) {
            lines.push(`- [${issue.severity}] ${issue.description}${issue.location ? `（${issue.location}）` : ''}`);
            if (issue.suggestion) lines.push(`  - 建议：${issue.suggestion}`);
        }
        lines.push('');
    }
    return lines.join('\n');
}

/**
 * 写入一致性检查报告（同名覆盖，加锁）。
 *
 * @param fs - 文件端口
 * @param project - 项目
 * @param volumeNum - 卷号
 * @param chapterNum - 章号
 * @param chapterKey - 章名
 * @param result - 检查结果
 * @returns 报告文件路径
 */
export async function writeConsistencyReport(
    fs: FileSystemPort,
    project: string,
    volumeNum: number,
    chapterNum: number,
    chapterKey: string,
    result: ConsistencyCheckResult,
): Promise<string> {
    const dir = pjStepDir(project, Math.max(1, volumeNum), Math.max(1, chapterNum));
    const path = `${dir}/${chapterKey}_一致性检查.md`;
    await fs.mkdir(dir).catch(() => {});
    await withWriteLock(path, async () => {
        await fs.write(path, formatConsistencyReport(result, chapterKey));
    });
    return path;
}
