
import { TFile, TFolder } from 'obsidian';
import NovelWriterPlugin from '../main';
import { OUTLINE_TABLE_HEADER } from '../shared/format-constants';
import { WORLDVIEW_SLICE } from '../shared/thresholds';
import type { OutlineSettings, WorldElements } from './ai-types';
import { AIApiClient } from './ai-api-client';
import type { APIResponse } from './ai-engine';
import { pjControlDir, pjVolumeOutlineDir } from '../shared/paths';
import {
    OUTLINE_VOLUME_REQUIRED_KEYS,
    buildBlueprintRepairHint,
    buildVolumeRepairHint,
    chunkRanges,
    consolidateChapterTable,
    extractFieldValue,
    findMissingChapterRanges,
    normalizeChapterRanges,
    normalizeOutlineSettings,
    validateBlueprintCompleteness,
    validateGlobalChapterContinuity,
    validateVolumeStructure,
    type BlueprintValidationContext,
    type NormalizedOutlineSettings,
} from './outline-contract';

import type { Notifier } from '../shared/types';
import { NOOP_NOTIFIER } from '../shared/types';
import { VolumeOutlineSummarizer, type VolumeSummary } from './volume-outline-summarizer';
import {
    CrossVolumeOutlineValidator,
    FACTION_FALL_WORDS,
    FACTION_RISE_WORDS,
    type CrossVolumeValidationReport,
    type GlobalStorylineBlueprint as ValidatorBlueprint,
} from './cross-volume-outline-validator';
import { CrossVolumeIntegrator, type CrossVolumeSnapshot } from './cross-volume-integration';
import { createLogger } from '../shared/logger';

const log = createLogger('AiOutlineGenerator');

/** 单卷章节数安全阈值：超过该值时单次逐章输出易触发省略/截断，需日志告警提示调整分卷参数 */
const MAX_CHAPTERS_PER_VOLUME = 100;
/** 单卷章节数超过该阈值时启用分段生成（卷概览 + 章节分批），从结构上规避单次输出被截断 */
const OUTLINE_VOLUME_SEGMENT_THRESHOLD = 60;
/** 分段生成时每批输出的章节数 */
const OUTLINE_SEGMENT_BATCH_SIZE = 25;
/** 章节批次并发生成上限：压缩长卷的墙钟耗时，同时避免触发 API 并发限流 */
const OUTLINE_BATCH_CONCURRENCY = 3;
/** 单卷生成的最大轮数（含首轮）：每轮基于上一轮缺陷做定向补全，耗尽后降级返回而非中断 */
const OUTLINE_VOLUME_MAX_ATTEMPTS = 3;
/** 跨卷关键问题定向修复的最大轮数 */
const OUTLINE_MAX_REPAIR_ROUNDS = 2;
/** 跨卷修复时回喂已有卷内容的长度上限，避免 prompt 膨胀 */
const OUTLINE_REPAIR_DRAFT_SLICE = 6000;
/** 蓝图质量控制的最大轮数（含首轮）：字段不完整/章号范围不合法时带缺陷清单重新生成 */
const OUTLINE_BLUEPRINT_MAX_ATTEMPTS = 3;
/** 章节缺失时「只补缺失区间」的增量补全最大轮数（避免整卷重写造成的成倍耗时） */
const OUTLINE_CHAPTER_COMPLETION_MAX_ROUNDS = 2;

/**
 * 大纲生成器。
 */
export class OutlineGenerator {
    private plugin: NovelWriterPlugin;
    private notifier: Notifier;
    private apiClient: AIApiClient;

    constructor(plugin: NovelWriterPlugin, apiClient: AIApiClient, notifier?: Notifier) {
        this.notifier = notifier || NOOP_NOTIFIER;
        this.plugin = plugin;
        this.apiClient = apiClient;
    }

    /**
     * 生成卷纲。
     *
     * @param worldview - 世界观
     * @param globalSkeleton - 全局骨架
     * @param volumeNumber - 卷号
     * @param totalVolumes - 总卷数
     * @param chaptersPerVolume - 每卷章数
     * @param contextPrompt - 上下文提示词
     * @param existingElements - 已有要素
     * @param blueprint - 全局蓝图文本
     * @param previousSummaries - 前情摘要
     * @param chapterRange - 章节范围
     * @returns 卷纲文本
     */
    async generateVolumeOutline(
        worldview: string,
        globalSkeleton: string,
        volumeNumber: number,
        totalVolumes: number,
        chaptersPerVolume: number,
        contextPrompt?: string,
        existingElements?: { characters: string; factions: string; locations: string; items: string; foreshadows?: string; timelineEvents?: string },
        blueprint?: ValidatorBlueprint,
        previousSummaries?: string,
        chapterRange?: [number, number]
    ): Promise<APIResponse> {
        const systemPrompt = `你是小说结构师。基于全书的全局骨架，为第${volumeNumber}卷生成详细大纲。

${blueprint ? `【全局故事线蓝图概要——不可改写的约束】
- 关键转折点：${blueprint.turningPoints?.map((tp: any) => `第${tp.expectedVolume}卷「${tp.name}」`).join('、') || '无'}
- 伏笔规划：${blueprint.requiredForeshadows?.map((f: any) => `第${f.buryVolume}卷埋「${f.name}」→第${f.expectedRevealVolume}卷收`).join('、') || '无'}
- 势力演变：${blueprint.factionTimeline?.map((fe: any) => `第${fe.expectedVolume}卷「${fe.factionName}」${fe.eventType === 'rise' ? '崛起' : '衰落'}`).join('、') || '无'}
` : ''}
【不可违反的输出契约】
本卷必须包含以下全部字段，缺一不可：
${OUTLINE_VOLUME_REQUIRED_KEYS.map(k => `- **${k}**：值`).join('\n')}
- **章节分配**：（必须两列表格 ${OUTLINE_TABLE_HEADER}，完整列出本卷共 ${chaptersPerVolume} 章，禁止任何省略，表格必须严格只有两列）

章节分配表格格式示例：
${OUTLINE_TABLE_HEADER}
|---|---|
| N | 一句话描述该章的核心冲突 |
| N+1 | ...（如此类推，直到该卷最后一章） |

违反以上任何一项，输出将被判定为无效并重新生成。

【四大核心要素具体要求——必须填写且内容充实】
1. **三幕结构**：按"建置阶段/对抗阶段/解决阶段"三段式概述本卷剧情走向——建置阶段交代背景与冲突起点；对抗阶段推进冲突升级；解决阶段收束本卷高潮并过渡至下一卷
2. **爽点节奏**：标注本卷爽点位置和类型，至少一个爽点（如"第3章：能力觉醒"、"第8章：身份反转打脸"、"第12章：以弱胜强"）
3. **反转路线**：描述本卷反转节点，至少1-2次，从小到大递进（如"小反转：盟友背叛→中反转：幕后黑手现身→大反转：主角身世揭晓"）
4. **情绪曲线**：描述本卷情绪起伏走向，如"低谷→上升→高潮→回落"、"压抑→爆发→释然"

【卷间递进约束——优先级最高】
1. 必须严格遵循全局蓝图中的主线脉络和关键转折点
2. 必须承接前序卷的人物状态和事件结果
3. 本卷的结尾过渡必须与蓝图规划一致
4. 不得擅自修改主线剧情或人物命运
5. 支线剧情可以独立展开，但与主线的连接点必须有合理因果逻辑

【输出格式——严格按以下格式输出该卷的完整大纲】

### 第${volumeNumber}卷
- **卷名**：
- **章节范围**：第X章 - 第Y章（必须输出实际章号数字，禁用"AI计算具体章号范围"等占位符）
- **核心冲突**：
- **主要事件**：
- **人物弧光**：
- **本卷字数**：
- **本卷高潮**：
- **结尾过渡**：
- **三幕结构**：（建置阶段/对抗阶段/解决阶段，每阶段简述）
- **爽点节奏**：（本卷爽点位置和类型，如"第3章：能力觉醒"）
- **反转路线**：（反转节点描述，从小到大）
- **情绪曲线**：（本卷情绪起伏走向，如"低谷→上升→高潮→回落"）
- **伏笔安排**：（本卷埋设/回收的伏笔，每条以「埋设：X」或「回收：Y」开头；本卷确实没有时写「（无）」）
- **势力变动**：（本卷势力格局变化，如「裴家：衰落」；本卷确实没有时写「（无）」）
- **章节分配**：（必须两列表格，完整列出本卷共 ${chaptersPerVolume} 章，禁止任何省略，表格必须严格只有两列）

${OUTLINE_TABLE_HEADER}
|---|---|
| N | 一句话描述该章的核心冲突 |
| N+1 | ...（如此类推，直到该卷最后一章） |

不要输出额外解释，不要重复其他卷的内容。只输出本卷。

【输出前自检清单——必须逐项确认】
在输出大纲前，请逐项检查以下内容。如果缺少任何一项，必须补充后再输出：
${(blueprint?.turningPoints?.filter((tp: any) => tp.expectedVolume === volumeNumber).length ?? 0) > 0 ? `1. ✅ 本卷必须包含的转折点已在「主要事件」或「三幕结构」中明确描述` : ''}
${(blueprint?.requiredForeshadows?.filter((f: any) => f.expectedRevealVolume === volumeNumber).length ?? 0) > 0 ? `2. ✅ 本卷必须回收的伏笔已在「主要事件」中安排回收剧情` : ''}
${(blueprint?.factionTimeline?.filter((fe: any) => fe.expectedVolume === volumeNumber).length ?? 0) > 0 ? `3. ✅ 本卷必须体现的势力演变已在「主要事件」或「核心冲突」中体现` : ''}
4. ✅ 章节范围字段填写了具体数字（如"第51章 - 第100章"）
5. ✅ 章节分配表格完整列出了本卷全部 ${chaptersPerVolume} 章

【角色使用铁律】
- 你必须基于用户提供的已有角色来规划本卷的人物弧光
- 严禁自创全新主角，所有主角必须来自已有角色列表
- 如果已有角色不足以支撑剧情，只能从已有角色中发展或引入从已有势力中衍生的配角`;

        let userPrompt = `基于以下信息，为第${volumeNumber}卷（共${totalVolumes}卷）生成详细大纲。

${globalSkeleton ? `【全书骨架】
${globalSkeleton.slice(0, 4000)}
` : ''}
【世界观参考】
${worldview.slice(0, WORLDVIEW_SLICE)}

【已有角色】
${existingElements?.characters || '无'}

【已有势力】
${existingElements?.factions || '无'}

【已有地点】
${existingElements?.locations || '无'}

【已有物品功法】
${existingElements?.items || '无'}

【已有伏笔】
${existingElements?.foreshadows || '无'}
【已有时间线事件】
${existingElements?.timelineEvents || '无'}

【章节数量】
本卷应生成 ${chaptersPerVolume} 章的详细大纲。必须逐章列出，禁止使用"..."、"省略"、"以此类推"等任何省略表述。

${chapterRange ? `【章节编号范围】
本卷章节编号必须严格为：第${chapterRange[0]}章 到 第${chapterRange[1]}章。
章节分配表格中的章号必须从 ${chapterRange[0]} 开始，依次递增，最后一章必须是 ${chapterRange[1]}。
章节范围字段必须填写为：第${chapterRange[0]}章 - 第${chapterRange[1]}章。
` : ''}

${blueprint?.turningPoints ? (() => {
                const volumeTPs = blueprint.turningPoints.filter(tp => tp.expectedVolume === volumeNumber);
                if (volumeTPs.length > 0) {
                    return `【本卷必须包含的关键转折点】
以下转折点是全局故事线蓝图中规划的本卷必须出现的核心剧情节点，**必须**在「主要事件」或「三幕结构」中明确描述：
${volumeTPs.slice(0, 5).map((tp, idx) => `${idx + 1}. 「${tp.name}」${tp.expectedChapterRange ? `（预期章节：${tp.expectedChapterRange[0]}-${tp.expectedChapterRange[1]}）` : ''}`).join('\n')}

**强制要求**：如果缺少上述任何一个转折点，本卷大纲将被视为不合格！必须在相应章节中安排转折点的剧情表现。
`;
                }
                return '';
            })() : ''}

${blueprint?.requiredForeshadows ? (() => {
                const volumeFS = blueprint.requiredForeshadows.filter(f => f.expectedRevealVolume === volumeNumber);
                if (volumeFS.length > 0) {
                    return `【本卷必须回收的伏笔】
以下伏笔是全局故事线蓝图中规划的本卷必须回收的剧情线索，**必须**在「主要事件」中安排回收：
${volumeFS.slice(0, 5).map((f, idx) => `${idx + 1}. 「${f.name}」（第${f.buryVolume}卷埋设 → 本卷回收）`).join('\n')}

**强制要求**：如果缺少上述任何一个伏笔回收，本卷大纲将被视为不合格！
`;
                }
                return '';
            })() : ''}

${blueprint?.factionTimeline ? (() => {
                const volumeFE = blueprint.factionTimeline.filter(fe => fe.expectedVolume === volumeNumber);
                if (volumeFE.length > 0) {
                    return `【本卷必须体现的势力演变】
以下势力变化是全局故事线蓝图中规划的本卷必须体现的格局变动，**必须**在「主要事件」或「核心冲突」中体现：
${volumeFE.slice(0, 5).map((fe, idx) => `${idx + 1}. 「${fe.factionName}」：${fe.eventType === 'rise' ? '崛起/兴盛' : fe.eventType === 'fall' ? '衰落/覆灭' : '转变'}`).join('\n')}

**强制要求**：如果缺少上述任何一个势力演变，本卷大纲将被视为不合格！
`;
                }
                return '';
            })() : ''}

【规划原则——优先级最高】
- 必须基于以上已有角色/势力/地点/物品来规划本卷的人物弧光和剧情
- 严禁自创主角或核心势力，所有主要角色必须从已有角色中选取
- 人物弧光部分必须明确引用已有角色姓名

${previousSummaries ? `【前序卷关键信息摘要——必须在规划本卷时考虑】
${previousSummaries}
` : ''}
【要求】
- 只输出第${volumeNumber}卷的内容
- 章节表中的章号必须是连续整数
- 章节分配表格必须完整列出本卷全部 ${chaptersPerVolume} 章，禁止使用"..."、"省略"、"以此类推"等任何省略表述`;

        if (contextPrompt) {
            userPrompt += `\n\n【用户补充要求】\n${contextPrompt}`;
        }

        return this.apiClient.callAI(systemPrompt, userPrompt, this.plugin.settings.flashModel, 0.6, this.plugin.settings.maxOutput);
    }

    /**
     * 生成大纲。
     *
     * @param worldview - 世界观
     * @param settings - 设置
     * @param existingWorldElements - 已有世界要素
     * @param customPrompt - 自定义提示词
     * @param onProgress - 进度回调
     * @returns 大纲文本
     */
    async generateOutline(
        worldview: string,
        settings: OutlineSettings,
        existingWorldElements?: WorldElements,
        customPrompt?: string,
        onProgress?: (phase: string, current: number, total: number) => void
    ): Promise<APIResponse> {
        // 设置归一化：volumes / wordsPerChapter / totalChapters 全部落入合法域，
        // 从根上排除除零、每卷 0 章、章号总数与规划值脱节等边界问题。
        const norm = normalizeOutlineSettings(settings);
        const volumes = norm.volumes;
        const totalChapters = norm.totalChapters;

        // Phase -1: 清除旧卷数据（重新生成时）——清理失败不阻断生成
        const project = this.plugin.getActiveProject();
        if (project) {
            try {
                const volumesPath = pjVolumeOutlineDir(project);
                const volumesDir = this.plugin.app.vault.getAbstractFileByPath(volumesPath);
                if (volumesDir instanceof TFolder) {
                    const volumeFiles = volumesDir.children.filter(
                        (child): child is TFile => child instanceof TFile && child.name.endsWith('_分卷大纲.md'),
                    );
                    // 重新生成前先备份旧大纲；备份失败时保留旧文件，避免 AI 失败后旧规划直接消失。
                    // writeVolumeOutlines 会在新内容成功生成后清理残留旧卷，因此保留文件不会污染最终结果。
                    let backupOk = true;
                    if (volumeFiles.length > 0) {
                        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
                        const backupPath = `${pjControlDir(project)}/分卷大纲备份_${stamp}.md`;
                        try {
                            const parts: string[] = [];
                            for (const file of volumeFiles) {
                                parts.push(`# ${file.basename}

${await this.plugin.app.vault.read(file)}`);
                            }
                            await this.plugin.app.vault.create(backupPath, parts.join('\n\n---\n\n'));
                            this.notifier.showNotice(`已备份旧分卷大纲：${backupPath}`, 5000);
                        } catch (backupError) {
                            backupOk = false;
                            log.warn('[小说工坊] 旧分卷大纲备份失败，保留旧文件不删除:', backupError);
                        }
                    }
                    if (backupOk) {
                        log.info('[小说工坊] 递进式大纲 - Phase -1: 清除旧卷数据');
                        // v4.27 修复：只删本插件生成的 `*_分卷大纲.md`。
                        // 旧实现删除该目录**全部** children（含用户自建笔记），
                        // 而备份只含大纲文件——非大纲文件会被永久删除且无备份。
                        for (const child of volumesDir.children) {
                            if (child instanceof TFile && child.name.endsWith('_分卷大纲.md')) {
                                await this.plugin.app.vault.delete(child, true);
                            }
                        }
                    }
                }
            } catch (e) {
                log.warn('[小说工坊] Phase -1 清理旧卷失败，继续生成:', e);
            }
        }

        // Phase 0: 扫描已有项目状态
        let existingSnapshot: CrossVolumeSnapshot | undefined;
        if (project) {
            log.info('[小说工坊] 递进式大纲 - Phase 0: 扫描跨卷状态');
            const integrator = new CrossVolumeIntegrator(this.plugin.app, this.notifier);
            try {
                existingSnapshot = await integrator.getSnapshotData(project);
                log.info(`[小说工坊] Phase 0 完成: 人物${existingSnapshot.characters.length} 势力${existingSnapshot.factions.length} 伏笔${existingSnapshot.foreshadows.length} 时间线${existingSnapshot.timeline.length}`);
            } catch (e) {
                log.warn('[小说工坊] Phase 0 扫描失败，继续生成:', e);
            }
        }

        // 统一收集项目已有元素，供蓝图与各卷生成共用（避免多处重复拼装导致上下文不一致）
        const existingElements = {
            characters: existingWorldElements?.characters || '',
            factions: existingWorldElements?.factions || '',
            locations: existingWorldElements?.locations || '',
            items: existingWorldElements?.items || '',
            foreshadows: existingWorldElements?.foreshadows,
            timelineEvents: existingWorldElements?.timelineEvents,
        };

        // Phase 1: 全局蓝图 —— 与逐卷生成同等的质量控制：字段契约校验 + 章号范围归一化 + 定向补全
        onProgress?.('blueprint', 0, volumes);
        log.info('[小说工坊] 递进式大纲 - Phase 1: 生成全局蓝图（含契约校验与章号归一化）');
        const blueprintOutcome = await this.generateBlueprintWithQualityControl({
            worldview,
            elements: existingElements,
            volumes,
            totalChapters,
            existingSnapshot,
            onRetry: () => onProgress?.('blueprint', 0, volumes),
        });
        const blueprint = blueprintOutcome.blueprint;
        const chapterRanges = blueprintOutcome.chapterRanges;

        // Phase 2-N: 逐卷递进生成
        // 章号范围直接取自 Phase 1 归一化结果：长度恒等于分卷数、各卷首尾相接、总和恒等于总章数，
        // 因此这里不再需要「蓝图缺失则按 ceil 平均分配」的兜底（原兜底会把 400 章放大成 402 章）。
        log.info(`[小说工坊] 递进式大纲 - Phase 2-N: 逐卷生成 (共${volumes}卷)`);

        const summaries: VolumeSummary[] = [];
        const volumeResults: string[] = [];
        const volumeRanges: Array<[number, number]> = [];
        for (let v = 1; v <= volumes; v++) {
            const chapterRange = chapterRanges[v - 1];
            const volChapterCount = chapterRange[1] - chapterRange[0] + 1;

            if (volChapterCount > MAX_CHAPTERS_PER_VOLUME) {
                log.warn(`[小说工坊] 第${v}卷章节数 ${volChapterCount} 超过单卷安全阈值 ${MAX_CHAPTERS_PER_VOLUME}，将启用分段生成规避截断`);
            }

            onProgress?.('volume', v, volumes);
            log.info(`[小说工坊] 递进式大纲 - 生成第${v}卷...（${volChapterCount}章）`);

            const previousSummariesText = new VolumeOutlineSummarizer().compress(summaries);

            // 单卷质量控制：机械性缺陷确定性净化 + 内循环重试 + 分段组织 + 增量补全；耗尽降级保留最佳结果
            let volResult: { content: string; degraded: boolean } = { content: '', degraded: true };
            try {
                volResult = await this.generateVolumeWithQualityControl({
                    worldview,
                    volumeNumber: v,
                    totalVolumes: volumes,
                    volChapterCount,
                    wordsPerChapter: norm.wordsPerChapter,
                    chapterRange,
                    customPrompt,
                    existingElements,
                    blueprint,
                    previousSummariesText,
                    onRetry: () => onProgress?.('volume', v, volumes),
                });
            } catch (e) {
                log.error(`[小说工坊] 第${v}卷生成出现未预期异常（不中断，继续后续卷）:`, e);
            }

            volumeRanges.push(chapterRange);

            let volContent = volResult.content;
            if (!volContent.trim()) {
                log.error(`[小说工坊] 第${v}卷无任何可用内容，写入占位标记后继续（不中断）`);
                volContent = [
                    `### 第${v}卷`,
                    '- **卷名**：（本卷生成失败，可重新生成）',
                    `- **章节范围**：第${chapterRange[0]}章 - 第${chapterRange[1]}章`,
                    '- **核心冲突**：（AI 未返回有效内容）',
                ].join('\n');
            } else {
                summaries.push(new VolumeOutlineSummarizer().extract(volContent, v));
                if (!volContent.includes(`### 第${v}卷`)) {
                    volContent = `### 第${v}卷\n${volContent}`;
                }
                log.info(`[小说工坊] 第${v}卷完成 (${volContent.length}字符)${volResult.degraded ? '（降级）' : ''}`);
            }
            volumeResults.push(volContent);
        }

        // Phase N+1: 跨卷连贯性验证（纯正则，不调用 AI）——验证异常不阻断
        onProgress?.('validation', 0, 1);
        log.info('[小说工坊] 递进式大纲 - Phase N+1: 跨卷连贯性验证');
        const validator = new CrossVolumeOutlineValidator();
        let report: CrossVolumeValidationReport | undefined;
        try {
            report = validator.validate(volumeResults, blueprint);
            this.logValidationReport(report);
        } catch (e) {
            log.warn('[小说工坊] 跨卷验证异常（降级跳过验证）:', e);
        }

        // Phase N+2: 跨卷关键问题定向修复（多轮迭代，失败降级，绝不中断）
        if (report && report.criticalIssues.length > 0) {
            log.info(`[小说工坊] 递进式大纲 - Phase N+2: 定向修复 ${report.criticalIssues.length} 个跨卷关键问题`);
            onProgress?.('repair', 1, OUTLINE_MAX_REPAIR_ROUNDS);
            try {
                const repaired = await this.repairCrossVolumeIssues({
                    volumeResults,
                    volumeRanges,
                    blueprint,
                    report,
                    worldview,
                    existingElements,
                    customPrompt,
                    onRound: (round) => onProgress?.('repair', round, OUTLINE_MAX_REPAIR_ROUNDS),
                });
                for (let i = 0; i < repaired.volumeResults.length; i++) {
                    volumeResults[i] = repaired.volumeResults[i];
                }
                report = repaired.report;
            } catch (e) {
                log.warn('[小说工坊] 跨卷定向修复异常（降级保留原内容）:', e);
            }
        }

        // Phase N+3: 全局章号连续性终检（组装前最后一道门）
        // 单卷校验只能保证「卷内自洽」，跨卷重叠/全书缺章/超总章数必须在这里兜住。
        let globalGaps = validateGlobalChapterContinuity(volumeResults, volumeRanges, totalChapters);
        if (globalGaps.length > 0) {
            log.warn(`[小说工坊] 递进式大纲 - Phase N+3: 全局章号终检发现 ${globalGaps.length} 项问题，触发章节定向补全`);
            for (const gap of globalGaps) log.warn(`  ${gap}`);
            for (let round = 1; round <= OUTLINE_MAX_REPAIR_ROUNDS; round++) {
                onProgress?.('repair', round, OUTLINE_MAX_REPAIR_ROUNDS);
                let changed = false;
                for (let i = 0; i < volumeResults.length; i++) {
                    const before = volumeResults[i];
                    try {
                        const completed = await this.completeMissingChapters({
                            content: before,
                            volumeNumber: i + 1,
                            chapterRange: volumeRanges[i],
                        });
                        if (completed !== before) {
                            volumeResults[i] = completed;
                            changed = true;
                        }
                    } catch (e) {
                        log.warn(`[小说工坊] 第${i + 1}卷全局章节补全异常（不中断）:`, e);
                    }
                }
                globalGaps = validateGlobalChapterContinuity(volumeResults, volumeRanges, totalChapters);
                if (globalGaps.length === 0 || !changed) break;
            }
            log.info(`[小说工坊] Phase N+3 结束，剩余全局章号问题 ${globalGaps.length} 项`);
        }

        const finalContent = this.buildOutlineDocument(norm, totalChapters, volumeResults);
        log.info(`[小说工坊] 递进式大纲完成！共${volumes}卷`);

        // 降级标记必须以「最终落盘内容」为准：跨卷定向修复/全局章节补全可能已经把
        // 初轮不达标的卷修好，若沿用生成阶段的旧标记，会误报「降级生成」。
        const finalDegradedVolumes = this.findDegradedVolumes(volumeResults, volumeRanges);

        // 降级项与遗留问题以 HTML 注释追加，不阻断输出、不重复调用 AI
        const annotations: string[] = [];
        if (blueprintOutcome.degraded) {
            annotations.push('<!-- 蓝图质量提示 -->\n' +
                `- 全局蓝图经 ${OUTLINE_BLUEPRINT_MAX_ATTEMPTS} 轮定向补全后仍未完全满足契约（转折点/伏笔/势力与角色时间线可能不完整），跨卷约束校验能力受限\n` +
                '\n<!-- 蓝图质量提示结束 -->');
        }
        if (finalDegradedVolumes.length > 0) {
            annotations.push('<!-- 降级生成提示 -->\n' +
                `- 第 ${finalDegradedVolumes.join('、')} 卷在 ${OUTLINE_VOLUME_MAX_ATTEMPTS} 轮内未完全达标，已保留最佳结果\n` +
                '\n<!-- 降级提示结束 -->');
        }
        if (report && report.warningIssues.length > 0) {
            annotations.push('<!-- 跨卷验证警告 -->\n' +
                report.warningIssues.map(i => `- [${i.severity}] ${i.message}`).join('\n') +
                '\n<!-- 警告结束 -->');
        }
        if (report && report.criticalIssues.length > 0) {
            annotations.push('<!-- 跨卷验证待完善问题（修复后仍存在） -->\n' +
                report.criticalIssues.map(i => `- ${i.message}`).join('\n') +
                '\n<!-- 待完善问题结束 -->');
        }
        if (globalGaps.length > 0) {
            annotations.push('<!-- 全局章号待完善问题 -->\n' +
                globalGaps.map(g => `- ${g}`).join('\n') +
                '\n<!-- 全局章号待完善问题结束 -->');
        }

        const output = annotations.length > 0
            ? finalContent + '\n\n' + annotations.join('\n\n')
            : finalContent;

        // 极端兜底：所有卷均未产出有效内容时返回错误，供 UI 提示
        if (volumeResults.length === 0 || volumeResults.every(c => c.includes('（AI 未返回有效内容）'))) {
            return { content: output, error: '各卷均未生成有效内容，请检查 API 配置后重试' };
        }
        return { content: output };
    }

    /**
     * 单卷生成质量控制：单次/分段生成 → 结构校验 → 按缺陷定向补全（最多 OUTLINE_VOLUME_MAX_ATTEMPTS 轮）。
     * 全程不抛出异常；重试耗尽时返回当前最佳结果（degraded=true），保证链路不中断。
     */
    private async generateVolumeWithQualityControl(args: {
        worldview: string;
        volumeNumber: number;
        totalVolumes: number;
        volChapterCount: number;
        wordsPerChapter: number;
        chapterRange: [number, number];
        customPrompt?: string;
        existingElements: { characters: string; factions: string; locations: string; items: string; foreshadows?: string; timelineEvents?: string };
        blueprint: ValidatorBlueprint;
        previousSummariesText: string;
        onRetry?: (attempt: number) => void;
    }): Promise<{ content: string; degraded: boolean }> {
        let bestContent = '';
        let bestGaps: string[] = ['本卷尚未生成'];
        let bestGapCount = Number.MAX_SAFE_INTEGER;

        for (let attempt = 1; attempt <= OUTLINE_VOLUME_MAX_ATTEMPTS; attempt++) {
            if (attempt > 1) args.onRetry?.(attempt);

            // 增量补全优先：若上一轮只是「缺章节」而字段/范围/表格均合规，
            // 只请求缺失章号区间即可，无需整卷重写（避免成倍耗时）。
            if (attempt > 1 && this.hasOnlyChapterGaps(bestGaps)) {
                const completed = await this.completeMissingChapters({
                    content: bestContent,
                    volumeNumber: args.volumeNumber,
                    chapterRange: args.chapterRange,
                });
                const gaps = validateVolumeStructure(completed, args.chapterRange, args.volChapterCount);
                if (gaps.length === 0) {
                    log.info(`[小说工坊] 第${args.volumeNumber}卷经增量章节补全达标（第${attempt}轮）`);
                    return { content: completed, degraded: false };
                }
                if (gaps.length < bestGapCount) {
                    bestGapCount = gaps.length;
                    bestContent = completed;
                    bestGaps = gaps;
                }
                continue;
            }

            // 重试轮次必须携带"上一轮缺陷清单"，既保证提示词随轮次变化（否则命中 prompt 五元组
            // 哈希缓存会直接返回完全相同的结果，形成无效重试），也驱动 AI 做针对性补全。
            const repairHint = attempt === 1 ? '' : buildVolumeRepairHint(bestGaps, attempt);

            let result: APIResponse | undefined;
            try {
                result = await this.callVolumeOutline({
                    worldview: args.worldview,
                    volumeNumber: args.volumeNumber,
                    totalVolumes: args.totalVolumes,
                    volChapterCount: args.volChapterCount,
                    wordsPerChapter: args.wordsPerChapter,
                    chapterRange: args.chapterRange,
                    customPrompt: args.customPrompt,
                    existingElements: args.existingElements,
                    blueprint: args.blueprint,
                    previousSummariesText: args.previousSummariesText,
                    attempt,
                    repairHint,
                });
            } catch (e) {
                log.warn(`[小说工坊] 第${args.volumeNumber}卷第${attempt}轮调用异常: ${e instanceof Error ? e.message : String(e)}`);
            }

            if (!result || result.error || !result.content?.trim()) {
                const errMsg = result?.error || 'AI 返回空内容';
                log.warn(`[小说工坊] 第${args.volumeNumber}卷第${attempt}轮生成失败: ${errMsg}`);
                bestGaps = [`AI 调用未返回有效内容（${errMsg}）`];
                continue;
            }

            // 机械性缺陷先做确定性净化：越界章号、重复章号、空描述行直接剔除，
            // 使校验只聚焦"真正需要 AI 补全"的缺口（缺字段、缺章节）。
            const sanitized = consolidateChapterTable(result.content, args.chapterRange[0], args.chapterRange[1]);
            const gaps = validateVolumeStructure(sanitized, args.chapterRange, args.volChapterCount);
            if (gaps.length === 0) {
                log.info(`[小说工坊] 第${args.volumeNumber}卷第${attempt}轮通过质量校验`);
                return { content: sanitized, degraded: false };
            }

            log.warn(`[小说工坊] 第${args.volumeNumber}卷第${attempt}轮存在 ${gaps.length} 项结构缺陷：${gaps.slice(0, 3).join('；')}`);
            if (gaps.length < bestGapCount) {
                bestGapCount = gaps.length;
                bestContent = sanitized;
                bestGaps = gaps;
            }
        }

        // 最后一搏：对最佳草稿做一次增量章节补全，仍不达标才降级
        if (bestContent) {
            const completed = await this.completeMissingChapters({
                content: bestContent,
                volumeNumber: args.volumeNumber,
                chapterRange: args.chapterRange,
            });
            const gaps = validateVolumeStructure(completed, args.chapterRange, args.volChapterCount);
            if (gaps.length === 0) {
                log.info(`[小说工坊] 第${args.volumeNumber}卷经末轮增量补全达标`);
                return { content: completed, degraded: false };
            }
            if (gaps.length < bestGapCount) {
                bestContent = completed;
                bestGaps = gaps;
            }
        }

        log.warn(`[小说工坊] 第${args.volumeNumber}卷 ${OUTLINE_VOLUME_MAX_ATTEMPTS} 轮后仍有 ${bestGaps.length} 项缺陷，降级保留最佳结果`);
        return { content: bestContent, degraded: true };
    }

    /** 缺陷是否全部为「章节覆盖不足」：此时字段/范围/表格均合规，可直接走增量补齐 */
    private hasOnlyChapterGaps(gaps: string[]): boolean {
        return gaps.length > 0 && gaps.every(g => g.startsWith('章节分配覆盖'));
    }

    /**
     * 增量章节补全：只请求缺失的章号区间（按缺号压缩为连续区间并分批），合并回原草稿后返回。
     * 全程不抛出异常；未补齐的部分留给上层判定（可继续走降级）。
     */
    private async completeMissingChapters(args: {
        content: string;
        volumeNumber: number;
        chapterRange: [number, number];
        maxRounds?: number;
    }): Promise<string> {
        const [start, end] = args.chapterRange;
        let content = consolidateChapterTable(args.content, start, end);
        const maxRounds = args.maxRounds ?? OUTLINE_CHAPTER_COMPLETION_MAX_ROUNDS;

        for (let round = 1; round <= maxRounds; round++) {
            const missing = findMissingChapterRanges(content, start, end);
            if (missing.length === 0) return content;

            const batches = chunkRanges(missing, OUTLINE_SEGMENT_BATCH_SIZE);
            log.info(`[小说工坊] 第${args.volumeNumber}卷增量补全第${round}轮：缺失 ${missing.length} 个区间，拆为 ${batches.length} 批`);

            const { rows, failed } = await this.runBatchRanges(
                batches,
                args.volumeNumber,
                this.buildBatchContext(content),
            );
            for (const range of failed) {
                log.warn(`[小说工坊] 第${args.volumeNumber}卷增量补全 ${range} 未取得有效行（不中断）`);
            }
            if (rows.length === 0) return content;
            content = consolidateChapterTable(content, start, end, rows.join('\n'));
        }
        return content;
    }

    /**
     * 按"章节分段"策略选择底层生成方式：
     * - 章节数 ≤ OUTLINE_VOLUME_SEGMENT_THRESHOLD：单次完整生成；
     * - 超过阈值：分段生成（卷概览 + 章节分配表分批），从结构上规避单次输出被截断。
     */
    private async callVolumeOutline(args: {
        worldview: string;
        volumeNumber: number;
        totalVolumes: number;
        volChapterCount: number;
        wordsPerChapter: number;
        chapterRange: [number, number];
        customPrompt?: string;
        existingElements: { characters: string; factions: string; locations: string; items: string; foreshadows?: string; timelineEvents?: string };
        blueprint: ValidatorBlueprint;
        previousSummariesText: string;
        attempt: number;
        repairHint: string;
    }): Promise<APIResponse> {
        const contextPrompt = args.repairHint
            ? [args.customPrompt, args.repairHint].filter(Boolean).join('\n\n')
            : args.customPrompt;

        if (args.volChapterCount > OUTLINE_VOLUME_SEGMENT_THRESHOLD) {
            return this.generateVolumeOutlineSegmented({
                worldview: args.worldview,
                volumeNumber: args.volumeNumber,
                totalVolumes: args.totalVolumes,
                volChapterCount: args.volChapterCount,
                wordsPerChapter: args.wordsPerChapter,
                chapterRange: args.chapterRange,
                contextPrompt,
                existingElements: args.existingElements,
                previousSummariesText: args.previousSummariesText,
            });
        }

        return this.generateVolumeOutline(
            args.worldview,
            '',
            args.volumeNumber,
            args.totalVolumes,
            args.volChapterCount,
            contextPrompt,
            args.existingElements,
            args.blueprint,
            args.previousSummariesText,
            args.chapterRange
        );
    }

    /**
     * 超长卷分段生成：先出「卷级概览」（不含章节表），再按批出「章节分配表行」，最后合并为一卷完整大纲。
     * 任一批次失败不中断，交由结构校验在下一轮触发定向补全。
     */
    private async generateVolumeOutlineSegmented(args: {
        worldview: string;
        volumeNumber: number;
        totalVolumes: number;
        volChapterCount: number;
        wordsPerChapter: number;
        chapterRange: [number, number];
        contextPrompt?: string;
        existingElements: { characters: string; factions: string; locations: string; items: string; foreshadows?: string; timelineEvents?: string };
        previousSummariesText: string;
    }): Promise<APIResponse> {
        const model = this.plugin.settings.flashModel;
        const [start, end] = args.chapterRange;

        const overviewSystem = `你是小说结构师。基于全局骨架为第${args.volumeNumber}卷生成「卷级概览」。
不要输出「章节分配」字段，也不要输出任何章节表格（章节表由后续分段补齐）。

【不可违反的输出契约】
必须包含以下全部字段，缺一不可：
${OUTLINE_VOLUME_REQUIRED_KEYS.map(k => `- **${k}**：值`).join('\n')}

【输出格式】
### 第${args.volumeNumber}卷
- **卷名**：
- **章节范围**：第${start}章 - 第${end}章（必须为这两个确定的章号，禁止占位符）
- **核心冲突**：
- **主要事件**：
- **人物弧光**：
- **本卷字数**：
- **本卷高潮**：
- **结尾过渡**：
- **三幕结构**：
- **爽点节奏**：
- **反转路线**：
- **情绪曲线**：
- **伏笔安排**：（本卷埋设/回收的伏笔，每条以「埋设：X」或「回收：Y」开头；本卷确实没有时写「（无）」）
- **势力变动**：（本卷势力格局变化，如「裴家：衰落」；本卷确实没有时写「（无）」）

不要输出章节分配表，不要输出额外解释。`;

        let overviewUser = `【本卷规划】
- 卷号：第${args.volumeNumber}卷（共${args.totalVolumes}卷）
- 章节范围：第${start}章 - 第${end}章（共 ${args.volChapterCount} 章）
- 每章约 ${args.wordsPerChapter} 字

【世界观参考】
${args.worldview.slice(0, WORLDVIEW_SLICE)}

【已有角色】
${args.existingElements.characters || '无'}

【已有势力】
${args.existingElements.factions || '无'}

【已有地点】
${args.existingElements.locations || '无'}
${args.previousSummariesText ? `\n【前序卷关键信息摘要——必须承接】\n${args.previousSummariesText}\n` : ''}
【要求】
- 只输出第${args.volumeNumber}卷的卷级概览，严禁输出章节分配表
- 严禁自创全新主角，必须基于以上已有角色展开`;
        if (args.contextPrompt) {
            overviewUser += `\n\n【用户补充要求】\n${args.contextPrompt}`;
        }

        const overview = await this.apiClient.callAI(overviewSystem, overviewUser, model, 0.6, this.plugin.settings.maxOutput);
        if (overview.error || !overview.content) {
            return overview;
        }

        // 批次输出统一交给契约层归并：越界/重复/空描述行被剔除，章号升序重排。
        // 单卷 100+ 章时逐批串行会成为主要耗时来源，这里用受限并发压缩墙钟时间。
        const batchRanges: Array<[number, number]> = [];
        for (let s = start; s <= end; s += OUTLINE_SEGMENT_BATCH_SIZE) {
            batchRanges.push([s, Math.min(s + OUTLINE_SEGMENT_BATCH_SIZE - 1, end)]);
        }
        const { rows: rowSources, failed: failedBatches } = await this.runBatchRanges(
            batchRanges,
            args.volumeNumber,
            this.buildBatchContext(overview.content),
        );
        if (failedBatches.length > 0) {
            log.warn(`[小说工坊] 第${args.volumeNumber}卷分段生成有 ${failedBatches.length} 个章节批次未取得有效行（${failedBatches.join('、')}），将由质量校验触发增量补全`);
        }

        const shell = [
            overview.content.trim(),
            '',
            '- **章节分配**：',
            OUTLINE_TABLE_HEADER,
            '|---|---|',
        ].join('\n');

        return { content: consolidateChapterTable(shell, start, end, rowSources.join('\n')) };
    }

    /**
     * 把卷级概览压缩成批次可用的结构化上下文。
     * 原实现只截取前 3000 字，长概览的伏笔/势力/反转等后半段字段会丢失，
     * 导致各批次只按“核心冲突”自由发挥，批次间质量与设定一致性下降。
     */
    private buildBatchContext(overviewContent: string): string {
        const fieldLimits: Record<string, number> = {
            '核心冲突': 600,
            '主要事件': 1200,
            '人物弧光': 800,
            '本卷高潮': 600,
            '三幕结构': 600,
            '爽点节奏': 600,
            '反转路线': 600,
            '情绪曲线': 400,
            '伏笔安排': 600,
            '势力变动': 600,
        };
        const fields = ['卷名', '章节范围', ...Object.keys(fieldLimits)];
        const lines = fields.map(key => {
            const value = extractFieldValue(overviewContent, key);
            if (!value) return '';
            const limit = fieldLimits[key] ?? 400;
            const text = value.length > limit ? `${value.slice(0, limit)}…` : value;
            return `- ${key}：${text}`;
        }).filter(Boolean);
        return lines.length > 0 ? lines.join('\n') : overviewContent.slice(0, 3000);
    }

    /** 受限并发执行章节批次；返回顺序与入参批次一致 */
    private async runBatchRanges(
        ranges: Array<[number, number]>,
        volumeNumber: number,
        volumeContext: string,
    ): Promise<{ rows: string[]; failed: string[] }> {
        const rowSources: Array<string | null> = new Array(ranges.length).fill(null);
        const failed: Array<string | null> = new Array(ranges.length).fill(null);
        let cursor = 0;

        const worker = async (): Promise<void> => {
            while (true) {
                const index = cursor++;
                if (index >= ranges.length) return;
                const [s, e] = ranges[index];
                let batch: APIResponse | undefined;
                try {
                    batch = await this.callChapterBatch(volumeContext, volumeNumber, s, e);
                } catch (err) {
                    log.warn(`[小说工坊] 第${volumeNumber}卷第${s}-${e}章批次调用异常（不中断其它批次）: ${err instanceof Error ? err.message : String(err)}`);
                }
                if (!batch || batch.error || !batch.content) {
                    failed[index] = `第${s}-${e}章`;
                    continue;
                }
                rowSources[index] = batch.content;
            }
        };

        const workerCount = Math.min(OUTLINE_BATCH_CONCURRENCY, ranges.length);
        await Promise.all(Array.from({ length: workerCount }, () => worker()));
        return {
            rows: rowSources.filter((value): value is string => value !== null),
            failed: failed.filter((value): value is string => value !== null),
        };
    }

    /** 分段生成：请求某一批章节的分配表行（仅输出 | 章号 | 核心冲突 | 行） */
    private async callChapterBatch(
        volumeContext: string,
        volumeNumber: number,
        start: number,
        end: number
    ): Promise<APIResponse> {
        const systemPrompt = `你是小说结构师。只输出「章节分配」表格的数据行，不要输出其他任何内容。

【铁律】
- 每行格式严格为：| 章号 | 一句话核心冲突 |
- 禁止输出表头行、分隔行、解释、序号说明或任何其它文本
- 章号必须严格覆盖 第${start}章 到 第${end}章，共 ${end - start + 1} 行，不得跳号、不得省略、不得合并
- 每章必须推进【卷级概览】中的主要事件，并服从其中的伏笔安排与势力变动，不得写成脱离主线的独立桥段
- 相邻章节之间必须有因果承接：本章冲突应源于上一章结果，并给下一章留下推进点`;

        const userPrompt = `【本卷概览（据此保持剧情连贯）】
${volumeContext}

【本批任务】
为第${volumeNumber}卷输出第${start}章 到 第${end}章 的章节分配表格行（共 ${end - start + 1} 行），每行形如：
| ${start} | 本章核心冲突的一句话概括 |
（依此类推，直到第${end}章）

只输出这些行，不要输出表头或任何其它内容。`;

        return this.apiClient.callAI(systemPrompt, userPrompt, this.plugin.settings.flashModel, 0.4, this.plugin.settings.maxOutput);
    }

    /**
     * 跨卷关键问题定向修复：按卷归并 critical 问题 → 请求该卷重写 → 结构不退化才接受 → 复验，
     * 最多 OUTLINE_MAX_REPAIR_ROUNDS 轮。全程不抛出异常，未修复项交由上层追加注释。
     */
    private async repairCrossVolumeIssues(args: {
        volumeResults: string[];
        volumeRanges: Array<[number, number]>;
        blueprint: ValidatorBlueprint;
        report: CrossVolumeValidationReport;
        worldview: string;
        existingElements: { characters: string; factions: string; locations: string; items: string; foreshadows?: string; timelineEvents?: string };
        customPrompt?: string;
        onRound?: (round: number) => void;
    }): Promise<{ volumeResults: string[]; report: CrossVolumeValidationReport }> {
        const validator = new CrossVolumeOutlineValidator();
        const volumeResults = [...args.volumeResults];
        let report = args.report;

        for (let round = 1; round <= OUTLINE_MAX_REPAIR_ROUNDS; round++) {
            // 问题→卷映射：优先 volumeIndex；无 volumeIndex 的问题（如伏笔未回收）退化为 relatedVolumes
            // 的首个卷，使「无法直接定位到具体卷」的问题也能被定向修复，而不是只能追加注释。
            const issuesByVolume = new Map<number, string[]>();
            for (const issue of report.criticalIssues) {
                const candidates = [issue.volumeIndex, ...(issue.relatedVolumes || [])]
                    .filter((n): n is number => typeof n === 'number' && n >= 0 && n < volumeResults.length);
                if (candidates.length === 0) continue;
                const idx = candidates[0];
                if (!issuesByVolume.has(idx)) issuesByVolume.set(idx, []);
                issuesByVolume.get(idx)!.push(issue.message);
            }
            if (issuesByVolume.size === 0) break;

            args.onRound?.(round);
            let repairedAny = false;

            for (const [idx, issues] of issuesByVolume) {
                const v = idx + 1;
                const range = args.volumeRanges[idx] || [0, 0];
                const expectedCount = range[1] > 0 ? range[1] - range[0] + 1 : 0;

                let result: APIResponse | undefined;
                try {
                    result = await this.callCrossVolumeRepair({
                        volumeNumber: v,
                        volumeContent: volumeResults[idx],
                        issues,
                        blueprint: args.blueprint,
                        worldview: args.worldview,
                        existingElements: args.existingElements,
                        customPrompt: args.customPrompt,
                        range,
                    });
                } catch (e) {
                    log.warn(`[小说工坊] 第${v}卷跨卷修复第${round}轮调用异常: ${e instanceof Error ? e.message : String(e)}`);
                }

                if (!result || result.error || !result.content?.trim()) {
                    log.warn(`[小说工坊] 第${v}卷跨卷修复第${round}轮未取得有效结果（不中断）: ${result?.error || '空响应'}`);
                    continue;
                }

                // 仅当修复结果结构不退化时才接受，避免"越修越差"
                const candidate = consolidateChapterTable(result.content, range[0], range[1]);
                if (expectedCount > 0) {
                    const gaps = validateVolumeStructure(candidate, range, expectedCount);
                    if (gaps.length > 0) {
                        log.warn(`[小说工坊] 第${v}卷跨卷修复结果结构仍不达标，保留原内容：${gaps.slice(0, 3).join('；')}`);
                        continue;
                    }
                }

                volumeResults[idx] = candidate.includes(`### 第${v}卷`)
                    ? candidate
                    : `### 第${v}卷\n${candidate}`;
                repairedAny = true;
                log.info(`[小说工坊] 第${v}卷跨卷修复第${round}轮已收敛`);
            }

            if (!repairedAny) break;

            // 收敛判定：只有「关键问题数量确实下降」才继续下一轮，避免无进展地空转浪费调用
            const beforeCount = report.criticalIssues.length;
            try {
                report = validator.validate(volumeResults, args.blueprint);
                this.logValidationReport(report);
            } catch (e) {
                log.warn('[小说工坊] 跨卷复验异常（保留上一轮报告）:', e);
                break;
            }
            if (report.criticalIssues.length === 0) break;
            if (report.criticalIssues.length >= beforeCount) {
                log.warn(`[小说工坊] 跨卷修复无进展（${beforeCount} → ${report.criticalIssues.length}），停止继续修复以避免无效 AI 调用`);
                break;
            }
        }

        return { volumeResults, report };
    }

    /** 请求针对某一卷的跨卷一致性修复（重写该卷完整大纲，含完整章节表） */
    private async callCrossVolumeRepair(args: {
        volumeNumber: number;
        volumeContent: string;
        issues: string[];
        blueprint: ValidatorBlueprint;
        worldview: string;
        existingElements: { characters: string; factions: string; locations: string; items: string; foreshadows?: string; timelineEvents?: string };
        customPrompt?: string;
        range: [number, number];
    }): Promise<APIResponse> {
        const model = this.plugin.settings.flashModel;
        const [start, end] = args.range;
        const chapterCount = end >= start ? end - start + 1 : 0;

        const systemPrompt = `你是小说结构编辑，负责修复跨卷一致性缺陷。你必须重写第${args.volumeNumber}卷的完整大纲，在修正指定问题的同时保持与前后卷的衔接一致。

【不可违反的输出契约】
- 必须包含全部 ${OUTLINE_VOLUME_REQUIRED_KEYS.length} 个必填字段：${OUTLINE_VOLUME_REQUIRED_KEYS.join('、')}
- 「章节分配」必须使用两列表格 ${OUTLINE_TABLE_HEADER}，完整列出本卷${chapterCount > 0 ? `共 ${chapterCount} 章（第${start}章 - 第${end}章）` : '全部章节'}，禁止省略
${chapterCount > 0 ? `- 「章节范围」必须填写为：第${start}章 - 第${end}章` : ''}

【输出格式】
### 第${args.volumeNumber}卷
（按上述字段逐项输出，不要输出解释或修改说明）`;

        let userPrompt = `请修复第${args.volumeNumber}卷大纲的跨卷一致性问题。

【本卷现有大纲】
${args.volumeContent.slice(0, OUTLINE_REPAIR_DRAFT_SLICE)}

【必须逐项修复的问题】
${args.issues.slice(0, 8).map((msg, i) => `${i + 1}. ${msg}`).join('\n')}`;

        if (args.blueprint.turningPoints?.length) {
            const tps = args.blueprint.turningPoints
                .filter(tp => tp.expectedVolume === args.volumeNumber)
                .map(tp => `「${tp.name}」`);
            if (tps.length > 0) userPrompt += `\n\n【本卷必须体现的关键转折点】\n${tps.join('、')}`;
        }
        if (args.blueprint.requiredForeshadows?.length) {
            const fs = args.blueprint.requiredForeshadows
                .filter(f => f.expectedRevealVolume === args.volumeNumber)
                .map(f => `「${f.name}」（第${f.buryVolume}卷埋设）`);
            if (fs.length > 0) userPrompt += `\n\n【本卷必须回收的伏笔】\n${fs.join('、')}`;
        }
        // 生成侧提示词（generateVolumeOutline）一直带「本卷必须体现的势力演变」，而修复侧此前缺失，
        // 导致校验必然报「势力演变未体现」且怎么重写都无法闭合。这里补齐，并把判定词汇表
        // 从校验器同一来源注入，保证「要求」与「校验」严格一致。
        if (args.blueprint.factionTimeline?.length) {
            const fe = args.blueprint.factionTimeline.filter(x => x.expectedVolume === args.volumeNumber);
            if (fe.length > 0) {
                const desc = fe.map(x => `「${x.factionName}」：${x.eventType === 'rise' ? `崛起/兴盛（须出现「${FACTION_RISE_WORDS.join('／')}」之一）` : x.eventType === 'fall' ? `覆灭/衰落（须出现「${FACTION_FALL_WORDS.join('／')}」之一）` : '重大转变'}`).join('；');
                userPrompt += `\n\n【本卷必须体现的势力演变】\n${desc}\n**强制要求**：必须在「主要事件」或「核心冲突」中同时满足 —— ① 出现该势力名称（逐字取自已有势力列表）；② 明确使用上述括号内规定词汇之一描述其结局。缺少任一项，本卷大纲视为不合格。`;
            }
        }

        userPrompt += `

【世界观参考】
${args.worldview.slice(0, WORLDVIEW_SLICE)}

【已有角色】
${args.existingElements.characters || '无'}

【已有势力】
${args.existingElements.factions || '无'}

【已有地点】
${args.existingElements.locations || '无'}

【已有物品功法】
${args.existingElements.items || '无'}

【要求】
- 重写后的第${args.volumeNumber}卷必须完整、连贯，章号与前后卷严格衔接
- 不要自创全新主角，所有主要角色必须来自已有角色
- 「角色」「势力」「地点」「物品」名称必须与上述已有元素列表逐字一致，严禁改名或使用别称`;

        if (args.customPrompt) {
            userPrompt += `\n\n【用户补充要求】\n${args.customPrompt}`;
        }

        return this.apiClient.callAI(systemPrompt, userPrompt, model, 0.5, this.plugin.settings.maxOutput);
    }

    /** 组装完整大纲文档（全书总览 + 各卷正文）。总览与各卷章号范围同源于归一化设置，保证自洽。 */
    private buildOutlineDocument(norm: NormalizedOutlineSettings, totalChapters: number, volumeResults: string[]): string {
        return [
            '## 全书总览',
            `- **总字数目标**：${norm.totalWords}`,
            `- **分卷数**：${norm.volumes}`,
            `- **每章字数**：约${norm.wordsPerChapter} 字`,
            `- **总章节数**：${totalChapters}`,
            '',
            '## 分卷大纲',
            '',
            ...volumeResults,
        ].join('\n');
    }

    /** 以最终卷内容重新判定降级状态（纯校验，不调用 AI） */
    private findDegradedVolumes(volumeResults: string[], volumeRanges: Array<[number, number]>): number[] {
        const degraded: number[] = [];
        for (let i = 0; i < volumeResults.length; i++) {
            const range = volumeRanges[i];
            if (!range) continue;
            const expectedCount = range[1] - range[0] + 1;
            const gaps = validateVolumeStructure(volumeResults[i], range, expectedCount);
            if (gaps.length > 0) {
                degraded.push(i + 1);
                log.warn(`[小说工坊] 第${i + 1}卷最终仍有 ${gaps.length} 项结构缺陷：${gaps.slice(0, 3).join('；')}`);
            }
        }
        return degraded;
    }

    /** 集中打印跨卷验证结果（不中断、不调用 AI） */
    private logValidationReport(report: CrossVolumeValidationReport): void {
        if (report.warningIssues.length > 0) {
            log.warn(`[小说工坊] 跨卷验证发现 ${report.warningIssues.length} 个警告:`);
            for (const issue of report.warningIssues) {
                log.warn(`  [${issue.severity}] ${issue.message}`);
            }
        }
        if (report.criticalIssues.length > 0) {
            log.warn(`[小说工坊] 跨卷验证发现 ${report.criticalIssues.length} 个严重问题`);
        }
    }

    /**
     * 全局蓝图质量控制：与逐卷生成同构的「生成 → 契约校验 → 定向补全」循环。
     * 原实现没有质量循环（蓝图失败就直接进入"无蓝图模式"），一旦 AI 给出稀薄蓝图
     * （只有章号范围、无转折点/伏笔/势力与角色时间线），跨卷约束链就形同虚设却无人发现。
     */
    private async generateBlueprintWithQualityControl(args: {
        worldview: string;
        elements: { characters: string; factions: string; locations: string; items: string; foreshadows?: string; timelineEvents?: string };
        volumes: number;
        totalChapters: number;
        existingSnapshot?: CrossVolumeSnapshot;
        onRetry?: (attempt: number) => void;
    }): Promise<{ blueprint: ValidatorBlueprint; chapterRanges: Array<[number, number]>; degraded: boolean }> {
        let best: ValidatorBlueprint | undefined;
        let bestRanges = normalizeChapterRanges(undefined, args.volumes, args.totalChapters).ranges;
        let bestGaps: string[] = ['蓝图尚未生成'];
        let bestGapCount = Number.MAX_SAFE_INTEGER;

        // 蓝图上下文必须与卷级生成同源：若蓝图拿不到「已有势力/地点/物品/伏笔」，
        // AI 会编造名称（实测出现「裴氏世家」而 vault 里是「裴家」），
        // 而 ≤4 字短名称只有精确匹配、没有模糊兜底 → 必然误报跨卷 critical 并触发整卷重写风暴。
        const elementContext = [
            `【已有势力】\n${args.elements.factions || '（无）'}`,
            `【已有地点】\n${args.elements.locations || '（无）'}`,
            `【已有物品功法】\n${args.elements.items || '（无）'}`,
            `【已有伏笔】\n${args.elements.foreshadows || '（无）'}`,
        ].join('\n\n');
        const hasCharacters = args.elements.characters.trim().length > 0;
        const hasFactions = args.elements.factions.trim().length > 0;

        for (let attempt = 1; attempt <= OUTLINE_BLUEPRINT_MAX_ATTEMPTS; attempt++) {
            if (attempt > 1) args.onRetry?.(attempt);
            const repairHint = attempt === 1 ? '' : buildBlueprintRepairHint(bestGaps, attempt);

            let raw: ValidatorBlueprint | undefined;
            let failure = '';
            try {
                raw = await this.generateGlobalBlueprint(
                    args.worldview,
                    args.elements.characters,
                    args.volumes,
                    args.totalChapters,
                    args.existingSnapshot,
                    repairHint,
                    elementContext
                );
            } catch (e) {
                failure = e instanceof Error ? e.message : String(e);
            }

            if (!raw) {
                log.warn(`[小说工坊] 蓝图第${attempt}轮生成或解析失败: ${failure}`);
                bestGaps = [`蓝图生成或解析失败：${failure}`];
                continue;
            }

            // 章号范围先归一化：无论 AI 输出什么，都得到「长度=分卷数、首尾相接、总和=总章数」的合法范围
            const normalized = normalizeChapterRanges(raw.expectedChapterRanges, args.volumes, args.totalChapters);
            if (normalized.normalized) {
                log.warn(`[小说工坊] 蓝图章号范围不合法，已自动按比例重分配：${normalized.reason}`);
            }
            const candidate: ValidatorBlueprint = { ...raw, expectedChapterRanges: normalized.ranges };

            const ctx: BlueprintValidationContext = {
                volumes: args.volumes,
                totalChapters: args.totalChapters,
                chapterRanges: normalized.ranges,
                hasCharacters,
                hasFactions,
            };
            const gaps = validateBlueprintCompleteness(candidate, ctx);
            if (gaps.length === 0) {
                log.info(`[小说工坊] 蓝图第${attempt}轮通过契约校验（转折点${candidate.turningPoints?.length ?? 0} / 伏笔${candidate.requiredForeshadows?.length ?? 0} / 势力事件${candidate.factionTimeline?.length ?? 0} / 角色线${candidate.characterTimeline?.length ?? 0}）`);
                return { blueprint: candidate, chapterRanges: normalized.ranges, degraded: false };
            }

            log.warn(`[小说工坊] 蓝图第${attempt}轮存在 ${gaps.length} 项契约缺陷：${gaps.slice(0, 3).join('；')}`);
            if (gaps.length < bestGapCount) {
                bestGapCount = gaps.length;
                best = candidate;
                bestRanges = normalized.ranges;
                bestGaps = gaps;
            }
        }

        log.warn(`[小说工坊] 蓝图 ${OUTLINE_BLUEPRINT_MAX_ATTEMPTS} 轮后仍有 ${bestGaps.length} 项契约缺陷，降级使用「章号范围已归一化」的蓝图继续生成`);
        return {
            blueprint: best ?? { expectedChapterRanges: bestRanges },
            chapterRanges: bestRanges,
            degraded: true,
        };
    }

    /**
     * 生成全局蓝图。
     *
     * @param worldview - 世界观
     * @param charactersText - 角色文本
     * @param volumeCount - 卷数
     * @param totalChapters - 总章数
     * @param existingSnapshot - 已有快照
     * @param repairHint - 修复提示
     * @param elementContext - 要素上下文
     * @returns 蓝图文本
     */
    async generateGlobalBlueprint(
        worldview: string,
        charactersText: string,
        volumeCount: number,
        totalChapters: number,
        existingSnapshot?: CrossVolumeSnapshot,
        repairHint?: string,
        elementContext?: string
    ): Promise<ValidatorBlueprint> {
        const model = this.plugin.settings.flashModel || this.plugin.settings.defaultModel;

        const systemPrompt = `你是专业的小说全局蓝图规划师。请基于提供的世界观、角色设定和分卷参数，生成全书的整体故事线蓝图。
你必须以 JSON 格式输出，且严格遵循以下字段结构，禁止输出额外解释或 Markdown 代码块包裹之外的内容。

输出 JSON 结构：
{
  "turningPoints": [
    {"name": "转折点名称", "expectedVolume": 1, "expectedChapterRange": [1, 10]}
  ],
  "requiredForeshadows": [
    {"name": "伏笔名称", "buryVolume": 1, "expectedRevealVolume": 3}
  ],
  "factionTimeline": [
    {"factionName": "势力名", "eventType": "rise", "expectedVolume": 2}
  ],
  "characterTimeline": [
    {"characterName": "角色名", "expectedStates": [{"volume": 1, "state": "状态描述"}]}
  ],
  "expectedChapterRanges": [[1, 30], [31, 60]]
}

说明：
- turningPoints：全书关键转折点，expectedVolume 表示预期发生的卷号，expectedChapterRange 为可选的章节范围 [起始, 结束]
- requiredForeshadows：必须回收的伏笔，buryVolume 为埋设卷号，expectedRevealVolume 为预期回收卷号
- factionTimeline：势力重大事件时间线，eventType 可选 rise（崛起/兴盛）、fall（覆灭/衰落）、transform（重大变化）
- characterTimeline：角色状态时间线，expectedStates 中 volume 为卷号，state 为该卷预期状态
- expectedChapterRanges：每卷预期的章节范围数组，如 [[1,30],[31,60]]

【角色使用铁律——违反将导致规划无效】
1. 你必须使用以下「已有角色」作为全书主角和核心配角，严禁自创全新主角
2. 已有角色中标注了"主角"或类似核心定位的即为本书主角，必须作为核心展开
3. 如果提供了跨卷状态快照，必须参考其中的角色状态和伏笔回收情况`;

        let userPrompt = `请为以下小说规划全局故事线蓝图。

【世界观概述】
${worldview.slice(0, 2000)}

【已有角色】
${charactersText || '（无）'}

【分卷参数】
- 总卷数：${volumeCount}卷
- 总章数：${totalChapters}章

【章节分配要求——优先级最高】
请根据每卷核心剧情的复杂度和内容权重，将 ${totalChapters} 章合理分配到各卷。
禁止平均分配！每卷章数应根据该卷核心冲突的规模决定。
例如：主线推进密集的卷可分配更多章节，过渡卷可分配较少章节。
必须在 expectedChapterRanges 字段中输出每卷的章节范围 [起始章号, 结束章号]，各卷范围连续且总和等于 ${totalChapters}。`;

        if (existingSnapshot) {
            userPrompt += `\n\n【跨卷状态快照】\n${this.formatSnapshot(existingSnapshot).slice(0, 1500)}`;
        }

        userPrompt += `\n\n【规划原则——优先级最高】
- 必须基于已有角色进行规划，主角和核心势力从已有元素中选取，严禁随意新增
- 每卷核心冲突必须至少涉及一位已有角色
- 必须呼应世界观中的"与主线关联"设定
- 必须输出合法、可解析的 JSON，不要添加任何 JSON 之外的解释性文字`;

        if (elementContext) {
            userPrompt += `\n\n${elementContext}\n\n【命名铁律——违反将导致规划无效】
- 「角色」「势力」「地点」「物品」名称必须与上述已有元素列表中的名称**完全一致**（含简称），严禁改名、简称化或使用别称
- turningPoints / requiredForeshadows / factionTimeline 中出现的一切专有名词，都必须逐字取自上述列表，不得自创`;
        }

        if (repairHint) {
            userPrompt += `\n\n${repairHint}`;
        }

        try {
            const result = await this.apiClient.callAI(systemPrompt, userPrompt, model, 0.3, this.plugin.settings.maxOutput);
            if (result.error) {
                throw new Error(`AI 调用失败 - ${result.error}`);
            }

            const rawText = result.content;
            const jsonMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
            const jsonText = jsonMatch ? jsonMatch[1].trim() : rawText.trim();

            const parsed = JSON.parse(jsonText) as ValidatorBlueprint;

            return parsed;
        } catch (e: unknown) {
            const errMsg = e instanceof Error ? e.message : String(e);
            throw new Error(`OUTLINE_BLUEPRINT_FAILED: ${errMsg}`);
        }
    }

    private formatSnapshot(snapshot: CrossVolumeSnapshot): string {
        const lines: string[] = [];
        if (snapshot.characters.length > 0) {
            lines.push('### 人物状态');
            for (const ch of snapshot.characters) {
                lines.push(`- ${ch.姓名} | 状态:${ch.当前状态} | 情绪:${ch.当前情绪} | 标签:${ch.性格标签} | 动机:${ch.核心动机} | 势力:${ch.所属势力}`);
            }
        }
        if (snapshot.factions.length > 0) {
            lines.push('### 势力状态');
            for (const f of snapshot.factions) {
                lines.push(`- ${f.名称} | 地位/排名:${f.地位或排名}`);
            }
        }
        if (snapshot.foreshadows.length > 0) {
            lines.push('### 未回收伏笔');
            for (const fb of snapshot.foreshadows) {
                lines.push(`- ${fb.name} | 重要度:${fb.importance} | 埋设:${fb.buryChapter} | 计划回收:${fb.plannedReveal}`);
            }
        }
        if (snapshot.timeline.length > 0) {
            lines.push('### 近期时间线');
            for (const tl of snapshot.timeline) {
                lines.push(`- 时间:${tl.time} | 章节:${tl.chapter} | 事件:${tl.event}`);
            }
        }
        return lines.join('\n');
    }
}


