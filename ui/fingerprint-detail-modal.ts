import { App, Modal, Notice } from 'obsidian';
import { StyleFingerprint, StyleFingerprintLibrary } from '../engine/style-fingerprint-library';
import { migrateV1ToV2 } from '../engine/style/fingerprint-migrator';
import { V2Fingerprint, StyleDimensionKeyV2, DimensionStatus } from '../engine/style/style-dimensions-v2';
import { formatWordCount, formatDateTime, FEATURE_DIMENSIONS, FEATURE_DIMENSIONS_V2, DIMENSION_STATUS_LABELS, getDimensionScore } from './fingerprint-utils';
import { radarChart, barChart, donutChart } from './svg-charts';

interface FingerprintDetailModalOptions {
    fingerprint: StyleFingerprint;
    /** 指纹库实例（提供后启用 V2 12 维展示） */
    library?: StyleFingerprintLibrary;
    /** 项目路径（用于强度配置入口） */
    project?: string;
    canEdit?: boolean;
    onToggle?: (fp: StyleFingerprint) => void;
    onReextract?: (fp: StyleFingerprint) => void;
    onDelete?: (fp: StyleFingerprint) => void;
    /** 打开强度调节 Modal 回调 */
    onOpenIntensity?: (fp: StyleFingerprint) => void;
}

export class FingerprintDetailModal extends Modal {
    private options: FingerprintDetailModalOptions;
    private expandedFeatures: Record<string, boolean> = {};
    /** V2 转换结果（懒加载） */
    private v2Fingerprint: V2Fingerprint | null = null;

    constructor(app: App, options: FingerprintDetailModalOptions) {
        super(app);
        this.options = options;
        for (const dim of FEATURE_DIMENSIONS) {
            this.expandedFeatures[dim.key] = true;
        }
    }

    onOpen() {
        this.modalEl.addClass('nw-scope');
        this.render();
    }

    onClose() {
        this.contentEl.empty();
    }

    /** 懒加载 V2 转换（migrateV1ToV2 是纯函数，无副作用） */
    private getV2(): V2Fingerprint {
        if (!this.v2Fingerprint) {
            const scope = this.options.fingerprint.scope;
            this.v2Fingerprint = migrateV1ToV2(this.options.fingerprint, scope);
        }
        return this.v2Fingerprint;
    }

    private render(): void {
        const { contentEl } = this;
        contentEl.empty();

        const fp = this.options.fingerprint;

        const wrapper = contentEl.parentElement as HTMLElement;
        if (wrapper) {
            wrapper.addClass('nw-modal');
        }
        contentEl.style.width = '100%';
        contentEl.style.setProperty('overflow-y', 'auto', 'important');
        contentEl.style.maxHeight = '85vh';

        contentEl.createEl('h3', { text: `🔍 ${fp.name}`, attr: { style: 'margin-top:0;margin-bottom:8px;' } });

        this.renderBasicInfo(contentEl, fp);
        this.renderStats(contentEl, fp);
        this.renderV2Features(contentEl);
        this.renderSamples(contentEl, fp);
        this.renderActions(contentEl, fp);
    }

    private renderBasicInfo(container: HTMLElement, fp: StyleFingerprint): void {
        const section = container.createDiv({ attr: { style: 'margin-bottom:16px;padding:12px;background:var(--background-secondary);border-radius:6px;' } });
        section.createEl('div', { text: '基本信息', attr: { style: 'font-weight:600;font-size:13px;margin-bottom:8px;' } });

        const grid = section.createDiv({ attr: { style: 'display:grid;grid-template-columns:1fr 1fr;gap:8px 16px;font-size:12px;' } });

        this.renderInfoRow(grid, '名称', fp.name);
        this.renderInfoRow(grid, '来源', fp.source);
        this.renderInfoRow(grid, '字数', formatWordCount(fp.stats.wordCount));
        this.renderInfoRow(grid, '提取时间', formatDateTime(fp.extractedAt));
        this.renderInfoRow(grid, '作用域', fp.scope === 'global' ? '全局' : '项目');
        this.renderInfoRow(grid, '状态', fp.enabled ? '✅ 已启用' : '⏸ 已禁用');
    }

    private renderInfoRow(container: HTMLElement, label: string, value: string): void {
        const row = container.createDiv({ attr: { style: 'display:flex;gap:6px;' } });
        row.createEl('span', { text: `${label}:`, attr: { style: 'color:var(--text-muted);min-width:56px;' } });
        row.createEl('span', { text: value, attr: { style: 'color:var(--text-normal);' } });
    }

    private renderStats(container: HTMLElement, fp: StyleFingerprint): void {
        const section = container.createDiv({ attr: { style: 'margin-bottom:16px;' } });
        section.createEl('div', { text: '数据可视化', attr: { style: 'font-weight:600;font-size:13px;margin-bottom:10px;' } });

        const statsGrid = section.createDiv({ attr: { style: 'display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;' } });

        const statCards = [
            { label: '平均句长', value: `${fp.stats.avgSentenceLength} 字` },
            { label: '平均段长', value: `${fp.stats.avgParagraphLength} 字` },
            { label: '对话占比', value: `${Math.round(fp.stats.dialogueRatio * 100)}%` },
            { label: '描写占比', value: `${Math.round(fp.stats.descriptionRatio * 100)}%` },
        ];

        for (const stat of statCards) {
            const card = statsGrid.createDiv({
                attr: {
                    style: 'padding:10px 12px;background:var(--background-secondary);border-radius:6px;display:flex;flex-direction:column;gap:4px;'
                }
            });
            card.createEl('span', { text: stat.label, attr: { style: 'font-size:11px;color:var(--text-muted);' } });
            card.createEl('span', { text: stat.value, attr: { style: 'font-size:16px;font-weight:600;color:var(--text-normal);' } });
        }

        const chartsRow = section.createDiv({ attr: { style: 'display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;' } });

        // V2 12 维雷达图（基于维度数据状态评分，移除旧估算函数）
        const radarCard = chartsRow.createDiv({
            attr: { style: 'padding:12px;background:var(--background-secondary);border-radius:6px;display:flex;flex-direction:column;align-items:center;' }
        });
        radarCard.createEl('div', { text: '风格维度雷达图（V2 12 维）', attr: { style: 'font-size:12px;font-weight:500;margin-bottom:8px;' } });

        const v2 = this.getV2();
        const radarData = FEATURE_DIMENSIONS_V2.map(dim => {
            const dimData = v2.features[dim.key];
            return {
                label: dim.name,
                value: getDimensionScore(dimData.status, this.extractMetricForRadar(dim.key, dimData)),
            };
        });
        radarCard.innerHTML += radarChart(radarData, { size: 280 });

        const donutCard = chartsRow.createDiv({
            attr: { style: 'padding:12px;background:var(--background-secondary);border-radius:6px;' }
        });
        donutCard.createEl('div', { text: '内容占比分布', attr: { style: 'font-size:12px;font-weight:500;margin-bottom:8px;' } });

        const narrationRatio = Math.max(0, 1 - fp.stats.dialogueRatio - fp.stats.descriptionRatio);
        const donutData = [
            { label: '对话', value: Math.round(fp.stats.dialogueRatio * 100), color: '#7c3aed' },
            { label: '描写', value: Math.round(fp.stats.descriptionRatio * 100), color: '#ec4899' },
            { label: '叙述', value: Math.round(narrationRatio * 100), color: '#10b981' },
        ];
        donutCard.innerHTML += donutChart(donutData, { size: 220 });

        const barCard = section.createDiv({
            attr: { style: 'padding:12px;background:var(--background-secondary);border-radius:6px;' }
        });
        barCard.createEl('div', { text: '平均长度统计', attr: { style: 'font-size:12px;font-weight:500;margin-bottom:8px;' } });

        const barData = [
            { label: '平均句长', value: fp.stats.avgSentenceLength },
            { label: '平均段长', value: fp.stats.avgParagraphLength },
        ];
        barCard.innerHTML += barChart(barData, { width: 400, height: 180 });
    }

    /**
     * 从 V2 维度数据中提取归一化指标（0-1）用于雷达图
     * - 优先使用真实统计指标
     * - 缺失时返回 undefined，由 getDimensionScore 回退到状态评分
     */
    private extractMetricForRadar(key: StyleDimensionKeyV2, dimData: unknown): number | undefined {
        if (!dimData || typeof dimData !== 'object') return undefined;
        const obj = dimData as Record<string, unknown>;
        switch (key) {
            case 'rhythm':
                return typeof obj.shortSentenceRatio === 'number' ? obj.shortSentenceRatio : undefined;
            case 'wordChoice':
                return typeof obj.commonWordRatio === 'number' ? obj.commonWordRatio : undefined;
            case 'rhetoric':
                return typeof obj.metaphorDensity === 'number'
                    ? Math.min(1, (obj.metaphorDensity as number) / 10)
                    : undefined;
            case 'perspective':
                return typeof obj.personDistribution === 'object' && obj.personDistribution !== null
                    ? (obj.personDistribution as Record<string, number>).third
                    : undefined;
            case 'emotion': {
                const valence = obj.valenceRatio as Record<string, number> | undefined;
                return valence ? valence.positive : undefined;
            }
            case 'tension':
                return typeof obj.suspenseDensity === 'number'
                    ? Math.min(1, (obj.suspenseDensity as number) / 10)
                    : undefined;
            case 'infoDensity':
                return typeof obj.infoDensity === 'number'
                    ? Math.min(1, (obj.infoDensity as number) / 10)
                    : undefined;
            case 'dialogue':
                return typeof obj.dialogueRatio === 'number' ? obj.dialogueRatio : undefined;
            case 'description':
                return typeof obj.environmentDescriptionRatio === 'number'
                    ? obj.environmentDescriptionRatio
                    : undefined;
            case 'narration':
                return typeof obj.narrationSpeed === 'number'
                    ? Math.min(1, (obj.narrationSpeed as number) / 10)
                    : undefined;
            case 'languageTexture':
                return typeof obj.writtenLevel === 'number' ? obj.writtenLevel : undefined;
            case 'sentencePattern':
                return typeof obj.parallelismDensity === 'number'
                    ? Math.min(1, (obj.parallelismDensity as number) / 10)
                    : undefined;
            default:
                return undefined;
        }
    }

    private renderStatRow(container: HTMLElement, label: string, value: string): void {
        const row = container.createDiv({ attr: { style: 'display:flex;justify-content:space-between;gap:8px;' } });
        row.createEl('span', { text: label, attr: { style: 'color:var(--text-muted);' } });
        row.createEl('span', { text: value, attr: { style: 'color:var(--text-normal);font-weight:500;' } });
    }

    private renderV2Features(container: HTMLElement): void {
        const section = container.createDiv({ attr: { style: 'margin-bottom:16px;' } });
        section.createEl('div', {
            text: '风格特征（V2 12 维详情）',
            attr: { style: 'font-weight:600;font-size:13px;margin-bottom:8px;' }
        });

        const v2 = this.getV2();
        const featuresList = section.createDiv({ attr: { style: 'display:flex;flex-direction:column;gap:6px;' } });

        for (const dim of FEATURE_DIMENSIONS_V2) {
            const dimData = v2.features[dim.key];
            const featureEl = featuresList.createDiv({
                attr: { style: 'border:1px solid var(--background-modifier-border);border-radius:6px;overflow:hidden;' }
            });

            const header = featureEl.createDiv({
                attr: { style: 'padding:8px 12px;display:flex;align-items:center;justify-content:space-between;cursor:pointer;background:var(--background-secondary);' }
            });
            const headerLeft = header.createDiv({
                attr: { style: 'display:flex;align-items:center;gap:8px;' }
            });
            headerLeft.createEl('span', {
                text: dim.name,
                attr: { style: 'font-weight:500;font-size:13px;' }
            });
            // 数据状态徽章
            const statusColor = this.getStatusColor(dimData.status);
            headerLeft.createEl('span', {
                text: DIMENSION_STATUS_LABELS[dimData.status],
                attr: {
                    style: `padding:1px 6px;font-size:10px;border-radius:8px;background:${statusColor.bg};color:${statusColor.fg};`
                }
            });
            // V1 来源标记
            if (!dim.fromV1) {
                headerLeft.createEl('span', {
                    text: '🆕',
                    attr: { style: 'font-size:10px;', title: 'V2 新增维度' }
                });
            }
            header.createEl('span', {
                text: this.expandedFeatures[dim.key] ? '▼' : '▶',
                attr: { style: 'font-size:10px;color:var(--text-muted);' }
            });

            header.addEventListener('click', () => {
                this.expandedFeatures[dim.key] = !this.expandedFeatures[dim.key];
                this.render();
            });

            if (this.expandedFeatures[dim.key]) {
                const body = featureEl.createDiv({
                    attr: { style: 'padding:10px 12px;font-size:12px;line-height:1.6;color:var(--text-normal);border-top:1px solid var(--background-modifier-border);' }
                });

                // 描述
                body.createEl('div', {
                    text: dimData.description || '（暂无描述）',
                    attr: { style: 'margin-bottom:8px;' }
                });

                // 定量指标网格
                const metricsGrid = body.createDiv({
                    attr: { style: 'display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:6px;margin-bottom:8px;' }
                });
                const metrics = this.extractMetricsForDisplay(dim.key, dimData);
                for (const metric of metrics) {
                    const row = metricsGrid.createDiv({
                        attr: { style: 'padding:4px 8px;background:var(--background-primary);border-radius:4px;' }
                    });
                    row.createEl('div', {
                        text: metric.label,
                        attr: { style: 'font-size:10px;color:var(--text-muted);' }
                    });
                    row.createEl('div', {
                        text: metric.value,
                        attr: { style: 'font-size:12px;font-weight:600;color:var(--text-normal);' }
                    });
                }
                if (metrics.length === 0) {
                    body.createEl('div', {
                        text: '（暂无定量指标）',
                        attr: { style: 'color:var(--text-faint);font-size:11px;' }
                    });
                }

                // 代表性示例
                if (dimData.samples && dimData.samples.length > 0) {
                    body.createEl('div', {
                        text: '代表性示例:',
                        attr: { style: 'margin-top:8px;font-size:11px;color:var(--text-muted);margin-bottom:4px;' }
                    });
                    dimData.samples.forEach((sample, idx) => {
                        body.createEl('div', {
                            text: sample,
                            attr: {
                                style: 'padding:6px 8px;background:var(--background-secondary);border-radius:4px;font-size:11px;margin-bottom:4px;white-space:pre-wrap;word-break:break-word;'
                            }
                        });
                    });
                }
            }
        }
    }

    /** 获取状态对应颜色 */
    private getStatusColor(status: DimensionStatus): { bg: string; fg: string } {
        switch (status) {
            case 'complete':
                return { bg: 'rgba(16,185,129,0.2)', fg: 'var(--text-success, #10b981)' };
            case 'partial':
                return { bg: 'rgba(245,158,11,0.2)', fg: 'var(--text-warning, #f59e0b)' };
            case 'pending':
            default:
                return { bg: 'rgba(107,114,128,0.2)', fg: 'var(--text-muted)' };
        }
    }

    /** 提取维度定量指标用于展示 */
    private extractMetricsForDisplay(key: StyleDimensionKeyV2, dimData: unknown): Array<{ label: string; value: string }> {
        if (!dimData || typeof dimData !== 'object') return [];
        const obj = dimData as Record<string, unknown>;
        const formatRatio = (v: unknown) => typeof v === 'number' ? `${Math.round(v * 100)}%` : '—';
        const formatNumber = (v: unknown, suffix = '') => typeof v === 'number' ? `${v.toFixed(2)}${suffix}` : '—';

        switch (key) {
            case 'rhythm':
                return [
                    { label: '短句占比', value: formatRatio(obj.shortSentenceRatio) },
                    { label: '平均句长', value: formatNumber(obj.avgSentenceLength, ' 字') },
                    { label: '标点密度', value: formatNumber(obj.punctuationDensity, '/千字') },
                    { label: '段落密度', value: formatNumber(obj.paragraphDensity, '/千字') },
                ];
            case 'sentencePattern':
                return [
                    { label: '倒装句密度', value: formatNumber(obj.inversionDensity, '/千字') },
                    { label: '省略句密度', value: formatNumber(obj.ellipsisDensity, '/千字') },
                    { label: '排比句密度', value: formatNumber(obj.parallelismDensity, '/千字') },
                    { label: '从句嵌套深度', value: formatNumber(obj.clauseNestingDepth) },
                ];
            case 'wordChoice':
                return [
                    { label: '常用词比例', value: formatRatio(obj.commonWordRatio) },
                    { label: '生僻词比例', value: formatRatio(obj.rareWordRatio) },
                    { label: '虚词比例', value: formatRatio(obj.functionWordRatio) },
                    { label: '四字格密度', value: formatNumber(obj.fourCharIdiomDensity, '/千字') },
                ];
            case 'rhetoric':
                return [
                    { label: '比喻密度', value: formatNumber(obj.metaphorDensity, '/千字') },
                    { label: '拟人密度', value: formatNumber(obj.personificationDensity, '/千字') },
                    { label: '夸张密度', value: formatNumber(obj.hyperboleDensity, '/千字') },
                    { label: '对偶密度', value: formatNumber(obj.antithesisDensity, '/千字') },
                ];
            case 'perspective': {
                const pd = obj.personDistribution as Record<string, number> | undefined;
                return [
                    { label: '第一人称', value: pd ? formatRatio(pd.first) : '—' },
                    { label: '第三人称', value: pd ? formatRatio(pd.third) : '—' },
                    { label: '视角切换频率', value: formatNumber(obj.perspectiveSwitchFrequency, '/千字') },
                ];
            }
            case 'emotion':
                return [
                    { label: '情绪基调', value: typeof obj.emotionalTone === 'string' ? obj.emotionalTone : '—' },
                    { label: '情绪波动频率', value: formatNumber(obj.emotionalFluctuationFrequency, '/千字') },
                ];
            case 'tension':
                return [
                    { label: '悬念密度', value: formatNumber(obj.suspenseDensity, '/千字') },
                    { label: '冲突频率', value: formatNumber(obj.conflictFrequency, '/千字') },
                    { label: '转折句密度', value: formatNumber(obj.turningPointDensity, '/千字') },
                ];
            case 'infoDensity':
                return [
                    { label: '信息密度', value: formatNumber(obj.infoDensity, '/百字') },
                    { label: '专有名词密度', value: formatNumber(obj.properNounDensity, '/千字') },
                    { label: '设定植入频率', value: formatNumber(obj.settingInjectionFrequency, '/千字') },
                ];
            case 'dialogue':
                return [
                    { label: '对话占比', value: formatRatio(obj.dialogueRatio) },
                    { label: '对话风格', value: typeof obj.dialogueStyleTag === 'string' ? obj.dialogueStyleTag : '—' },
                    { label: '个性化程度', value: formatRatio(obj.personalizationLevel) },
                    { label: '潜台词比例', value: formatRatio(obj.subtextRatio) },
                ];
            case 'description':
                return [
                    { label: '环境描写占比', value: formatRatio(obj.environmentDescriptionRatio) },
                    { label: '细节密度', value: formatNumber(obj.detailDensity, '/百字') },
                ];
            case 'narration':
                return [
                    { label: '叙事速度', value: formatNumber(obj.narrationSpeed, '/千字') },
                    { label: '时间跳跃频率', value: formatNumber(obj.timeJumpFrequency, '/千字') },
                    { label: '场景切换频率', value: formatNumber(obj.sceneSwitchFrequency, '/千字') },
                ];
            case 'languageTexture':
                return [
                    { label: '书面化程度', value: formatRatio(obj.writtenLevel) },
                    { label: '口语化程度', value: formatRatio(obj.colloquialLevel) },
                    { label: '古风化程度', value: formatRatio(obj.archaismLevel) },
                    { label: '地域特色词', value: formatNumber(obj.regionalWordDensity, '/千字') },
                ];
            default:
                return [];
        }
    }

    private renderSamples(container: HTMLElement, fp: StyleFingerprint): void {
        const section = container.createDiv({ attr: { style: 'margin-bottom:16px;' } });
        const header = section.createDiv({ attr: { style: 'display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;' } });
        header.createEl('span', { text: '示例片段', attr: { style: 'font-weight:600;font-size:13px;' } });
        header.createEl('span', { text: `共 ${fp.samples.length} 段`, attr: { style: 'font-size:11px;color:var(--text-muted);' } });

        const samplesList = section.createDiv({
            attr: { style: 'max-height:300px;overflow-y:auto;display:flex;flex-direction:column;gap:8px;padding:4px;' }
        });

        if (fp.samples.length === 0) {
            samplesList.createDiv({
                attr: { style: 'padding:20px;text-align:center;color:var(--text-faint);font-size:12px;' },
                text: '暂无示例片段'
            });
            return;
        }

        fp.samples.forEach((sample, idx) => {
            const sampleEl = samplesList.createDiv({
                attr: {
                    style: 'padding:10px 12px;border:1px solid var(--background-modifier-border);border-radius:4px;font-size:12px;line-height:1.6;color:var(--text-normal);background:var(--background-primary);'
                }
            });
            const idxLabel = sampleEl.createEl('div', {
                text: `片段 ${idx + 1}`,
                attr: { style: 'font-size:11px;color:var(--text-muted);margin-bottom:4px;' }
            });
            const textEl = sampleEl.createEl('div', {
                attr: { style: 'white-space:pre-wrap;word-break:break-word;' }
            });
            textEl.textContent = sample;
        });
    }

    private renderActions(container: HTMLElement, fp: StyleFingerprint): void {
        const canEdit = this.options.canEdit !== false;
        const btnRow = container.createDiv({ attr: { style: 'display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;' } });

        if (this.options.onToggle) {
            const toggleBtn = btnRow.createEl('button', {
                text: fp.enabled ? '⏸ 禁用' : '✅ 启用',
                attr: {
                    type: 'button',
                    style: 'padding:6px 14px;cursor:pointer;border:1px solid var(--background-modifier-border);border-radius:4px;font-size:12px;'
                }
            });
            toggleBtn.addEventListener('click', () => {
                this.options.onToggle?.(fp);
                this.options.fingerprint.enabled = !fp.enabled;
                this.render();
            });
        }

        if (canEdit && this.options.onReextract) {
            const reextractBtn = btnRow.createEl('button', {
                text: '🔄 重新提取',
                attr: {
                    type: 'button',
                    style: 'padding:6px 14px;cursor:pointer;border:1px solid var(--background-modifier-border);border-radius:4px;font-size:12px;'
                }
            });
            reextractBtn.addEventListener('click', () => {
                if (!confirm('确定要重新提取该指纹吗？现有数据将被覆盖。')) return;
                this.options.onReextract?.(fp);
            });
        }

        // 强度调节入口（V2 Task 7）
        if (this.options.onOpenIntensity) {
            const intensityBtn = btnRow.createEl('button', {
                text: '🎚 强度调节',
                attr: {
                    type: 'button',
                    style: 'padding:6px 14px;cursor:pointer;border:1px solid var(--background-modifier-border);border-radius:4px;font-size:12px;background:var(--background-primary);'
                }
            });
            intensityBtn.addEventListener('click', () => {
                this.options.onOpenIntensity?.(fp);
            });
        }

        if (canEdit && this.options.onDelete) {
            const deleteBtn = btnRow.createEl('button', {
                text: '🗑 删除',
                attr: {
                    type: 'button',
                    style: 'padding:6px 14px;cursor:pointer;border:1px solid var(--background-modifier-error);border-radius:4px;font-size:12px;color:var(--text-error);background:transparent;'
                }
            });
            deleteBtn.addEventListener('click', () => {
                if (!confirm(`确定要删除指纹「${fp.name}」吗？此操作不可恢复。`)) return;
                this.options.onDelete?.(fp);
                this.close();
            });
        }

        const closeBtn = btnRow.createEl('button', {
            text: '关闭',
            attr: {
                type: 'button',
                style: 'padding:6px 14px;cursor:pointer;background:var(--interactive-accent);color:var(--text-on-accent);border:none;border-radius:4px;font-size:12px;'
            }
        });
        closeBtn.addEventListener('click', () => this.close());
    }
}
