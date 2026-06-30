
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

import type { Notifier } from '../shared/types';
import { NOOP_NOTIFIER } from '../shared/types';
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

【输出格式要求】
1. 必须用【项目名称】书名【/项目名称】格式在回答第一行输出小说名称
2. 然后按以下 Markdown 格式输出每卷概要（只要求卷名和一句话核心冲突，不需要章节表）：

## 全书总览
- **总字数目标**：${settings.totalWords}
- **分卷数**：${settings.volumes}
- **每卷预估章数**：${settings.chaptersPerVolume}（约${settings.wordsPerChapter}字/章）

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
【已有时间线事件】${existingElements.timelineEvents || '（无）'}

【规划原则——优先级最高】
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
        existingElements?: { characters: string; factions: string; locations: string; items: string; foreshadows?: string; timelineEvents?: string }
    ): Promise<APIResponse> {
        const systemPrompt = `你是小说结构师。基于全书的全局骨架，为第${volumeNumber}卷生成详细大纲。

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
- **章节分配**：（必须两列表格，完整列出本卷共 ${chaptersPerVolume} 章，禁止任何省略，表格必须严格只有两列）

${OUTLINE_TABLE_HEADER}
|---|---|
| N | 一句话描述该章的核心冲突 |
| N+1 | ...（如此类推，直到该卷最后一章） |

不要输出额外解释，不要重复其他卷的内容。只输出本卷。

【角色使用铁律】
- 你必须基于用户提供的已有角色来规划本卷的人物弧光
- 严禁自创全新主角，所有主角必须来自已有角色列表
- 如果已有角色不足以支撑剧情，只能从已有角色中发展或引入从已有势力中衍生的配角`;

        let userPrompt = `基于以下全局骨架，为第${volumeNumber}卷（共${totalVolumes}卷）生成详细大纲。

【全书骨架】
${globalSkeleton.slice(0, 4000)}

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

【规划原则——优先级最高】
- 必须基于以上已有角色/势力/地点/物品来规划本卷的人物弧光和剧情
- 严禁自创主角或核心势力，所有主要角色必须从已有角色中选取
- 人物弧光部分必须明确引用已有角色姓名

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
        const chaptersPerVolume = Math.ceil(totalWordsNum / settings.volumes / settings.wordsPerChapter);
        onProgress?.('skeleton', 0, settings.volumes);
        console.log('[小说工坊] 瀑布式大纲 - Phase 1: 生成全局骨架');
        
        const skeletonResult = await this.generateGlobalSkeleton(
            worldview,
            {
                characters: existingWorldElements?.characters || '',
                factions: existingWorldElements?.factions || '',
                locations: existingWorldElements?.locations || '',
                items: existingWorldElements?.items || '',
                foreshadows: existingWorldElements?.foreshadows,
                timelineEvents: existingWorldElements?.timelineEvents,
            },
            { totalWords: totalWordsNum, volumes: settings.volumes, wordsPerChapter: settings.wordsPerChapter, chaptersPerVolume: chaptersPerVolume, theme: settings.theme || '', genre: settings.genre || '' },
            customPrompt
        );

        if (skeletonResult.error) {
            console.log('[小说工坊] 瀑布式骨架失败，回退到 retry 模式');
            const systemPrompt = this.buildOutlineSystemPrompt(settings);
            const userPrompt = this.buildOutlineUserPrompt(worldview, settings, existingWorldElements, customPrompt);
            return this.generateOutlineWithRetry(systemPrompt, userPrompt, settings.volumes);
        }

        const volumeSummaries: string[] = [];
        for (let v = 1; v <= settings.volumes; v++) {
            const regex = new RegExp(`### 第${v}卷\\s*\\n([\\s\\S]*?)(?=### 第${v + 1}卷|##|$)`, 'm');
            const match = skeletonResult.content.match(regex);
            volumeSummaries.push(match ? match[0].trim() : `### 第${v}卷\n- **卷名**：待定\n- **核心冲突**：待定`);
        }

        if (volumeSummaries.length === 0 || volumeSummaries.filter(s => s.includes('待定')).length >= Math.ceil(settings.volumes / 2)) {
            console.log('[小说工坊] 骨架解析无有效数据，回退到 retry 模式');
            const systemPrompt = this.buildOutlineSystemPrompt(settings);
            const userPrompt = this.buildOutlineUserPrompt(worldview, settings, existingWorldElements, customPrompt);
            return this.generateOutlineWithRetry(systemPrompt, userPrompt, settings.volumes);
        }

        console.log(`[小说工坊] 瀑布式大纲 - Phase 2: 逐卷生成 (共${settings.volumes}卷)`);
        
        const volumeResults: string[] = [];
        const omissionPatterns = [
            /\.{2,}（.*?省略.*?）/i,
            /省略第\d+章至第\d+章/i,
            /以此类推/i,
            /第\d+章.*?第\d+章.*?省略/i,
        ];

        for (let v = 0; v < volumeSummaries.length; v++) {
            const volumeNumber = v + 1;
            onProgress?.('volume', volumeNumber, settings.volumes);
            console.log(`[小说工坊] 瀑布式大纲 - 生成第${volumeNumber}卷...`);

            let result: APIResponse | null = null;
            const MAX_VOLUME_RETRIES = 3;

            for (let retry = 0; retry < MAX_VOLUME_RETRIES; retry++) {
                const retrySuffix = retry > 0 ? ` (重试${retry}/${MAX_VOLUME_RETRIES - 1})` : '';
                if (retry > 0) console.log(`[小说工坊] 第${volumeNumber}卷${retrySuffix}...`);

                result = await this.generateVolumeOutline(
                    worldview,
                    skeletonResult.content,
                    volumeNumber,
                    settings.volumes,
                    chaptersPerVolume,
                    customPrompt,
                    {
                        characters: existingWorldElements?.characters || '',
                        factions: existingWorldElements?.factions || '',
                        locations: existingWorldElements?.locations || '',
                        items: existingWorldElements?.items || '',
                        foreshadows: existingWorldElements?.foreshadows,
                        timelineEvents: existingWorldElements?.timelineEvents,
                    }
                );

                if (!result.error) break;
                console.error(`[小说工坊] 第${volumeNumber}卷生成失败${retrySuffix}: ${result.error}`);
                if (retry < MAX_VOLUME_RETRIES - 1) {
                    await new Promise(r => setTimeout(r, AI_RETRY_BACKOFF_MS));
                }
            }

            if (!result || result.error) {
                console.error(`[小说工坊] 第${volumeNumber}卷${MAX_VOLUME_RETRIES}次重试全部失败，跳过本卷`);
                volumeResults.push(`### 第${volumeNumber}卷\n- **卷名**：生成失败，请手动补充\n- **核心冲突**：待定\n- **章节分配**：待定`);
                continue;
            }

            const currentContent = result.content;
            if (omissionPatterns.some(p => p.test(currentContent))) {
                console.warn(`[小说工坊] 第${volumeNumber}卷检测到省略模式，尝试强化重试...`);
                const retryResult = await this.generateVolumeOutline(
                    worldview,
                    skeletonResult.content,
                    volumeNumber,
                    settings.volumes,
                    chaptersPerVolume,
                    (customPrompt ? customPrompt + '\n\n' : '') + '⚠️ 上次输出包含省略表述（如"..."、"省略第X章至第Y章"），这是不允许的。必须逐章列出全部 ' + chaptersPerVolume + ' 章，禁止任何省略！',
                    {
                        characters: existingWorldElements?.characters || '',
                        factions: existingWorldElements?.factions || '',
                        locations: existingWorldElements?.locations || '',
                        items: existingWorldElements?.items || '',
                        foreshadows: existingWorldElements?.foreshadows,
                        timelineEvents: existingWorldElements?.timelineEvents,
                    }
                );
                
                if (!retryResult.error && !omissionPatterns.some(p => p.test(retryResult.content))) {
                    console.log(`[小说工坊] 第${volumeNumber}卷省略重试成功`);
                    result = retryResult;
                } else {
                    console.warn(`[小说工坊] 第${volumeNumber}卷省略重试后仍含省略，使用当前输出继续`);
                }
            }

            let volContent = result.content;
            if (!volContent.includes(`### 第${volumeNumber}卷`)) {
                volContent = `### 第${volumeNumber}卷\n${volContent}`;
            }
            volumeResults.push(volContent);
            console.log(`[小说工坊] 第${volumeNumber}卷完成 (${volContent.length}字符)`);
        }

        if (volumeResults.length === 0 || volumeResults.every(r => r.includes('生成失败'))) {
            console.warn('[小说工坊] 瀑布式全部卷失败，回退到旧版 retry 模式');
            const systemPrompt = this.buildOutlineSystemPrompt(settings);
            const userPrompt = this.buildOutlineUserPrompt(worldview, settings, existingWorldElements, customPrompt);
            return this.generateOutlineWithRetry(systemPrompt, userPrompt, settings.volumes);
        }

        const projectNameMatch = skeletonResult.content.match(/【项目名称】(.+?)【\/项目名称】/);
        const projectName = projectNameMatch?.[1] || '';

        const assembledContent = [
            projectName ? `【项目名称】${projectName}【/项目名称】\n` : '',
            '## 全书总览',
            `- **总字数目标**：${settings.totalWords}`,
            `- **分卷数**：${settings.volumes}`,
            `- **每章字数**：约${settings.wordsPerChapter} 字`,
            `- **每卷章节数**：AI 根据内容计算`,
            '',
            '## 分卷大纲',
            '',
            ...volumeResults,
        ].join('\n');

        console.log(`[小说工坊] 瀑布式大纲完成！共${settings.volumes}卷`);

        let finalContent = assembledContent;
        const outlineValidation = validateOutlineOutput(finalContent);
        if (!outlineValidation.valid) {
            console.warn(`[小说工坊] 大纲输出校验失败，缺失字段: ${outlineValidation.missingFields.join(', ')}，尝试重试一次`);
            
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
                    console.warn(`[小说工坊] 大纲重试后仍缺失: ${revalidation.missingFields.join(', ')}`);
                }
            }
        }

        return { content: finalContent };
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
                console.log(`[小说工坊] AI全书规划 - 初始生成请求, maxTokens: ${this.plugin.settings.maxOutput}`);
                result = await this.apiClient.callAI(systemPrompt, userPrompt, this.plugin.settings.flashModel, 0.6, this.plugin.settings.maxOutput);
            } else {
                let lastFound = 0;
                for (let v = 1; v <= volCount; v++) {
                    if (combinedContent.includes(`### 第${v}卷`)) lastFound = v;
                }
                console.log(`[小说工坊] AI全书规划 - 续写请求, 已完成卷: ${lastFound}, 目标卷: ${volCount}`);
                const continuePrompt = `继续输出分卷大纲。你已经输出了到第${lastFound}卷，请从第${lastFound + 1}卷开始，按之前的格式继续输出剩余卷。直接输出 Markdown 内容，不要解释。`;
                result = await this.apiClient.callAI(systemPrompt, continuePrompt, this.plugin.settings.flashModel, 0.6, 4096);
            }

            if (result.error) {
                console.error('[小说工坊] AI全书规划失败:', result.error);
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
}
