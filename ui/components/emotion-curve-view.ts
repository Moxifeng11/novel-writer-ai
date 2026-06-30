 /**
 * emotion-curve-view.ts — 情绪曲线可视化组件
 * 
 * 功能：渲染情绪曲线 SVG 图表
 * 对应优化方向：F3
 */
 
 import { EmotionCurve, EmotionPoint } from '../../shared/co-writer-types';
 
 export class EmotionCurveView {
     private container: HTMLElement | null = null;
     private width: number = 600;
     private height: number = 200;
     
     constructor(container?: HTMLElement) {
         this.container = container || null;
     }
     
     /**
      * 渲染情绪曲线
      */
     render(curve: EmotionCurve): string {
         if (!curve.points.length) {
             return '<div class="emotion-curve-empty">暂无情绪数据</div>';
         }
         
         const points = curve.points;
         const width = this.width;
         const height = this.height;
         const padding = 30;
         
         // 生成曲线点坐标
         const pathPoints = this.generatePathPoints(points, width - padding * 2, height - padding * 2);
         
         return `
             <div class="emotion-curve-container">
                 <svg width="${width}" height="${height}" class="emotion-curve-svg">
                     <!-- 背景网格 -->
                     ${this.renderGrid(width, height, padding)}
                     
                     <!-- 情绪曲线 -->
                     <polyline 
                         points="${pathPoints}" 
                         fill="none" 
                         stroke="var(--text-accent, #7c3aed)" 
                         stroke-width="2"
                         class="emotion-curve-line"
                     />
                     
                     <!-- 数据点 -->
                     ${points.map((p, i) => {
                         const x = padding + (i / Math.max(points.length - 1, 1)) * (width - padding * 2);
                         const y = height - padding - (p.intensity / 100) * (height - padding * 2);
                         return `
                             <circle 
                                 cx="${x}" 
                                 cy="${y}" 
                                 r="5" 
                                 fill="var(--text-accent, #7c3aed)"
                                 class="emotion-point"
                                 data-emotion="${p.emotion}"
                                 data-intensity="${p.intensity}"
                                 data-text="${this.escapeHtml(p.text.slice(0, 30))}"
                             />
                         `;
                     }).join('')}
                 </svg>
                 
                 <!-- 统计信息 -->
                 <div class="curve-stats">
                     <span class="stat-item">
                         <span class="stat-label">主导情绪</span>
                         <span class="stat-value">${this.getEmotionLabel(curve.dominantEmotion)}</span>
                     </span>
                     <span class="stat-item">
                         <span class="stat-label">波动度</span>
                         <span class="stat-value">${curve.volatility}%</span>
                     </span>
                     <span class="stat-item">
                         <span class="stat-label">弧线类型</span>
                         <span class="stat-value">${this.getArcTypeLabel(curve.arcType)}</span>
                     </span>
                 </div>
             </div>
         `;
     }
     
     /**
      * 渲染网格
      */
     private renderGrid(width: number, height: number, padding: number): string {
         const lines: string[] = [];
         
         // 水平线
         for (let i = 0; i <= 4; i++) {
             const y = padding + (i / 4) * (height - padding * 2);
             lines.push(`<line x1="${padding}" y1="${y}" x2="${width - padding}" y2="${y}" stroke="var(--background-modifier-border, #e5e5e5)" stroke-dasharray="4,4"/>`);
         }
         
         return lines.join('');
     }
     
     /**
      * 生成路径点
      */
     private generatePathPoints(points: EmotionPoint[], width: number, height: number): string {
         return points.map((p, i) => {
             const x = 30 + (i / Math.max(points.length - 1, 1)) * width;
             const y = 170 - (p.intensity / 100) * height;
             return `${x},${y}`;
         }).join(' ');
     }
     
     /**
      * 获取情绪标签
      */
     private getEmotionLabel(emotion: string): string {
         const labels: Record<string, string> = {
             joy: '喜悦',
             sadness: '悲伤',
             anger: '愤怒',
             fear: '恐惧',
             surprise: '惊讶',
             disgust: '厌恶',
             neutral: '平静'
         };
         return labels[emotion] || emotion;
     }
     
     /**
      * 获取弧线类型标签
      */
     private getArcTypeLabel(type: string): string {
         const labels: Record<string, string> = {
             rise: '上升',
             fall: '下降',
             wave: '波动',
             flat: '平稳'
         };
         return labels[type] || type;
     }
     
     /**
      * HTML 转义
      */
     private escapeHtml(text: string): string {
         return text
             .replace(/&/g, '&amp;')
             .replace(/</g, '&lt;')
             .replace(/>/g, '&gt;')
             .replace(/"/g, '&quot;');
     }
 }
