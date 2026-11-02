import { App, Modal, Notice } from 'obsidian';
import { OperationConfirmModal } from './components/progress';
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
    onToggle?: (fp: StyleFingerprint) => void | Promise<void>;
    /**
     * 真实生效状态解析。全局层生效状态是「项目级覆盖优先」，
     * 直接读 fp.enabled 会显示成全局默认值，与列表里的开关不一致。
     */
    resolveEffectiveEnabled?: (fp: StyleFingerprint) => boolean;
    onReextract?: (fp: StyleFingerprint) => void;
    onDelete?: (fp: StyleFingerprint) => void;
    /** 打开强度调节 Modal 回调 */
    onOpenIntensity?: (fp: StyleFingerprint) => void;
}

/**
 * FingerprintDetailModal 类。
 */
export class FingerprintDetailModal extends Modal {
    private options: FingerprintDetailModalOptions;
    private expandedFeatures: Record<string, boolean> = {};
    /** V2 转换结果（懒加载） */
    private v2Fingerprint: V2Fingerprint | null = null;

    constructor(app: App, options: FingerprintDetailModalOptions) {
        super(app);
        this.options = options;
        // V1 与 V2 的维度 key 不同（sentenceRhythm vs rhythm），两套都要初始化，
        // 否则 V2 的 12 个区块会全部默认折叠。
        for (const dim of FEATURE_DIMENSIONS) {
            this.expandedFeatures[dim.key] = true;
        }
        for (const dim of FEATURE_DIMENSIONS_V2) {
            this.expandedFeatures[dim.key] = true;
        }
    }

    /**
     * onOpen 方法。
     */
    onOpen() {
        this.modalEl.addClass('nw-scope');
        this.render();
    }

    /**
     * onClose 方法。
     */
    onClose() {
        this.contentEl.empty();
    }

    /** 懒加载 V2 转换（migrateV1ToV2 是纯函数，无副作用） */
    private getV2(): V2Fingerprint {
        if (!this.v2Fingerprint) {
            // 优先读库里已存在的 V2（含逐维样本与量化值）；没有才从 V1 七维推导。
            // 旧实现一律重新推导，导致已落盘的 V2 数据在详情页永远看不到。
            const stored = this.options.library?.getV2Fingerprint?.(this.options.fingerprint.id);
            this.v2Fingerprint = stored
                ?? migrateV1ToV2(this.options.fingerprint, this.options.fingerprint.scope);
        }
        return this.v2Fingerprint;
    }

    /** 该指纹当前是否真的生效（优先用调用方的项目级覆盖解析） */
    private isEnabled(fp: StyleFingerprint): boolean {
        return this.options.resolveEffectiveEnabled?.(fp) ?? fp.enabled;
    }

    /**
     * 开关落盘后从库里取回最新对象再重渲染。
     * 只重渲染不刷新的话，options.fingerprint 还是 Modal 打开时捕获的旧对象，
     * 徽标与按钮文案会停在上一次的状态。
     */
    private refreshFromLibrary(): void {
        const lib = this.options.library;
        const { id, scope } = this.options.fingerprint;
        const next = scope === 'template'
            ? lib?.getTemplate(id)
            : scope === 'project'
                ? lib?.getProject(id)
                : lib?.getGlobal(id);
        if (!next || next === this.options.fingerprint) return;
        this.options.fingerprint = next;
        this.v2Fingerprint = null;
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

        contentEl.createEl('h3', { text: `🔍 ${fp.name}`, cls: 'nw-u-margintop-0 nw-u-marginbottom-8px-2' });

        this.renderBasicInfo(contentEl, fp);
        this.renderStats(contentEl, fp);
        this.renderV2Features(contentEl);
        this.renderSamples(contentEl, fp);
        this.renderActions(contentEl, fp);
    }

    private renderBasicInfo(container: HTMLElement, fp: StyleFingerprint): void {
        const section = container.createDiv({ cls: 'nw-u-marginbottom-16px-2 nw-u-p-12px-2 nw-u-bg-background-secondary-2 nw-u-brd-6px-2' });
        section.createEl('div', { text: '基本信息', cls: 'nw-u-fwt-600-2 nw-u-fs-13px-2 nw-u-marginbottom-8px-2' });

        const grid = section.createDiv({ cls: 'nw-u-d-grid-2 nw-u-gtc-1fr-1fr-2 nw-u-gap-8px-16px nw-u-fs-12px-2' });

        this.renderInfoRow(grid, '名称', fp.name);
        this.renderInfoRow(grid, '来源', fp.source);
        this.renderInfoRow(grid, '字数', formatWordCount(fp.stats.wordCount));
        this.renderInfoRow(grid, '提取时间', formatDateTime(fp.extractedAt));
        const scopeLabel = fp.scope === 'global' ? '全局' : fp.scope === 'template' ? '模板' : '项目';
        this.renderInfoRow(grid, '作用域', scopeLabel);
        this.renderInfoRow(grid, '状态', this.isEnabled(fp) ? '✅ 已启用' : '⏸ 已禁用');
    }

    private renderInfoRow(container: HTMLElement, label: string, value: string): void {
        const row = container.createDiv({ cls: 'nw-u-d-flex-2 nw-u-gap-6px-2' });
        row.createEl('span', { text: `${label}:`, cls: 'nw-u-c-text-muted-2 nw-u-minw-56px' });
        row.createEl('span', { text: value, cls: 'nw-u-c-text-normal-2' });
    }

    private renderStats(container: HTMLElement, fp: StyleFingerprint): void {
        const section = container.createDiv({ cls: 'nw-u-marginbottom-16px-2' });
        section.createEl('div', { text: '数据可视化', cls: 'nw-u-fwt-600-2 nw-u-fs-13px-2 nw-u-marginbottom-10px-2' });

        const statsGrid = section.createDiv({ cls: 'nw-u-d-grid-2 nw-u-gtc-1fr-1fr-2 nw-u-gap-12px-2 nw-u-marginbottom-12px-2' });

        const statCards = [
            { label: '平均句长', value: `${fp.stats.avgSentenceLength} 字` },
            { label: '平均段长', value: `${fp.stats.avgParagraphLength} 字` },
            { label: '对话占比', value: `${Math.round(fp.stats.dialogueRatio * 100)}%` },
            { label: '描写占比', value: `${Math.round(fp.stats.descriptionRatio * 100)}%` },
        ];

        for (const stat of statCards) {
            const card = statsGrid.createDiv({
                cls: 'nw-u-p-10px-12px-2 nw-u-bg-background-secondary-2 nw-u-brd-6px-2 nw-u-d-flex-2 nw-u-fd-column-2 nw-u-gap-4px-2'
            });
            card.createEl('span', { text: stat.label, cls: 'nw-u-fs-11px-2 nw-u-c-text-muted-2' });
            card.createEl('span', { text: stat.value, cls: 'nw-u-fs-16px-2 nw-u-fwt-600-2 nw-u-c-text-normal-2' });
        }

        const chartsRow = section.createDiv({ cls: 'nw-u-d-grid-2 nw-u-gtc-1fr-1fr-2 nw-u-gap-12px-2 nw-u-marginbottom-12px-2' });

        // V2 12 维雷达图（基于维度数据状态评分，移除旧估算函数）
        const radarCard = chartsRow.createDiv({
            cls: 'nw-u-p-12px-2 nw-u-bg-background-secondary-2 nw-u-brd-6px-2 nw-u-d-flex-2 nw-u-fd-column-2 nw-u-ai-center-2'
        });
        radarCard.createEl('div', { text: '风格维度雷达图（V2 12 维）', cls: 'nw-u-fs-12px-2 nw-u-fwt-500-2 nw-u-marginbottom-8px-2' });

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
            cls: 'nw-u-p-12px-2 nw-u-bg-background-secondary-2 nw-u-brd-6px-2'
        });
        donutCard.createEl('div', { text: '内容占比分布', cls: 'nw-u-fs-12px-2 nw-u-fwt-500-2 nw-u-marginbottom-8px-2' });

        const narrationRatio = Math.max(0, 1 - fp.stats.dialogueRatio - fp.stats.descriptionRatio);
        const donutData = [
            { label: '对话', value: Math.round(fp.stats.dialogueRatio * 100), color: '#7c3aed' },
            { label: '描写', value: Math.round(fp.stats.descriptionRatio * 100), color: '#ec4899' },
            { label: '叙述', value: Math.round(narrationRatio * 100), color: '#10b981' },
        ];
        donutCard.innerHTML += donutChart(donutData, { size: 220 });

        const barCard = section.createDiv({
            cls: 'nw-u-p-12px-2 nw-u-bg-background-secondary-2 nw-u-brd-6px-2'
        });
        barCard.createEl('div', { text: '平均长度统计', cls: 'nw-u-fs-12px-2 nw-u-fwt-500-2 nw-u-marginbottom-8px-2' });

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
        const row = container.createDiv({ cls: 'nw-u-d-flex-2 nw-u-jc-space-between-2 nw-u-gap-8px-2' });
        row.createEl('span', { text: label, cls: 'nw-u-c-text-muted-2' });
        row.createEl('span', { text: value, cls: 'nw-u-c-text-normal-2 nw-u-fwt-500-2' });
    }

    private renderV2Features(container: HTMLElement): void {
        const section = container.createDiv({ cls: 'nw-u-marginbottom-16px-2' });
        section.createEl('div', {
            text: '风格特征（V2 12 维详情）',
            cls: 'nw-u-fwt-600-2 nw-u-fs-13px-2 nw-u-marginbottom-8px-2'
        });

        const v2 = this.getV2();
        const featuresList = section.createDiv({ cls: 'nw-u-d-flex-2 nw-u-fd-column-2 nw-u-gap-6px-2' });

        for (const dim of FEATURE_DIMENSIONS_V2) {
            const dimData = v2.features[dim.key];
            const featureEl = featuresList.createDiv({
                cls: 'nw-u-b-1px-solid-background-m-2 nw-u-brd-6px-2 nw-u-ov-hidden-2'
            });

            const header = featureEl.createDiv({
                cls: 'nw-u-p-8px-12px-2 nw-u-d-flex-2 nw-u-ai-center-2 nw-u-jc-space-between-2 nw-u-cur-pointer-2 nw-u-bg-background-secondary-2'
            });
            const headerLeft = header.createDiv({
                cls: 'nw-u-d-flex-2 nw-u-ai-center-2 nw-u-gap-8px-2'
            });
            headerLeft.createEl('span', {
                text: dim.name,
                cls: 'nw-u-fwt-500-2 nw-u-fs-13px-2'
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
                cls: 'nw-u-fs-10px-2 nw-u-c-text-muted-2'
            });

            header.addEventListener('click', () => {
                this.expandedFeatures[dim.key] = !this.expandedFeatures[dim.key];
                this.render();
            });

            if (this.expandedFeatures[dim.key]) {
                const body = featureEl.createDiv({
                    cls: 'nw-u-p-10px-12px-2 nw-u-fs-12px-2 nw-u-lh-1-6-2 nw-u-c-text-normal-2 nw-u-bt-1px-solid-background-m-2'
                });

                // 描述
                body.createEl('div', {
                    text: dimData.description || '（暂无描述）',
                    cls: 'nw-u-marginbottom-8px-2'
                });

                // 定量指标网格
                const metricsGrid = body.createDiv({
                    cls: 'nw-u-d-grid-2 nw-u-gtc-repeat-auto-fit-minmax-6 nw-u-gap-6px-2 nw-u-marginbottom-8px-2'
                });
                const metrics = this.extractMetricsForDisplay(dim.key, dimData);
                for (const metric of metrics) {
                    const row = metricsGrid.createDiv({
                        cls: 'nw-u-p-4px-8px-2 nw-u-bg-background-primary-2 nw-u-brd-4px-2'
                    });
                    row.createEl('div', {
                        text: metric.label,
                        cls: 'nw-u-fs-10px-2 nw-u-c-text-muted-2'
                    });
                    row.createEl('div', {
                        text: metric.value,
                        cls: 'nw-u-fs-12px-2 nw-u-fwt-600-2 nw-u-c-text-normal-2'
                    });
                }
                if (metrics.length === 0) {
                    body.createEl('div', {
                        text: '（暂无定量指标）',
                        cls: 'nw-u-c-text-faint-2 nw-u-fs-11px-2'
                    });
                }

                // 代表性示例
                if (dimData.samples && dimData.samples.length > 0) {
                    body.createEl('div', {
                        text: '代表性示例:',
                        cls: 'nw-u-margintop-8px-2 nw-u-fs-11px-2 nw-u-c-text-muted-2 nw-u-marginbottom-4px-2'
                    });
                    dimData.samples.forEach((sample, idx) => {
                        body.createEl('div', {
                            text: sample,
                            cls: 'nw-u-p-6px-8px-2 nw-u-bg-background-secondary-2 nw-u-brd-4px-2 nw-u-fs-11px-2 nw-u-marginbottom-4px-2 nw-u-ws-pre-wrap nw-u-wordbreak-break-word'
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
        const section = container.createDiv({ cls: 'nw-u-marginbottom-16px-2' });
        const header = section.createDiv({ cls: 'nw-u-d-flex-2 nw-u-ai-center-2 nw-u-jc-space-between-2 nw-u-marginbottom-8px-2' });
        header.createEl('span', { text: '示例片段', cls: 'nw-u-fwt-600-2 nw-u-fs-13px-2' });
        header.createEl('span', { text: `共 ${fp.samples.length} 段`, cls: 'nw-u-fs-11px-2 nw-u-c-text-muted-2' });

        const samplesList = section.createDiv({
            cls: 'nw-u-maxh-300px-2 nw-u-ovy-auto-2 nw-u-d-flex-2 nw-u-fd-column-2 nw-u-gap-8px-2 nw-u-p-4px'
        });

        if (fp.samples.length === 0) {
            samplesList.createDiv({
                cls: 'nw-u-p-20px-2 nw-u-ta-center-2 nw-u-c-text-faint-2 nw-u-fs-12px-2',
                text: '暂无示例片段'
            });
            return;
        }

        fp.samples.forEach((sample, idx) => {
            const sampleEl = samplesList.createDiv({
                cls: 'nw-u-p-10px-12px-2 nw-u-b-1px-solid-background-m-2 nw-u-brd-4px-2 nw-u-fs-12px-2 nw-u-lh-1-6-2 nw-u-c-text-normal-2 nw-u-bg-background-primary-2'
            });
            const idxLabel = sampleEl.createEl('div', {
                text: `片段 ${idx + 1}`,
                cls: 'nw-u-fs-11px-2 nw-u-c-text-muted-2 nw-u-marginbottom-4px-2'
            });
            const textEl = sampleEl.createEl('div', {
                cls: 'nw-u-ws-pre-wrap nw-u-wordbreak-break-word'
            });
            textEl.textContent = sample;
        });
    }

    private renderActions(container: HTMLElement, fp: StyleFingerprint): void {
        const canEdit = this.options.canEdit !== false;
        const btnRow = container.createDiv({ cls: 'nw-u-d-flex-2 nw-u-gap-8px-2 nw-u-jc-flex-end-2 nw-u-fwr-wrap-2' });

        if (this.options.onToggle) {
            const toggleBtn = btnRow.createEl('button', {
                text: this.isEnabled(fp) ? '⏸ 禁用' : '✅ 启用',
                attr: {
                    type: 'button',
                    style: 'padding:6px 14px;cursor:pointer;border:1px solid var(--background-modifier-border);border-radius:4px;font-size:12px;'
                }
            });
            toggleBtn.addEventListener('click', async () => {
                if (toggleBtn.disabled) return;
                toggleBtn.disabled = true;
                try {
                    // 只把对象交给调用方翻转并持久化，回来后按持久化结果重渲染。
                    // 曾经在这里又手动 `enabled = !enabled` 翻一次：调用方同步翻一次、
                    // 这里再翻回去，落盘的仍是翻转前的值 → 开关看起来点了没反应。
                    await this.options.onToggle?.(fp);
                    this.refreshFromLibrary();
                    this.render();
                } finally {
                    toggleBtn.disabled = false;
                }
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
            reextractBtn.addEventListener('click', async () => {
                const confirmed = await OperationConfirmModal.confirm(this.app, {
                    title: '重新提取指纹',
                    description: '确定要重新提取该指纹吗？现有数据将被覆盖。',
                    confirmText: '确认提取',
                    cancelText: '取消',
                });
                if (!confirmed) return;
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
            deleteBtn.addEventListener('click', async () => {
                const confirmed = await OperationConfirmModal.confirm(this.app, {
                    title: '删除指纹',
                    description: `确定要删除指纹「${fp.name}」吗？`,
                    warning: '此操作不可恢复',
                    confirmText: '确认删除',
                    cancelText: '取消',
                });
                if (!confirmed) return;
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
