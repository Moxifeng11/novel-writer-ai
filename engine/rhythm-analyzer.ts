 /**
 * rhythm-analyzer.ts — 节奏分析器
 * 
 * 功能：分析正文节奏，检测拖沓/紧张区段
 * 对应优化方向：C2
 */
 
import { App } from 'obsidian';
import { AIEngine } from './ai-engine';
import { RhythmSegment, RhythmAnalysis } from '../shared/co-writer-types';
import { extractResponseText } from '../shared/api-response-utils';
import type { NovelWriterSettingsAPI } from '../shared/plugin-api';
 
 export interface RhythmAnalyzerOptions {
    app: App;
    aiEngine: AIEngine;
    plugin: NovelWriterSettingsAPI;
}

export class RhythmAnalyzer {
    private app: App;
    private aiEngine: AIEngine;
    private plugin: NovelWriterSettingsAPI;
     
     constructor(opts: RhythmAnalyzerOptions) {
         this.app = opts.app;
         this.aiEngine = opts.aiEngine;
         this.plugin = opts.plugin;
     }
     
     /**
      * 分析文本节奏
      */
     async analyze(text: string): Promise<RhythmAnalysis> {
         if (!text || text.length < 100) {
             return this.getEmptyAnalysis();
         }
         
         // 将文本按段落分割
         const paragraphs = text.split(/\n{2,}/).filter(p => p.trim().length > 0);
         const segments: RhythmSegment[] = [];
         
         let pos = 0;
         for (const para of paragraphs) {
             const trimmed = para.trim();
             if (trimmed.length < 10) continue;
             
             try {
                 const segment = await this.analyzeParagraph(trimmed, pos);
                 segments.push(segment);
             } catch (e) {
                 console.warn('[RhythmAnalyzer] 段落分析失败:', e);
                 // 添加默认段落
                 segments.push(this.getDefaultSegment(trimmed, pos));
             }
             pos += trimmed.length + 2;
         }
         
         return {
             segments,
             overallPace: this.calculateOverallPace(segments),
             slowSegments: segments.filter(s => s.pace === 'slow' && s.density < 30),
             fastSegments: segments.filter(s => s.pace === 'fast' && s.tensionLevel > 80),
             suggestions: this.generateSuggestions(segments)
         };
     }
     
     /**
      * 分析单个段落
      */
     private async analyzeParagraph(text: string, pos: number): Promise<RhythmSegment> {
         // 基于规则快速分析
         const type = this.detectType(text);
         const wordCount = text.length;
         const sentenceCount = (text.match(/[。！？]/g) || []).length;
         const avgSentenceLen = wordCount / Math.max(sentenceCount, 1);
         
         // 判断节奏
         let pace: 'fast' | 'medium' | 'slow';
         if (avgSentenceLen > 50) pace = 'slow';
         else if (avgSentenceLen > 25) pace = 'medium';
         else pace = 'fast';
         
         // 计算信息密度（关键词密度）
         const density = this.calculateDensity(text);
         
         // AI 辅助估算紧张度
         const tensionLevel = await this.estimateTension(text);
         
         // 检测问题
         const issues = this.detectIssues(text, type, pace, density);
         
         return {
             start: pos,
             end: pos + text.length,
             type,
             pace,
             density,
             tensionLevel,
             issues
         };
     }
     
     /**
      * 检测段落类型
      */
     private detectType(text: string): 'action' | 'dialogue' | 'description' | 'introspection' {
         const dialogueIndicators = /["「『"]|说[道道]/
         const actionIndicators = /[打杀冲跳跑闪躲挥劈]/
         const introspectionIndicators = /[心想觉得感到思考]/
         
         const dialogueMatches = (text.match(dialogueIndicators) || []).length;
         const actionMatches = (text.match(actionIndicators) || []).length;
         const introspectionMatches = (text.match(introspectionIndicators) || []).length;
         
         if (dialogueMatches > actionMatches && dialogueMatches > introspectionMatches) return 'dialogue';
         if (actionMatches > introspectionMatches) return 'action';
         if (introspectionMatches > 0) return 'introspection';
         return 'description';
     }
     
     /**
      * 计算信息密度
      */
     private calculateDensity(text: string): number {
         // 简单估算：名词和动词的比例
         const meaningfulChars = text.replace(/[的地得了着过吗呢吧啊，。！？、]/g, '');
         return Math.round((meaningfulChars.length / text.length) * 100);
     }
     
     /**
      * 估算紧张度
      */
     private async estimateTension(text: string): Promise<number> {
         // 快速规则估算
         const tensionKeywords = /[危险死亡威胁紧张恐惧惊恐愤怒仇恨杀]/
         const matches = (text.match(tensionKeywords) || []).length;
         const baseTension = Math.min(100, matches * 15 + 30);
         
         // 如果段落较长，可以用 AI 精确估算（可选）
         if (text.length > 200 && this.plugin?.settings?.enableDetailedAnalysis) {
             try {
                 const prompt = [
                     '估算以下段落的紧张程度（0-100）：',
                     '',
                     text.slice(0, 300),
                     '',
                     '返回一个数字：'
                 ].join('\n');
                 
                 const response = await this.aiEngine.callAI('', prompt, this.plugin?.settings?.flashModel || 'flash', 0.3, 20);
                 const num = parseInt(extractResponseText(response).replace(/\D/g, ''));
                 return isNaN(num) ? baseTension : Math.min(100, Math.max(0, num));
             } catch {
                 return baseTension;
             }
         }
         
         return baseTension;
     }
     
     /**
      * 检测问题
      */
     private detectIssues(text: string, type: string, pace: string, density: number): string[] {
         const issues: string[] = [];
         
         if (type === 'description' && text.length > 300) {
             issues.push('描写过长，可能拖慢节奏');
         }
         if (pace === 'slow' && density < 30) {
             issues.push('节奏缓慢且信息密度低，建议压缩');
         }
         if (type === 'introspection' && text.length > 200) {
             issues.push('内心独白过长，建议穿插动作');
         }
         if (density > 85) {
             issues.push('信息密度过高，读者可能疲劳');
         }
         
         return issues;
     }
     
     /**
      * 默认段落
      */
     private getDefaultSegment(text: string, pos: number): RhythmSegment {
         return {
             start: pos,
             end: pos + text.length,
             type: 'description',
             pace: 'medium',
             density: 50,
             tensionLevel: 50,
             issues: []
         };
     }
     
     /**
      * 计算整体节奏
      */
     private calculateOverallPace(segments: RhythmSegment[]): string {
         if (segments.length === 0) return 'balanced';
         
         const paceCounts = { fast: 0, medium: 0, slow: 0 };
         for (const s of segments) {
             paceCounts[s.pace]++;
         }
         
         const total = segments.length;
         if (paceCounts.fast > total * 0.6) return 'fast';
         if (paceCounts.slow > total * 0.6) return 'slow';
         return 'balanced';
     }
     
     /**
      * 生成建议
      */
     private generateSuggestions(segments: RhythmSegment[]): string[] {
         const suggestions: string[] = [];
         
         const slowCount = segments.filter(s => s.pace === 'slow').length;
         const fastCount = segments.filter(s => s.pace === 'fast').length;
         const total = segments.length;
         
         if (slowCount > total * 0.5) {
             suggestions.push('整体节奏偏慢，建议增加动作或对话场景');
         }
         if (fastCount > total * 0.5) {
             suggestions.push('整体节奏偏快，建议穿插描写或内心戏调节');
         }
         if (segments.some(s => s.issues.length > 0)) {
             suggestions.push('部分段落存在问题，建议查看详情');
         }
         
         // 检查连续同类型段落
         let sameTypeCount = 1;
         for (let i = 1; i < segments.length; i++) {
             if (segments[i].type === segments[i-1].type) {
                 sameTypeCount++;
             } else {
                 if (sameTypeCount >= 4) {
                     suggestions.push(`连续 ${sameTypeCount} 个${this.typeToLabel(segments[i-1].type)}，建议变换节奏`);
                 }
                 sameTypeCount = 1;
             }
         }
         
         return suggestions;
     }
     
     private typeToLabel(type: string): string {
         const labels: Record<string, string> = {
             action: '动作场景',
             dialogue: '对话场景',
             description: '描写场景',
             introspection: '内心戏'
         };
         return labels[type] || type;
     }
     
     /**
      * 空分析结果
      */
     private getEmptyAnalysis(): RhythmAnalysis {
         return {
             segments: [],
             overallPace: 'balanced',
             slowSegments: [],
             fastSegments: [],
             suggestions: []
         };
     }
 }
