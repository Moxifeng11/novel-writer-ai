import NovelWriterPlugin from '../main';
import {
    CHARACTER_MANDATORY_FIELDS,
    CHARACTER_BODY_SECTIONS_V2,
} from '../shared/format-constants';
import { AIApiClient } from './ai-api-client';
import type { APIResponse } from './ai-engine';
import { TemplateService } from '../services/template-service';

import type { Notifier } from '../shared/types';
import { NOOP_NOTIFIER } from '../shared/types';
export class CharacterGenerator {
    private plugin: NovelWriterPlugin;
    private notifier: Notifier;
    private apiClient: AIApiClient;
    private templateService: TemplateService;

    constructor(plugin: NovelWriterPlugin, apiClient: AIApiClient, notifier?: Notifier) {
        this.notifier = notifier || NOOP_NOTIFIER;
        this.plugin = plugin;
        this.apiClient = apiClient;
        this.templateService = new TemplateService(plugin.app);
    }

    async generateCharacters(worldview: string, count: number = 5, customPrompt?: string, templateContent?: string, isFirstCharacter?: boolean, names?: string[]): Promise<APIResponse> {
        const nameList = names?.filter(n => n && n.trim().length > 0) || [];
        const namedCount = nameList.length;

        const tmplGuide = templateContent ? `\n【以下为用户自定义人物模板，生成的人物卡必须严格遵循此模板的字段和结构】\n${templateContent.slice(0, 1500)}\n` : '';
        const defaultSystemPrompt = `
【不可违反的输出契约】
你必须严格按照以下字段清单生成每个人物卡，不得跳过任何字段，不得用省略号代替内容，不得输出不完整的 YAML frontmatter。

必填 YAML 字段（${CHARACTER_MANDATORY_FIELDS.length}个，按顺序输出）：
${CHARACTER_MANDATORY_FIELDS.map((f, i) => `${i + 1}. ${f}`).join('\n')}
其中以下字段为【强制必填】，必须填写有意义的内容，不得留空：
- 姓名、身份、核心动机、当前状态

必填正文分节（${CHARACTER_BODY_SECTIONS_V2.length}个，按顺序输出）：
${CHARACTER_BODY_SECTIONS_V2.map((s, i) => `${i + 1}. ## ${s}`).join('\n')}

每个角色卡必须完整包含上述所有 YAML 字段和正文分节。
违反以上任何一项，输出将被判定为无效角色卡并丢弃。
${nameList.length > 0 ? `\n【指定人物名称——严格匹配】\n${nameList.map((n, i) => `${i + 1}. ${n}`).join('\n')}\n\n前 ${namedCount} 个人物必须使用上述指定名称，姓名 YAML 字段必须精确匹配。` : ''}
---
你是一位专业的人物设定师。请根据世界观设定，生成多个有深度、有个性的人物。

【输出格式要求——严格遵循】
每个人物必须按照以下Markdown格式输出：

---
tags: [人物]
entity_status: active
entity_created_at:
entity_last_changed_at:
entity_last_changed_reason:
姓名:
年龄:
身份:
核心动机:
核心驱动力_软肋:
习惯性小动作:
当前状态:
当前情绪:
性格标签:
金手指/特殊能力:
功法/技能树:
所属势力:
人物背景:
外貌特征:
当前目标:
character_core:
  desire:
  fear:
  obsession:
  shame:
  trauma:
  weakness:
  soft_spot:
  rage_trigger:
  moral_boundary:
---

# {{Name}}

## 确定性设定（已揭露，不可违背）
- 外貌：
- 核心性格：
- 关键背景：

## 不确定性（未解之谜 / 角色弧光）
- 内心矛盾：
- 隐藏秘密：
- 未来可能的成长方向：

## 与其他角色的互信息
- [[角色B]] : 关系描述（信任？敌对？）
- [[角色C]] :

## 自信息事件储备（低概率但合理的惊喜行为）
- 可能做出的出人意料举动：
- 在极端压力下的可能反应：

## 功法/技能树

- 修为：
- 武技：
- 法术：

## 角色灵魂层（欲望/恐惧/创伤/底线）

> 这是角色的灵魂——不是标签，是驱动其一切行为的深层动力。

- desire（欲望）：最想得到什么
- fear（恐惧）：最害怕什么
- obsession（执念）：最执着什么
- shame（羞耻）：最羞耻经历
- trauma（创伤）：最大创伤
- weakness（弱点）：致命弱点
- soft_spot（软处）：最容易被触动的对象
- rage_trigger（暴走红线）：什么事情会让其失控
- moral_boundary（底线）：再坏也不会跨越的界限

## 变更记录

- [章节名] 时间戳 | 变更描述

【核心要求】
1. 每个人物必须有完整的YAML frontmatter
2. 正文必须按七个分节组织：确定性设定、不确定性、与其他角色的互信息、自信息事件储备、功法/技能树、角色灵魂层、变更记录
3. 人物之间要有互动关系和冲突可能性
4. 主角要有明确的成长弧线
5. 必须填写【核心驱动力_软肋】（最在乎什么/最怕失去什么）以及【习惯性小动作】
6. ⚠️ V2灵魂层：character_core 的9个字段必须全部填写（desire/fear/obsession/shame/trauma/weakness/soft_spot/rage_trigger/moral_boundary），每个字段写1-2句具体内容，这是驱动情节的核心

【重要规则——违反以下规则将导致生成失败】
1. 以上所有 YAML 字段必须填写，不得留空。如果暂时不确定某个字段的值，请根据角色背景合理推断填充。
2. 所有7个正文分节都必须输出，即使内容较少也要保留标题。
3. character_core 的9个子字段一个都不能少——这是角色驱动创作的核心。`;

        const defaultUserPrompt = `请根据以下世界观设定，生成${count}个主要人物：
${nameList.length > 0 ? `\n【指定名称】前 ${namedCount} 个人物的姓名必须为：${nameList.slice(0, namedCount).join('、')}\n` : ''}
【世界观摘要】${worldview.slice(0, 1500)}
${tmplGuide}

要求：
1. 包含1个主角、2-3个重要配角、1个反派
2. 每个人物要有独特的性格和动机
3. 人物之间要有复杂的关系网
4. 主角要有明确的成长目标`;

        const custom = await this.templateService.getCustomPrompt('character', {
            system: defaultSystemPrompt,
            user: defaultUserPrompt,
        });

        let userPrompt = custom.user;
        if (isFirstCharacter) {
            userPrompt += `

【主角标记规则（重要）】
- 这是本书【第一个】生成的人物卡片，必须在 YAML frontmatter 的 身份 字段填写：主角
- 主角必须是全书最核心的人物，围绕其设计欲望、恐惧、执念等灵魂层字段
- 其他人物填写：配角 | 反派 | 路人`;
        }

        if (customPrompt && customPrompt.length > 0) {
            userPrompt += `

【用户自定义要求】
${customPrompt}`;
        }

        const result = await this.apiClient.callAI(custom.system, userPrompt, this.plugin.settings.proModel, 0.7, this.plugin.settings.maxOutput);

        let combinedContent = result.content;
        const expectedBlocks = count;

        let completeBlocks = (combinedContent.match(/^---\n/mg) || []).length;
        
        if (completeBlocks < expectedBlocks) {
            let retryCount = 0;
            const maxRetries = 3;
            let noProgressCount = 0;
            const systemPromptForRetry = custom.system;
            
            while (retryCount < maxRetries && completeBlocks < expectedBlocks) {
                console.log(`[小说工坊] 角色生成截断续写，当前完成: ${completeBlocks}/${expectedBlocks}, 重试: ${retryCount + 1}`);
                
                const continuePrompt = `请继续输出上次被截断的内容。你已经生成了前${completeBlocks}个角色，请从截断处继续，按相同格式输出剩余的角色卡。不要重复已输出的内容。`;
                const continueResult = await this.apiClient.callAI(systemPromptForRetry, continuePrompt, this.plugin.settings.proModel, 0.7, this.plugin.settings.maxOutput);
                
                retryCount++;
                if (continueResult.error) break;
                
                combinedContent += '\n\n' + continueResult.content;
                
                const newCompleteBlocks = (combinedContent.match(/^---\n/mg) || []).length;
                if (newCompleteBlocks <= completeBlocks) {
                    noProgressCount++;
                    if (noProgressCount >= 2) {
                        console.warn(`[小说工坊] 角色生成续写连续${noProgressCount}次无进展，返回已有${completeBlocks}个角色`);
                        break;
                    }
                } else {
                    noProgressCount = 0;
                }
                completeBlocks = newCompleteBlocks;
            }
            if (completeBlocks < expectedBlocks) {
                console.warn(`[小说工坊] 角色生成续写结束，完成: ${completeBlocks}/${expectedBlocks}，部分角色可能不完整`);
            }
        }
        result.content = combinedContent;

        return result;
    }
}
