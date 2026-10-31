import NovelWriterPlugin from '../main';
import {
    FACTION_FRONTMATTER_KEYS,
    LOCATION_FRONTMATTER_KEYS,
    ITEM_FRONTMATTER_KEYS,
    ENTITY_BODY_SECTIONS,
} from '../shared/format-constants';
import { AIApiClient } from './ai-api-client';
import type { APIResponse, BatchEntityResult } from './ai-engine';
import { stripCodeFence } from '../shared/api-response-utils';
import { buildEntityTemplateBlock } from '../shared/entity-templates';
import {
    validateFactionOutput,
    validateLocationOutput,
    validateItemOutput,
    type ValidationResult,
} from '../shared/template-validator';

import type { Notifier } from '../shared/types';
import { NOOP_NOTIFIER } from '../shared/types';
import { Notice } from 'obsidian';
import { NOTICE_ERROR } from '../shared/thresholds';
import { createLogger } from '../shared/logger';

const log = createLogger('AiBatchEntityGenerator');
export class BatchEntityGenerator {
    private plugin: NovelWriterPlugin;
    private notifier: Notifier;
    private apiClient: AIApiClient;

    constructor(plugin: NovelWriterPlugin, apiClient: AIApiClient, notifier?: Notifier) {
        this.notifier = notifier || NOOP_NOTIFIER;
        this.plugin = plugin;
        this.apiClient = apiClient;
    }

    async generateFactionsBatch(
        worldview: string,
        names: string[],
        description: string,
        count: number,
        customSystemPrompt?: string,
        settingLib?: string
    ): Promise<BatchEntityResult[]> {
        return this._generateEntitiesBatchInternal(
            '势力', FACTION_FRONTMATTER_KEYS, '名称、类型、领袖',
            `${buildEntityTemplateBlock('faction').frontmatter}

${buildEntityTemplateBlock('faction').body}`,
            worldview, names, description, count, customSystemPrompt, settingLib
        );
    }

    async generateLocationsBatch(
        worldview: string,
        names: string[],
        description: string,
        count: number,
        customSystemPrompt?: string,
        settingLib?: string
    ): Promise<BatchEntityResult[]> {
        return this._generateEntitiesBatchInternal(
            '地点', LOCATION_FRONTMATTER_KEYS, '名称、类型、地理位置',
            `${buildEntityTemplateBlock('location').frontmatter}

${buildEntityTemplateBlock('location').body}`,
            worldview, names, description, count, customSystemPrompt, settingLib
        );
    }

    async generateItemsBatch(
        worldview: string,
        names: string[],
        description: string,
        count: number,
        customSystemPrompt?: string,
        itemType?: string,
        settingLib?: string
    ): Promise<BatchEntityResult[]> {
        const typeLabel = itemType || '物品/功法';
        const typeKey = itemType === '功法' ? '功法' : '物品';
        return this._generateEntitiesBatchInternal(
            typeLabel, ITEM_FRONTMATTER_KEYS, '名称、类型、品级',
            `${buildEntityTemplateBlock('item', { itemTag: typeKey }).frontmatter}

${buildEntityTemplateBlock('item', { itemTag: typeKey }).body}`,
            worldview, names, description, count, customSystemPrompt, settingLib
        );
    }

    private async _generateEntitiesBatchInternal(
        entityType: string,
        frontmatterKeys: readonly string[],
        mandatoryFields: string,
        templateExample: string,
        worldview: string,
        names: string[],
        description: string,
        count: number,
        customSystemPrompt?: string,
        settingLib?: string
    ): Promise<BatchEntityResult[]> {
        const nameList = names?.filter(n => n && n.trim().length > 0) || [];
        const namedCount = nameList.length;
        const aiGenerateCount = Math.max(0, count - namedCount);

        if (namedCount === 0 && aiGenerateCount === 0) {
            return [];
        }

        const validateFn = this._getValidateFn(entityType);

        const namesPrompt = nameList.length > 0
            ? `\n【指定${entityType}名称】\n${nameList.map((n, i) => `${i + 1}. ${n}`).join('\n')}\n\n前 ${namedCount} 个必须使用上述指定名称，剩余 ${aiGenerateCount} 个由你自由命名。`
            : `\n请自由生成 ${count} 个${entityType}的名称。`;

        const settingLibSection = settingLib && settingLib.trim().length > 0
            ? `\n【设定库参考】\n参考以下设定库表格，确保生成的实体与设定库不矛盾：\n\n${settingLib}\n`
            : '';

        let systemPrompt = customSystemPrompt || `你是专业的${entityType}设定师。请一次性生成多个${entityType}。

【不可违反的输出契约】
每个${entityType}必须严格按照以下模板输出，不得跳过任何字段：

YAML frontmatter 字段（${frontmatterKeys.length}个）：
${frontmatterKeys.map((k, i) => `${i + 1}. ${k}`).join('\n')}
其中以下为【强制必填】：${mandatoryFields}

正文分节（${ENTITY_BODY_SECTIONS.length}个）：
${ENTITY_BODY_SECTIONS.map((s, i) => `${i + 1}. ## ${s}`).join('\n')}

【输出格式——严格遵循】
每个${entityType}之间用 "---" 分隔线隔开。
每个${entityType}格式示例：
${templateExample}

【要求】
- 一次性输出全部 ${count} 个${entityType}
- 每个${entityType}必须完整，不得使用省略号
- 名称必须有辨识度，不要太普通
- 所有${entityType}的设定不能互相矛盾
- ⚠️ 生成不完整的实体将被直接丢弃，不会展示给用户${settingLibSection}`;

        if (!customSystemPrompt) {
            systemPrompt += namesPrompt;
        }

        const userPrompt = `请生成 ${count} 个${entityType}。

【世界观参考】
${worldview.slice(0, 2000)}

${description ? `【补充要求】\n${description}` : ''}

请直接输出所有${entityType}内容，不要额外解释。`;

        const response = await this.apiClient.callAI(
            systemPrompt,
            userPrompt,
            this.plugin.settings.flashModel,
            0.7,
            this.plugin.settings.maxOutput
        );

        if (response.error || !response.content) {
            log.error(`[批量生成${entityType}] AI调用失败:`, response.error);
            this.notifier.showNotice(`❌ 生成失败: ${response.error || '未知错误'}`, NOTICE_ERROR);
            return [];
        }

        let results = this._parseEntityBlocks(response.content, entityType, nameList, count);

        const MAX_RETRIES = this.plugin.settings.maxEntityBatchRetries ?? 2;
        for (let retry = 0; retry < MAX_RETRIES; retry++) {
            const incomplete: { name: string; content: string; missing: string[] }[] = [];
            const complete: BatchEntityResult[] = [];

            for (const r of results) {
                const v = validateFn(r.content);
                if (v.valid) {
                    complete.push(r);
                } else {
                    incomplete.push({ name: r.name, content: r.content, missing: v.missingFields });
                }
            }

            if (incomplete.length === 0) {
                results = complete;
                break;
            }

            log.warn(`[批量生成${entityType}] 第${retry + 1}轮：${complete.length}个完整 / ${incomplete.length}个不完整，开始补全...`);

            const retryResults: BatchEntityResult[] = [...complete];

            const batchFixed = await this._retryFixEntitiesBatch(
                entityType, incomplete, frontmatterKeys, worldview, customSystemPrompt
            );
            if (batchFixed.length > 0) {
                for (const fixed of batchFixed) {
                    const v = validateFn(fixed.content);
                    if (v.valid) {
                        retryResults.push(fixed);
                    }
                }
                const fixedNames = new Set(batchFixed.map(f => f.name));
                const stillIncomplete = incomplete.filter(inc => !fixedNames.has(inc.name));
                for (const inc of stillIncomplete) {
                    const fixed = await this._retryFixEntity(
                        entityType, inc.name, inc.content, inc.missing,
                        frontmatterKeys, worldview, customSystemPrompt
                    );
                    if (fixed) {
                        retryResults.push(fixed);
                    } else {
                        log.warn(`[批量生成${entityType}] 补全失败，丢弃：${inc.name}`);
                    }
                }
            } else {
                for (const inc of incomplete) {
                    const fixed = await this._retryFixEntity(
                        entityType, inc.name, inc.content, inc.missing,
                        frontmatterKeys, worldview, customSystemPrompt
                    );
                    if (fixed) {
                        retryResults.push(fixed);
                    } else {
                        log.warn(`[批量生成${entityType}] 补全失败，丢弃：${inc.name}`);
                    }
                }
            }
            results = retryResults;
            const stillIncomplete = results.filter(r => !validateFn(r.content).valid);
            if (stillIncomplete.length === 0) break;
        }

        results = results.filter(r => validateFn(r.content).valid);
        results = results.slice(0, count);

        if (results.length < count) {
            log.warn(`[批量生成${entityType}] 最终完整实体 ${results.length}/${count}，不足部分已丢弃`);
            this.notifier.showNotice(
                `⚠️ 生成 ${results.length}/${count} 个完整${entityType}，其余不完整的已自动丢弃`,
                4000
            );
        }

        return results;
    }

    /**
     * 公开的单条实体补全入口。
     * 供生成模态在保存前做「校验 → AI 补全 → 复检」闭环使用；
     * 补全结果仍不完整时返回 null，调用方必须拒绝落盘。
     */
    async repairEntity(
        entityType: '势力' | '地点' | '物品/功法',
        name: string,
        content: string,
        missingFields: string[],
        worldview = ''
    ): Promise<string | null> {
        const frontmatterKeys =
            entityType === '势力' ? FACTION_FRONTMATTER_KEYS
                : entityType === '地点' ? LOCATION_FRONTMATTER_KEYS
                    : ITEM_FRONTMATTER_KEYS;
        const result = await this._retryFixEntity(
            entityType, name, content, missingFields, frontmatterKeys, worldview
        );
        return result?.content ?? null;
    }

    private _getValidateFn(entityType: string): (content: string) => ValidationResult {
        switch (entityType) {
            case '势力': return validateFactionOutput;
            case '地点': return validateLocationOutput;
            case '物品/功法':
            case '物品':
            case '功法': return validateItemOutput;
            default: return () => ({ valid: true, missingFields: [] });
        }
    }

    private _parseEntityBlocks(
        content: string,
        entityType: string,
        nameList: string[],
        count: number
    ): BatchEntityResult[] {
        const results: BatchEntityResult[] = [];
        const namedCount = nameList.length;

        const blocks = this._splitEntityBlocks(content);
        log.info(`[批量生成${entityType}] 解析: AI 原始长度 ${content.length}，切出 ${blocks.length} 个实体块`);

        for (let i = 0; i < blocks.length && results.length < count; i++) {
            const entityContent = blocks[i].trim();
            if (!entityContent) continue;

            let entityName = '';
            const yaml = entityContent.match(/^---\s*\n([\s\S]*?)\n---/);
            if (yaml) {
                const nameMatch = yaml[1].match(/^(?:名称|name)\s*:\s*(.+)$/m);
                if (nameMatch && nameMatch[1].trim()) {
                    entityName = nameMatch[1].trim();
                }
            }

            if (!entityName) {
                const titleMatch = entityContent.match(/^#\s+(.+)$/m);
                if (titleMatch && titleMatch[1].trim()
                    && titleMatch[1].trim() !== '物品/功法名'
                    && titleMatch[1].trim() !== '势力名'
                    && titleMatch[1].trim() !== '地点名') {
                    entityName = titleMatch[1].trim();
                }
            }

            if (!entityName && yaml) {
                const firstLine = yaml[1].split('\n').find(l => l.includes(':') && !l.startsWith('#'));
                if (firstLine) {
                    const val = firstLine.split(':')[1]?.trim();
                    if (val && val.length > 1 && val.length < 50) {
                        entityName = val;
                    }
                }
            }

            if (!entityName) {
                const weaponMatch = entityContent.match(/【(.+?)】/);
                if (weaponMatch) entityName = weaponMatch[1];
            }

            if (i < namedCount && nameList[i]) {
                entityName = nameList[i];
            }

            if (!entityName) {
                entityName = `${entityType}${results.length + 1}`;
            }

            entityName = entityName.replace(/[<>:"/\\|?*]/g, '·').trim();

            results.push({ name: entityName, content: entityContent });
        }

        log.info(`[批量生成${entityType}] 解析结果: 有效实体块 ${results.length} 个 / 原始块 ${blocks.length} 个`);
        return results;
    }

    private _splitEntityBlocks(content: string): string[] {
        const normalized = content.replace(/\r\n/g, '\n');
        const lines = normalized.split('\n');
        const dashPositions: number[] = [];

        for (let i = 0; i < lines.length; i++) {
            if (/^---\s*$/.test(lines[i])) {
                dashPositions.push(i);
            }
        }

        if (dashPositions.length < 2) {
            return normalized.trim() ? [normalized.trim()] : [];
        }

        const blocks: string[] = [];
        let i = 0;
        while (i + 1 < dashPositions.length) {
            const openIdx = dashPositions[i];
            const closeIdx = dashPositions[i + 1];

            let endLine = normalized.length;
            if (i + 2 < dashPositions.length) {
                endLine = dashPositions[i + 2];
                i += 2;
            } else {
                endLine = normalized.length;
                i = dashPositions.length;
            }

            const blockLines = lines.slice(openIdx, endLine);
            const blockText = blockLines.join('\n').trim();
            if (blockText) {
                blocks.push(blockText);
            }
        }

        return blocks;
    }

    private async _retryFixEntity(
        entityType: string,
        name: string,
        currentContent: string,
        missingFields: string[],
        frontmatterKeys: readonly string[],
        worldview: string,
        customSystemPrompt?: string
    ): Promise<BatchEntityResult | null> {
        const systemPrompt = customSystemPrompt || `你是专业的${entityType}设定师。请补全以下不完整的${entityType}卡片。

【补全硬性要求】
1. 只输出补全后的完整${entityType}卡片，不要额外解释、不要代码围栏
2. 必须保留并补全 YAML frontmatter，且以 --- 开始、以 --- 关闭
3. 以下 YAML 字段必须全部存在且有具体内容：${frontmatterKeys.join('、')}
4. 以下缺失字段/分节必须全部补齐，禁止输出"待补充"、"未知"、"无"、省略号或空值
5. 正文必须包含以下 ${ENTITY_BODY_SECTIONS.length} 个二级标题分节，且每节都要有实质内容（不能只有标题）：
${ENTITY_BODY_SECTIONS.map((s, i) => `${i + 1}. ## ${s}`).join('\n')}
6. 补全内容需与世界观一致，优先补齐结构完整性，再追求文采

【缺失的字段/分节】
${missingFields.map((f, i) => `${i + 1}. ${f}`).join('\n')}

【当前不完整的${entityType}卡片】
${currentContent.slice(0, 2600)}`;

        const userPrompt = `请补全这个${entityType}：${name}

【世界观参考】
${worldview.slice(0, 1800)}

请一次性输出完整且可通过校验的${entityType}卡片。`;

        try {
            const response = await this.apiClient.callAI(
                systemPrompt,
                userPrompt,
                this.plugin.settings.proModel || this.plugin.settings.defaultModel,
                0.35,
                Math.max(4096, this.plugin.settings.maxOutput || 0)
            );

            if (response.error || !response.content) return null;

            const blocks = this._splitEntityBlocks(stripCodeFence(response.content));
            if (blocks.length === 0) return null;

            let content = (blocks.find(block => block.includes(name)) || blocks[0]).trim();
            if (!content.startsWith('---')) {
                content = '---\n' + content;
            }

            const validation = this._getValidateFn(entityType)(content);
            if (!validation.valid) {
                log.warn(`[批量生成${entityType}] 补全结果仍不完整：${name}，缺失 ${validation.missingFields.join('、')}`);
                return null;
            }

            return { name, content };
        } catch (e: unknown) {
            const errMsg = e instanceof Error ? e.message : String(e);
            log.error(`[批量生成${entityType}] 补全 "${name}" 失败:`, errMsg);
            new Notice(`❌ 补全"${name}"失败: ${errMsg}`, 5000);
            return null;
        }
    }

    private async _retryFixEntitiesBatch(
        entityType: string,
        incompleteEntities: { name: string; content: string; missing: string[] }[],
        frontmatterKeys: readonly string[],
        worldview: string,
        customSystemPrompt?: string
    ): Promise<BatchEntityResult[]> {
        if (incompleteEntities.length <= 1) return [];

        const entitiesList = incompleteEntities.map((inc, i) => {
            return `### ${i + 1}. ${inc.name}
【缺失字段】${inc.missing.join('、')}
【当前不完整内容】
${inc.content.slice(0, 800)}`;
        }).join('\n\n');

        const systemPrompt = customSystemPrompt || `你是专业的${entityType}设定师。请批量补全以下不完整的${entityType}卡片。

【补全硬性要求】
1. 只输出补全后的完整${entityType}卡片，不要额外解释、不要代码围栏
2. 每个卡片必须以 --- 开始，包含完整的 YAML frontmatter（字段：${frontmatterKeys.join('、')}）
3. 卡片之间用 "---CARD_SEPARATOR---" 分隔
4. 所有缺失字段必须全部补齐，禁止输出"待补充"、"未知"、"无"、省略号或空值
5. 正文必须包含以下 ${ENTITY_BODY_SECTIONS.length} 个二级标题分节，且每节都要有实质内容（不能只有标题）：
${ENTITY_BODY_SECTIONS.map((s, i) => `${i + 1}. ## ${s}`).join('\n')}
6. 补全内容需与世界观一致`;

        const userPrompt = `【批量补全任务】
以下 ${incompleteEntities.length} 个${entityType}卡片不完整，请一次性全部补全。
每个卡片必须以 --- 开始，包含完整的 YAML frontmatter。
卡片之间用 "---CARD_SEPARATOR---" 分隔。

${entitiesList}

【世界观参考】
${worldview.slice(0, 1800)}

请一次性输出所有补全后的${entityType}卡片。`;

        try {
            const response = await this.apiClient.callAI(
                systemPrompt,
                userPrompt,
                this.plugin.settings.proModel || this.plugin.settings.defaultModel,
                0.35,
                Math.max(4096, this.plugin.settings.maxOutput || 0)
            );

            if (response.error || !response.content) return [];

            const cards = stripCodeFence(response.content).split('---CARD_SEPARATOR---');
            const results: BatchEntityResult[] = [];
            for (const card of cards) {
                let content = card.trim();
                if (!content) continue;
                if (!content.startsWith('---')) content = '---\n' + content;
                const yaml = content.match(/^---\s*\n([\s\S]*?)\n---/);
                let name = '';
                if (yaml) {
                    const nameMatch = yaml[1].match(/^(?:名称|name)\s*:\s*(.+)$/m);
                    if (nameMatch) name = nameMatch[1].trim();
                }
                if (!name) {
                    const titleMatch = content.match(/^#\s+(.+)$/m);
                    if (titleMatch) name = titleMatch[1].trim();
                }
                if (name && content) {
                    results.push({ name, content });
                }
            }
            return results;
        } catch {
            return [];
        }
    }
}
