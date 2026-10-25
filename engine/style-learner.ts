 /**
 * style-learner.ts — 风格自学习引擎
 * 
 * 功能：从用户修改中学习文风偏好
 * 对应优化方向：E1
 */
 
import { App } from 'obsidian';
import { AIEngine } from './ai-engine';
import { extractResponseText } from '../shared/api-response-utils';
import { FileSystemPort, ObsidianFileSystem } from '../shared/file-system-port';
import { pluginDataDir, pluginStylePatternsFile } from '../shared/paths';
import { SerializedWriter } from '../shared/serialized-writer';
import type { NovelWriterPluginAPI } from '../shared/plugin-api';
import { createLogger } from '../shared/logger';
 

const log = createLogger('StyleLearner');
 export interface StylePattern {
     id: string;
     type: 'vocabulary' | 'sentence' | 'paragraph' | 'tone';
     pattern: string;
     frequency: number;
     userPreference: number;  // -1 to 1
     examples: string[];
     learnedAt: number;
 }
 
 export interface StyleDiff {
     changes: TextChange[];
 }
 
 export interface TextChange {
     type: 'replace' | 'add' | 'delete';
     original: string;
     modified: string;
     context: string;
 }
 
 export interface StyleLearningResult {
     newPatterns: StylePattern[];
     totalPatterns: number;
 }
 
 export interface StyleLearnerOptions {
     app: App;
     aiEngine: AIEngine;
     plugin: NovelWriterPluginAPI;
     project: string;
 }
 
 export class StyleLearner {
    private app: App;
    private aiEngine: AIEngine;
    private plugin: NovelWriterPluginAPI;
    private project: string;
    private patterns: Map<string, StylePattern> = new Map();
    private dataPath: string;
    private fs: FileSystemPort | null = null;

    /** 串行写入器，保证写入顺序和原子性 */
    private writer = new SerializedWriter({ debug: false });
     
     constructor(opts: StyleLearnerOptions) {
         this.app = opts.app;
         this.aiEngine = opts.aiEngine;
         this.plugin = opts.plugin;
         this.project = opts.project;
         this.dataPath = pluginStylePatternsFile(opts.project);
     }

     /** 获取 FileSystemPort 实例（懒加载） */
     private getFS(): FileSystemPort {
         if (!this.fs) {
             this.fs = new ObsidianFileSystem(this.app);
         }
         return this.fs;
     }
     
     /**
      * 从用户编辑中学习
      */
     async learnFromEdit(
         original: string, 
         modified: string, 
         context: string
     ): Promise<StyleLearningResult> {
         // 分析修改差异
         const diff = this.analyzeDiff(original, modified);
         const newPatterns: StylePattern[] = [];
         
         for (const change of diff.changes) {
             // 提取风格模式
             const pattern = await this.extractPattern(change, context);
             
             if (pattern) {
                 const existing = this.patterns.get(pattern.id);
                 
                 if (existing) {
                     existing.frequency++;
                     existing.userPreference = Math.min(1, existing.userPreference + 0.1);
                     existing.examples.push(change.modified);
                     if (existing.examples.length > 5) existing.examples.shift();
                 } else {
                     this.patterns.set(pattern.id, pattern);
                     newPatterns.push(pattern);
                 }
             }
         }
         
         // 持久化
         await this.savePatterns();
         
         return {
             newPatterns,
             totalPatterns: this.patterns.size
         };
     }
     
     /**
      * 生成风格指南（用于注入提示词）
      */
     getStyleGuide(): string {
         const positive = Array.from(this.patterns.values())
             .filter(p => p.userPreference > 0.3)
             .sort((a, b) => b.userPreference - a.userPreference)
             .slice(0, 10);
         
         const negative = Array.from(this.patterns.values())
             .filter(p => p.userPreference < -0.3)
             .sort((a, b) => a.userPreference - b.userPreference)
             .slice(0, 5);
         
         if (positive.length === 0 && negative.length === 0) {
             return '';
         }
         
         let guide = '【作者风格偏好】\n';
         
         if (positive.length > 0) {
             guide += '偏好风格：\n' + positive.map(p => `- ${p.pattern}`).join('\n');
         }
         
         if (negative.length > 0) {
             guide += '\n避免风格：\n' + negative.map(p => `- ${p.pattern}`).join('\n');
         }
         
         return guide;
     }
     
     /**
      * 分析文本差异
      */
     private analyzeDiff(original: string, modified: string): StyleDiff {
         const changes: TextChange[] = [];
         
         // 简单差异检测（可升级为更复杂的 diff 算法）
         const origLines = original.split(/\n/);
         const modLines = modified.split(/\n/);
         
         for (let i = 0; i < Math.max(origLines.length, modLines.length); i++) {
             const origLine = origLines[i] || '';
             const modLine = modLines[i] || '';
             
             if (origLine !== modLine) {
                 if (origLine && !modLine) {
                     changes.push({
                         type: 'delete',
                         original: origLine,
                         modified: '',
                         context: (origLines[i-1] || '') + ' ' + (origLines[i+1] || '')
                     });
                 } else if (!origLine && modLine) {
                     changes.push({
                         type: 'add',
                         original: '',
                         modified: modLine,
                         context: (modLines[i-1] || '') + ' ' + (modLines[i+1] || '')
                     });
                 } else {
                     changes.push({
                         type: 'replace',
                         original: origLine,
                         modified: modLine,
                         context: ''
                     });
                 }
             }
         }
         
         return { changes };
     }
     
     /**
      * 从变更中提取风格模式
      */
     private async extractPattern(change: TextChange, context: string): Promise<StylePattern | null> {
         if (!change.modified || change.modified.length < 5) return null;
         
         // 使用 AI 提取风格特征
         const prompt = [
             '分析以下文本修改反映的写作风格偏好。',
             '',
             change.type === 'replace' 
                 ? `原文：${change.original}\n修改后：${change.modified}`
                 : `新增：${change.modified}`,
             '',
             '提取一个简洁的风格特征（10字以内），例如：',
             '- 喜用短句',
             '- 偏好动词开头',
             '- 避免形容词堆砌',
             '',
             '只返回风格特征描述：'
         ].join('\n');
         
         try {
             const response = await this.aiEngine.callAI(
                 '', 
                 prompt, 
                 this.plugin?.settings?.flashModel || this.plugin?.settings?.defaultModel || '', 
                 0.3, 
                 50
             );
             
             const patternText = extractResponseText(response);
             
             if (!patternText || patternText.length > 30) return null;
             
             return {
                 id: `style-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                 type: 'sentence',
                 pattern: patternText,
                 frequency: 1,
                 userPreference: 0.5, // 新模式默认偏好
                 examples: [change.modified],
                 learnedAt: Date.now()
             };
         } catch (e) {
             log.warn('[StyleLearner] E1: 模式提取失败:', e);
             return null;
         }
     }
     
     /**
      * 加载已保存的模式
      */
     async loadPatterns(): Promise<void> {
         try {
             const data = await this.getFS().read(this.dataPath);
             const parsed = JSON.parse(data);
             this.patterns = new Map(Object.entries(parsed));
             log.info('[StyleLearner] E1: 加载了', this.patterns.size, '个风格模式');
         } catch (e) {
             // 文件不存在，使用空状态
             log.info('[StyleLearner] E1: 无已保存的风格模式');
         }
     }
     
     /**
     * 保存模式（通过串行写入器，保证原子性）
     */
    private async savePatterns(): Promise<void> {
        // 使用 enqueueAutoClean，自动在成功后清除脏标记
        await this.writer.enqueueAutoClean(async () => {
            const data = Object.fromEntries(this.patterns);
            await this.getFS().mkdir(pluginDataDir()).catch(() => undefined);
            await this.getFS().write(this.dataPath, JSON.stringify(data, null, 2));
        }).catch(e => {
            log.warn('[StyleLearner] E1: 保存失败:', e);
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
      * 获取所有模式
      */
     getAllPatterns(): StylePattern[] {
         return Array.from(this.patterns.values());
     }
 }
