import NovelWriterPlugin from '../main';
import {
    CHARACTER_MANDATORY_FIELDS,
    CHARACTER_BODY_SECTIONS_V2,
    CHARACTER_NESTED_FIELD_GROUPS,
} from '../shared/format-constants';
import { AIApiClient } from './ai-api-client';
import type { APIResponse } from './ai-engine';
import { TemplateService } from '../services/template-service';
import { ENGINE_NAMES } from './engine-registry';
import { stripCodeFence } from '../shared/api-response-utils';

import type { Notifier } from '../shared/types';
import { NOOP_NOTIFIER } from '../shared/types';
import { createLogger } from '../shared/logger';

const log = createLogger('AiCharacterGenerator');
export class CharacterGenerator {
    private plugin: NovelWriterPlugin;
    private notifier: Notifier;
    private apiClient: AIApiClient;
    private templateService: TemplateService;

    constructor(plugin: NovelWriterPlugin, apiClient: AIApiClient, notifier?: Notifier) {
        this.notifier = notifier || NOOP_NOTIFIER;
        this.plugin = plugin;
        this.apiClient = apiClient;
        this.templateService = plugin.engineRegistry.get<TemplateService>(ENGINE_NAMES.TEMPLATE_SERVICE);
    }

    /**
     * AI两步搜索：第一步让AI选择需要的section标题，第二步用正则提取对应内容
     */
    private async extractRelevantWorldview(worldview: string, entityType: string, signal?: AbortSignal): Promise<string> {
        // 第一步：提取所有 ## 标题作为目录
        const headings = worldview.match(/^##\s+.+$/gm) || [];
        if (headings.length === 0) {
            // 没有 ## 标题，直接返回前2000字符
            return worldview.slice(0, 2000);
        }
        const toc = headings.map((h, i) => `${i + 1}. ${h.replace(/^##\s+/, '')}`).join('\n');

        // 用 flashModel 让AI选择需要的section
        const selectPrompt = `你是一个信息检索助手。用户要生成${entityType}，需要从世界观中提取相关信息。

世界观目录：
${toc}

请选出对生成${entityType}最重要的章节标题（最多5个），只返回标题名称，每行一个，不要编号不要解释。`;

        try {
            const result = await this.apiClient.callAI(
                '你是一个信息检索助手，只返回标题名称。',
                selectPrompt,
                this.plugin.settings.flashModel || this.plugin.settings.defaultModel,
                0.3,
                500,
                { signal }
            );
            if (result.error || !result.content.trim()) {
                // AI选择失败，fallback到前2000字符
                return worldview.slice(0, 2000);
            }

            // 第二步：根据AI返回的标题，用正则提取对应section内容
            const selectedTitles = result.content.trim().split('\n').map(t => t.trim().replace(/^\d+\.\s*/, '')).filter(t => t.length > 0);
            const sections: string[] = [];
            for (const title of selectedTitles) {
                // 匹配 ## 标题 到下一个 ## 或文件末尾
                const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const re = new RegExp(`(##\\s+${escaped}[\\s\\S]*?)(?=\\n##\\s|$)`, 'i');
                const match = worldview.match(re);
                if (match) {
                    sections.push(match[1].trim());
                }
            }
            if (sections.length === 0) {
                return worldview.slice(0, 2000);
            }
            return sections.join('\n\n');
        } catch (e) {
            log.warn('[小说工坊] 世界观智能搜索失败，回退到截断模式:', e instanceof Error ? e.message : e);
            return worldview.slice(0, 2000);
        }
    }

    async generateCharacters(worldview: string, count: number = 5, customPrompt?: string, templateContent?: string, isFirstCharacter?: boolean, names?: string[], settingLib?: string, signal?: AbortSignal, existingEntities?: string): Promise<APIResponse> {
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

【性格三层结构要求——重要】
每个角色的性格必须包含三层结构：
1. **表层性格（面具）**：外人眼中的形象，是角色展示给世界的面具（如：冷漠疏离、开朗热情、不苟言笑）
2. **中层性格（真实）**：熟悉的人才能看到的真实性格（如：内心柔软、缺乏安全感、重情重义）
3. **深层性格（内核）**：连角色自己都未必完全意识到的核心驱动力（如：渴望被认可、恐惧被抛弃、追求掌控感）

【角色弧光要求——重要】
每个主要角色必须有明确的角色弧光：
1. **起点状态**：故事开始时的状态（性格缺陷/错误信念/未解心结）
2. **成长触发点**：什么事件或人物会推动角色改变
3. **终点状态**：故事结束时可能达到的状态（成长/堕落/幻灭）
4. **弧光类型**：成长弧 / 堕落弧 / 幻灭弧 / 扁平弧（主角必须是成长弧）

【关系网约束要求——重要】
生成的角色之间必须有复杂的关系网，不能孤立存在：
1. 每个角色至少与其他2个角色有明确关系
2. 关系类型要多样：师徒、敌对、盟友、暗恋、利用、亲情、竞争等
3. 关系要有张力：不是非黑即白，有爱恨交织、利益纠葛
4. 主角必须处于关系网的中心位置

【输出格式要求——严格遵循】
每个人物必须按照以下Markdown格式输出：

---
tags: [人物, nw/实体/人物]
entity_status: active
entity_created_at:
entity_last_changed_at:
entity_last_changed_reason:
姓名:
年龄:
性别:
身份:
首次出场:
核心动机:
核心驱动力_软肋:
习惯性小动作:
当前状态:
当前情绪:
当前位置:
修为等级:
性格标签:
金手指/特殊能力:
功法/技能树:
所属势力:
人物背景:
外貌特征:
当前目标:
性格三层:
  表层_面具:
  中层_真实:
  深层_内核:
角色弧光:
  起点状态:
  成长触发点:
  终点状态:
  弧光类型:
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
- [[角色B]] : 关系描述（信任？敌对？）—— 关系类型：XXX —— 关系张力：XXX
- [[角色C]] : —— 关系类型：XXX —— 关系张力：XXX

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
7. ⚠️ 性格三层：表层/中层/深层必须分明，不能混为一谈，表层是给外人看的，深层是连自己都怕面对的
8. ⚠️ 角色弧光：主角必须是成长弧，反派可以是堕落弧或扁平弧，每个角色都要有明确的变化轨迹
9. ⚠️ 关系网：所有角色必须编织在同一张关系网中，不能有孤岛角色，关系必须有张力

【重要规则——违反以下规则将导致生成失败】
1. 以上所有 YAML 字段必须填写，不得留空。如果暂时不确定某个字段的值，请根据角色背景合理推断填充。
2. 所有7个正文分节都必须输出，即使内容较少也要保留标题。
3. character_core 的9个子字段一个都不能少——这是角色驱动创作的核心。
4. 性格三层的3个子字段必须全部填写，且层层递进。
5. 角色弧光的4个子字段必须全部填写。
6. "与其他角色的互信息"中必须至少列出2个其他角色，且关系描述要具体。`;

        const settingLibSection = settingLib && settingLib.trim().length > 0
            ? `\n【设定库（结构化设定速查）】\n${settingLib}\n`
            : '';
        const relevantWorldview = await this.extractRelevantWorldview(worldview, '人物', signal);
        const worldviewSection = `\n【世界观补充（叙述性细节）】\n${relevantWorldview}\n`;
        const existingEntitiesSection = existingEntities && existingEntities.trim().length > 0
            ? `\n【已有实体摘要（生成的新实体应与这些实体有关联）】\n${existingEntities}\n`
            : '';

        const defaultUserPrompt = `请根据以下世界设定，生成${count}个主要人物：
${nameList.length > 0 ? `\n【指定名称】前 ${namedCount} 个人物的姓名必须为：${nameList.slice(0, namedCount).join('、')}\n` : ''}${settingLibSection}${worldviewSection}${existingEntitiesSection}${tmplGuide}

要求：
1. 包含1个主角、2-3个重要配角、1个反派
2. 每个人物要有独特的性格和动机
3. 人物之间要有复杂的关系网——每个角色至少与其他2个角色有关联，关系类型多样（师徒/敌对/盟友/暗恋/利用/亲情/竞争）
4. 主角要有明确的成长目标和完整的成长弧光
5. 人物的功法/技能/势力归属必须与设定库中的力量体系/势力分布一致
6. 新生成的人物应与已有实体有关联（如所属势力、所在地等），不要孤立存在
7. 性格三层要分明：表层是面具，中层是真实，深层是连自己都怕面对的内核
8. 每个角色要有明确的角色弧光：起点→触发→终点，主角必须是成长弧
9. 关系网要有张力：不是简单的好坏，而是爱恨交织、利益纠葛`;

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

        const result = await this.apiClient.callAI(
            custom.system,
            userPrompt,
            this.plugin.settings.proModel,
            0.7,
            this.plugin.settings.maxOutput,
            { signal }
        );

        let combinedContent = result.content;
        const expectedBlocks = count;

        let completeBlocks = (combinedContent.match(/^---\n/mg) || []).length;
        
        if (completeBlocks < expectedBlocks) {
            let retryCount = 0;
            const maxRetries = 3;
            let noProgressCount = 0;
            const systemPromptForRetry = custom.system;
            
            while (retryCount < maxRetries && completeBlocks < expectedBlocks) {
                log.info(`[小说工坊] 角色生成截断续写，当前完成: ${completeBlocks}/${expectedBlocks}, 重试: ${retryCount + 1}`);
                
                const continuePrompt = `请继续输出上次被截断的内容。你已经生成了前${completeBlocks}个角色，请从截断处继续，按相同格式输出剩余的角色卡。不要重复已输出的内容。`;
                const continueResult = await this.apiClient.callAI(
                    systemPromptForRetry,
                    continuePrompt,
                    this.plugin.settings.proModel,
                    0.7,
                    this.plugin.settings.maxOutput,
                    { signal }
                );
                
                retryCount++;
                if (continueResult.error) break;
                
                combinedContent += '\n\n' + continueResult.content;
                
                const newCompleteBlocks = (combinedContent.match(/^---\n/mg) || []).length;
                if (newCompleteBlocks <= completeBlocks) {
                    noProgressCount++;
                    if (noProgressCount >= 2) {
                        log.warn(`[小说工坊] 角色生成续写连续${noProgressCount}次无进展，返回已有${completeBlocks}个角色`);
                        break;
                    }
                } else {
                    noProgressCount = 0;
                }
                completeBlocks = newCompleteBlocks;
            }
            if (completeBlocks < expectedBlocks) {
                log.warn(`[小说工坊] 角色生成续写结束，完成: ${completeBlocks}/${expectedBlocks}，部分角色可能不完整`);
            }
        }
        result.content = combinedContent;

        return result;
    }

    /**
     * 针对性补全不完整的角色卡：接收原始内容和缺失字段列表，调用 API 补全。
     *
     * 补全必须与生成使用同一套「输出契约」：只补 frontmatter 会通过不了
     * validateCharacterOutput（它还要求 7 个正文分节与 3 个嵌套组），
     * 因此这里显式列出全部必需结构，避免「补了但复检依旧失败」。
     */
    async completeCharacter(
        rawContent: string,
        missingFields: string[],
        signal?: AbortSignal,
        options: { worldview?: string; templateContent?: string } = {}
    ): Promise<string> {
        const missingList = missingFields.join('、');
        const soulFields = CHARACTER_NESTED_FIELD_GROUPS['character_core']?.join(' / ') ?? '';
        const threeLayers = CHARACTER_NESTED_FIELD_GROUPS['性格三层']?.join(' / ') ?? '';
        const arcFields = CHARACTER_NESTED_FIELD_GROUPS['角色弧光']?.join(' / ') ?? '';

        const systemPrompt = `你是一个人物卡补全专家。用户会给你一个不完整的人物卡，以及缺失的字段列表。
请补全缺失的字段/分节，输出完整的人物卡。不要修改已有字段的内容，不要添加多余解释。

【输出契约——不可违反，违反将被判定为无效】
1. YAML frontmatter 必须用 --- 开始、用 --- 结束，以下 ${CHARACTER_MANDATORY_FIELDS.length} 个字段必须全部存在且有具体内容：
${CHARACTER_MANDATORY_FIELDS.map((f, i) => `${i + 1}. ${f}`).join('\n')}
2. 必须包含以下三个 YAML 嵌套组，子字段一个都不能少：
- character_core: ${soulFields}
- 性格三层: ${threeLayers}
- 角色弧光: ${arcFields}
3. 正文必须包含以下 ${CHARACTER_BODY_SECTIONS_V2.length} 个二级标题分节，且每节都要有实质内容（不能只有标题）：
${CHARACTER_BODY_SECTIONS_V2.map((s, i) => `${i + 1}. ## ${s}`).join('\n')}
4. 禁止输出「待补充」「未知」「无」「—」「...」等占位值
5. 只输出人物卡 Markdown 本体，不要代码围栏，不要任何解释`;

        const userPrompt = `以下人物卡缺少这些字段/分节：${missingList}

【当前人物卡】
${rawContent}

${options.worldview ? `【世界观参考】\n${options.worldview.slice(0, 1800)}\n` : ''}${options.templateContent ? `【用户人物模板】\n${options.templateContent.slice(0, 1200)}\n` : ''}
请输出补全后的完整人物卡。`;

        const result = await this.apiClient.callAI(
            systemPrompt,
            userPrompt,
            this.plugin.settings.proModel || this.plugin.settings.defaultModel,
            0.4,
            Math.max(4096, this.plugin.settings.maxOutput || 0),
            { signal }
        );

        if (result.error || !result.content.trim()) {
            log.warn('[小说工坊] 角色补全失败:', result.error);
            return rawContent;
        }

        return stripCodeFence(result.content);
    }
}
