/**
 * creation-flow.ts — 三模式创作流程的单一事实源（纯函数）
 *
 * 只做「阶段定义 + 事实 → 状态」的映射，不读 Obsidian、不写文件。
 * 事实采集放在 ui/full-writer/creation-flow-state.ts，这样进度口径可以在 Node
 * 单测里穷举，不会因为界面刷新时机不同而漂移。
 *
 * 三条流程共用同一套阶段状态语义，但阶段内容完全按模式分叉：
 *   长篇：初始化向导 → 章节写作 → 章节结算 → 成稿导出
 *   短篇：前期调研 → 分节大纲 → 分节写作 → 导出
 *   剧本：前期调研 → 分集大纲 → 分镜表 → 分集写作 → 导出
 */
import type { CreationMode } from './creation-mode';
import { modeUnitLabel } from './mode-content';
import { hasMessage, t } from '@/i18n';

/**
 * CreationFlowAction 类型定义。
 */
export type CreationFlowAction =
    | 'wizard'
    | 'research'
    | 'document'
    | 'create-units'
    | 'write-unit'
    | 'settle'
    | 'export';

/**
 * CreationFlowStageState 类型定义。
 */
export type CreationFlowStageState = 'done' | 'active' | 'todo' | 'blocked';

/**
 * CreationFlowStage 类型定义。
 */
export interface CreationFlowStage {
    id: string;
    /** 中文展示名（zh 兜底；渲染请用 stageLabel()/stageDesc() 取当前语言） */
    label: string;
    /** i18n 键（creationFlow.<mode>.stage.<id>.label） */
    labelKey?: string;
    /** 中文描述（zh 兜底） */
    description: string;
    /** i18n 键（...description） */
    descKey?: string;
    action: CreationFlowAction;
    /** 总进度权重；同一模式内权重之和为 1 */
    weight: number;
    /** 依赖的阶段 id；依赖未完成时该阶段显示 blocked */
    dependsOn?: string[];
    /**
     * 强制前置：依赖未完成时即使本阶段已有进度也显示 blocked。
     * 仅用于「必填、不可因存量正文跳过」的前置（如剧本分镜表）。
     */
    hardDependsOn?: string[];
}

/**
 * CreationFlowDocFacts 类型定义。
 */
export interface CreationFlowDocFacts {
    storyCore?: boolean;
    outline?: boolean;
    bible?: boolean;
    storyboard?: boolean;
}

/**
 * CreationFlowFacts 类型定义。
 */
export interface CreationFlowFacts {
    /** 短篇/剧本：前期调研是否已填写 */
    preResearchDone: boolean;
    docs: CreationFlowDocFacts;
    /** 长篇：初始化向导是否完成 */
    wizardDone?: boolean;
    unitTotal: number;
    /** 目标单元数（来自 .project 创作模式段）；用于「创建 N 节骨架」文案 */
    unitTarget: number;
    unitWritten: number;
    /** 长篇：已结算章节数 */
    unitSettled?: number;
    /** 第一个未写单元号；全部写完为 null */
    nextUnitNumber: number | null;
    exportExists: boolean;
}

/**
 * CreationFlowStageStatus 类型定义。
 */
export interface CreationFlowStageStatus extends CreationFlowStage {
    state: CreationFlowStageState;
    /** 0..1 */
    ratio: number;
    /** 进度文案（已按当前语言求值） */
    progressText: string;
    /** 主按钮文案（已按当前语言求值） */
    ctaLabel: string;
    /** 解析后的主按钮动作：单元阶段在「无骨架」时是 create-units */
    primaryAction: CreationFlowAction;
    blockedReason?: string;
    blockedBy?: string;
}

/**
 * CreationFlowSnapshot 类型定义。
 */
export interface CreationFlowSnapshot {
    mode: CreationMode;
    unitLabel: string;
    project: string;
    stages: CreationFlowStageStatus[];
    /** 0..1，按权重加权 */
    overallRatio: number;
    /** 第一个未完成阶段；全部完成时为空串 */
    nextStageId: string;
    nextUnitNumber: number | null;
}

/**
 * 阶段展示名（当前语言）；缺键回落目录里的中文兜底值。
 *
 * @param stage - 阶段定义或阶段状态
 * @returns 展示名
 */
export function stageLabel(stage: CreationFlowStage): string {
    return stage.labelKey && hasMessage(stage.labelKey) ? t(stage.labelKey) : stage.label;
}

/**
 * 阶段描述（当前语言）；缺键回落目录里的中文兜底值。
 *
 * @param stage - 阶段定义或阶段状态
 * @returns 描述
 */
export function stageDesc(stage: CreationFlowStage): string {
    return stage.descKey && hasMessage(stage.descKey) ? t(stage.descKey) : stage.description;
}
const STAGE_LABELS: Record<CreationMode, CreationFlowStage[]> = {
    long: [
        {
            id: 'wizard',
            label: '初始化与全书规划',
            labelKey: 'creationFlow.long.stage.wizard.label',
            description: '世界观、人物、势力与分卷章节规划',
            descKey: 'creationFlow.long.stage.wizard.description',
            action: 'wizard',
            weight: 0.25,
        },
        {
            id: 'chapters',
            label: '章节写作',
            labelKey: 'creationFlow.long.stage.chapters.label',
            description: '按章推进大纲、正文与质量分析',
            descKey: 'creationFlow.long.stage.chapters.description',
            action: 'write-unit',
            weight: 0.5,
            dependsOn: ['wizard'],
        },
        {
            id: 'settlement',
            label: '章节结算',
            labelKey: 'creationFlow.long.stage.settlement.label',
            description: '把正文产生的实体、伏笔、时间线变动写回设定库',
            descKey: 'creationFlow.long.stage.settlement.description',
            action: 'settle',
            weight: 0.15,
            dependsOn: ['chapters'],
        },
        {
            id: 'export',
            label: '成稿导出',
            labelKey: 'creationFlow.long.stage.export.label',
            description: '合并分卷正文，导出成稿',
            descKey: 'creationFlow.long.stage.export.description',
            action: 'export',
            weight: 0.1,
            dependsOn: ['chapters'],
        },
    ],
    short: [
        {
            id: 'research',
            label: '前期调研',
            labelKey: 'creationFlow.short.stage.research.label',
            description: '五维分类、故事核与分节规格',
            descKey: 'creationFlow.short.stage.research.description',
            action: 'research',
            weight: 0.15,
        },
        {
            id: 'outline',
            label: '分节大纲',
            labelKey: 'creationFlow.short.stage.outline.label',
            description: '为每一节写目标、冲突、反转与结尾钩子',
            descKey: 'creationFlow.short.stage.outline.description',
            action: 'document',
            weight: 0.1,
            dependsOn: ['research'],
        },
        {
            id: 'units',
            label: '分节写作',
            labelKey: 'creationFlow.short.stage.units.label',
            description: '进入单元工作台，逐节生成、续写与质检',
            descKey: 'creationFlow.short.stage.units.description',
            action: 'write-unit',
            weight: 0.6,
            dependsOn: ['outline'],
        },
        {
            id: 'export',
            label: '导出成稿',
            labelKey: 'creationFlow.short.stage.export.label',
            description: '合并全节正文并导出',
            descKey: 'creationFlow.short.stage.export.description',
            action: 'export',
            weight: 0.15,
            dependsOn: ['units'],
        },
    ],
    script: [
        {
            id: 'research',
            label: '前期调研',
            labelKey: 'creationFlow.script.stage.research.label',
            description: '类型、商业钩子、集数规格与场景基线',
            descKey: 'creationFlow.script.stage.research.description',
            action: 'research',
            weight: 0.1,
        },
        {
            id: 'outline',
            label: '分集大纲',
            labelKey: 'creationFlow.script.stage.outline.label',
            description: '为每一集写冲突、爽点、钩子与场次',
            descKey: 'creationFlow.script.stage.outline.description',
            action: 'document',
            weight: 0.1,
            dependsOn: ['research'],
        },
        {
            id: 'storyboard',
            label: '分镜表',
            labelKey: 'creationFlow.script.stage.storyboard.label',
            description: '把分集大纲拆成可拍摄的镜号表',
            descKey: 'creationFlow.script.stage.storyboard.description',
            action: 'document',
            weight: 0.1,
            dependsOn: ['outline'],
        },
        {
            id: 'units',
            label: '分集写作',
            labelKey: 'creationFlow.script.stage.units.label',
            description: '进入单元工作台，逐集生成剧本与质检',
            descKey: 'creationFlow.script.stage.units.description',
            action: 'write-unit',
            weight: 0.55,
            dependsOn: ['outline'],
            // 分镜表强制必填（用户 2026-11-07 拍板）：未完成分镜表不得进入分集写作
            hardDependsOn: ['storyboard'],
        },
        {
            id: 'export',
            label: '导出成稿',
            labelKey: 'creationFlow.script.stage.export.label',
            description: '合并全剧并导出',
            descKey: 'creationFlow.script.stage.export.description',
            action: 'export',
            weight: 0.15,
            dependsOn: ['units'],
        },
    ],
};

/**
 * getCreationFlowStages 函数。
 * @param mode - 模式
 * @returns 结果数组
 */
export function getCreationFlowStages(mode: CreationMode): CreationFlowStage[] {
    // 存量配置可能持久化了已删除的模式字符串，缺表时回退长篇而不是抛 TypeError
    const stages = STAGE_LABELS[mode] ?? STAGE_LABELS.long;
    return stages.map(stage => ({ ...stage, dependsOn: stage.dependsOn ? [...stage.dependsOn] : undefined }));
}

function clamp01(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.min(1, Math.max(0, value));
}

function ratioOf(part: number, total: number): number {
    if (!Number.isFinite(part) || !Number.isFinite(total) || total <= 0) return 0;
    return clamp01(part / total);
}

interface StageComputation {
    ratio: number;
    done: boolean;
    progressText: string;
    ctaLabel: string;
    primaryAction: CreationFlowAction;
}

function unitCtaLabel(mode: CreationMode, number: number, unitLabel: string): string {
    if (mode === 'long') return t('creationFlow.cta.continueChapter', { n: number });
    return t('creationFlow.cta.continueUnit', { n: number, unit: unitLabel });
}

function createUnitCta(facts: CreationFlowFacts, unitLabel: string): string {
    return facts.unitTarget > 0
        ? t('creationFlow.cta.createUnitsWithTarget', { count: facts.unitTarget, unit: unitLabel })
        : t('creationFlow.cta.createUnits', { unit: unitLabel });
}

function evaluateStage(
    stage: CreationFlowStage,
    mode: CreationMode,
    unitLabel: string,
    facts: CreationFlowFacts,
    wizardDone: boolean,
): StageComputation {
    const written = Math.max(0, facts.unitWritten || 0);
    const total = Math.max(0, facts.unitTotal || 0);
    const settled = Math.max(0, facts.unitSettled || 0);
    const next = facts.nextUnitNumber;
    // 已经写出正文的项目，前置设定阶段视为已跨过：否则老项目会被拉回「去做前期调研」。
    // 例外：剧本分镜表（storyboard）强制必填，见该分支注释。
    const setupSatisfied = written > 0;

    switch (stage.id) {
        case 'wizard': {
            return {
                ratio: wizardDone ? 1 : 0,
                done: wizardDone,
                progressText: wizardDone ? t('creationFlow.progress.wizardDone') : t('creationFlow.progress.wizardTodo'),
                ctaLabel: t('creationFlow.cta.gotoWizard'),
                primaryAction: 'wizard',
            };
        }
        case 'research': {
            const ownDone = !!facts.preResearchDone;
            const done = ownDone || setupSatisfied;
            return {
                ratio: done ? 1 : 0,
                done,
                progressText: done
                    ? (ownDone ? t('creationFlow.progress.researchDone') : t('creationFlow.progress.skippedByExisting'))
                    : t('creationFlow.progress.researchTodo'),
                ctaLabel: t('creationFlow.cta.gotoResearch'),
                primaryAction: 'research',
            };
        }
        case 'outline': {
            const isScript = mode === 'script';
            const ownDone = !!facts.docs.outline;
            const done = ownDone || setupSatisfied;
            return {
                ratio: done ? 1 : 0,
                done,
                progressText: done
                    ? (ownDone
                        ? (isScript ? t('creationFlow.progress.episodeOutlineReady') : t('creationFlow.progress.sectionOutlineReady'))
                        : t('creationFlow.progress.skippedByExisting'))
                    : (isScript ? t('creationFlow.progress.episodeOutlineTodo') : t('creationFlow.progress.sectionOutlineTodo')),
                ctaLabel: isScript ? t('creationFlow.cta.writeEpisodeOutline') : t('creationFlow.cta.writeSectionOutline'),
                primaryAction: 'document',
            };
        }
        case 'storyboard': {
            const ownDone = !!facts.docs.storyboard;
            // 用户拍板（2026-11-07）：剧本分镜表强制必填，不因「已有正文」跳过——
            // 分镜是剧本可拍性的前置条件，与前期调研/大纲的存量项目跳过规则不同。
            const done = ownDone;
            return {
                ratio: done ? 1 : 0,
                done,
                progressText: done ? t('creationFlow.progress.storyboardReady') : t('creationFlow.progress.storyboardTodo'),
                ctaLabel: t('creationFlow.cta.writeStoryboard'),
                primaryAction: 'document',
            };
        }
        case 'chapters': {
            const done = total > 0 && written >= total;
            const progressText = total > 0
                ? t('creationFlow.progress.chaptersWritten', { written, total })
                : t('creationFlow.progress.chaptersTodo');
            const ctaLabel = total <= 0
                ? t('creationFlow.cta.createChapters')
                : unitCtaLabel('long', next ?? 1, unitLabel);
            return {
                ratio: ratioOf(written, total),
                done,
                progressText,
                ctaLabel,
                primaryAction: total <= 0 ? 'create-units' : 'write-unit',
            };
        }
        case 'units': {
            const done = total > 0 && written >= total;
            const progressText = total > 0
                ? t('creationFlow.progress.unitsWritten', { written, total, unit: unitLabel })
                : t('creationFlow.progress.unitsTodo', { unit: unitLabel });
            const ctaLabel = total <= 0
                ? createUnitCta(facts, unitLabel)
                : unitCtaLabel(mode, next ?? 1, unitLabel);
            return {
                ratio: ratioOf(written, total),
                done,
                progressText,
                ctaLabel,
                primaryAction: total <= 0 ? 'create-units' : 'write-unit',
            };
        }
        case 'settlement': {
            // 结算阶段按「全书规划章数」算完成度，不能按「已写章数」。
            // 按已写算时，只写了第 1 章并顺手结算，就会 1/1 判成「结算完成」，
            // 明明还有 9 章没写（2026-10-27 用户回归）。
            const done = total > 0 && settled >= total;
            return {
                ratio: ratioOf(settled, total),
                done,
                progressText: total > 0
                    ? t('creationFlow.progress.settlementDone', {
                        settled,
                        total,
                        writtenNote: written > settled ? t('creationFlow.progress.settlementWrittenNote', { written }) : '',
                    })
                    : t('creationFlow.progress.settlementTodo'),
                ctaLabel: done ? t('creationFlow.cta.allSettled') : t('creationFlow.cta.settleNext'),
                primaryAction: 'settle',
            };
        }
        case 'export': {
            const done = !!facts.exportExists;
            return {
                ratio: done ? 1 : 0,
                done,
                progressText: done
                    ? t('creationFlow.progress.exportReady')
                    : written > 0
                        ? t('creationFlow.progress.exportAvailable', { written, unit: unitLabel })
                        : t('creationFlow.progress.exportTodo'),
                ctaLabel: done ? t('creationFlow.cta.viewExport') : t('creationFlow.cta.exportNow'),
                primaryAction: 'export',
            };
        }
        default: {
            return {
                ratio: 0,
                done: false,
                progressText: '',
                ctaLabel: t('creationFlow.cta.view'),
                primaryAction: stage.action,
            };
        }
    }
}

/**
 * 已完成阶段的按钮文案：从「继续做」改成「查看/回看」
 *
 * @param stage - 阶段
 * @param mode - 模式
 * @param unitLabel - 单元标签
 * @returns 文本结果
 */
function doneCtaLabel(stage: CreationFlowStage, mode: CreationMode, unitLabel: string): string {
    switch (stage.id) {
        case 'wizard': return t('creationFlow.doneCta.wizard');
        case 'research': return t('creationFlow.doneCta.research');
        case 'outline': return mode === 'script' ? t('creationFlow.doneCta.episodeOutline') : t('creationFlow.doneCta.sectionOutline');
        case 'storyboard': return t('creationFlow.doneCta.storyboard');
        case 'chapters': return t('creationFlow.doneCta.chapters');
        case 'units': return t('creationFlow.doneCta.units', { unit: unitLabel });
        case 'settlement': return t('creationFlow.doneCta.settlement');
        case 'export': return t('creationFlow.doneCta.export');
        default: return t('creationFlow.cta.view');
    }
}

/**
 * 事实 → 流程快照。
 *
 * 状态判定顺序（避免老项目被误判）：
 *   1. 自身完成 → done
 *   2. 自身有进度 → active（进度优先于依赖，老项目即使缺前置也照常显示）
 *   3. 第一个未完成阶段 → active
 *   4. 依赖未完成 → blocked
 *   5. 其余 → todo
 * @param mode - 模式
 * @param project - 项目（路径或对象）
 * @param facts - 事实
  * @returns CreationFlowSnapshot 实例
 */
export function resolveCreationFlow(
    mode: CreationMode,
    project: string,
    facts: CreationFlowFacts,
): CreationFlowSnapshot {
    const stages = getCreationFlowStages(mode);
    // 展示用单位按语言求值；文件/路径仍用 modeUnitLabel（数据契约）
    const unitLabel = t(`settings.mode.spec.${mode}.unitLabel`);
    // 已有章节骨架说明初始化至少跑到过分卷/建章，避免老项目永远卡在第一步
    const wizardDone = facts.wizardDone === true || facts.unitTotal > 0;

    const computations = stages.map(stage => evaluateStage(stage, mode, unitLabel, facts, wizardDone));
    const doneFlags = computations.map(computation => computation.done || computation.ratio >= 1);
    const firstNotDone = doneFlags.findIndex(done => !done);
    const stageById = new Map(stages.map(stage => [stage.id, stage]));

    const statuses: CreationFlowStageStatus[] = stages.map((stage, index) => {
        const computation = computations[index];
        let state: CreationFlowStageState;
        let blockedBy: string | undefined;
        let blockedReason: string | undefined;

        if (doneFlags[index]) {
            state = 'done';
        } else if (index === firstNotDone) {
            // 第一个未完成阶段永远是 active（引导用户从这里继续）
            state = 'active';
        } else {
            // 强制前置（hardDependsOn）：即使本阶段已有进度，也要按 blocked 展示。
            // 用于剧本分镜表这类「必填、不可因存量正文跳过」的前置。
            const hardBlocked = (stage.hardDependsOn || []).find(dep => {
                const depIndex = stages.findIndex(item => item.id === dep);
                return depIndex >= 0 && !doneFlags[depIndex];
            });
            if (hardBlocked) {
                state = 'blocked';
                const depStage = stageById.get(hardBlocked);
                blockedBy = hardBlocked;
                blockedReason = t('creationFlow.blocked.needFirst', { stage: depStage ? stageLabel(depStage) : hardBlocked });
            } else if (computation.ratio > 0) {
                state = 'active';
            } else {
                blockedBy = (stage.dependsOn || []).find(dep => {
                    const depIndex = stages.findIndex(item => item.id === dep);
                    return depIndex >= 0 && !doneFlags[depIndex];
                });
                if (blockedBy) {
                    state = 'blocked';
                    const depStage = stageById.get(blockedBy);
                    blockedReason = t('creationFlow.blocked.needFirst', { stage: depStage ? stageLabel(depStage) : blockedBy });
                } else {
                    state = 'todo';
                }
            }
        }

        return {
            ...stage,
            // 展示字段按当前语言求值（id/action/weight/dependsOn 保持原样，行为契约不变）
            label: stageLabel(stage),
            description: stageDesc(stage),
            state,
            ratio: clamp01(computation.ratio),
            progressText: computation.progressText,
            ctaLabel: state === 'done'
                ? doneCtaLabel(stage, mode, unitLabel)
                : state === 'blocked'
                    ? t('creationFlow.blocked.needFirst', { stage: (() => { const dep = stageById.get(blockedBy || ''); return dep ? stageLabel(dep) : ''; })() })
                    : computation.ctaLabel,
            primaryAction: computation.primaryAction,
            blockedReason,
            blockedBy,
        };
    });

    const overall = statuses.reduce((sum, stage) => sum + stage.weight * stage.ratio, 0);

    return {
        mode,
        unitLabel,
        project,
        stages: statuses,
        overallRatio: clamp01(Math.round(overall * 100) / 100),
        nextStageId: firstNotDone >= 0 ? stages[firstNotDone].id : '',
        nextUnitNumber: facts.nextUnitNumber,
    };
}

const TABLE_HEADER_WORDS = new Set([
    '镜号', '景别', '角度', '运镜', '时长', '画面', '动作/表演', '台词/音效', '转场', '目的',
]);

function isSubstantiveLine(line: string): boolean {
    const trimmed = line.trim();
    if (!trimmed) return false;
    if (/^#{1,6}\s/.test(trimmed)) return false;
    if (/^>/.test(trimmed)) return false;
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) return false;
    // 表格分隔行
    if (/^\|?[\s:|-]+\|?$/.test(trimmed)) return false;
    // 未填写的字段行：- 目标： / 1. 冲突：
    if (/^[-*+]\s*[^：:]{0,16}[：:]\s*$/.test(trimmed)) return false;
    if (/^\d+[.、]\s*[^：:]{0,16}[：:]\s*$/.test(trimmed)) return false;
    if (trimmed.startsWith('|')) {
        const cells = trimmed.split('|').slice(1, -1).map(cell => cell.trim()).filter(Boolean);
        const dataCells = cells.filter(cell => !TABLE_HEADER_WORDS.has(cell));
        return dataCells.length >= 3;
    }
    return trimmed.replace(/[\s\p{P}]/gu, '').length >= 4;
}

function countSubstantiveLines(content: string): number {
    const body = content
        .replace(/\r\n/g, '\n')
        .replace(/^---\n[\s\S]*?\n---\n?/, '');
    return body.split('\n').reduce((count, line) => count + (isSubstantiveLine(line) ? 1 : 0), 0);
}

/**
 * 骨架文档是否已经被真正填写过。
 *
 * 项目创建时会写入带提示语的 starter，仅「文件存在」不能算完成，
 * 否则新建项目会立刻显示 100%。判定口径：
 *   - 与 starter 完全一致 → 未填写
 *   - 比 starter 多出 20 字符以上 → 已填写
 *   - 否则至少有 2 行实质内容（排除标题、引用、空字段）
 * @param content - 内容
 * @param starter - 起始值
 * @returns 是否成功
 */
export function hasMeaningfulDocContent(content: string, starter = ''): boolean {
    const body = String(content || '').replace(/\r\n/g, '\n').trim();
    if (!body) return false;
    const base = String(starter || '').replace(/\r\n/g, '\n').trim();
    if (!base) return body.length >= 40 || countSubstantiveLines(body) >= 2;
    if (body === base) return false;
    if (body.length >= base.length + 20) return true;
    return countSubstantiveLines(body) >= 2;
}

/**
 * 流程总览文案，供项目页摘要与 Agent 复用
 *
 * @param snapshot - 快照
 * @returns 文本结果
 */
export function formatCreationFlowSummary(snapshot: CreationFlowSnapshot): string {
    const percent = Math.round(snapshot.overallRatio * 100);
    const next = snapshot.stages.find(stage => stage.id === snapshot.nextStageId);
    const head = t('creationFlow.summary.head', { project: snapshot.project, percent });
    return next ? t('creationFlow.summary.next', { head, stage: stageLabel(next) }) : t('creationFlow.summary.allDone', { head });
}
