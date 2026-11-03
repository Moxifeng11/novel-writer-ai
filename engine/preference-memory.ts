 /**
 * preference-memory.ts — 偏好记忆引擎
 * 
 * 功能：长期记忆用户写作偏好
 * 对应优化方向：E3
 */
 
 import { App } from 'obsidian';
import { FileSystemPort, ObsidianFileSystem } from '@/shared/file-system-port';
import { pluginDataDir, pluginPreferenceFile } from '@/shared/paths';
import { SerializedWriter } from '@/shared/serialized-writer';
import type { NovelWriterPluginAPI } from '@/plugin-api';
import { createLogger } from '@/shared/logger';
 

const log = createLogger('PreferenceMemory');
/**
 * UserPreference 类型定义。
 */
 export interface UserPreference {
     id: string;
     category: 'character' | 'plot' | 'style' | 'pacing' | 'dialogue' | 'description';
     key: string;
     value: any;
     confidence: number;
     source: 'explicit' | 'learned' | 'inferred';
     lastUpdated: number;
     usageCount: number;
 }
 
/**
 * PreferenceMemoryOptions 类型定义。
 */
 export interface PreferenceMemoryOptions {
     app: App;
     plugin: NovelWriterPluginAPI;
     project: string;
 }
 
/**
 * PreferenceMemory 类。
 */
 export class PreferenceMemory {
    private app: App;
    private plugin: NovelWriterPluginAPI;
    private project: string;
    private preferences: Map<string, UserPreference> = new Map();
    private dataPath: string;
    private fs: FileSystemPort | null = null;
    /** 上次加载时读/解析失败：首次保存前必须留档原文件，避免整体覆盖历史偏好 */
    private loadFailed = false;

    /** 串行写入器，保证写入顺序和原子性 */
    private writer = new SerializedWriter({ debug: false });
     
     constructor(opts: PreferenceMemoryOptions) {
         this.app = opts.app;
         this.plugin = opts.plugin;
         this.project = opts.project;
         this.dataPath = pluginPreferenceFile(opts.project);
     }

     /** 获取 FileSystemPort 实例（懒加载） */
     private getFS(): FileSystemPort {
         if (!this.fs) {
             this.fs = new ObsidianFileSystem(this.app);
         }
         return this.fs;
     }
     
     /**
      * 记录偏好
      * @param category - 分类
      * @param key - 键
      * @param value - 值
      * @param source - 来源
      */
     async recordPreference(
         category: UserPreference['category'],
         key: string,
         value: any,
         source: UserPreference['source'] = 'learned'
     ): Promise<void> {
         const id = `${category}:${key}`;
         const existing = this.preferences.get(id);
         
         if (existing) {
             existing.value = value;
             existing.confidence = Math.min(1, existing.confidence + 0.1);
             existing.lastUpdated = Date.now();
             existing.usageCount++;
         } else {
             this.preferences.set(id, {
                 id,
                 category,
                 key,
                 value,
                 confidence: 0.5,
                 source,
                 lastUpdated: Date.now(),
                 usageCount: 1
             });
         }
         
         await this.savePreferences();
         log.info('[PreferenceMemory] E3: 记录偏好:', id, value);
     }
     
     /**
      * 获取偏好
      * @param category - 分类
      * @param key - 键
       * @returns UserPreference 或 undefined
      */
     getPreference(category: string, key: string): UserPreference | undefined {
         return this.preferences.get(`${category}:${key}`);
     }
     
     /**
      * 获取某类别的所有偏好
      * @param category - 分类
      * @returns 结果数组
      */
     getAllPreferences(category?: UserPreference['category']): UserPreference[] {
         const all = Array.from(this.preferences.values());
         return category ? all.filter(p => p.category === category) : all;
     }
     
     /**
      * 生成偏好提示词
      * @returns 文本结果
      */
     generatePreferencePrompt(): string {
         const prefs = this.getAllPreferences()
             .filter(p => p.confidence > 0.6)
             .sort((a, b) => b.confidence - a.confidence);
         
         if (prefs.length === 0) return '';
         
         let prompt = '【用户写作偏好】\n';
         
         const grouped = this.groupByCategory(prefs);
         
         for (const [category, items] of Object.entries(grouped)) {
             const categoryLabel = this.getCategoryLabel(category);
             prompt += `\n${categoryLabel}：\n`;
             for (const item of items.slice(0, 3)) {
                 prompt += `- ${item.key}: ${JSON.stringify(item.value)}\n`;
             }
         }
         
         return prompt;
     }
     
     /**
      * 按类别分组
      */
     private groupByCategory(prefs: UserPreference[]): Record<string, UserPreference[]> {
         const grouped: Record<string, UserPreference[]> = {};
         
         for (const pref of prefs) {
             if (!grouped[pref.category]) {
                 grouped[pref.category] = [];
             }
             grouped[pref.category].push(pref);
         }
         
         return grouped;
     }
     
     /**
      * 获取类别标签
      */
     private getCategoryLabel(category: string): string {
         const labels: Record<string, string> = {
             character: '人物塑造',
             plot: '情节设计',
             style: '文风偏好',
             pacing: '节奏控制',
             dialogue: '对话风格',
             description: '描写偏好'
         };
         return labels[category] || category;
     }
     
     /**
      * 加载已保存的偏好。
      *
      * 「文件不存在」与「读取/解析失败」必须区分：旧实现把两者都当成「没有偏好」，
      * 读失败后用户采纳一条建议就会用只含新偏好的对象整体覆盖原文件，
      * 长期积累的偏好一次性丢失。
      */
     async loadPreferences(): Promise<void> {
         const fs = this.getFS();
         let exists = true;
         try {
             exists = await fs.exists(this.dataPath);
         } catch {
             // 探测失败按「存在」处理，走保守路径
             exists = true;
         }
         if (!exists) {
             log.info('[PreferenceMemory] E3: 无已保存的偏好');
             return;
         }
         try {
             const data = await fs.read(this.dataPath);
             const parsed = JSON.parse(data);
             this.preferences = new Map(Object.entries(parsed));
             this.loadFailed = false;
             log.info('[PreferenceMemory] E3: 加载了', this.preferences.size, '个偏好');
         } catch (e) {
             this.loadFailed = true;
             log.warn('[PreferenceMemory] E3: 偏好文件读取失败，本次不覆盖磁盘:', e);
         }
     }
     
     /**
     * 保存偏好（通过串行写入器，保证原子性）
     */
    private async savePreferences(): Promise<void> {
        // 使用 enqueueAutoClean，自动在成功后清除脏标记
        await this.writer.enqueueAutoClean(async () => {
            const fs = this.getFS();
            if (this.loadFailed) {
                // 读失败后的第一次保存：先把原文件改名留档，
                // 否则下面的整体覆盖会抹掉读不到的历史偏好
                try {
                    await fs.rename(this.dataPath, `${this.dataPath}.corrupt-${Date.now()}.bak`);
                    log.warn('[PreferenceMemory] E3: 原偏好文件已留档，后续保存写入新文件');
                } catch (e) {
                    log.warn('[PreferenceMemory] E3: 留档失败，继续写入:', e);
                }
                this.loadFailed = false;
            }
            const data = Object.fromEntries(this.preferences);
            await fs.mkdir(pluginDataDir()).catch(() => undefined);
            await fs.write(this.dataPath, JSON.stringify(data, null, 2));
        }).catch(e => {
            log.warn('[PreferenceMemory] E3: 保存失败:', e);
        });
    }

    /**
     * 等待所有待处理的写入操作完成
     */
    async flush(): Promise<void> {
        await this.writer.flush();
    }

    /**
     * 检查是否有待处理的写入
     * @returns 是否成功
     */
    get hasPendingWrites(): boolean {
        return this.writer.isDirty;
    }
     
     /**
      * 清除所有偏好
      */
     async clearPreferences(): Promise<void> {
         this.preferences.clear();
         await this.savePreferences();
     }
     
     /**
      * 导出偏好（用于迁移或备份）
      * @returns 文本结果
      */
     exportPreferences(): string {
         return JSON.stringify(Object.fromEntries(this.preferences), null, 2);
     }
     
     /**
      * 导入偏好
      * @param json - JSON
      */
     async importPreferences(json: string): Promise<void> {
         try {
             const parsed = JSON.parse(json);
             for (const [id, pref] of Object.entries(parsed)) {
                 this.preferences.set(id, pref as UserPreference);
             }
             await this.savePreferences();
         } catch (e) {
             log.warn('[PreferenceMemory] E3: 导入失败:', e);
         }
     }
 }
