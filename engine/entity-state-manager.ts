/**
 * 实体状态管理器 v1.6.0
 * 功能：检测正文生成后的实体状态变更，自动写入 frontmatter 时间戳字段
 * 调用时机：Step 4（正文生成）完成后，由 full-writer-view.ts 触发
 */
import { App, TFile } from 'obsidian';
import { AIEngine } from './ai-engine';
import { getInvolvedEntities } from './chapter-context-builder';
import { CharacterFrontmatter, Notifier, NOOP_NOTIFIER } from '../shared/types';
import { NOTICE_ERROR, NOTICE_WARNING } from '../shared/thresholds';
import { withWriteLock } from './write-lock';
import { pjCharsDir } from '../shared/paths';
import { FileSystemPort, VaultMetaPort, ObsidianFileSystem, ObsidianVaultMeta } from '../shared/file-system-port';
import type { NovelWriterPluginAPI } from '../shared/plugin-api';

export interface EntityStateChange {
    /** 实体名称（人物名） */
    entityName: string;
    /** 新状态描述 */
    newStatus: string;
    /** 状态变更原因（简述） */
    reason: string;
    /** 检测置信度 0-1 */
    confidence: number;
}

export interface EntityStateManagerOptions {
    app: App;
    plugin: NovelWriterPluginAPI;
    aiEngine: AIEngine;
    notifier?: Notifier;
}

export class EntityStateManager {
    private app: App;
    private plugin: NovelWriterPluginAPI;
    private aiEngine: AIEngine;
    private notifier: Notifier;
    private fs: FileSystemPort | null = null;
    private vaultMeta: VaultMetaPort | null = null;

    constructor(opts: EntityStateManagerOptions) {
        this.app = opts.app;
        this.plugin = opts.plugin;
        this.aiEngine = opts.aiEngine;
        this.notifier = opts.notifier || NOOP_NOTIFIER;
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
     * @returns 检测到的状态变更列表
     */
    async detectStateChanges(
        bodyContent: string,
        project: string,
        chapterNum: number,
        chapterName: string,
    ): Promise<EntityStateChange[]> {
        const prompt = this.buildDetectPrompt(bodyContent, project);
        try {
            const response = await this.aiEngine.callAI(
                '',                          // systemPrompt: 不需要，prompt 已包含完整指令
                prompt,                      // userPrompt
                this.plugin.settings.flashModel,
                0.7,                        // temperature
                2000,                       // maxTokens
            );
            if (response.error) {
                console.warn('[EntityStateManager] AI 调用失败:', response.error);
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
            console.warn('[EntityStateManager] 状态检测失败:', e);
            this.notifier.showNotice('⚠️ 实体状态检测异常，角色数据可能未更新', NOTICE_ERROR);
            return [];
        }
    }

    /**
     * 将状态变更写入人物 frontmatter
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
        const mentionedNames = this.extractMentionedNames(bodyContent, project);
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

【任务】分析以下正文内容，检测每位角色的状态是否发生变化。
输出 JSON 数组（不要加 \`\`\` 包裹）：
[
  { "entityName": "角色名", "newStatus": "新状态描述", "reason": "变更原因简述", "confidence": 0.9 }
]

【规则】
1. 只有状态确实发生变化时才输出（战斗受伤、情绪重大改变、位置迁移、境界突破等）
2. 无明显变化的不输出
3. 一次最多检测 8 个角色
4. confidence：0.9=非常确定，0.7=比较确定，0.5=可能
5. newStatus 应简洁（≤30字），如"与遗迹守卫激战中受伤，左臂中剑"

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
        const folderPath = pjCharsDir(project);
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
            content = this.updateFrontmatterField(content, 'entity_last_changed_at', chapterName || `第${chapterNum}章`);
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
     * 更新 frontmatter 中的单个字段
     */
    private updateFrontmatterField(content: string, fieldName: string, value: string): string {
        const fieldRegex = new RegExp(`^(${fieldName}\\s*:).+$`, 'm');
        const newLine = `${fieldName}: ${value}`;

        if (fieldRegex.test(content)) {
            return content.replace(fieldRegex, `$1 ${value}`);
        } else {
            // 字段不存在，在 --- 后插入
            return content.replace(
                /^(---\s*\n)/m,
                `$1${newLine}\n`
            );
        }
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
    private extractMentionedNames(bodyContent: string, project: string): string[] {
        // 方案：从人物文件夹获取所有人名，检查是否在正文中出现
        const folderPath = pjCharsDir(project);
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


