import NovelWriterPlugin from '../main';
import {
    FACTION_FRONTMATTER_KEYS,
    LOCATION_FRONTMATTER_KEYS,
    ITEM_FRONTMATTER_KEYS,
    ENTITY_BODY_SECTIONS,
} from '../shared/format-constants';
import { AIApiClient } from './ai-api-client';
import type { APIResponse } from './ai-engine';
import { TemplateService } from '../services/template-service';
import { ENGINE_NAMES } from './engine-registry';

import type { Notifier } from '../shared/types';
import { NOOP_NOTIFIER } from '../shared/types';
export class EntityGenerator {
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

    async generateFaction(worldview: string, name: string, description: string, templateContent?: string, settingLib?: string): Promise<APIResponse> {
        const tmplGuide = templateContent ? `\n【用户自定义势力模板，必须遵循此结构和字段】\n${templateContent.slice(0, 1000)}\n` : '';
        const settingLibSection = settingLib && settingLib.trim().length > 0
            ? `\n参考以下设定库表格，确保生成的实体与设定库不矛盾：\n\n${settingLib}\n`
            : '';
        const defaultSystemPrompt = `
【不可违反的输出契约】
你必须为生成的势力严格按照以下模板字段输出完整档案。

YAML frontmatter 字段（${FACTION_FRONTMATTER_KEYS.length}个，按顺序）：
${FACTION_FRONTMATTER_KEYS.map((f, i) => `${i + 1}. ${f}`).join('\n')}
其中以下为【强制必填】：名称、类型、领袖

正文分节（${ENTITY_BODY_SECTIONS.length}个，按顺序）：
${ENTITY_BODY_SECTIONS.map((s, i) => `${i + 1}. ## ${s}`).join('\n')}

禁止跳过任何字段或分节，禁止使用省略号代替内容。
---
你是一位专业的势力设定师。请根据提供的信息，生成一个完整的势力设定。

【输出格式要求——严格遵循】
必须按照以下Markdown格式输出：

---
tags: [势力]
entity_status: active
entity_created_at:
entity_last_changed_at:
entity_last_changed_reason:
名称:
别称:
类型:
地位/排名:
描述:
领袖:
---

# 势力名

## 确定性设定
- 领袖：
- 核心成员：
- 层级体系：
- 规模：
- 宗旨：
- 行事风格：
- 资源底蕴：

## 不确定性
- 内部矛盾：
- 隐藏目的：
- 潜在变数：

## 与其他元素的互信息
- [[关联人物]] :
- [[敌对势力]] :
- [[关联地点]] :

## 变更记录
- [章节名] 时间戳 | 变更描述

【核心要求】
1. 必须有完整的YAML frontmatter
2. 正文必须按四个分节组织：确定性设定、不确定性、与其他元素的互信息、变更记录
3. 每个分节必须有详细内容${settingLibSection}`;

        const defaultUserPrompt = name
            ? `请生成一个名为「${name}」的势力设定。
${tmplGuide}
${description ? `【描述】${description}` : ''}

【世界观】${worldview.slice(0, 1500)}`
            : `请基于世界观自由创造一个势力设定（名字由你根据世界观风格命名，需契合该世界的语言/文化基调）。
${tmplGuide}
${description ? `【参考方向】${description}` : '【参考方向】无具体方向，请自由发挥'}

【世界观】${worldview.slice(0, 1500)}

⚠️ 注意：YAML 中的"名称"字段必须填写你新创造的势力名，不能留空、不能填"待补充"。`;

        const custom = await this.templateService.getCustomPrompt('faction', {
            system: defaultSystemPrompt,
            user: defaultUserPrompt,
        });

        return this.apiClient.callAI(custom.system, custom.user, this.plugin.settings.proModel, 0.7, 4096);
    }

    async generateLocation(worldview: string, name: string, description: string, templateContent?: string, settingLib?: string): Promise<APIResponse> {
        const tmplGuide = templateContent ? `\n【用户自定义地点模板，必须遵循此结构和字段】\n${templateContent.slice(0, 1000)}\n` : '';
        const settingLibSection = settingLib && settingLib.trim().length > 0
            ? `\n参考以下设定库表格，确保生成的实体与设定库不矛盾：\n\n${settingLib}\n`
            : '';
        const defaultSystemPrompt = `
【不可违反的输出契约】
你必须为生成的地点严格按照以下模板字段输出完整档案。

YAML frontmatter 字段（${LOCATION_FRONTMATTER_KEYS.length}个，按顺序）：
${LOCATION_FRONTMATTER_KEYS.map((f, i) => `${i + 1}. ${f}`).join('\n')}
其中以下为【强制必填】：名称、类型

正文分节（${ENTITY_BODY_SECTIONS.length}个，按顺序）：
${ENTITY_BODY_SECTIONS.map((s, i) => `${i + 1}. ## ${s}`).join('\n')}

禁止跳过任何字段或分节，禁止使用省略号代替内容。
---
你是一位专业的地点设定师。请根据提供的信息，生成一个完整的地点设定。

【输出格式要求——严格遵循】
必须按照以下Markdown格式输出：

---
tags: [地点]
entity_status: active
entity_created_at:
entity_last_changed_at:
entity_last_changed_reason:
名称:
别称:
类型:
所在世界/区域:
描述:
重要程度:
地理特征:
主要居民/势力:
---

# 地点名

## 确定性设定
- 地理特征：
- 气候：
- 灵脉/资源：
- 规模：
- 主要居民/势力：
- 文化风俗：

## 不确定性
- 隐藏秘密：
- 未探索区域：
- 潜在危机：

## 与其他元素的互信息
- [[关联人物]] :
- [[关联势力]] :
- [[关联事件]] :

## 变更记录
- [章节名] 时间戳 | 变更描述

【核心要求】
1. 必须有完整的YAML frontmatter
2. 正文必须按四个分节组织：确定性设定、不确定性、与其他元素的互信息、变更记录
3. 每个分节必须有详细内容${settingLibSection}`;

        const defaultUserPrompt = name
            ? `请生成一个名为「${name}」的地点设定。
${tmplGuide}
${description ? `【描述】${description}` : ''}

【世界观】${worldview.slice(0, 1500)}`
            : `请基于世界观自由创造一个地点设定（名字由你根据世界观风格命名，需契合该世界的地理/文化基调）。
${tmplGuide}
${description ? `【参考方向】${description}` : '【参考方向】无具体方向，请自由发挥'}

【世界观】${worldview.slice(0, 1500)}

⚠️ 注意：YAML 中的"名称"字段必须填写你新创造的地点名，不能留空、不能填"待补充"。`;

        const custom = await this.templateService.getCustomPrompt('location', {
            system: defaultSystemPrompt,
            user: defaultUserPrompt,
        });

        return this.apiClient.callAI(custom.system, custom.user, this.plugin.settings.proModel, 0.7, 4096);
    }

    async generateItem(worldview: string, name: string, description: string, templateContent?: string, settingLib?: string): Promise<APIResponse> {
        const tmplGuide = templateContent ? `\n【用户自定义物品功法模板，必须遵循此结构和字段】\n${templateContent.slice(0, 1000)}\n` : '';
        const settingLibSection = settingLib && settingLib.trim().length > 0
            ? `\n参考以下设定库表格，确保生成的实体与设定库不矛盾：\n\n${settingLib}\n`
            : '';
        const defaultSystemPrompt = `
【不可违反的输出契约】
你必须为生成的物品功法严格按照以下模板字段输出完整档案。

YAML frontmatter 字段（${ITEM_FRONTMATTER_KEYS.length}个，按顺序）：
${ITEM_FRONTMATTER_KEYS.map((f, i) => `${i + 1}. ${f}`).join('\n')}
其中以下为【强制必填】：名称、类型、效果

正文分节（${ENTITY_BODY_SECTIONS.length}个，按顺序）：
${ENTITY_BODY_SECTIONS.map((s, i) => `${i + 1}. ## ${s}`).join('\n')}

禁止跳过任何字段或分节，禁止使用省略号代替内容。
---
你是一位专业的物品功法设定师。请根据提供的信息，生成一个完整的物品或功法设定。

【输出格式要求——严格遵循】
必须按照以下Markdown格式输出：

---
tags: [物品功法]
entity_status: active
entity_created_at:
entity_last_changed_at:
entity_last_changed_reason:
名称:
类型:
品阶/等级:
所属/归属:
描述:
效果:
---

# 物品/功法名

## 确定性设定
- 外观/形态：
- 特性：
- 主要用途：
- 特殊效果：

## 不确定性
- 隐藏能力：
- 限制/副作用：
- 真正来历：

## 与其他元素的互信息
- [[持有者/修炼者]] :
- [[关联剧情]] :
- [[关联物品]] :

## 变更记录
- [章节名] 时间戳 | 变更描述

【核心要求】
1. 必须有完整的YAML frontmatter
2. 正文必须按四个分节组织：确定性设定、不确定性、与其他元素的互信息、变更记录
3. 每个分节必须有详细内容${settingLibSection}`;

        const defaultUserPrompt = name
            ? `请生成一个名为「${name}」的物品/功法设定。

${description ? `【描述】${description}` : ''}

【世界观】${worldview.slice(0, 1500)}`
            : `请基于世界观自由创造一个物品或功法设定（名字由你根据世界观风格命名，需契合该世界的力量体系/文化基调）。

${description ? `【参考方向】${description}` : '【参考方向】无具体方向，请自由发挥'}

【世界观】${worldview.slice(0, 1500)}

⚠️ 注意：YAML 中的"名称"字段必须填写你新创造的物品/功法名，不能留空、不能填"待补充"。`;

        const custom = await this.templateService.getCustomPrompt('item', {
            system: defaultSystemPrompt,
            user: defaultUserPrompt,
        });

        return this.apiClient.callAI(custom.system, custom.user, this.plugin.settings.proModel, 0.7, 4096);
    }
}
