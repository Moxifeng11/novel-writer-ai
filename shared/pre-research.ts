/**
 * pre-research.ts — 短篇 / 剧本前期调研数据与落盘规范
 *
 * 与长篇创建流程分离：短篇、剧本先完成本模块的调研，再创建项目；
 * 调研结果写入项目内独立的 `00-前期调研/`，不混入长篇 11 步目录。
 */
import type { DataAdapter } from 'obsidian';
import type { CreationMode } from './creation-mode';
import { resolveProjectRoot } from '../domains/kernel/project-locator';

/**
 * 前期调研目录。
 */
export const PRE_RESEARCH_DIR = '00-前期调研';
/**
 * 调研数据文件名。
 */
export const PRE_RESEARCH_DATA_FILE = '调研数据.json';
/**
 * 调研报告文件名。
 */
export const PRE_RESEARCH_REPORT_FILE = '调研报告.md';

/**
 * 调研洞察。
 */
export interface PreResearchInsight {
    /** 热点/行业调研摘要；无实时来源时以“未经实时核实：”开头 */
    summary: string;
    verified: boolean;
    researchedAt: number;
    sources: Array<{ title: string; url: string; snippet: string }>;
    warnings: string[];
    framework: string;
    randomFactors: {
        seed: string;
        premise: string[];
        structure: string[];
        texture: string[];
        differentiation: string[];
        forbiddenPatterns: string[];
    };
}

/**
 * 短篇前期调研数据。
 */
export interface ShortPreResearch {
    mode: 'short';
    name: string;
    primaryCategory: string;
    targetWords: number;
    targetSections: number;
    premise: string;
    coreConflict: string;
    emotionalPromise: string;
    reversals: string;
    endingPayoff: string;
    plotTags: string;
    characterCore: string;
    emotionCurve: string;
    background: string;
    audience: string;
    references: string;
    notes: string;
    insight?: PreResearchInsight;
}

/**
 * 剧本前期调研数据。
 */
export interface ScriptPreResearch {
    mode: 'script';
    name: string;
    genre: string;
    targetWords: number;
    targetEpisodes: number;
    episodeSeconds: number;
    logline: string;
    hook3s: string;
    coreConflict: string;
    payoff: string;
    paywallEpisode: number;
    characters: string;
    scenes: string;
    audience: string;
    references: string;
    notes: string;
    insight?: PreResearchInsight;
}

/**
 * 前期调研数据联合类型。
 */
export type PreResearchData = ShortPreResearch | ScriptPreResearch;

/**
 * 创建默认调研数据。
 *
 * @param mode - 参数
 * @param name = '' - 参数
 * @returns 调研数据
 */
export function createDefaultPreResearch(mode: CreationMode, name = ''): PreResearchData {
    if (mode === 'script') {
        return {
            mode: 'script',
            name,
            genre: '',
            targetWords: 60000,
            targetEpisodes: 80,
            episodeSeconds: 90,
            logline: '',
            hook3s: '',
            coreConflict: '',
            payoff: '',
            paywallEpisode: 12,
            characters: '',
            scenes: '',
            audience: '',
            references: '',
            notes: '',
        };
    }
    return {
        mode: 'short',
        name,
        primaryCategory: '',
        targetWords: 80000,
        targetSections: 20,
        premise: '',
        coreConflict: '',
        emotionalPromise: '',
        reversals: '',
        endingPayoff: '',
        plotTags: '',
        characterCore: '',
        emotionCurve: '',
        background: '',
        audience: '',
        references: '',
        notes: '',
    };
}

export function preResearchDir(project: string): string {
    return `${resolveProjectRoot(project)}/${PRE_RESEARCH_DIR}`;
}

export function preResearchDataPath(project: string): string {
    return `${preResearchDir(project)}/${PRE_RESEARCH_DATA_FILE}`;
}

export function preResearchReportPath(project: string): string {
    return `${preResearchDir(project)}/${PRE_RESEARCH_REPORT_FILE}`;
}

export function preResearchModeDocPath(project: string, mode: CreationMode): string {
    const fileName = mode === 'script' ? '剧本定位.md' : mode === 'short' ? '五维分类.md' : '长篇定位.md';
    return `${preResearchDir(project)}/${fileName}`;
}

function yamlValue(value: string): string {
    return `"${String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function bullet(label: string, value: string | number): string {
    return `- ${label}：${String(value || '').trim() || '（未填写）'}`;
}

function buildInsightBlock(data: PreResearchData): string {
    const insight = data.insight;
    if (!insight) return '';
    const sourceLines = insight.sources.length > 0
        ? insight.sources.map((source, index) => `- [T${index + 1}] ${source.title || '无标题'} · ${source.url || '（无 URL）'} · ${source.snippet.slice(0, 120)}`).join('\n')
        : '- 无实时来源';
    return [

        '## 五、AI 前期调研',
        bullet('数据来源', insight.verified ? '联网检索（实时）' : '模型调研草稿（未经实时核实）'),
        bullet('调研时间', new Date(insight.researchedAt).toLocaleString()),
        '',
        '### 热点与行业分析',
        insight.summary,
        '',
        '### 来源/素材',
        sourceLines,
        '',
        '### 固化创作框架',
        insight.framework,
        '',
        '### 多层真随机因子',
        `- 随机种子：${insight.randomFactors.seed}`,
        ...insight.randomFactors.premise.map(item => `- 前提层：${item}`),
        ...insight.randomFactors.structure.map(item => `- 结构层：${item}`),
        ...insight.randomFactors.texture.map(item => `- 质感层：${item}`),
        ...insight.randomFactors.differentiation.map(item => `- 差异化：${item}`),
        ...insight.randomFactors.forbiddenPatterns.map(item => `- 禁用：${item}`),
        '',
        ...(insight.warnings.length > 0 ? ['### 警告', ...insight.warnings.map(item => `- ${item}`)] : []),
    ].join('\n');
}

export function buildPreResearchReport(data: PreResearchData): string {
    const now = new Date().toISOString();
    if (data.mode === 'short') {
        return `---
tags: [前期调研, 短篇小说]
模式: short
调研状态: 已完成
生成时间: ${yamlValue(now)}
项目名称: ${yamlValue(data.name)}
主分类: ${yamlValue(data.primaryCategory)}
目标字数: ${data.targetWords}
目标节数: ${data.targetSections}
---

# 短篇前期调研报告

> 本文件由「短篇前期调研」生成。调研结果用于创建项目与约束后续写作；
> 与长篇 11 步流程无关，不写入章节步骤状态。

## 一、市场与定位
${bullet('项目名称', data.name)}
${bullet('番茄主分类', data.primaryCategory)}
${bullet('目标字数', data.targetWords)}
${bullet('目标节数', data.targetSections)}
${bullet('目标读者', data.audience)}
${bullet('参考作品/资料', data.references)}

## 二、故事核心
${bullet('一句话故事', data.premise)}
${bullet('核心冲突', data.coreConflict)}
${bullet('情绪承诺', data.emotionalPromise)}
${bullet('3–5 个反转', data.reversals)}
${bullet('结尾兑现', data.endingPayoff)}

## 三、五维标签
${bullet('情节', data.plotTags)}
${bullet('角色', data.characterCore)}
${bullet('情绪曲线', data.emotionCurve)}
${bullet('背景', data.background)}

## 四、补充
${bullet('备注', data.notes)}
${buildInsightBlock(data)}
`;
    }

    return `---
tags: [前期调研, 短剧剧本]
模式: script
调研状态: 已完成
生成时间: ${yamlValue(now)}
剧名: ${yamlValue(data.name)}
类型: ${yamlValue(data.genre)}
目标字数: ${data.targetWords}
目标集数: ${data.targetEpisodes}
单集秒数: ${data.episodeSeconds}
---

# 剧本前期调研报告

> 本文件由「剧本前期调研」生成。调研结果用于创建项目与约束后续分集/分镜；
> 与长篇 11 步流程无关，不写入章节步骤状态。

## 一、项目定位
${bullet('剧名', data.name)}
${bullet('红果短剧类型', data.genre)}
${bullet('目标集数', data.targetEpisodes)}
${bullet('目标字数', data.targetWords)}
${bullet('单集时长（秒）', data.episodeSeconds)}
${bullet('目标受众', data.audience)}
${bullet('参考作品/资料', data.references)}

## 二、商业钩子
${bullet('一句话卖点', data.logline)}
${bullet('前 3 秒钩子', data.hook3s)}
${bullet('核心冲突', data.coreConflict)}
${bullet('本剧爽点/兑现', data.payoff)}
${bullet('付费卡点集数', data.paywallEpisode)}

## 三、人物与场景
${bullet('主要人物', data.characters)}
${bullet('主要场景', data.scenes)}

## 四、补充
${bullet('备注', data.notes)}
${buildInsightBlock(data)}
`;
}

export function buildPreResearchModeDoc(data: PreResearchData): string {
    if (data.mode === 'short') {
        return `# 短篇五维分类

## 主分类
${data.primaryCategory || '（未选择）'}

## 情节
${data.plotTags || '（未填写）'}

## 角色
${data.characterCore || '（未填写）'}

## 情绪
${data.emotionCurve || data.emotionalPromise || '（未填写）'}

## 背景
${data.background || '（未填写）'}

## 使用规则
- 主分类用于平台投稿；其余四维用于提示词与质检。
- 不得用四维标签替代主分类。
- 分类变更后，故事核、分节大纲与正文需重新检查。
`;
    }

    return `# 剧本定位

## 类型
${data.genre || '（未选择）'}

## 集数与时长
- 目标集数：${data.targetEpisodes}
- 单集时长：${data.episodeSeconds} 秒

## 商业钩子
- 前 3 秒：${data.hook3s || '（未填写）'}
- 核心冲突：${data.coreConflict || '（未填写）'}
- 爽点/兑现：${data.payoff || '（未填写）'}
- 付费卡点：第 ${data.paywallEpisode} 集

## 人物与场景
- 主要人物：${data.characters || '（未填写）'}
- 主要场景：${data.scenes || '（未填写）'}
`;
}

async function backupIfExists(adapter: DataAdapter, path: string): Promise<void> {
    if (!(await adapter.exists(path))) return;
    try {
        const old = await adapter.read(path);
        await adapter.write(path.replace(/\.md$/, `.备份-${Date.now()}.md`), old);
    } catch {
        // 备份失败不阻断主写入；调用方仍会写新内容
    }
}

export async function writePreResearchFiles(
    adapter: DataAdapter,
    project: string,
    data: PreResearchData
): Promise<void> {
    const dir = preResearchDir(project);
    if (!(await adapter.exists(dir))) await adapter.mkdir(dir);
    const reportPath = preResearchReportPath(project);
    const modePath = preResearchModeDocPath(project, data.mode);
    await backupIfExists(adapter, reportPath);
    await backupIfExists(adapter, modePath);
    await adapter.write(preResearchDataPath(project), JSON.stringify(data, null, 2));
    await adapter.write(reportPath, buildPreResearchReport(data));
    await adapter.write(modePath, buildPreResearchModeDoc(data));
}

export async function readPreResearchData(
    adapter: DataAdapter,
    project: string
): Promise<PreResearchData | null> {
    try {
        const path = preResearchDataPath(project);
        if (!(await adapter.exists(path))) return null;
        const raw = JSON.parse(await adapter.read(path)) as Partial<PreResearchData>;
        if (raw.mode === 'script') {
            const base = createDefaultPreResearch('script', String(raw.name || project)) as ScriptPreResearch;
            return { ...base, ...raw, mode: 'script' } as ScriptPreResearch;
        }
        const base = createDefaultPreResearch('short', String(raw.name || project)) as ShortPreResearch;
        return { ...base, ...raw, mode: 'short' } as ShortPreResearch;
    } catch {
        return null;
    }
}

/**
 * 前期调研是否已经填到「可开工」的程度。
 *
 * 只要求每类最关键的四项：分类/类型、一句话故事(logline/premise)、
 * 核心冲突、情绪承诺(hook/promise)。目标字数与参考资料不参与判定，
 * 否则默认值会把新项目直接判成已完成。
 */
export function isPreResearchComplete(data: PreResearchData | null): boolean {
    if (!data) return false;
    const filled = (value: unknown): boolean => String(value ?? '').trim().length > 0;
    if (data.mode === 'script') {
        return filled(data.genre)
            && filled(data.logline)
            && filled(data.hook3s)
            && filled(data.coreConflict);
    }
    return filled(data.primaryCategory)
        && filled(data.premise)
        && filled(data.coreConflict)
        && filled(data.emotionalPromise);
}
