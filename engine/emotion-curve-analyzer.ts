 /**
 * emotion-curve-analyzer.ts — 情绪曲线分析器
 * 
 * 功能：分析正文的情绪变化轨迹，生成可视化曲线数据
 * 对应优化方向：F3
 */
 
import { EmotionPoint, EmotionCurve } from '@/shared/co-writer-types';
import { createLogger } from '@/shared/logger';


const log = createLogger('EmotionCurveAnalyzer');

/**
 * EmotionCurveAnalyzer 类。
 */
export class EmotionCurveAnalyzer {
    /** 片段内容哈希 → 情绪点：正文只在尾部增长时，前面片段不必重新分析 */
    private segmentCache = new Map<string, EmotionPoint>();

     /**
      * 分析文本的情绪曲线
      * @param text - 文本内容
       * @returns EmotionCurve 实例
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

         // 片段缓存只服务「正文尾部增长」这一常见场景；超限直接清空，
         // 避免长章节反复改写时把整本正文的片段都留在内存里。
         if (this.segmentCache.size > 512) this.segmentCache.clear();
         
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
     *
     * 实时面板每次停顿都会重算整条曲线。此前若逐段调用 AI，4000 字正文就是每 2.5 秒
     * 5 次云端请求——这是监控链路里最大的隐性云端依赖，而入口开关
     * `enableDetailedAnalysis` 从未有 UI 写入方（AI 分支不可达）。现统一走本地词典规则，
     * 相同片段命中缓存、不重复计算。
     */
    private async analyzeSegment(text: string, index: number): Promise<EmotionPoint> {
        const cacheKey = this.hashSegment(text);
        const cached = this.segmentCache.get(cacheKey);
        if (cached) {
            return { ...cached, position: index };
        }

        const point = this.classifyByKeywords(text, index);
        this.segmentCache.set(cacheKey, point);
        return point;
    }

    /** 片段内容哈希（只用于缓存命中判断） */
    private hashSegment(text: string): string {
        let hash = 0x811c9dc5;
        for (let i = 0; i < text.length; i++) {
            hash ^= text.charCodeAt(i);
            hash = Math.imul(hash, 0x01000193);
        }
        return `${text.length}:${(hash >>> 0).toString(36)}`;
    }

    /**
     * 本地情绪分类：按关键词命中数取最高的情绪桶。
     * 与 AI 版保持同一组 emotion 取值，强度按命中数放大。
     */
    private classifyByKeywords(text: string, index: number): EmotionPoint {
        const buckets: Array<{ emotion: string; pattern: RegExp }> = [
            { emotion: 'joy', pattern: /喜悦|开心|高兴|快乐|幸福|满足|欣慰|激动|兴奋|期待|希望|热情|感激|感动|骄傲|自豪|轻松|平静|安宁|温馨|浪漫|甜蜜/g },
            { emotion: 'sadness', pattern: /悲伤|痛苦|绝望|失落|孤独|寂寞|沮丧|气馁|后悔|内疚|羞愧|思念|离别/g },
            { emotion: 'anger', pattern: /愤怒|生气|憎恨|厌恶|嫉妒|怒火|暴怒|怒吼|咬牙/g },
            { emotion: 'fear', pattern: /恐惧|害怕|焦虑|紧张|担忧|惊恐|战栗|颤抖|不安/g },
            { emotion: 'surprise', pattern: /惊讶|震惊|意外|吃惊|错愕|愕然|突然/g },
        ];

        let bestEmotion = 'neutral';
        let bestHits = 0;
        for (const bucket of buckets) {
            const hits = (text.match(bucket.pattern) || []).length;
            if (hits > bestHits) {
                bestHits = hits;
                bestEmotion = bucket.emotion;
            }
        }

        const intensity = bestHits === 0 ? 50 : Math.min(100, 40 + bestHits * 12);
        return {
            position: index,
            emotion: bestEmotion,
            intensity,
            text: text.slice(0, 50) + (text.length > 50 ? '...' : ''),
        };
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
