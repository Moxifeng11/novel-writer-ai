/**
 * 实体状态管理器 v1.6.0
 * 功能：检测正文生成后的实体状态变更，自动写入 frontmatter 时间戳字段
 * 调用时机：Step 4（正文生成）完成后，由 full-writer-view.ts 触发
 */
import { App, TFile } from 'obsidian';
import { AIEngine } from './ai-engine';
import { getInvolvedEntities } from './chapter-context-builder';
import { CharacterFrontmatter, Notifier, NOOP_NOTIFIER } from '@/shared/types';
import { entityDir } from '@/shared/entity-reader';
import { NOTICE_ERROR, NOTICE_WARNING } from '@/shared/thresholds';
import { withWriteLock } from '@/shared/write-lock';
import { pjCharsDir } from '@/shared/paths';
import { FileSystemPort, VaultMetaPort, ObsidianFileSystem, ObsidianVaultMeta } from '@/shared/file-system-port';
import type { NovelWriterPluginAPI } from '@/plugin-api';
import type { CharacterRepository } from './repository';
import type { Character, CharacterProps } from './repository/domain/aggregates/character-aggregate';
import type { EngineRegistry } from './engine-registry';
import { createLogger } from '@/shared/logger';
import { setFrontmatterValue } from '@/shared/frontmatter';


const log = createLogger('EntityStateManager');
/** 实体变化类型（Task 12 六类扩展：人物状态/新地点/新道具/关系/新伏笔/已完成节点） */
export type EntityChangeType = 'character' | 'location' | 'prop' | 'relationship' | 'foreshadow' | 'plotNode';

/**
 * EntityStateChange 类型定义。
 */
export interface EntityStateChange {
    /** 实体名称（人物名/地名/道具名等） */
    entityName: string;
    /** 新状态描述 */
    newStatus: string;
    /** 状态变更原因（简述） */
    reason: string;
    /** 检测置信度 0-1 */
    confidence: number;
    /** 实体变化类型；缺省视为 character（向后兼容旧检测结果） */
    entityType?: EntityChangeType;
}

/**
 * EntityStateManagerOptions 类型定义。
 */
export interface EntityStateManagerOptions {
    app: App;
    plugin: NovelWriterPluginAPI;
    aiEngine: AIEngine;
    notifier?: Notifier;
    characterRepository?: CharacterRepository | null;
    engineRegistry?: EngineRegistry | null;
}

/**
 * EntityStateManager 类。
 */
export class EntityStateManager {
    private app: App;
    private plugin: NovelWriterPluginAPI;
    private aiEngine: AIEngine;
    private notifier: Notifier;
    private fs: FileSystemPort | null = null;
    private vaultMeta: VaultMetaPort | null = null;

    // Task 2.1: Repository 接入
    private characterRepo: CharacterRepository | null = null;
    private engineRegistry: EngineRegistry | null = null;

    // 性能埋点统计
    private repoPerfStats = {
        totalAccesses: 0,
        readHits: 0,
        readMisses: 0,
        writeHits: 0,
        writeMisses: 0,
    };

    constructor(opts: EntityStateManagerOptions) {
        this.app = opts.app;
        this.plugin = opts.plugin;
        this.aiEngine = opts.aiEngine;
        this.notifier = opts.notifier || NOOP_NOTIFIER;
        if (opts.characterRepository) {
            this.characterRepo = opts.characterRepository;
        }
        if (opts.engineRegistry) {
            this.engineRegistry = opts.engineRegistry;
        }
    }

    /**
     * 获取 Repository 性能统计
      * @returns typeof this.repoPerfStats 结果
     */
    getRepositoryPerfStats(): typeof this.repoPerfStats {
        return { ...this.repoPerfStats };
    }

    /**
     * 重置 Repository 性能统计
     */
    resetRepositoryPerfStats(): void {
        this.repoPerfStats = {
            totalAccesses: 0,
            readHits: 0,
            readMisses: 0,
            writeHits: 0,
            writeMisses: 0,
        };
    }

    /**
     * 设置 CharacterRepository 实例
     * @param repo - 仓储
     */
    setCharacterRepository(repo: CharacterRepository | null): void {
        this.characterRepo = repo;
    }

    /**
     * 获取指定项目的 CharacterRepository
     * 优先使用已设置的实例，其次从 engineRegistry 获取
     */
    private getCharacterRepo(project: string): CharacterRepository | null {
        if (this.characterRepo) {
            return this.characterRepo;
        }
        if (this.engineRegistry && project) {
            try {
                const repo = this.engineRegistry.getCharacterRepository(project);
                this.characterRepo = repo;
                return repo;
            } catch {
                // 忽略错误，返回 null
            }
        }
        // 尝试从 plugin 获取 engineRegistry（plugin-api 已声明该字段；运行时仍做空值守卫）
        try {
            const registry = this.plugin.engineRegistry;
            if (registry && project) {
                const repo = registry.getCharacterRepository(project);
                this.characterRepo = repo;
                return repo;
            }
        } catch {
            // 忽略错误
        }
        return null;
    }

    /** 获取 FileSystemPort 实例（懒加载） */
    private getFS(): FileSystemPort {
        if (!this.fs) {
            this.fs = new ObsidianFileSystem(this.app);
        }
        return this.fs;
    }

    /** 获取 VaultMetaPort 实例（懒加载） */
    private getVaultMeta(): VaultMetaPort {
        if (!this.vaultMeta) {
            this.vaultMeta = new ObsidianVaultMeta(this.app);
        }
        return this.vaultMeta;
    }

    // ============================================================
    // 公开 API
    // ============================================================

    /**
     * 从正文中检测实体状态变更
     * @param bodyContent 正文内容（纯文本）
     * @param project 当前项目名
     * @param chapterNum 当前章节号
     * @param options 模型与调用选项覆盖；协同写作传入协同模型，避免绕过本地模型配置
     * @param chapterName - 章节名
     * @returns 检测到的状态变更列表
     */
    async detectStateChanges(
        bodyContent: string,
        project: string,
        chapterNum: number,
        chapterName: string,
        options?: {
            model?: string;
            callOptions?: {
                signal?: AbortSignal;
                endpoint?: string;
                apiKey?: string;
                disableFallback?: boolean;
                numCtx?: number;
                allowKeyPrompt?: boolean;
            };
        },
    ): Promise<EntityStateChange[]> {
        const prompt = this.buildDetectPrompt(bodyContent, project);
        try {
            const response = await this.aiEngine.callAI(
                '',                          // systemPrompt: 不需要，prompt 已包含完整指令
                prompt,                      // userPrompt
                options?.model || this.plugin.settings.flashModel,
                0.7,                        // temperature
                2000,                       // maxTokens
                options?.callOptions,
            );
            if (response.error) {
                log.warn('[EntityStateManager] AI 调用失败:', response.error);
                this.notifier.showNotice('⚠️ 实体状态检测失败，角色数据可能未更新。请稍后手动重试。', NOTICE_WARNING);
                return [];
            }
            const text = (response.content || '').trim();
            // 提取 JSON（可能被 ```json ... ``` 包裹）
            const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/) || text.match(/([\[{][\s\S]*)/);
            const jsonStr = jsonMatch ? jsonMatch[1] || jsonMatch[0] : text;
            const parsed = JSON.parse(jsonStr);
            const changes: EntityStateChange[] = Array.isArray(parsed) ? parsed : (parsed.changes || []);
            // 校验 + 补充章节信息
            return changes
                .filter(c => c.entityName && c.newStatus)
                .map(c => ({
                    ...c,
                    confidence: c.confidence || 0.8,
                }));
        } catch (e) {
            log.warn('[EntityStateManager] 状态检测失败:', e);
            this.notifier.showNotice('⚠️ 实体状态检测异常，角色数据可能未更新', NOTICE_ERROR);
            return [];
        }
    }

    /**
     * 将状态变更写入人物 frontmatter
     * @param project - 项目（路径或对象）
     * @param changes - 变更
     * @param chapterNum - 章号
     * @param chapterName - 章节名
     */
    async applyStateChanges(
        project: string,
        changes: EntityStateChange[],
        chapterNum: number,
        chapterName: string,
    ): Promise<void> {
        for (const change of changes) {
            await this.applySingleChange(project, change, chapterNum, chapterName);
        }
    }

    /**
     * 更新章节正文文件的"涉及人物/地点/势力/物品功法" frontmatter
     * 基于正文内容自动扩展涉及实体索引
     * @param project - 项目（路径或对象）
     * @param chapterBodyPath - 章节正文路径
     * @param bodyContent - 正文内容
     */
    async updateInvolvedEntities(
        project: string,
        chapterBodyPath: string,
        bodyContent: string,
    ): Promise<void> {
        const bodyFile = this.getVaultMeta().getAbstractFileByPath(chapterBodyPath);
        if (!bodyFile || !(bodyFile instanceof TFile)) return;

        const content = await this.getFS().read(chapterBodyPath);
        const existing = getInvolvedEntities(this.app, bodyFile);

        // 从正文中提取人物名（基于 [[]] 链接 + 出现频率）
        const mentionedNames = await this.extractMentionedNames(bodyContent, project);
        const mergedChars = [...new Set([...existing.chars, ...mentionedNames])];

        // 只在确实有新增时才写入
        if (mergedChars.length > existing.chars.length) {
            const updated = this.updateFrontmatterArray(
                content,
                '涉及人物',
                mergedChars.map(n => `  - ${n}`)
            );
            await this.getFS().write(chapterBodyPath, updated);
        }
    }

    // ============================================================
    // 内部方法
    // ============================================================

    /**
     * 构建状态检测提示词
     */
    private buildDetectPrompt(bodyContent: string, project: string): string {
        return `你是一个小说实体状态变更检测器。

【任务】分析以下正文内容，检测以下六类变化：
1. character：人物状态变化（战斗受伤、情绪重大改变、位置迁移、境界突破等）
2. location：新地点（出现新的地名/场景）
3. prop：新道具（出现新的物品/功法/装备）
4. relationship：关系变化（人物之间关系建立/破裂/转变）
5. foreshadow：新伏笔（埋设新的悬念/线索）
6. plotNode：已完成节点（剧情节点完成/推进）

输出 JSON 数组（不要加 \`\`\` 包裹）：
[
  { "entityType": "character", "entityName": "角色名", "newStatus": "新状态描述", "reason": "变更原因简述", "confidence": 0.9 }
]

【规则】
1. 只有确实发生变化/出现新实体时才输出
2. 无明显变化的不输出
3. 一次最多检测 12 项
4. confidence：0.9=非常确定，0.7=比较确定，0.5=可能
5. newStatus 应简洁（≤30字），如"与遗迹守卫激战中受伤，左臂中剑"
6. entityType 必须是上述六类之一（character/location/prop/relationship/foreshadow/plotNode）

【正文内容】（前 6000 字）：
${bodyContent.slice(0, 6000)}

【输出】仅输出 JSON 数组：`;
    }

    /**
     * 将单条状态变更写入人物文件
     */
    private async applySingleChange(
        project: string,
        change: EntityStateChange,
        chapterNum: number,
        chapterName: string,
    ): Promise<void> {
        const repo = this.getCharacterRepo(project);

        // Task 2.1: 优先通过 CharacterRepository 更新
        if (repo) {
            this.repoPerfStats.totalAccesses++;
            try {
                const allChars = await repo.findAll();
                const targetChar = allChars.find(c => c.name === change.entityName);
                if (targetChar) {
                    this.repoPerfStats.writeHits++;
                    // 使用 Repository 的 save 方法更新（会自动更新缓存）
                    const updatedChar = this.updateCharacterWithStateChange(targetChar, change, chapterNum, chapterName);
                    await repo.save(updatedChar);
                    log.info('[EntityStateManager] 通过 Repository 更新状态:', change.entityName);
                    return;
                } else {
                    this.repoPerfStats.writeMisses++;
                }
            } catch (e) {
                log.warn('[EntityStateManager] Repository 更新失败，回退到文件操作:', e);
                this.repoPerfStats.writeMisses++;
            }
        }

        // Fallback: 原有的文件直接读写方式
        const folderPath = entityDir(project, 'characters');
        const files = this.getVaultMeta().getFiles().filter(f =>
            f.path.startsWith(folderPath) && f instanceof TFile
        );

        // 查找匹配的人物文件
        let targetFile: TFile | null = null;
        for (const f of files) {
            const fm = this.app.metadataCache.getFileCache(f)?.frontmatter;
            if (!fm) continue;
            const name = fm['姓名'] || fm['名称'] || fm['name'] || '';
            if (name === change.entityName) {
                targetFile = f;
                break;
            }
        }

        if (!targetFile) return;

        // v3.4.6 跨模块写入保护：与 settlement-engine 共用文件级锁
        const filePath = targetFile.path;
        await withWriteLock(filePath, async () => {
            let content = await this.getFS().read(filePath);
            const now = new Date().toISOString();

            // 更新"当前状态"字段
            content = this.updateFrontmatterField(content, '当前状态', change.newStatus);

            // v4.0：以 entity_* 系列字段为唯一权威来源（旧"状态更新*"已弃用，不再写入）
            // item6-a（2026-11-10 审计）：entity_last_changed_at 统一 ISO 语义，章名入 chapter 字段
            content = this.updateFrontmatterField(content, 'entity_last_changed_at', now);
            content = this.updateFrontmatterField(content, 'entity_last_changed_chapter', chapterName || `第${chapterNum}章`);
            content = this.updateFrontmatterField(content, 'entity_last_changed_reason', change.reason);
            if (!content.match(/^entity_status:/m)) {
                content = this.updateFrontmatterField(content, 'entity_status', 'active');
            }
            if (!content.match(/^entity_created_at:/m)) {
                content = this.updateFrontmatterField(content, 'entity_created_at', now);
            }

            await this.getFS().write(filePath, content);
        });
    }

    /**
     * 使用 Character 聚合根的方式更新状态
     */
    private updateCharacterWithStateChange(
        char: Character,
        change: EntityStateChange,
        chapterNum: number,
        chapterName: string,
    ): Character {
        // 由于 Character 是不可变对象，我们通过 toJSON 获取所有属性，更新后重新创建
        const charData = char.toJSON();
        
        // 更新 frontmatter 中的字段
        if (charData.frontmatter) {
            charData.frontmatter['当前状态'] = change.newStatus;
            // item6-a：ISO 语义统一；章名入 entity_last_changed_chapter
            charData.frontmatter['entity_last_changed_at'] = new Date().toISOString();
            charData.frontmatter['entity_last_changed_chapter'] = chapterName || `第${chapterNum}章`;
            charData.frontmatter['entity_last_changed_reason'] = change.reason;
            if (!charData.frontmatter['entity_status']) {
                charData.frontmatter['entity_status'] = 'active';
            }
            if (!charData.frontmatter['entity_created_at']) {
                charData.frontmatter['entity_created_at'] = new Date().toISOString();
            }
        }

        // 更新属性
        charData.currentStatus = change.newStatus;
        charData.lastChangedAt = new Date().toISOString();
        charData.lastChangedReason = change.reason;

        // 使用 from 方法重新创建（Character 提供静态 from）
        const CharacterClass = char.constructor as typeof Character;
        if (typeof CharacterClass.from === 'function') {
            // toJSON 是聚合根自述快照（Record<string, any>），from 的入参是同一份 props
            return CharacterClass.from(charData as unknown as CharacterProps);
        }
        return char;
    }

    /**
     * 更新 frontmatter 中的单个字段
     */
    private updateFrontmatterField(content: string, fieldName: string, value: string): string {
        // 统一走 shared/frontmatter：空值行与历史重复键都能正确收敛（旧实现会插出重复键）
        return setFrontmatterValue(content, fieldName, value);
    }

    /**
     * 更新 frontmatter 中的数组字段（如"涉及人物"）
     */
    private updateFrontmatterArray(content: string, fieldName: string, lines: string[]): string {
        // 找到字段所在行，替换整个数组块
        const fieldRegex = new RegExp(`^(${fieldName}\\s*:\\s*\\n)((?:  - .+\\n)*)`, 'm');
        if (fieldRegex.test(content)) {
            return content.replace(fieldRegex, `$1${lines.join('\n')}\n`);
        }
        return content;
    }

    /**
     * 从正文中提取涉及的人物名
     */
    private async extractMentionedNames(bodyContent: string, project: string): Promise<string[]> {
        const repo = this.getCharacterRepo(project);

        // Task 2.1: 优先通过 CharacterRepository 获取人物列表（利用缓存）
        if (repo) {
            this.repoPerfStats.totalAccesses++;
            try {
                const chars = await repo.findAll();
                if (chars.length > 0) {
                    this.repoPerfStats.readHits++;
                    const names: string[] = [];
                    for (const char of chars) {
                        const name = char.name;
                        if (!name) continue;
                        const pattern = new RegExp(`(\\[\\[${name}\\]\\]|\`${name}\`|${this.escapeRegex(name)})`, 'g');
                        if (pattern.test(bodyContent)) {
                            names.push(name);
                        }
                    }
                    return names;
                } else {
                    this.repoPerfStats.readMisses++;
                }
            } catch {
                this.repoPerfStats.readMisses++;
            }
        }

        return this.extractMentionedNamesFallback(bodyContent, project);
    }

    /**
     * Fallback: 原有的文件直接读取方式
     */
    private extractMentionedNamesFallback(bodyContent: string, project: string): string[] {
        // 方案：从人物文件夹获取所有人名，检查是否在正文中出现
        const folderPath = entityDir(project, 'characters');
        const files = this.getVaultMeta().getFiles().filter(f =>
            f.path.startsWith(folderPath) && f instanceof TFile
        );

        const names: string[] = [];
        for (const f of files) {
            const fm = this.app.metadataCache.getFileCache(f)?.frontmatter;
            if (!fm) continue;
            const name = fm['姓名'] || fm['名称'] || fm['name'] || '';
            if (!name) continue;
            // 检查是否在正文中出现（支持 [[姓名]] 和纯文本）
            const pattern = new RegExp(`(\\[\\[${name}\\]\\]|\`${name}\`|${this.escapeRegex(name)})`, 'g');
            if (pattern.test(bodyContent)) {
                names.push(name);
            }
        }
        return names;
    }

    private escapeRegex(str: string): string {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
}


