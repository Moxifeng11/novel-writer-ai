/**
 * ai-entity-generator.ts — 势力 / 地点 / 物品功法 的单条实体生成
 *
 * 批次 4 第一步：三类实体的 prompt 组装由「三份近 90 行的重复方法」收敛为
 * 「一份 EntityKindSpec 配置表 + 一个 generateByKind 实现」。三个 public 方法
 * 保留原签名，prompt 文本按字符级保持原样（行为零变化，由
 * `tests/unit/engine/entity-generator-prompt-parity.test.ts` 钉住）。
 */
import NovelWriterPlugin from '../main';
import {
    FACTION_FRONTMATTER_KEYS,
    LOCATION_FRONTMATTER_KEYS,
    ITEM_FRONTMATTER_KEYS,
    ENTITY_BODY_SECTIONS,
} from '../shared/format-constants';
import { AIApiClient } from './ai-api-client';
import type { APIResponse } from './ai-engine';
import { TemplateService } from './template-service';
import { ENGINE_NAMES } from '../shared/engine-names';
import { buildEntityTemplateBlock } from '../shared/entity-templates';

import type { Notifier } from '../shared/types';
import { NOOP_NOTIFIER } from '../shared/types';

type EntityKind = 'faction' | 'location' | 'item';

interface EntityKindSpec {
    /** 自定义 prompt 的类型键（TemplateService.getCustomPrompt） */
    promptKey: EntityKind;
    frontmatterKeys: readonly string[];
    /** 「其中以下为【强制必填】：…」的整段文案 */
    mandatory: string;
    /** system prompt 中的角色名（「你是一位专业的${role}」） */
    role: string;
    /** system prompt 的输出对象（「你必须为生成的${outputTarget}」） */
    outputTarget: string;
    /** system prompt 的生成目标（「请根据提供的信息，生成${target}」） */
    target: string;
    /** 示例 frontmatter 块（含 tags / entity_* 元字段，来自 shared/entity-templates） */
    frontmatter: string;
    /** 示例正文（一级标题 + 四分节，来自 shared/entity-templates） */
    body: string;
    /** 自定义模板引导语的模板名（「用户自定义${templateLabel}」） */
    templateLabel: string;
    /** 是否把自定义模板注入 user prompt（物品功法历史实现未注入，保持现状） */
    includeTemplateGuide: boolean;
    /** name 分支的对象名（「请生成一个名为「X」的${userTarget}」） */
    userTarget: string;
    /** 自由创作分支的对象名 */
    freeformTarget: string;
    /** 自由创作时要求的基调（「需契合该世界的${cultureHint}基调」） */
    cultureHint: string;
    /** YAML 名称字段提示（「必须填写你新创造的${nameHint}」） */
    nameHint: string;
}

const ENTITY_KIND_SPECS: Record<EntityKind, EntityKindSpec> = {
    faction: {
        promptKey: 'faction',
        frontmatterKeys: FACTION_FRONTMATTER_KEYS,
        mandatory: '名称、类型、领袖',
        role: '势力设定师',
        outputTarget: '势力',
        target: '一个完整的势力设定',
        templateLabel: '势力模板',
        includeTemplateGuide: true,
        userTarget: '势力设定',
        freeformTarget: '势力设定',
        cultureHint: '语言/文化',
        nameHint: '势力名',
        ...buildEntityTemplateBlock('faction'),
    },
    location: {
        promptKey: 'location',
        frontmatterKeys: LOCATION_FRONTMATTER_KEYS,
        mandatory: '名称、类型',
        role: '地点设定师',
        outputTarget: '地点',
        target: '一个完整的地点设定',
        templateLabel: '地点模板',
        includeTemplateGuide: true,
        userTarget: '地点设定',
        freeformTarget: '地点设定',
        cultureHint: '地理/文化',
        nameHint: '地点名',
        ...buildEntityTemplateBlock('location'),
    },
    item: {
        promptKey: 'item',
        frontmatterKeys: ITEM_FRONTMATTER_KEYS,
        mandatory: '名称、类型、效果',
        role: '物品功法设定师',
        outputTarget: '物品功法',
        target: '一个完整的物品或功法设定',
        templateLabel: '物品功法模板',
        includeTemplateGuide: false,
        userTarget: '物品/功法设定',
        freeformTarget: '物品或功法设定',
        cultureHint: '力量体系/文化',
        nameHint: '物品/功法名',
        ...buildEntityTemplateBlock('item'),
    },
};

/**
 * 单实体生成器（势力/地点/物品）。
 */
export class EntityGenerator {
    private plugin: NovelWriterPlugin;
    private notifier: Notifier;
    private apiClient: AIApiClient;
    private templateService: TemplateService;

    constructor(plugin: NovelWriterPlugin, apiClient: AIApiClient, notifier?: Notifier) {
        this.notifier = notifier || NOOP_NOTIFIER;
        this.plugin = plugin;
        this.apiClient = apiClient;
        this.templateService = plugin.engineRegistry.get(ENGINE_NAMES.TEMPLATE_SERVICE);
    }

    /**
     * 生成势力。
     *
     * @param worldview - 世界观
     * @param name - 名称
     * @param description - 描述
     * @param templateContent - 模板内容
     * @param settingLib - 设定库
     * @returns 势力实体
     */
    async generateFaction(worldview: string, name: string, description: string, templateContent?: string, settingLib?: string): Promise<APIResponse> {
        return this.generateByKind('faction', worldview, name, description, templateContent, settingLib);
    }

    /**
     * 生成地点。
     *
     * @param worldview - 世界观
     * @param name - 名称
     * @param description - 描述
     * @param templateContent - 模板内容
     * @param settingLib - 设定库
     * @returns 地点实体
     */
    async generateLocation(worldview: string, name: string, description: string, templateContent?: string, settingLib?: string): Promise<APIResponse> {
        return this.generateByKind('location', worldview, name, description, templateContent, settingLib);
    }

    /**
     * 生成物品。
     *
     * @param worldview - 世界观
     * @param name - 名称
     * @param description - 描述
     * @param templateContent - 模板内容
     * @param settingLib - 设定库
     * @returns 物品实体
     */
    async generateItem(worldview: string, name: string, description: string, templateContent?: string, settingLib?: string): Promise<APIResponse> {
        return this.generateByKind('item', worldview, name, description, templateContent, settingLib);
    }

    private async generateByKind(
        kind: EntityKind,
        worldview: string,
        name: string,
        description: string,
        templateContent?: string,
        settingLib?: string,
    ): Promise<APIResponse> {
        const spec = ENTITY_KIND_SPECS[kind];
        const tmplGuide = spec.includeTemplateGuide && templateContent
            ? `\n【用户自定义${spec.templateLabel}，必须遵循此结构和字段】\n${templateContent.slice(0, 1000)}\n`
            : '';
        const settingLibSection = settingLib && settingLib.trim().length > 0
            ? `\n参考以下设定库表格，确保生成的实体与设定库不矛盾：\n\n${settingLib}\n`
            : '';
        const defaultSystemPrompt = `
【不可违反的输出契约】
你必须为生成的${spec.outputTarget}严格按照以下模板字段输出完整档案。

YAML frontmatter 字段（${spec.frontmatterKeys.length}个，按顺序）：
${spec.frontmatterKeys.map((f, i) => `${i + 1}. ${f}`).join('\n')}
其中以下为【强制必填】：${spec.mandatory}

正文分节（${ENTITY_BODY_SECTIONS.length}个，按顺序）：
${ENTITY_BODY_SECTIONS.map((s, i) => `${i + 1}. ## ${s}`).join('\n')}

禁止跳过任何字段或分节，禁止使用省略号代替内容。
---
你是一位专业的${spec.role}。请根据提供的信息，生成${spec.target}。

【输出格式要求——严格遵循】
必须按照以下Markdown格式输出：

${spec.frontmatter}

${spec.body}

【核心要求】
1. 必须有完整的YAML frontmatter
2. 正文必须按四个分节组织：确定性设定、不确定性、与其他元素的互信息、变更记录
3. 每个分节必须有详细内容${settingLibSection}`;

        const defaultUserPrompt = name
            ? `请生成一个名为「${name}」的${spec.userTarget}。
${tmplGuide}
${description ? `【描述】${description}` : ''}

【世界观】${worldview.slice(0, 1500)}`
            : `请基于世界观自由创造一个${spec.freeformTarget}（名字由你根据世界观风格命名，需契合该世界的${spec.cultureHint}基调）。
${tmplGuide}
${description ? `【参考方向】${description}` : '【参考方向】无具体方向，请自由发挥'}

【世界观】${worldview.slice(0, 1500)}

⚠️ 注意：YAML 中的"名称"字段必须填写你新创造的${spec.nameHint}，不能留空、不能填"待补充"。`;

        const custom = await this.templateService.getCustomPrompt(spec.promptKey, {
            system: defaultSystemPrompt,
            user: defaultUserPrompt,
        });

        return this.apiClient.callAI(custom.system, custom.user, this.plugin.settings.proModel, 0.7, this.plugin.settings.maxOutput);
    }
}
