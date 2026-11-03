/**
 * emotion-curve-view.ts — 情绪曲线可视化组件
 * 
 * 功能：渲染情绪曲线 SVG 图表
 * 对应优化方向：F3
 * 
 * Task 12: 重构为复用 svg-charts.ts 的 lineChart() 预设，
 * 消除独立 polyline + circle 实现，统一交互与动画行为。
 */

import { EmotionCurve } from '@/shared/co-writer-types';
import {
	lineChart,
	attachChartInteractions,
	LineChartSeries,
	LineChartOptions
} from '@/ui/svg-charts';

/**
 * EmotionCurveView 类。
 *
 * @example
 * ```ts
 * const view = new EmotionCurveView(container);
 * view.render(curve);
 * view.attachInteractions(container);
 * ```
 */
export class EmotionCurveView {
    private container: HTMLElement | null = null;
    private width: number = 600;
    private height: number = 250;
    
    constructor(container?: HTMLElement) {
        this.container = container || null;
    }
    
    /**
     * 渲染情绪曲线
     * 调用 lineChart() 生成 SVG，并附加统计面板。
     * 若需启用 hover tooltip / 图例 toggle 等交互，在 mount 后调用 attachInteractions(container)。
     * @param curve - 曲线数据
     * @returns 文本结果
     */
    render(curve: EmotionCurve): string {
        if (!curve.points.length) {
            return '<div class="nw-emotion-curve-empty">暂无情绪数据</div>';
        }
        
        const series: LineChartSeries[] = [{
            name: '情绪曲线',
            data: curve.points.map(p => ({
                label: this.getEmotionLabel(p.emotion),
                value: p.intensity
            })),
            color: 'var(--text-accent, #7c3aed)',
            smooth: true,
            showPoints: true
        }];
        
        const options: LineChartOptions = {
            width: this.width,
            height: this.height,
            xAxisLabel: '叙事进度',
            yAxisLabel: '情绪强度',
            showGrid: true,
            showLegend: false
        };
        
        const chartSvg = lineChart(series, options);
        
        return `
            <div class="nw-emotion-curve-container">
                ${chartSvg}
                <div class="nw-curve-stats">
                    <span class="nw-emotion-stat-item">
                        <span class="nw-emotion-stat-label">主导情绪</span>
                        <span class="nw-stat-value">${this.getEmotionLabel(curve.dominantEmotion)}</span>
                    </span>
                    <span class="nw-emotion-stat-item">
                        <span class="nw-emotion-stat-label">波动度</span>
                        <span class="nw-stat-value">${curve.volatility}%</span>
                    </span>
                    <span class="nw-emotion-stat-item">
                        <span class="nw-emotion-stat-label">弧线类型</span>
                        <span class="nw-stat-value">${this.getArcTypeLabel(curve.arcType)}</span>
                    </span>
                </div>
            </div>
        `;
    }
    
    /**
     * 为已挂载的容器附加图表交互（tooltip / 图例 toggle）。
     * 在调用方将 render() 返回的 HTML 写入 DOM 后调用。
     * @param container - 容器元素
     */
    attachInteractions(container: HTMLElement): void {
        attachChartInteractions(container);
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
}
