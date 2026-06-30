import { App, TFile } from 'obsidian';
import NovelWriterPlugin from '../main';
import {
    WV_SECTIONS,
    WV_SECTION_FIELDS,
    WV_PROSE_MAX_LENGTH,
} from '../shared/format-constants';
import { validateWorldviewOutput } from '../shared/template-validator';
import { getWorldviewPath, getSettingLibPath, pjFanficDir } from '../shared/paths';
import { AIApiClient } from './ai-api-client';
import type { APIResponse } from './ai-engine';
import { TemplateService } from '../services/template-service';

import type { Notifier } from '../shared/types';
import { NOOP_NOTIFIER } from '../shared/types';
import { NOTICE_ERROR } from '../shared/thresholds';
import type { FileSystemPort, VaultMetaPort } from '../shared/file-system-port';
import { ObsidianFileSystem, ObsidianVaultMeta } from '../shared/file-system-port';

export class WorldviewGenerator {
    private plugin: NovelWriterPlugin;
    private notifier: Notifier;
    private apiClient: AIApiClient;
    private templateService: TemplateService;
    private fs: FileSystemPort | null = null;
    private vaultMeta: VaultMetaPort | null = null;

    constructor(plugin: NovelWriterPlugin, apiClient: AIApiClient, notifier?: Notifier) {
        this.notifier = notifier || NOOP_NOTIFIER;
        this.plugin = plugin;
        this.apiClient = apiClient;
        this.templateService = new TemplateService(plugin.app);
    }

    private getFS(): FileSystemPort {
        if (!this.fs) {
            this.fs = new ObsidianFileSystem(this.plugin.app);
        }
        return this.fs;
    }

    private getVaultMeta(): VaultMetaPort {
        if (!this.vaultMeta) {
            this.vaultMeta = new ObsidianVaultMeta(this.plugin.app);
        }
        return this.vaultMeta;
    }

    async generateWorldviewSkeleton(
        worldName: string,
        projectName: string,
        genre: string,
        theme: string,
        customPrompt?: string
    ): Promise<APIResponse> {
        const defaultSystemPrompt = `你是专业的世界观设计师。你只负责输出世界观9个模块的概要骨架，不需要输出详细的设定内容。

【不可违反的输出契约】
你必须严格按照以下字段清单输出，每个字段使用 "- **字段名**：值" 格式。
禁止使用连续叙述段落代替要点格式。
禁止任何字段超过 ${WV_PROSE_MAX_LENGTH} 个连续中文字符无换行。
违反以上任何一项，输出将被判定为无效并重新生成。

【必须输出的9个模块及其字段清单】
${WV_SECTIONS.map(section => {
    const fields = WV_SECTION_FIELDS[section];
    if (fields.length === 0) {
        return `## ${section}\n（使用 ### 远古、### 近代、### 近期 三个子标题，每个子标题下至少一个 "- **关键事件**：值"）`;
    }
    const fieldList = fields.map(f => `- **${f}**：（概要）`).join('\n');
    return `## ${section}\n${fieldList}`;
}).join('\n\n')}

【输出格式要求——严格遵循】
1. 回答第一行必须是 "# 世界观总览"，不要用其他标题
2. 全部9个模块缺一不可
3. 历史大事记模块必须包含三个 ### 子标题：### 远古、### 近代、### 近期

不要输出详细的设定内容，详细设定将在后续逐模块生成中完成。`;

        const defaultUserPrompt = `请为以下小说规划世界观骨架（仅概要）。

【世界名称】${worldName}
【项目名称】${projectName}
【题材】${genre}
【要求】请为这个世界观设计一个小说/项目名称，用【项目名称】名称【/项目名称】格式放在回复第一行。
${theme ? `【主题】${theme}` : ''}`;

        const custom = await this.templateService.getCustomPrompt('worldviewSkeleton', {
            system: defaultSystemPrompt,
            user: defaultUserPrompt,
        });

        let userPrompt = custom.user;
        if (customPrompt && customPrompt.length > 0) {
            userPrompt += `\n\n【用户自定义要求】\n${customPrompt}`;
        }

        return this.apiClient.callAI(custom.system, userPrompt, this.plugin.settings.flashModel, 0.8, 4096);
    }

    async generateWorldviewModule(
        moduleName: string,
        skeleton: string,
        worldName: string,
        genre: string,
        customPrompt?: string
    ): Promise<APIResponse> {
        const moduleFields = WV_SECTION_FIELDS[moduleName] || [];
        const fieldListStr = moduleFields.length > 0
            ? moduleFields.map(f => `- **${f}**：值`).join('\n')
            : '（使用 ### 远古、### 近代、### 近期 三个子标题，每个子标题下至少一个 "- **关键事件**：值"）';

        const defaultSystemPrompt = `你是专业的世界观设计师。基于已有的世界观骨架，为指定模块生成详细的世界观设定。

【不可违反的输出契约】
你必须严格按照以下字段清单输出，每个字段使用 "- **字段名**：值" 格式。
禁止使用连续叙述段落代替要点格式。
禁止任何字段超过 ${WV_PROSE_MAX_LENGTH} 个连续中文字符无换行。
违反以上任何一项，输出将被判定为无效并重新生成。

【${moduleName}模块的必须输出字段清单】
${fieldListStr}

【输出格式要求——严格遵循】
- 每个要点一行，层次分明
- 只输出指定模块的详细内容
- 内容必须丰富、有层次、有细节
- 不要重复输出其他模块的内容
- 不要输出模块标题（系统会自动添加）`;

        const defaultUserPrompt = `基于以下世界观骨架，为【${moduleName}】模块生成详细的世界观设定。

【世界观骨架】
${skeleton.slice(0, 3000)}

【世界名称】${worldName}
【题材】${genre}
【目标模块】${moduleName}

请只输出${moduleName}模块的详细内容，不要输出其他模块。`;

        const custom = await this.templateService.getCustomPrompt('worldviewModule', {
            system: defaultSystemPrompt,
            user: defaultUserPrompt,
        });

        let userPrompt = custom.user;
        if (customPrompt && customPrompt.length > 0) {
            userPrompt += `\n\n【用户补充要求】\n${customPrompt}`;
        }

        return this.apiClient.callAI(custom.system, userPrompt, this.plugin.settings.flashModel, 0.8, this.plugin.settings.maxOutput);
    }

    async generateWorldview(
        worldName: string,
        projectName: string,
        genre: string,
        theme: string,
        customPrompt?: string,
        onProgress?: (phase: string, current: number, total: number) => void
    ): Promise<APIResponse> {
        onProgress?.('skeleton', 0, WV_SECTIONS.length);
        console.log('[小说工坊] 瀑布式世界观 - Phase 1: 生成骨架');
        
        const skeletonResult = await this.generateWorldviewSkeleton(
            worldName, projectName, genre, theme, customPrompt
        );

        if (skeletonResult.error) {
            console.log('[小说工坊] 骨架生成失败，回退到单次生成');
            return this.generateWorldviewFallback(worldName, projectName, genre, theme, customPrompt);
        }

        const moduleNames = [...WV_SECTIONS];
        const foundModules = moduleNames.filter(m => skeletonResult.content.includes(m));
        
        if (foundModules.length < moduleNames.length) {
            console.log(`[小说工坊] 骨架仅包含${foundModules.length}/${moduleNames.length}个模块，回退到单次生成`);
            return this.generateWorldviewFallback(worldName, projectName, genre, theme, customPrompt);
        }

        console.log(`[小说工坊] 瀑布式世界观 - Phase 2: 逐模块生成 (共${foundModules.length}个)`);
        
        const moduleResults: { name: string; content: string }[] = [];

        for (let i = 0; i < foundModules.length; i++) {
            const moduleName = foundModules[i];
            onProgress?.('module', i + 1, foundModules.length);
            console.log(`[小说工坊] 生成模块: ${moduleName} (${i + 1}/${foundModules.length})`);

            const result = await this.generateWorldviewModule(
                moduleName,
                skeletonResult.content,
                worldName,
                genre,
                customPrompt
            );

            if (result.error) {
                console.error(`[小说工坊] 模块${moduleName}生成失败: ${result.error}`);
                return this.generateWorldviewFallback(worldName, projectName, genre, theme, customPrompt);
            }

            moduleResults.push({ name: moduleName, content: result.content });
        }

        const projectNameMatch = skeletonResult.content.match(/【项目名称】(.+?)【\/项目名称】/);
        const projectNameStr = projectNameMatch?.[1] || '';

        const moduleSections = moduleResults.map(r => `## ${r.name}\n${r.content}`).join('\n\n');

        const assembledContent = [
            projectNameStr ? `【项目名称】${projectNameStr}【/项目名称】\n` : '',
            moduleSections,
        ].join('\n');

        console.log(`[小说工坊] 瀑布式世界观完成！共${foundModules.length}个模块`);
        return { content: assembledContent };
    }

    private async generateWorldviewFallback(
        worldName: string,
        projectName: string,
        genre: string,
        theme: string,
        customPrompt?: string
    ): Promise<APIResponse> {
        const defaultSystemPrompt = `你是一位专业的世界观设计师。请根据题材和主题，设计完整的世界观设定。

【不可违反的输出契约】
你必须严格按照以下字段清单输出，每个字段使用 "- **字段名**：值" 格式。
禁止使用连续叙述段落代替要点格式。
禁止任何字段超过 ${WV_PROSE_MAX_LENGTH} 个连续中文字符无换行。
违反以上任何一项，输出将被判定为无效并重新生成。

【必须输出的9个模块及其字段清单】
${WV_SECTIONS.map(section => {
    const fields = WV_SECTION_FIELDS[section];
    if (fields.length === 0) {
        return `## ${section}\n（使用 ### 远古、### 近代、### 近期 三个子标题，每个子标题下至少一个 "- **关键事件**：值"）`;
    }
    const fieldList = fields.map(f => `- **${f}**：值`).join('\n');
    return `## ${section}\n${fieldList}`;
}).join('\n\n')}

【输出要求】
1. 必须在输出第一行用以下格式返回小说名称：
【项目名称】你的小说名称【/项目名称】
2. 小说名称应精炼、有吸引力、贴合题材和世界观设定
3. 之后按照上述9个模块输出完整世界观内容
4. 每个模块必须有详细内容，不得省略`;

        const defaultUserPrompt = `请为以下小说设计世界观设定。

【世界名称】${worldName}
【项目名称】${projectName}
【题材】${genre}
【要求】请为这个世界观设计一个小说/项目名称，用【项目名称】名称【/项目名称】格式放在回复第一行。
${theme ? `【主题】${theme}` : ''}`;

        const custom = await this.templateService.getCustomPrompt('worldviewFallback', {
            system: defaultSystemPrompt,
            user: defaultUserPrompt,
        });

        let userPrompt = custom.user;
        if (customPrompt && customPrompt.length > 0) {
            userPrompt += `\n\n【用户自定义要求】\n${customPrompt}`;
        }

        return this.apiClient.callAI(custom.system, userPrompt, this.plugin.settings.flashModel, 0.8, this.plugin.settings.maxOutput);
    }

    async generateWorldviewForProject(app: App, project: string, genre?: string, onProgress?: (phase: string, module?: string) => void): Promise<string> {
        const fs = this.getFS();
        const vaultMeta = this.getVaultMeta();
        const wvPath = getWorldviewPath(project);
        const file = vaultMeta.getAbstractFileByPath(wvPath);
        let existingContent = '';
        if (file instanceof TFile) {
            try {
                existingContent = await fs.read(wvPath);
            } catch {
                existingContent = '';
            }
        }
        
        const extractName = (field: string): string => {
            const m = existingContent.match(new RegExp(`^${field}:\\s*(.+)$`, 'm'));
            if (!m) return project.replace(/^.*\//, '');
            const raw = m[1].trim().replace(/^["']+|["']+$/g, '');
            if (!raw || raw === '—' || raw === '-' || /^\{\{.+\}\}$/.test(raw)) {
                return project.replace(/^.*\//, '');
            }
            return raw;
        };
        const worldName = extractName('世界名称');
        const projectName = extractName('项目名称');
        
        const adaptedProgress = (phase: string, current: number, total: number) => {
            if (onProgress) {
                if (phase === 'module') {
                    onProgress(phase, `模块 ${current}/${total}`);
                } else {
                    onProgress(phase);
                }
            }
        };
        
        let result = await this.generateWorldview(worldName, projectName, genre || '玄幻', '', undefined, adaptedProgress);
        
        if (!result.error && result.content) {
            let validation = validateWorldviewOutput(result.content);
            let retryCount = 0;
            const maxRetries = 2;
            
            while (!validation.valid && retryCount < maxRetries) {
                console.log(`[小说工坊] 世界观输出校验失败，缺失字段: ${validation.missingFields.join(', ')}，重试 ${retryCount + 1}/${maxRetries}`);
                
                const fixPrompt = `⚠️ 上次生成的世界观输出未通过校验，缺少以下字段：\n${validation.missingFields.map(f => `- ${f}`).join('\n')}\n\n请重新生成完整的世界观设定，确保所有缺失字段均已补充。`;
                
                result = await this.generateWorldviewFallback(worldName, projectName, '玄幻', '', fixPrompt);
                
                if (result.error) break;
                
                validation = validateWorldviewOutput(result.content);
                retryCount++;
            }
            
            if (!validation.valid) {
                console.warn(`[小说工坊] 世界观校验${retryCount >= maxRetries ? '超过最大重试次数，接受当前输出' : '失败'}，缺失: ${validation.missingFields.join(', ')}`);
            }
        }
        
        if (!result.error && result.content) {
            const genNameMatch = result.content.match(/【项目名称】(.+?)【\/项目名称】/);
            const genProjectName = genNameMatch?.[1]?.trim() || projectName;

            if (file instanceof TFile) {
                const fmLines = (existingContent.match(/---\n([\s\S]*?)---/) || ['', ''])[1]
                    .split('\n')
                    .map(line => {
                        if (/^(世界名称)\s*:/.test(line)) return `世界名称: "${worldName}"`;
                        if (/^(项目名称)\s*:/.test(line)) return `项目名称: "${genProjectName}"`;
                        return line;
                    })
                    .join('\n');
                const content = `---\n${fmLines}---\n\n${result.content}`;
                await fs.write(wvPath, content);
            } else {
                const freshFm = `---\n世界名称: "${worldName}"\n项目名称: "${genProjectName}"\ntags: [世界观]\n世界类型:\n创作阶段: 世界观设定\n---\n\n${result.content}`;
                await fs.write(wvPath, freshFm);
            }
        }
        
        return result.error ? '' : result.content || '';
    }

    async generateSettingLibForProject(app: App, project: string): Promise<string> {
        const fs = this.getFS();
        const vaultMeta = this.getVaultMeta();
        const wvPath = getWorldviewPath(project);
        const wvFile = vaultMeta.getAbstractFileByPath(wvPath);
        let worldView = '';
        if (wvFile instanceof TFile) {
            try {
                worldView = await fs.read(wvPath);
            } catch {
                worldView = '';
            }
        }

        if (!worldView) {
            this.notifier.showNotice('⚠️ 未找到世界观总览，无法生成设定库', NOTICE_ERROR);
            return '';
        }

        const slPath = getSettingLibPath(project);
        const existingFile = vaultMeta.getAbstractFileByPath(slPath);
        let existingContent = '';
        if (existingFile instanceof TFile) {
            try {
                existingContent = await fs.read(slPath);
            } catch {
                existingContent = '';
            }
        }

        const defaultSystemPrompt = `你是一位资深设定架构师。基于给定的世界观设定，提炼出一份结构化的设定库，供后续写作时快速查阅。

【输出格式——严格遵循以下 8 大模块名称，不得修改】
---
tags: [设定库]
---

# 设定库

## 一、世界观底层规则
### 物理法则
- **基础法则**：
- **时空特性**：
- **因果/命运规则**：

## 二、核心设定（不可变更）
### 力量体系详情
- **力量类型**：
- **等级划分**：
- **修炼/成长路径**：
- **上限与代价**：

## 三、力量体系详情
（表格形式）
| 体系名称 | 类型 | 等级数量 | 最高等级 | 修炼方式 | 核心资源 |
|---------|------|---------|---------|---------|---------|

## 四、科技水平
- **整体技术水平**：
- **特殊技术/发明**：
- **科技与社会的关系**：

## 五、势力分布
（表格形式）
| 势力名称 | 类型 | 规模 | 核心人物 | 势力范围 | 与其他势力关系 |
|---------|------|------|---------|---------|--------------|

## 六、地理/区域
（表格形式）
| 区域名称 | 地理特征 | 所属势力 | 特殊资源 | 战略意义 | 气候环境 |
|---------|---------|---------|---------|---------|---------|

## 七、关键历史事件
- **时代划分**：
- **重大事件时间线**：
- **传说与神话**：

## 八、当前故事阶段
- **故事起点**：
- **当前势力格局**：
- **关键冲突**：
- **暗流涌动趋势**：

【核心要求】
1. 从世界观原文中提取关键信息填充各模块，不做无依据的杜撰
2. 若某模块缺失信息，在表格中至少填充一行或标注"（待补充）"而非编造
3. 带表格的模块必须有至少 3 行有效数据行
4. 保持条目式、可快速扫描的格式
5. 语言风格与世界观保持一致`;

        const defaultUserPrompt = `请基于以下世界观设定，生成结构化的设定库：

【世界观原文】
${worldView.slice(0, 8000)}

${existingContent ? `\n【已有设定库（请保留其中非冲突内容，进行增量更新）】\n${existingContent.slice(0, 2000)}` : ''}`;

        const custom = await this.templateService.getCustomPrompt('settingLib', {
            system: defaultSystemPrompt,
            user: defaultUserPrompt,
        });

        const result = await this.apiClient.callAI(custom.system, custom.user, this.plugin.settings.proModel, 0.6, this.plugin.settings.maxOutput);

        if (result.error || !result.content) {
            return '';
        }

        const content = result.content;
        if (existingFile instanceof TFile) {
            await fs.write(slPath, content);
        } else {
            await fs.write(slPath, content);
        }

        return content;
    }

    async generateFanficWorldviewForProject(app: App, project: string, onProgress?: (phase: string) => void): Promise<string> {
        const fs = this.getFS();
        const vaultMeta = this.getVaultMeta();
        const fanficDir = pjFanficDir(project);
        const ffFiles = await fs.listFiles(fanficDir);
        const ffFile = ffFiles.find((f: TFile) => f.name.endsWith('同人设定.md'));

        let fanficContent = '';
        if (ffFile) {
            try {
                fanficContent = await fs.read(ffFile.path);
            } catch {
                fanficContent = '';
            }
        }

        if (!fanficContent) {
            this.notifier.showNotice('⚠️ 未找到同人设定文件，请先完成「原作设定导入」步骤', NOTICE_ERROR);
            return '';
        }

        if (onProgress) onProgress('正在提取原作世界观...');

        const wvPath = getWorldviewPath(project);
        const wvFile = vaultMeta.getAbstractFileByPath(wvPath);
        let existingContent = '';
        if (wvFile instanceof TFile) {
            try {
                existingContent = await fs.read(wvPath);
            } catch {
                existingContent = '';
            }
        }

        const defaultSystemPrompt = `你是一位同人小说设定整理专家。请根据提供的原作设定和同人设定，整理出一份规范的世界观设定文档。

【输出格式——严格遵循】（保留模板中的 YAML frontmatter 不变）
请按照以下格式输出：
---
tags: [世界观]
世界名称:
项目名称:
世界类型:
创作阶段:
---
# 世界观总览

## 世界层级体系

## 原作力量体系

## 原作地理格局

## 原作势力格局

## 原作历史大事记

## 同人创作的特殊规则（与原作的差异/补充）

## 文化与社会

## 与主线关联

【核心要求】
1. 以上所有模块必须完整填充，从原作设定中提取信息
2. 若原作设定中某模块确实缺少信息，标注"（原作未明确，待作者设定）"
3. 同人规则模块需标注与原作的差异点
4. 使用条目式、清晰可读的格式
5. 严格基于提供的设定资料，不编造不存在的设定
6. 文化与社会模块需包含：社会结构、价值观念、风俗禁忌
7. 与主线关联模块需包含：世界观对主线的推动、世界观的潜在变化`;

        const defaultUserPrompt = `请根据以下同人设定整理世界观：

【同人设定原文】
${fanficContent.slice(0, 6000)}

${existingContent ? `【已有世界观（请保留frontmatter，仅更新正文内容）】\n${existingContent.slice(0, 1500)}` : ''}`;

        const custom = await this.templateService.getCustomPrompt('fanficWorldview', {
            system: defaultSystemPrompt,
            user: defaultUserPrompt,
        });

        if (onProgress) onProgress('AI 整理中...');
        const result = await this.apiClient.callAI(custom.system, custom.user, this.plugin.settings.proModel, 0.6, this.plugin.settings.maxOutput);

        if (result.error || !result.content) {
            return '';
        }

        if (wvFile instanceof TFile) {
            const fmMatch = existingContent.match(/---\n([\s\S]*?)---/);
            const fm = fmMatch ? fmMatch[1] : '';
            const newBody = result.content.replace(/^---[\s\S]*?---\n?/, '');
            const content = `---\n${fm}---\n\n${newBody}`;
            await fs.write(wvPath, content);
        } else {
            await fs.write(wvPath, result.content);
        }

        return result.content;
    }
}
