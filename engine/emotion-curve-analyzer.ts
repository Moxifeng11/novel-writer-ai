 /**
 * emotion-curve-analyzer.ts — 情绪曲线分析器
 * 
 * 功能：分析正文的情绪变化轨迹，生成可视化曲线数据
 * 对应优化方向：F3
 */
 
import { App } from 'obsidian';
import { AIEngine } from './ai-engine';
import { EmotionPoint, EmotionCurve } from '../shared/co-writer-types';
import { extractResponseText } from '../shared/api-response-utils';
import type { NovelWriterSettingsAPI } from '../shared/plugin-api';
import { createLogger } from '../shared/logger';
 

const log = createLogger('EmotionCurveAnalyzer');
 export interface EmotionCurveAnalyzerOptions {
    app: App;
    aiEngine: AIEngine;
    plugin: NovelWriterSettingsAPI;
}

export class EmotionCurveAnalyzer {
    private app: App;
    private aiEngine: AIEngine;
    private plugin: NovelWriterSettingsAPI;
     
     constructor(opts: EmotionCurveAnalyzerOptions) {
         this.app = opts.app;
         this.aiEngine = opts.aiEngine;
         this.plugin = opts.plugin;
     }
     
     /**
      * 分析文本的情绪曲线
      */
     async analyze(text: string): Promise<EmotionCurve> {
         if (!text || text.length < 100) {
             return this.getEmptyCurve();
         }
         
         // 将文本分段（每段约800字）
         const segments = this.segmentText(text, 800);
         const points: EmotionPoint[] = [];
         
         for (let i = 0; i < segments.length; i++) {
             try {
                 const point = await this.analyzeSegment(segments[i], i);
                 points.push(point);
             } catch (e) {
                 log.warn(`[EmotionCurveAnalyzer] 片段 ${i} 分析失败:`, e);
                 // 添加空点保持连续性
                 points.push({
                     position: i,
                     emotion: 'neutral',
                     intensity: 50,
                     text: segments[i].slice(0, 50)
                 });
             }
         }
         
         return {
             points,
             dominantEmotion: this.findDominant(points),
             volatility: this.calculateVolatility(points),
             arcType: this.determineArcType(points)
         };
     }
     
     /**
      * 将文本分段
      */
     private segmentText(text: string, targetLength: number): string[] {
         const segments: string[] = [];
         let start = 0;
         
         while (start < text.length) {
             let end = Math.min(start + targetLength, text.length);
             
             // 尝试在句号处切分
             if (end < text.length) {
                 const lastPeriod = text.lastIndexOf('。', end);
                 const lastExclaim = text.lastIndexOf('！', end);
                 const lastQuestion = text.lastIndexOf('？', end);
                 const breakPoint = Math.max(lastPeriod, lastExclaim, lastQuestion);
                 
                 if (breakPoint > start + targetLength / 2) {
                     end = breakPoint + 1;
                 }
             }
             
             segments.push(text.slice(start, end));
             start = end;
         }
         
         return segments;
     }
     
     /**
      * 分析单个片段的情绪
      */
     private async analyzeSegment(text: string, index: number): Promise<EmotionPoint> {
         const prompt = [
             '分析以下文本片段的情绪状态。',
             '',
             text,
             '',
             '请判断：',
             '1. 主要情绪类型（从以下选择：joy/sadness/anger/fear/surprise/disgust/neutral）',
             '2. 情绪强度（0-100）',
             '',
             '以 JSON 格式返回（不要包含 markdown 代码块）：',
             '{ "emotion": "情绪类型", "intensity": 50 }'
         ].join('\n');
         
         const response = await this.aiEngine.callAI(
             '', 
             prompt, 
             this.plugin?.settings?.flashModel || 'flash', 
             0.3, 
             100
         );
         
         const raw = extractResponseText(response);
         const cleaned = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
         
         try {
             const json = JSON.parse(cleaned);
             return {
                 position: index,
                 emotion: json.emotion || 'neutral',
                 intensity: Number(json.intensity) || 50,
                 text: text.slice(0, 50) + (text.length > 50 ? '...' : '')
             };
         } catch {
             return {
                 position: index,
                 emotion: 'neutral',
                 intensity: 50,
                 text: text.slice(0, 50)
             };
         }
     }
     
     /**
      * 找出主导情绪
      */
     private findDominant(points: EmotionPoint[]): string {
         const counts: Record<string, number> = {};
         for (const p of points) {
             counts[p.emotion] = (counts[p.emotion] || 0) + p.intensity;
         }
         
         let maxEmotion = 'neutral';
         let maxCount = 0;
         for (const [emotion, count] of Object.entries(counts)) {
             if (count > maxCount) {
                 maxCount = count;
                 maxEmotion = emotion;
             }
         }
         
         return maxEmotion;
     }
     
     /**
      * 计算情绪波动度
      */
     private calculateVolatility(points: EmotionPoint[]): number {
         if (points.length < 2) return 0;
         
         let totalChange = 0;
         for (let i = 1; i < points.length; i++) {
             totalChange += Math.abs(points[i].intensity - points[i-1].intensity);
         }
         
         return Math.round(totalChange / (points.length - 1));
     }
     
     /**
      * 判断弧线类型
      */
     private determineArcType(points: EmotionPoint[]): 'rise' | 'fall' | 'wave' | 'flat' {
         if (points.length < 2) return 'flat';
         
         const first = points[0].intensity;
         const last = points[points.length - 1].intensity;
         const diff = last - first;
         
         // 检查是否有显著波动
         const volatility = this.calculateVolatility(points);
         
         if (volatility > 25) return 'wave';
         if (diff > 15) return 'rise';
         if (diff < -15) return 'fall';
         return 'flat';
     }
     
     /**
      * 空曲线
      */
     private getEmptyCurve(): EmotionCurve {
         return {
             points: [],
             dominantEmotion: 'neutral',
             volatility: 0,
             arcType: 'flat'
         };
     }
 }
