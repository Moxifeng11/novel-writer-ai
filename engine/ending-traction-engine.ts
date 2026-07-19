 /**
 * ending-traction-engine.ts — 大结局牵引引擎
 * 
 * 功能：全局情节牵引，确保各线汇聚到预设结局
 * 对应优化方向：D4
 */
 
import { App, TFile } from 'obsidian';
import { AIEngine } from './ai-engine';
import { extractResponseText } from '../shared/api-response-utils';
import { pjOutlineDir, pjVolumeOutlineDir } from '../shared/paths';
import { FileSystemPort, VaultMetaPort, ObsidianFileSystem, ObsidianVaultMeta } from '../shared/file-system-port';
import type { NovelWriterSettingsAPI } from '../shared/plugin-api';
import { createLogger } from '../shared/logger';
 

const log = createLogger('EndingTractionEngine');
 export interface PlotThread {
     id: string;
     name: string;
     type: 'main' | 'subplot' | 'romance' | 'mystery';
     startPoint: { volume: number; chapter: number };
     targetEnd: { volume: number; chapter: number };
     currentProgress: number;
     keyNodes: PlotNode[];
     status: 'active' | 'dormant' | 'resolved' | 'abandoned';
 }
 
 export interface PlotNode {
     description: string;
     volume: number;
     chapter: number;
     completed: boolean;
 }
 
 export interface EndingTractionState {
     threads: PlotThread[];
     overallProgress: number;
     divergenceRisk: 'low' | 'medium' | 'high';
     recommendations: string[];
 }
 
 export interface TractionSuggestion {
     threadId: string;
     threadName: string;
     suggestion: string;
     priority: number;
 }
 
 export interface EndingTractionEngineOptions {
    app: App;
    aiEngine: AIEngine;
    plugin: NovelWriterSettingsAPI;
}

export class EndingTractionEngine {
    private app: App;
    private aiEngine: AIEngine;
    private plugin: NovelWriterSettingsAPI;
     private threads: Map<string, PlotThread> = new Map();
     private project: string = '';
     private fs: FileSystemPort | null = null;
     private vaultMeta: VaultMetaPort | null = null;
     
     constructor(opts: EndingTractionEngineOptions) {
         this.app = opts.app;
         this.aiEngine = opts.aiEngine;
         this.plugin = opts.plugin;
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
     
     /**
      * 初始化牵引引擎
      */
     async initialize(project: string): Promise<void> {
         this.project = project;
         this.threads.clear();
         
         try {
             const outlineContents = await this.loadVolumeOutlineContents(project);
             if (!outlineContents.length) {
                 log.warn('[EndingTractionEngine] D4: 未找到分卷大纲文件:', project);
                 return;
             }
             const content = outlineContents.map(item => item.content).join('\n\n');
             const parsedThreads = await this.parsePlotThreads(content);
             
             for (const thread of parsedThreads) {
                 this.threads.set(thread.id, thread);
             }
             
             log.info('[EndingTractionEngine] D4: 解析到', this.threads.size, '条情节线');
         } catch (e) {
             log.warn('[EndingTractionEngine] D4: 初始化失败:', e);
         }
     }
     
     /**
      * 检查当前牵引状态
      */
     async checkTraction(currentVolume: number, currentChapter: number): Promise<EndingTractionState> {
         const threads = Array.from(this.threads.values());
         if (threads.length === 0) {
             return {
                 threads,
                 overallProgress: 0,
                 divergenceRisk: 'medium',
                 recommendations: ['未解析到情节线：请检查分卷大纲是否包含主线/结局/伏笔目标，或重新生成全书规划。']
             };
         }
         
         for (const thread of threads) {
             thread.currentProgress = this.calculateThreadProgress(thread, currentVolume, currentChapter);
         }
         
         const divergenceRisk = this.calculateDivergenceRisk(threads, currentVolume, currentChapter);
         const recommendations = this.generateTractionRecommendations(threads, divergenceRisk);
         
         return {
             threads,
             overallProgress: this.calculateOverallProgress(threads),
             divergenceRisk,
             recommendations
         };
     }
     
     /**
      * 获取牵引点建议
      */
     async suggestTractionPoints(currentVolume: number, currentChapter: number): Promise<TractionSuggestion[]> {
         const state = await this.checkTraction(currentVolume, currentChapter);
         
         return state.threads
             .filter(t => t.status === 'dormant' && t.currentProgress < 50)
             .map(t => ({
                 threadId: t.id,
                 threadName: t.name,
                 suggestion: `建议在近期提及「${t.name}」相关元素，保持读者记忆`,
                 priority: 100 - t.currentProgress
             }))
             .sort((a, b) => b.priority - a.priority)
             .slice(0, 5);
     }
     
     /**
      * 从全书规划解析情节线
      */
     private async parsePlotThreads(content: string): Promise<PlotThread[]> {
         // 简单规则解析（可以用 AI 增强解析）
         const threads: PlotThread[] = [];
         
         // 匹配主线剧情
         const mainMatch = content.match(/主线[：:]\s*(.+?)(?:\n|$)/);
         if (mainMatch) {
             threads.push({
                 id: 'main-1',
                 name: mainMatch[1].trim(),
                 type: 'main',
                 startPoint: { volume: 1, chapter: 1 },
                 targetEnd: { volume: 10, chapter: 100 },
                 currentProgress: 0,
                 keyNodes: [],
                 status: 'active'
             });
         }
         
         // 匹配副线
         const subMatches = content.matchAll(/副线[（(](.+?)[)）][：:]\s*(.+?)(?:\n|$)/g);
         let subIndex = 0;
         for (const match of subMatches) {
             threads.push({
                 id: `sub-${subIndex++}`,
                 name: match[2].trim(),
                 type: 'subplot',
                 startPoint: { volume: 1, chapter: 1 },
                 targetEnd: { volume: 8, chapter: 80 },
                 currentProgress: 0,
                 keyNodes: [],
                 status: 'active'
             });
         }
         
         // 如果规则解析失败，尝试 AI 解析
         if (threads.length === 0 && content.length > 100) {
             try {
                 const aiThreads = await this.parseThreadsWithAI(content);
                 threads.push(...aiThreads);
             } catch (e) {
                 log.warn('[EndingTractionEngine] AI 解析情节线失败:', e);
             }
         }
         
         return threads;
     }
     
     /**
      * 使用 AI 解析情节线
      */
     private async parseThreadsWithAI(content: string): Promise<PlotThread[]> {
         const prompt = [
             '从以下大纲中提取情节线（主线、副线、感情线、伏笔线）。',
             '',
             content.slice(0, 2000),
             '',
             '以 JSON 数组格式返回（不要包含 markdown 代码块）：',
             '[',
             '  {',
             '    "name": "情节线名称",',
             '    "type": "main|subplot|romance|mystery",',
             '    "startVolume": 1,',
             '    "targetVolume": 10',
             '  }',
             ']'
         ].join('\n');
         
         const response = await this.aiEngine.callAI(
             '', 
             prompt, 
             this.plugin?.settings?.flashModel || 'flash', 
             0.3, 
             500
         );
         
         const raw = extractResponseText(response);
         const cleaned = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
         
         try {
             const parsed = JSON.parse(cleaned);
             return parsed.map((p: any, i: number) => ({
                 id: `ai-${i}`,
                 name: p.name || `情节线${i + 1}`,
                 type: p.type || 'subplot',
                 startPoint: { volume: p.startVolume || 1, chapter: 1 },
                 targetEnd: { volume: p.targetVolume || 10, chapter: 100 },
                 currentProgress: 0,
                 keyNodes: [],
                 status: 'active' as const
             }));
         } catch {
             return [];
         }
     }
     
     /**
      * 计算情节线进度
      */
     private calculateThreadProgress(thread: PlotThread, currentVolume: number, currentChapter: number): number {
         const startChapter = (thread.startPoint.volume - 1) * 10 + thread.startPoint.chapter;
         const endChapter = (thread.targetEnd.volume - 1) * 10 + thread.targetEnd.chapter;
         const current = (currentVolume - 1) * 10 + currentChapter;
         
         if (current <= startChapter) return 0;
         if (current >= endChapter) return 100;
         
         return Math.round(((current - startChapter) / (endChapter - startChapter)) * 100);
     }
     
     /**
      * 计算整体进度
      */
     private calculateOverallProgress(threads: PlotThread[]): number {
         if (threads.length === 0) return 0;
         
         const mainThreads = threads.filter(t => t.type === 'main');
         if (mainThreads.length > 0) {
             return Math.round(mainThreads.reduce((sum, t) => sum + t.currentProgress, 0) / mainThreads.length);
         }
         
         return Math.round(threads.reduce((sum, t) => sum + t.currentProgress, 0) / threads.length);
     }
     
     /**
      * 计算偏离风险
      */
     private calculateDivergenceRisk(
         threads: PlotThread[], 
         currentVolume: number, 
         currentChapter: number
     ): 'low' | 'medium' | 'high' {
         // 检查休眠的情节线
         const dormantThreads = threads.filter(t => t.status === 'dormant');
         
         // 检查进度滞后的情节线
         const expectedProgress = ((currentVolume - 1) * 10 + currentChapter) / 100;
         const laggingThreads = threads.filter(t => t.currentProgress < expectedProgress * 80);
         
         if (dormantThreads.length >= 3 || laggingThreads.length >= 3) return 'high';
         if (dormantThreads.length >= 1 || laggingThreads.length >= 1) return 'medium';
         return 'low';
     }
     
     /**
      * 生成牵引建议
      */
    private generateTractionRecommendations(
        threads: PlotThread[], 
        divergenceRisk: string
    ): string[] {
        const recommendations: string[] = [];
        
        if (divergenceRisk === 'high') {
            recommendations.push('⚠️ 多条情节线偏离预期，建议检查大纲对齐');
        }
        
        const dormantThreads = threads.filter(t => t.status === 'dormant');
        if (dormantThreads.length > 0) {
            recommendations.push(`休眠情节线：${dormantThreads.map(t => t.name).join('、')}，建议近期唤醒`);
        }
        
        const laggingThreads = threads.filter(t => t.currentProgress < 30 && t.type === 'main');
        if (laggingThreads.length > 0) {
            recommendations.push(`主线进度滞后：${laggingThreads.map(t => t.name).join('、')}`);
        }
        
        return recommendations;
    }
    
    /**
     * D4: 加载分卷大纲内容
     * v4.0：分卷大纲按卷归档于 {project}/03-大纲与章节/分卷大纲/第N卷_分卷大纲.md，
     * 不再读取旧版单文件 03-大纲与章节/分卷大纲.md（v4 已弃用）。
     */
    private async loadVolumeOutlineContents(project: string): Promise<{ path: string; content: string }[]> {
        const results: { path: string; content: string }[] = [];
        const seen = new Set<string>();

        const readFile = async (path: string): Promise<void> => {
            if (seen.has(path)) return;
            const file = this.getVaultMeta().getAbstractFileByPath(path);
            if (file instanceof TFile) {
                try {
                    const content = await this.getFS().read(path);
                    if (content && content.trim()) {
                        seen.add(path);
                        results.push({ path, content });
                    }
                } catch (e) {
                    log.warn('[EndingTractionEngine] D4: 读取分卷大纲失败:', path, e);
                }
            }
        };

        const outlineRoot = pjOutlineDir(project);

        // v4.0：扫描 分卷大纲/ 目录下所有按卷归档文件
        const volumeDir = pjVolumeOutlineDir(project);
        const dirFiles = this.getVaultMeta().getFiles()
            .filter(f => f.path.startsWith(`${volumeDir}/`) && f.extension === 'md')
            .sort((a, b) => a.path.localeCompare(b.path, 'zh-Hans-CN'));
        for (const f of dirFiles) {
            await readFile(f.path);
        }

        return results;
    }
}
