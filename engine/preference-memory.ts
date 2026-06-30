 /**
 * preference-memory.ts — 偏好记忆引擎
 * 
 * 功能：长期记忆用户写作偏好
 * 对应优化方向：E3
 */
 
 import { App } from 'obsidian';
import { FileSystemPort, ObsidianFileSystem } from '../shared/file-system-port';
import { pluginDataDir, pluginPreferenceFile } from '../shared/paths';
import { SerializedWriter } from '../shared/serialized-writer';
import type { NovelWriterPluginAPI } from '../shared/plugin-api';
 
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
 
 export interface PreferenceMemoryOptions {
     app: App;
     plugin: NovelWriterPluginAPI;
     project: string;
 }
 
 export class PreferenceMemory {
    private app: App;
    private plugin: NovelWriterPluginAPI;
    private project: string;
    private preferences: Map<string, UserPreference> = new Map();
    private dataPath: string;
    private fs: FileSystemPort | null = null;

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
         console.log('[PreferenceMemory] E3: 记录偏好:', id, value);
     }
     
     /**
      * 获取偏好
      */
     getPreference(category: string, key: string): UserPreference | undefined {
         return this.preferences.get(`${category}:${key}`);
     }
     
     /**
      * 获取某类别的所有偏好
      */
     getAllPreferences(category?: UserPreference['category']): UserPreference[] {
         const all = Array.from(this.preferences.values());
         return category ? all.filter(p => p.category === category) : all;
     }
     
     /**
      * 生成偏好提示词
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
      * 加载已保存的偏好
      */
     async loadPreferences(): Promise<void> {
         try {
             const data = await this.getFS().read(this.dataPath);
             const parsed = JSON.parse(data);
             this.preferences = new Map(Object.entries(parsed));
             console.log('[PreferenceMemory] E3: 加载了', this.preferences.size, '个偏好');
         } catch (e) {
             console.log('[PreferenceMemory] E3: 无已保存的偏好');
         }
     }
     
     /**
     * 保存偏好（通过串行写入器，保证原子性）
     */
    private async savePreferences(): Promise<void> {
        // 使用 enqueueAutoClean，自动在成功后清除脏标记
        await this.writer.enqueueAutoClean(async () => {
            const data = Object.fromEntries(this.preferences);
            await this.getFS().mkdir(pluginDataDir()).catch(() => undefined);
            await this.getFS().write(this.dataPath, JSON.stringify(data, null, 2));
        }).catch(e => {
            console.warn('[PreferenceMemory] E3: 保存失败:', e);
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
      */
     exportPreferences(): string {
         return JSON.stringify(Object.fromEntries(this.preferences), null, 2);
     }
     
     /**
      * 导入偏好
      */
     async importPreferences(json: string): Promise<void> {
         try {
             const parsed = JSON.parse(json);
             for (const [id, pref] of Object.entries(parsed)) {
                 this.preferences.set(id, pref as UserPreference);
             }
             await this.savePreferences();
         } catch (e) {
             console.warn('[PreferenceMemory] E3: 导入失败:', e);
         }
     }
 }
