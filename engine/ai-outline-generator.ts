
import { TFolder } from 'obsidian';
import NovelWriterPlugin from '../main';
import {
    OUTLINE_REQUIRED_KEYS,
    OUTLINE_TABLE_HEADER,
} from '../shared/format-constants';
import { validateOutlineOutput } from '../shared/template-validator';
import { WORLDVIEW_SLICE, AI_RETRY_BACKOFF_MS } from '../shared/thresholds';
import type { OutlineSettings, WorldElements } from './ai-types';
import { AIApiClient } from './ai-api-client';
import type { APIResponse } from './ai-engine';
import { pjVolumeOutlineDir } from '../shared/paths';

import type { Notifier } from '../shared/types';
import { NOOP_NOTIFIER } from '../shared/types';
import { VolumeOutlineSummarizer, type VolumeSummary } from './volume-outline-summarizer';
import { CrossVolumeOutlineValidator, type GlobalStorylineBlueprint as ValidatorBlueprint, type ValidationIssue } from './cross-volume-outline-validator';
import { CrossVolumeIntegrator, type CrossVolumeSnapshot } from './cross-volume-integration';
import { createLogger } from '../shared/logger';

const log = createLogger('AiOutlineGenerator');
export class OutlineGenerator {
    private plugin: NovelWriterPlugin;
    private notifier: Notifier;
    private apiClient: AIApiClient;

    constructor(plugin: NovelWriterPlugin, apiClient: AIApiClient, notifier?: Notifier) {
        this.notifier = notifier || NOOP_NOTIFIER;
        this.plugin = plugin;
        this.apiClient = apiClient;
    }

    async generateGlobalSkeleton(
        worldview: string,
        existingElements: { characters: string; factions: string; locations: string; items: string; foreshadows?: string; timelineEvents?: string; },
        settings: { totalWords: number; volumes: number; wordsPerChapter: number; chaptersPerVolume: number; theme: string; genre: string; },
        customPrompt?: string
    ): Promise<APIResponse> {
        const systemPrompt = `你是专业的小说结构规划师。你只负责输出全书的卷级概要骨架，不需要输出详细的章节表和事件描述。

【不可违反的输出契约】
每卷必须包含以下全部 ${OUTLINE_REQUIRED_KEYS.length} 个字段，缺一不可：
${OUTLINE_REQUIRED_KEYS.map(k => `- **${k}**：值`).join('\n')}

如涉及章节分配表格，必须严格使用两列表格：${OUTLINE_TABLE_HEADER}，禁止使用三列或更多列。
违反以上任何一项，输出将被判定为无效并重新生成。

【四大核心要素说明——每卷规划必须体现】
1. **三幕结构**：每卷要有建置→对抗→解决的三幕结构，简述每阶段要点（建置阶段交代背景与冲突起点；对抗阶段推进冲突升级；解决阶段收束本卷高潮并过渡至下一卷）
2. **爽点节奏**：每卷至少安排一个爽点高潮，标注预期位置和类型（如"第3章：能力觉醒"、"第8章：身份反转打脸"）
3. **反转路线**：规划至少1-2次反转节点，从小到大递进（小反转→中反转→大反转），避免一卷无反转或反转堆砌
4. **情绪曲线**：描述本卷的情绪起伏走向（如"低谷→上升→高潮→回落"、"压抑→爆发→释然"），确保情绪有节奏感

【输出格式要求】
1. 必须用【项目名称】书名【/项目名称】格式在回答第一行输出小说名称
2. 然后按以下 Markdown 格式输出每卷概要（只要求卷名和一句话核心冲突，不需要章节表）：

## 全书总览
- **总字数目标**：${settings.totalWords}
- **分卷数**：${settings.volumes}
- **总章数**：${settings.volumes * settings.chaptersPerVolume}（约${settings.wordsPerChapter}字/章，各卷按内容权重分配）

## 各卷概要
### 第1卷
- **卷名**：《卷名》
- **章节范围**：第X章 - 第Y章（必须输出实际章号，不得使用占位符或"待计算"等模糊表述）
- **核心冲突**：（一句话概括本卷的主要戏剧冲突）

### 第2卷
- **卷名**：
- **章节范围**：第X章 - 第Y章
- **核心冲突**：（一句话概括）

...（以此类推，共${settings.volumes}卷）

【表格格式铁律】
- 如涉及章节分配表格，必须严格使用两列表格：${OUTLINE_TABLE_HEADER}，禁止使用三列或更多列

【角色使用铁律——违反将导致规划无效】
1. 你必须使用以下「已有角色」作为全书主角和核心配角，严禁自创全新主角
2. 已有角色中标注了"身份：主角"的即为本书主角，必须作为第1卷的引入核心
3. 如果你提供了「已有势力」「已有地点」「已有物品」，必须在各卷概要中引用这些已有元素，不得自创替代
4. 卷名和核心冲突必须围绕已有角色展开
5. 如果提供了伏笔信息，卷核心冲突必须考虑伏笔的回收安排

不要输出额外解释，不要输出章节表。章节表将在后续分卷生成中完成。`;

        let userPrompt = `请为以下小说规划全书卷级骨架。

【世界观概述】${worldview.slice(0, 2000)}
【已有角色】${existingElements.characters || '无'}
【已有势力】${existingElements.factions || '无'}
【题材】${settings.genre || '未指定'}
【主题】${settings.theme || '未指定'}
【已有伏笔】${existingElements.foreshadows || '（无）'}
【已有时间线事件】${existingElements.timelineEvents || '（无）'}`;

        userPrompt += `\n\n【规划原则——优先级最高】
- 必须基于已有角色进行规划，主角和核心势力从已有元素中选取，严禁随意新增
- 如果已有角色不为空，每卷核心冲突必须至少涉及一位已有角色
- 如果某类数据为空或标注"（无，可自由创建）"，才可以自由创建
- 必须呼应世界观中的"与主线关联"设定——世界观对主线的推动作用要体现在卷级冲突中，世界观的潜在变化要预埋在各卷发展脉络里`;

        if (customPrompt) {
            userPrompt += `\n\n【用户自定义要求】\n${customPrompt}`;
        }

        return this.apiClient.callAI(systemPrompt, userPrompt, this.plugin.settings.flashModel, 0.6, 4096);
    }

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
${OUTLINE_REQUIRED_KEYS.map(k => `- **${k}**：值`).join('\n')}
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

    async generateOutline(
        worldview: string,
        settings: OutlineSettings,
        existingWorldElements?: WorldElements,
        customPrompt?: string,
        onProgress?: (phase: string, current: number, total: number) => void
    ): Promise<APIResponse> {
        const totalWordsNum = parseInt(settings.totalWords) || 1000000;
        const totalChapters = Math.ceil(totalWordsNum / settings.wordsPerChapter);
        const fallbackChaptersPerVolume = Math.ceil(totalChapters / settings.volumes);

        // Phase -1: 清除旧卷数据（重新生成时）
        const project = this.plugin.getActiveProject();
        if (project) {
            const volumesPath = pjVolumeOutlineDir(project);
            const volumesDir = this.plugin.app.vault.getAbstractFileByPath(volumesPath);
            if (volumesDir instanceof TFolder) {
                log.info('[小说工坊] 递进式大纲 - Phase -1: 清除旧卷数据');
                for (const child of volumesDir.children) {
                    await this.plugin.app.vault.delete(child, true);
                }
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

        // Phase 1: 生成全局蓝图
        onProgress?.('blueprint', 0, settings.volumes);
        log.info('[小说工坊] 递进式大纲 - Phase 1: 生成全局蓝图');

        const blueprint = await this.generateGlobalBlueprint(
            worldview,
            existingWorldElements?.characters || '',
            settings.volumes,
            totalChapters,
            existingSnapshot
        );

        // Phase 2-N: 逐卷递进生成
        log.info(`[小说工坊] 递进式大纲 - Phase 2-N: 逐卷生成 (共${settings.volumes}卷)`);

        const summaries: VolumeSummary[] = [];
        const volumeResults: string[] = [];
        const omissionPatterns = [
            /\.{2,}（.*?省略.*?）/i,
            /省略第\d+章至第\d+章/i,
            /以此类推/i,
            /第\d+章.*?第\d+章.*?省略/i,
        ];

        let lastChapter = 0;
        for (let v = 1; v <= settings.volumes; v++) {
            // 从蓝图获取该卷章数，降级为平均分配
            const expectedRange = blueprint.expectedChapterRanges?.[v - 1];
            let volChapterCount: number;
            let chapterRange: [number, number];

            if (expectedRange && Array.isArray(expectedRange) && expectedRange.length === 2
                && expectedRange[0] > 0 && expectedRange[1] >= expectedRange[0]) {
                volChapterCount = expectedRange[1] - expectedRange[0] + 1;
                chapterRange = [expectedRange[0], expectedRange[1]];
            } else {
                if (v === 1) log.warn('[小说工坊] 蓝图无有效 expectedChapterRanges，降级为平均分配');
                volChapterCount = fallbackChaptersPerVolume;
                const startChapter = lastChapter + 1;
                const endChapter = startChapter + volChapterCount - 1;
                chapterRange = [startChapter, endChapter];
            }

            onProgress?.('volume', v, settings.volumes);
            log.info(`[小说工坊] 递进式大纲 - 生成第${v}卷...（${volChapterCount}章）`);

            const previousSummariesText = new VolumeOutlineSummarizer().compress(summaries);

            let result: APIResponse | null = null;
            const MAX_VOLUME_RETRIES = 3;
            let currentPrompt = customPrompt;

            for (let retry = 0; retry < MAX_VOLUME_RETRIES; retry++) {
                const retrySuffix = retry > 0 ? ` (重试${retry}/${MAX_VOLUME_RETRIES - 1})` : '';
                if (retry > 0) log.info(`[小说工坊] 第${v}卷${retrySuffix}...`);

                result = await this.generateVolumeOutline(
                    worldview,
                    '',
                    v,
                    settings.volumes,
                    volChapterCount,
                    currentPrompt,
                    {
                        characters: existingWorldElements?.characters || '',
                        factions: existingWorldElements?.factions || '',
                        locations: existingWorldElements?.locations || '',
                        items: existingWorldElements?.items || '',
                        foreshadows: existingWorldElements?.foreshadows,
                        timelineEvents: existingWorldElements?.timelineEvents,
                    },
                    blueprint,
                    previousSummariesText,
                    chapterRange
                );

                if (!result.error) {
                    const hasOmission = omissionPatterns.some(p => p.test(result!.content));
                    if (hasOmission) {
                        if (retry < MAX_VOLUME_RETRIES - 1) {
                            log.warn(`[小说工坊] 第${v}卷检测到省略模式，尝试强化重试...`);
                            currentPrompt = (customPrompt ? customPrompt + '\n\n' : '') + '⚠️ 上次输出包含省略表述（如"..."、"省略第X章至第Y章"），这是不允许的。必须逐章列出全部 ' + volChapterCount + ' 章，禁止任何省略！';
                            continue;
                        } else {
                            result = { content: result.content, error: '输出仍包含省略表述' };
                        }
                    } else {
                        break;
                    }
                }

                log.error(`[小说工坊] 第${v}卷生成失败${retrySuffix}: ${result.error}`);
                currentPrompt = customPrompt;
                if (retry < MAX_VOLUME_RETRIES - 1) {
                    await new Promise(r => setTimeout(r, AI_RETRY_BACKOFF_MS));
                }
            }

            if (!result || result.error) {
                const errorMsg = result?.error || '未知错误';
                throw new Error(`OUTLINE_VOLUME_FAILED: 第${v}卷生成失败 - ${errorMsg}（已成功生成${v - 1}卷）`);
            }

            const summary = new VolumeOutlineSummarizer().extract(result.content, v);
            summaries.push(summary);

            let volContent = result.content;
            if (!volContent.includes(`### 第${v}卷`)) {
                volContent = `### 第${v}卷\n${volContent}`;
            }
            volumeResults.push(volContent);
            log.info(`[小说工坊] 第${v}卷完成 (${volContent.length}字符)`);

            lastChapter = chapterRange[1];
        }

        const assembledContent = [
            '## 全书总览',
            `- **总字数目标**：${settings.totalWords}`,
            `- **分卷数**：${settings.volumes}`,
            `- **每章字数**：约${settings.wordsPerChapter} 字`,
            `- **总章节数**：${totalChapters}`,
            '',
            '## 分卷大纲',
            '',
            ...volumeResults,
        ].join('\n');

        log.info(`[小说工坊] 递进式大纲完成！共${settings.volumes}卷`);

        // Phase N+1: 跨卷连贯性验证
        onProgress?.('validation', 0, 1);
        log.info('[小说工坊] 递进式大纲 - Phase N+1: 跨卷连贯性验证');
        const validator = new CrossVolumeOutlineValidator();
        let report = validator.validate(volumeResults, blueprint);

        if (report.warningIssues.length > 0) {
            log.warn(`[小说工坊] 跨卷验证发现 ${report.warningIssues.length} 个警告:`);
            for (const issue of report.warningIssues) {
                log.warn(`  [${issue.severity}] ${issue.message}`);
            }
        }

        // Phase N+2: 强制修复（最多3次）
        const MAX_REPAIR_ROUNDS = 3;
        for (let round = 0; round < MAX_REPAIR_ROUNDS; round++) {
            if (report.isValid) {
                if (round > 0) {
                    log.info(`[小说工坊] 跨卷验证通过（第${round}轮修复后）`);
                }
                break;
            }

            const criticalIssues = report.criticalIssues;
            onProgress?.('repair', round + 1, MAX_REPAIR_ROUNDS);
            log.warn(`[小说工坊] 跨卷验证发现 ${criticalIssues.length} 个严重问题，进入第${round + 1}轮强制修复...`);

            const issuesByVolume = new Map<number, ValidationIssue[]>();
            for (const issue of criticalIssues) {
                const volIndex = issue.volumeIndex ?? 0;
                if (!issuesByVolume.has(volIndex)) {
                    issuesByVolume.set(volIndex, []);
                }
                issuesByVolume.get(volIndex)!.push(issue);
            }

            for (const [volIndex, issues] of issuesByVolume) {
                const volumeNumber = volIndex + 1;
                const originalContent = volumeResults[volIndex];
                log.info(`[小说工坊] 修复第${volumeNumber}卷，问题数: ${issues.length}`);

                // 准备前序卷摘要（前1-2卷）
                const previousVolsSummaries = summaries.slice(0, volIndex);

                // 准备后序卷预告
                const nextVolContent = volIndex < volumeResults.length - 1 ? volumeResults[volIndex + 1] : undefined;

                const repairedContent = await this.repairVolume(
                    originalContent,
                    volumeNumber,
                    blueprint,
                    issues,
                    previousVolsSummaries,
                    nextVolContent,
                    round + 1  // 当前是第几轮修复
                );
                volumeResults[volIndex] = repairedContent;

                // 修复后重新提取该卷摘要，更新 summaries 数组
                const updatedSummary = new VolumeOutlineSummarizer().extract(repairedContent, volumeNumber);
                summaries[volIndex] = updatedSummary;
            }

            report = validator.validate(volumeResults, blueprint);
            if (report.isValid) {
                log.info(`[小说工坊] 第${round + 1}轮修复后跨卷验证通过`);
            }
        }

        if (!report.isValid) {
            const remainingCritical = report.criticalIssues.map(i => i.message).join('; ');
            log.warn(`[小说工坊] 跨卷验证在${MAX_REPAIR_ROUNDS}轮修复后仍存在${report.criticalIssues.length}个严重问题，降级返回大纲`);
            // 不抛出异常，降级返回内容
            // 将问题追加到输出内容的 HTML 注释中
            const warningComment = `<!-- 验证警告: 跨卷验证在${MAX_REPAIR_ROUNDS}轮修复后仍存在${report.criticalIssues.length}个待完善问题 -->\n${report.criticalIssues.map(i => `<!-- ${i.message} -->`).join('\n')}\n`;
            volumeResults[0] = warningComment + volumeResults[0];
        }

        // 如有修复，重新组装完整大纲
        const finalAssembledContent = [
            '## 全书总览',
            `- **总字数目标**：${settings.totalWords}`,
            `- **分卷数**：${settings.volumes}`,
            `- **每章字数**：约${settings.wordsPerChapter} 字`,
            `- **总章节数**：${totalChapters}`,
            '',
            '## 分卷大纲',
            '',
            ...volumeResults,
        ].join('\n');

        let finalContent = finalAssembledContent;
        const outlineValidation = validateOutlineOutput(finalContent);
        if (!outlineValidation.valid) {
            log.warn(`[小说工坊] 大纲输出校验失败，缺失字段: ${outlineValidation.missingFields.join(', ')}，尝试重试一次`);

            const fixPrompt = (customPrompt ? customPrompt + '\n\n' : '') +
                `⚠️ 上次生成的大纲未通过校验，缺少以下字段：\n${outlineValidation.missingFields.map(f => `- ${f}`).join('\n')}\n\n请重新生成完整大纲，确保所有缺失字段均已补充。`;

            const retryResult = await this.generateOutlineWithRetry(
                this.buildOutlineSystemPrompt(settings),
                this.buildOutlineUserPrompt(worldview, settings, existingWorldElements, fixPrompt),
                settings.volumes
            );

            if (!retryResult.error && retryResult.content) {
                finalContent = retryResult.content;
                const revalidation = validateOutlineOutput(finalContent);
                if (!revalidation.valid) {
                    log.warn(`[小说工坊] 大纲重试后仍缺失: ${revalidation.missingFields.join(', ')}`);
                }
            }
        }

        // 将跨卷验证警告附加到输出中（不阻断生成）
        if (report.warningIssues.length > 0) {
            const warningText = '\n\n<!-- 跨卷验证警告 -->\n' +
                report.warningIssues.map(i => `- [${i.severity}] ${i.message}`).join('\n') +
                '\n<!-- 警告结束 -->\n';
            finalContent += warningText;
        }

        return { content: finalContent };
    }

    private async repairVolume(
        volumeContent: string,
        volumeNumber: number,
        blueprint: ValidatorBlueprint,
        issues: ValidationIssue[],
        previousSummaries?: VolumeSummary[],
        nextVolumeContent?: string,
        repairRound?: number
    ): Promise<string> {
        // 构建前序卷摘要上下文
        let previousContext = '';
        if (previousSummaries && previousSummaries.length > 0) {
            const recentSummaries = previousSummaries.slice(-2); // 最近2卷摘要
            previousContext = `【前序卷关键信息——必须承接】
${recentSummaries.map((s, idx) => `第${s.volumeNumber}卷摘要：
- 人物状态变化：${s.characterChanges?.slice(0, 3).join('、') || '无'}
- 事件结果：${s.eventOutcomes?.slice(0, 3).join('、') || '无'}
- 结尾过渡：${s.endingTransition || '无'}
`).join('\n')}
`;
        }

        // 构建后序卷预告上下文
        let nextContext = '';
        if (nextVolumeContent) {
            // 提取后序卷的卷名和章节范围
            const nextTitleMatch = nextVolumeContent.match(/###?\s*第(\d+)卷[：:\s]*(.*)/);
            const nextChapterRangeMatch = nextVolumeContent.match(/第(\d+)章\s*[-~至]\s*第(\d+)章/);
            if (nextTitleMatch || nextChapterRangeMatch) {
                nextContext = `【后序卷预告——必须为本卷结尾铺垫】
${nextTitleMatch ? `第${nextTitleMatch[1]}卷：${nextTitleMatch[2]?.trim() || ''}` : ''}
${nextChapterRangeMatch ? `章节范围：第${nextChapterRangeMatch[1]}章 - 第${nextChapterRangeMatch[2]}章` : ''}
本卷结尾必须与后序卷开头形成自然的剧情衔接。
`;
            }
        }

        // 根据问题类型生成分类修复指令
        const repairInstructions = this.buildRepairInstructions(issues, blueprint, volumeNumber, repairRound || 1);

        const systemPrompt = `你是一位资深网络小说编辑，负责修正大纲中的连贯性问题。
以下大纲存在跨卷连贯性问题，请根据【修复指令】逐一修正。
修正时必须严格遵循全局蓝图，不得改写主线剧情，只修改与问题相关的部分。`;

        const issuesText = issues.map((issue, idx) => `${idx + 1}. [${issue.type}] ${issue.message}`).join('\n');

        const userPrompt = `【全局故事线蓝图】
${JSON.stringify(blueprint, null, 2)}

${previousContext}
${nextContext}
【需要修正的卷】
第${volumeNumber}卷原文：
${volumeContent}

【发现的问题】
${issuesText}

【分类修复指令——必须执行】
${repairInstructions}

【输出要求】
1. 输出修正后的第${volumeNumber}卷完整大纲
2. 必须解决上述全部问题，不得遗漏
3. 保持原文中与问题无关的内容不变
4. 章节范围字段必须填写具体数值，禁止使用占位符`;

        log.info(`[小说工坊] repairVolume 调用 AI 修复第${volumeNumber}卷（第${repairRound || 1}轮）...`);
        const response = await this.apiClient.callAI(systemPrompt, userPrompt);

        if (response.error || !response.content) {
            log.error(`[小说工坊] 第${volumeNumber}卷修复失败: ${response.error || '空响应'}`);
            return volumeContent;
        }

        log.info(`[小说工坊] 第${volumeNumber}卷修复完成 (${response.content.length}字符)`);
        return response.content;
    }

    /**
     * 根据问题类型生成分类修复指令
     */
    private buildRepairInstructions(
        issues: ValidationIssue[],
        blueprint: ValidatorBlueprint,
        volumeNumber: number,
        repairRound: number
    ): string {
        const instructions: string[] = [];

        for (const issue of issues) {
            switch (issue.type) {
                case 'chapter_range_gap': {
                    // 从蓝图中获取预期的章节范围
                    const expectedRange = blueprint.expectedChapterRanges?.[volumeNumber - 1];
                    if (expectedRange) {
                        instructions.push(`【章节范围修正】问题：${issue.message}
指令：将「章节范围」字段修改为：第${expectedRange[0]}章 - 第${expectedRange[1]}章。
章节分配表格中的章号必须从${expectedRange[0]}开始，依次递增到${expectedRange[1]}，共${expectedRange[1] - expectedRange[0] + 1}章。`);
                    } else {
                        instructions.push(`【章节范围修正】问题：${issue.message}
指令：检查前序卷的最后一章编号，将本卷「章节范围」字段修改为紧接其后的连续编号。
例如：如果前一卷结束于第50章，本卷应从第51章开始。`);
                    }
                    break;
                }

                case 'character_state_conflict': {
                    // 从蓝图中获取角色预期状态
                    const charTimeline = blueprint.characterTimeline;
                    const relevantTimeline = charTimeline?.filter(ct =>
                        ct.expectedStates.some(s => s.volume === volumeNumber)
                    );
                    if (relevantTimeline && relevantTimeline.length > 0) {
                        const charInstructions = relevantTimeline.map(ct => {
                            const state = ct.expectedStates.find(s => s.volume === volumeNumber);
                            return `角色「${ct.characterName}」本卷预期状态：「${state?.state || '保持连贯'}」`;
                        }).join('\n');
                        instructions.push(`【人物状态修正】问题：${issue.message}
指令：根据以下蓝图规划调整人物状态：
${charInstructions}
注意：如果前序卷角色已死亡/退场，本卷不得再次让其活跃出场，除非有合理的复活/回归剧情。`);
                    } else {
                        instructions.push(`【人物状态修正】问题：${issue.message}
指令：检查人物在前序卷的状态变化，确保本卷的人物弧光与前序卷连贯。
如果前序卷已「死亡」「退场」的角色，本卷不得无故再次活跃出场。`);
                    }
                    break;
                }

                case 'turning_point_missing': {
                    // 从蓝图中找到该卷应有的转折点
                    const expectedTPs = blueprint.turningPoints?.filter(tp => tp.expectedVolume === volumeNumber);
                    if (expectedTPs && expectedTPs.length > 0) {
                        const tpList = expectedTPs.map(tp =>
                            `- 「${tp.name}」${tp.expectedChapterRange ? `（预期章节：${tp.expectedChapterRange[0]}-${tp.expectedChapterRange[1]}）` : ''}`
                        ).join('\n');
                        instructions.push(`【转折点补充】问题：${issue.message}
指令：本卷必须包含以下蓝图规划的关键转折点：
${tpList}
在「主要事件」或「三幕结构」中明确描述这些转折点的剧情表现。`);
                    } else {
                        instructions.push(`【转折点补充】问题：${issue.message}
指令：检查全局蓝图，找出本卷应包含的关键转折点，在「主要事件」中补充对应剧情。`);
                    }
                    break;
                }

                case 'foreshadow_unresolved': {
                    // 从蓝图中找到本卷应回收的伏笔
                    const foreshadows = blueprint.requiredForeshadows;
                    const expectedReveals = foreshadows?.filter(f => f.expectedRevealVolume === volumeNumber);
                    if (expectedReveals && expectedReveals.length > 0) {
                        const fsList = expectedReveals.map(f =>
                            `- 「${f.name}」（第${f.buryVolume}卷埋设 → 本卷回收）`
                        ).join('\n');
                        instructions.push(`【伏笔回收】问题：${issue.message}
指令：本卷必须回收以下伏笔：
${fsList}
在「主要事件」或具体章节中安排伏笔揭晓的剧情节点。`);
                    }
                    instructions.push(`【伏笔回收】问题：${issue.message}
指令：检查前序卷埋设但尚未回收的伏笔，在本卷安排合理的回收剧情。`);
                    break;
                }

                case 'faction_state_conflict': {
                    // 从蓝图中获取势力演变规划
                    const factionEvents = blueprint.factionTimeline?.filter(fe => fe.expectedVolume === volumeNumber);
                    if (factionEvents && factionEvents.length > 0) {
                        const feList = factionEvents.map(fe =>
                            `- 「${fe.factionName}」：${fe.eventType === 'rise' ? '崛起/兴盛' : fe.eventType === 'fall' ? '衰落/覆灭' : '转变'}`
                        ).join('\n');
                        instructions.push(`【势力演变修正】问题：${issue.message}
指令：根据蓝图规划，本卷势力变化如下：
${feList}
注意：如果某势力在前序卷已覆灭，本卷不得再将其作为活跃势力处理。`);
                    } else {
                        instructions.push(`【势力演变修正】问题：${issue.message}
指令：检查前序卷的势力状态变化，确保本卷的势力格局与前序卷连贯。
已被灭的势力不得在本卷以活跃状态出现。`);
                    }
                    break;
                }

                case 'subplot_mainline_disconnect': {
                    instructions.push(`【支线-主线连接修正】问题：${issue.message}
指令：检查支线剧情与主线的连接点，确保：
1. 支线从主线分叉时有明确的因果触发点（如：主角决定、事件结果、第三方介入）
2. 支线收束回主线时有合理的回归逻辑（如：支线结果影响主线、支线角色回归主线）
在「主要事件」或具体章节中补充支线与主线的连接剧情。`);
                    break;
                }

                default: {
                    instructions.push(`【问题修正】${issue.message}
指令：根据问题描述，调整相关内容使其与前序卷保持连贯。`);
                }
            }
        }

        // 如果是第二轮及之后的修复，添加更强的约束
        if (repairRound >= 2) {
            instructions.push(`
【强制约束】这是第${repairRound}轮修复，请务必：
1. 逐条检查上述每个问题的修复结果
2. 确保章节范围字段填写的是具体数字（如「第51章 - 第100章」），而非占位符
3. 确保人物状态与前序卷逻辑连贯，不存在「死亡后复活」等矛盾
4. 如有疑问，优先遵循全局蓝图的规划`);
        }

        return instructions.join('\n\n');
    }

    async generateGlobalBlueprint(
        worldview: string,
        charactersText: string,
        volumeCount: number,
        totalChapters: number,
        existingSnapshot?: CrossVolumeSnapshot
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

        try {
            const result = await this.apiClient.callAI(systemPrompt, userPrompt, model, 0.3, 4096);
            if (result.error) {
                throw new Error(`OUTLINE_BLUEPRINT_FAILED: AI 调用失败 - ${result.error}`);
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

    private buildOutlineSystemPrompt(settings: OutlineSettings): string {
        return `你是一位经验丰富的小说策划师。请根据世界观和人物设定，制定完整的小说大纲。

【输出铁律——优先级最高】
1. 【章节分配表格】必须完整列出该卷所有章节，一行一章，不得使用省略号(...)或"略"等省略方式。
2. 表格只保留两列：【章号】和【核心冲突】，去掉章名列（章名由后续流程生成）。
3. 每行格式：| 数字 | 一句话描述核心冲突 |
4. 如果一卷有120章，表格必须有120行数据，不得减少。

输出格式要求：
1. 使用 Markdown 格式
2. 必须输出 ## 分卷大纲（每卷包含：卷名、核心冲突、主要事件、人物弧光）
3. 包含全书总览、章节分配表
4. 章节分配表使用两列表格：章号 | 核心冲突`;
    }

    private buildOutlineUserPrompt(
        worldview: string,
        settings: OutlineSettings,
        existingWorldElements?: WorldElements,
        customPrompt?: string
    ): string {
        let userPrompt = `请为一部${settings.totalWords}字的长篇小说制定大纲。

【基本参数】
- 总字数：${settings.totalWords}字
- 分卷数：${settings.volumes}卷
- 每章字数：约${settings.wordsPerChapter}字
- 每卷章节数根据内容合理分配

【世界观】${worldview.slice(0, 2000)}`;

        if (existingWorldElements) {
            userPrompt += `

【已有角色】
${existingWorldElements.characters || '（无，AI自由生成）'}
【已有地点】
${existingWorldElements.locations || '（无，AI自由生成）'}
【已有势力】
${existingWorldElements.factions || '（无，AI自由生成）'}
【已有物品功法】
${existingWorldElements.items || '（无，AI自由生成）'}
【已有伏笔】
${existingWorldElements.foreshadows || '（无）'}
【已有时间线事件】
${existingWorldElements.timelineEvents || '（无）'}

【规划原则】
- 如果已有角色/地点/势力/物品，请基于这些进行规划，主角和核心势力从已有元素中选取，不要随意新增
- 如果某类数据为空，可以自由创建
- 必须呼应世界观中的"与主线关联"设定——世界观对主线的推动作用要体现在卷级冲突中，世界观的潜在变化要预埋在各卷发展脉络里`;
        }

        if (customPrompt && customPrompt.length > 0) {
            userPrompt += `

【用户自定义要求】
${customPrompt}`;
        }

        userPrompt += `

【输出格式】
请严格按照以下 Markdown 格式输出：

## 全书总览
- **总字数目标**：${settings.totalWords}
- **总章节数**：（AI 计算）
- **分卷数**：${settings.volumes}
- **每章字数**：${settings.wordsPerChapter} 字

## 分卷大纲

### 第1卷
- **卷名**：《卷名》
- **章节范围**：第1章 - 第N章
- **核心冲突**：
- **主要事件**：
- **人物弧光**：
- **本卷字数**：
- **本卷高潮**：
- **结尾过渡**：
- **章节分配**：（必须两列表格，完整列出每章，禁止省略）

| 章号 | 核心冲突 |
|---|---|
| 1 | 一句话描述第一章的核心冲突 |
| 2 | 一句话描述第二章的核心冲突 |
| 3 | ...（如此类推，直到该卷最后一章） |

### 第2卷
...（同第1卷格式）

### 第3卷
...（同第1卷格式）

不要输出额外解释，直接输出大纲内容。`;

        return userPrompt;
    }

    private async generateOutlineWithRetry(systemPrompt: string, userPrompt: string, volCount: number): Promise<APIResponse> {
        let combinedContent = '';
        let attempt = 0;
        const maxAttempts = 5;

        while (attempt < maxAttempts) {
            let result;
            if (attempt === 0) {
                log.info(`[小说工坊] AI全书规划 - 初始生成请求, maxTokens: ${this.plugin.settings.maxOutput}`);
                result = await this.apiClient.callAI(systemPrompt, userPrompt, this.plugin.settings.flashModel, 0.6, this.plugin.settings.maxOutput);
            } else {
                let lastFound = 0;
                for (let v = 1; v <= volCount; v++) {
                    if (combinedContent.includes(`### 第${v}卷`)) lastFound = v;
                }
                log.info(`[小说工坊] AI全书规划 - 续写请求, 已完成卷: ${lastFound}, 目标卷: ${volCount}`);
                const continuePrompt = `继续输出分卷大纲。你已经输出了到第${lastFound}卷，请从第${lastFound + 1}卷开始，按之前的格式继续输出剩余卷。直接输出 Markdown 内容，不要解释。`;
                result = await this.apiClient.callAI(systemPrompt, continuePrompt, this.plugin.settings.flashModel, 0.6, 4096);
            }

            if (result.error) {
                log.error('[小说工坊] AI全书规划失败:', result.error);
                return result;
            }

            if (attempt === 0) {
                combinedContent = result.content;
            } else {
                let appendContent = result.content;
                for (let v = volCount; v >= 1; v--) {
                    const tag = `### 第${v}卷`;
                    if (combinedContent.includes(tag) && appendContent.includes(tag)) {
                        appendContent = appendContent.substring(appendContent.indexOf(tag) + tag.length);
                    }
                }
                combinedContent += '\n\n' + appendContent.trim();
            }

            const isComplete = (() => {
                for (let v = 1; v <= volCount; v++) {
                    if (!combinedContent.includes(`### 第${v}卷`)) return false;
                }
                return true;
            })();

            if (isComplete) {
                return { content: combinedContent };
            }

            attempt++;
            if (attempt >= maxAttempts) {
                let lastFound = 0;
                for (let v = 1; v <= volCount; v++) {
                    if (combinedContent.includes(`### 第${v}卷`)) lastFound = v;
                }
                return { content: combinedContent, error: `已重试${maxAttempts}次，仍只生成到第${lastFound}卷（共${volCount}卷）` };
            }
        }

        return { content: '', error: '重试耗尽' };
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


