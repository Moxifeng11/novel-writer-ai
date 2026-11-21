import { App, Modal } from 'obsidian';
import { t } from '@/i18n';
import { appendSanitizedHtml } from '@/ui/rendering/safe-html';
import { OperationConfirmModal } from './components/progress';
import { StyleFingerprint, StyleFingerprintLibrary } from '@/engine/style-fingerprint-library';
import { migrateV1ToV2 } from '@/engine/style/fingerprint-migrator';
import { V2Fingerprint, StyleDimensionKeyV2 } from '@/engine/style/style-dimensions-v2';
import { formatWordCount, formatDateTime, FEATURE_DIMENSIONS, FEATURE_DIMENSIONS_V2, dimensionNameV2, dimensionStatusLabel, getDimensionScore } from './fingerprint-utils';
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
        contentEl.addClass('nw-modal-content-85');

        contentEl.createEl('h3', { text: `🔍 ${fp.name}`, cls: 'nw-fp-modal-title' });

        this.renderBasicInfo(contentEl, fp);
        this.renderStats(contentEl, fp);
        this.renderV2Features(contentEl);
        this.renderSamples(contentEl, fp);
        this.renderActions(contentEl, fp);
    }

    private renderBasicInfo(container: HTMLElement, fp: StyleFingerprint): void {
        const section = container.createDiv({ cls: 'nw-fp-info-section' });
        section.createDiv({ text: t('fingerprint.detail.basicInfo'), cls: 'nw-fp-section-heading' });

        const grid = section.createDiv({ cls: 'nw-fp-info-grid' });

        this.renderInfoRow(grid, t('fingerprint.detail.name'), fp.name);
        this.renderInfoRow(grid, t('fingerprint.detail.source'), fp.source);
        this.renderInfoRow(grid, t('fingerprint.detail.wordCount'), formatWordCount(fp.stats.wordCount));
        this.renderInfoRow(grid, t('fingerprint.detail.extractedAt'), formatDateTime(fp.extractedAt));
        const scopeLabel = fp.scope === 'global' ? t('fingerprint.detail.scopeGlobal') : fp.scope === 'template' ? t('fingerprint.detail.scopeTemplate') : t('fingerprint.detail.scopeProject');
        this.renderInfoRow(grid, t('fingerprint.detail.scopeLabel'), scopeLabel);
        this.renderInfoRow(grid, t('fingerprint.detail.status'), this.isEnabled(fp) ? t('fingerprint.detail.enabled') : t('fingerprint.detail.disabled'));
    }

    private renderInfoRow(container: HTMLElement, label: string, value: string): void {
        const row = container.createDiv({ cls: 'nw-fp-info-row' });
        row.createSpan({ text: `${label}:`, cls: 'nw-fp-info-label' });
        row.createSpan({ text: value, cls: 'nw-fp-info-value' });
    }

    private renderStats(container: HTMLElement, fp: StyleFingerprint): void {
        const section = container.createDiv({ cls: 'nw-fp-detail-section' });
        section.createDiv({ text: t('fingerprint.detail.statsTitle'), cls: 'nw-fp-section-heading nw-fp-section-heading--spaced' });

        const statsGrid = section.createDiv({ cls: 'nw-fp-pair-grid' });

        const statCards = [
            { label: t('fingerprint.detail.avgSentenceLen'), value: `${fp.stats.avgSentenceLength}${t('fingerprint.metric.unit.char')}` },
            { label: t('fingerprint.detail.avgParaLen'), value: `${fp.stats.avgParagraphLength}${t('fingerprint.metric.unit.char')}` },
            { label: t('fingerprint.detail.dialogueRatio'), value: `${Math.round(fp.stats.dialogueRatio * 100)}%` },
            { label: t('fingerprint.detail.descriptionRatio'), value: `${Math.round(fp.stats.descriptionRatio * 100)}%` },
        ];

        for (const stat of statCards) {
            const card = statsGrid.createDiv({
                cls: 'nw-fp-stat-tile'
            });
            card.createSpan({ text: stat.label, cls: 'nw-fp-stat-tile-label' });
            card.createSpan({ text: stat.value, cls: 'nw-fp-stat-tile-value' });
        }

        const chartsRow = section.createDiv({ cls: 'nw-fp-pair-grid' });

        // V2 12 维雷达图（基于维度数据状态评分，移除旧估算函数）
        const radarCard = chartsRow.createDiv({
            cls: 'nw-fp-chart-card nw-fp-chart-card--center'
        });
        radarCard.createDiv({ text: t('fingerprint.detail.radarTitle'), cls: 'nw-fp-chart-title' });

        const v2 = this.getV2();
        const radarData = FEATURE_DIMENSIONS_V2.map(dim => {
            const dimData = v2.features[dim.key];
            return {
                label: dimensionNameV2(dim.key),
                value: getDimensionScore(dimData.status, this.extractMetricForRadar(dim.key, dimData)),
            };
        });
        appendSanitizedHtml(radarCard, radarChart(radarData, { size: 280 }));

        const donutCard = chartsRow.createDiv({
            cls: 'nw-fp-chart-card'
        });
        donutCard.createDiv({ text: t('fingerprint.detail.donutTitle'), cls: 'nw-fp-chart-title' });

        const narrationRatio = Math.max(0, 1 - fp.stats.dialogueRatio - fp.stats.descriptionRatio);
        const donutData = [
            { label: t('fingerprint.detail.donutDialogue'), value: Math.round(fp.stats.dialogueRatio * 100), color: '#7c3aed' },
            { label: t('fingerprint.detail.donutDescription'), value: Math.round(fp.stats.descriptionRatio * 100), color: '#ec4899' },
            { label: t('fingerprint.detail.donutNarration'), value: Math.round(narrationRatio * 100), color: '#10b981' },
        ];
        appendSanitizedHtml(donutCard, donutChart(donutData, { size: 220 }));

        const barCard = section.createDiv({
            cls: 'nw-fp-chart-card'
        });
        barCard.createDiv({ text: t('fingerprint.detail.barTitle'), cls: 'nw-fp-chart-title' });

        const barData = [
            { label: t('fingerprint.detail.avgSentenceLen'), value: fp.stats.avgSentenceLength },
            { label: t('fingerprint.detail.avgParaLen'), value: fp.stats.avgParagraphLength },
        ];
        appendSanitizedHtml(barCard, barChart(barData, { width: 400, height: 180 }));
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
                    ? Math.min(1, (obj.metaphorDensity) / 10)
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
                    ? Math.min(1, (obj.suspenseDensity) / 10)
                    : undefined;
            case 'infoDensity':
                return typeof obj.infoDensity === 'number'
                    ? Math.min(1, (obj.infoDensity) / 10)
                    : undefined;
            case 'dialogue':
                return typeof obj.dialogueRatio === 'number' ? obj.dialogueRatio : undefined;
            case 'description':
                return typeof obj.environmentDescriptionRatio === 'number'
                    ? obj.environmentDescriptionRatio
                    : undefined;
            case 'narration':
                return typeof obj.narrationSpeed === 'number'
                    ? Math.min(1, (obj.narrationSpeed) / 10)
                    : undefined;
            case 'languageTexture':
                return typeof obj.writtenLevel === 'number' ? obj.writtenLevel : undefined;
            case 'sentencePattern':
                return typeof obj.parallelismDensity === 'number'
                    ? Math.min(1, (obj.parallelismDensity) / 10)
                    : undefined;
            default:
                return undefined;
        }
    }

    private renderStatRow(container: HTMLElement, label: string, value: string): void {
        const row = container.createDiv({ cls: 'nw-fp-stat-row' });
        row.createSpan({ text: label, cls: 'nw-fp-stat-row-label' });
        row.createSpan({ text: value, cls: 'nw-fp-stat-row-value' });
    }

    private renderV2Features(container: HTMLElement): void {
        const section = container.createDiv({ cls: 'nw-fp-detail-section' });
        section.createDiv({
            text: t('fingerprint.detail.featuresTitle'),
            cls: 'nw-fp-section-heading'
        });

        const v2 = this.getV2();
        const featuresList = section.createDiv({ cls: 'nw-fp-dim-list' });

        for (const dim of FEATURE_DIMENSIONS_V2) {
            const dimData = v2.features[dim.key];
            const featureEl = featuresList.createDiv({
                cls: 'nw-fp-dim'
            });

            const header = featureEl.createDiv({
                cls: 'nw-fp-dim-head'
            });
            const headerLeft = header.createDiv({
                cls: 'nw-fp-dim-head-main'
            });
            headerLeft.createSpan({
                text: dimensionNameV2(dim.key),
                cls: 'nw-fp-dim-name'
            });
            // 数据状态徽章
            headerLeft.createSpan({
                text: dimensionStatusLabel(dimData.status),
                cls: `nw-fp-dim-status nw-fp-dim-status--${dimData.status}`,
            });
            // V1 来源标记
            if (!dim.fromV1) {
                headerLeft.createSpan({
                    text: '🆕',
                    cls: 'nw-fp-dim-new',
                    attr: { title: t('fingerprint.detail.newDimTitle') }
                });
            }
            header.createSpan({
                text: this.expandedFeatures[dim.key] ? '▼' : '▶',
                cls: 'nw-fp-dim-caret'
            });

            header.addEventListener('click', () => {
                this.expandedFeatures[dim.key] = !this.expandedFeatures[dim.key];
                this.render();
            });

            if (this.expandedFeatures[dim.key]) {
                const body = featureEl.createDiv({
                    cls: 'nw-fp-dim-body'
                });

                // 描述
                body.createDiv({
                    text: dimData.description || t('fingerprint.detail.noDesc'),
                    cls: 'nw-fp-dim-desc'
                });

                // 定量指标网格
                const metricsGrid = body.createDiv({
                    cls: 'nw-fp-metric-grid'
                });
                const metrics = this.extractMetricsForDisplay(dim.key, dimData);
                for (const metric of metrics) {
                    const row = metricsGrid.createDiv({
                        cls: 'nw-fp-metric'
                    });
                    row.createDiv({
                        text: metric.label,
                        cls: 'nw-fp-metric-label'
                    });
                    row.createDiv({
                        text: metric.value,
                        cls: 'nw-fp-metric-value'
                    });
                }
                if (metrics.length === 0) {
                    body.createDiv({
                        text: t('fingerprint.detail.noMetrics'),
                        cls: 'nw-fp-metric-empty'
                    });
                }

                // 代表性示例
                if (dimData.samples && dimData.samples.length > 0) {
                    body.createDiv({
                        text: t('fingerprint.detail.dimSamplesLabel'),
                        cls: 'nw-fp-dim-samples-label'
                    });
                    dimData.samples.forEach((sample, idx) => {
                        body.createDiv({
                            text: sample,
                            cls: 'nw-fp-dim-sample'
                        });
                    });
                }
            }
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
                    { label: t('fingerprint.metric.shortRatio'), value: formatRatio(obj.shortSentenceRatio) },
                    { label: t('fingerprint.metric.avgSentenceLen'), value: formatNumber(obj.avgSentenceLength, t('fingerprint.metric.unit.char')) },
                    { label: t('fingerprint.metric.punctuationDensity'), value: formatNumber(obj.punctuationDensity, t('fingerprint.metric.unit.perK')) },
                    { label: t('fingerprint.metric.paragraphDensity'), value: formatNumber(obj.paragraphDensity, t('fingerprint.metric.unit.perK')) },
                ];
            case 'sentencePattern':
                return [
                    { label: t('fingerprint.metric.inversionDensity'), value: formatNumber(obj.inversionDensity, t('fingerprint.metric.unit.perK')) },
                    { label: t('fingerprint.metric.ellipsisDensity'), value: formatNumber(obj.ellipsisDensity, t('fingerprint.metric.unit.perK')) },
                    { label: t('fingerprint.metric.parallelismDensity'), value: formatNumber(obj.parallelismDensity, t('fingerprint.metric.unit.perK')) },
                    { label: t('fingerprint.metric.clauseNestingDepth'), value: formatNumber(obj.clauseNestingDepth) },
                ];
            case 'wordChoice':
                return [
                    { label: t('fingerprint.metric.commonWordRatio'), value: formatRatio(obj.commonWordRatio) },
                    { label: t('fingerprint.metric.rareWordRatio'), value: formatRatio(obj.rareWordRatio) },
                    { label: t('fingerprint.metric.functionWordRatio'), value: formatRatio(obj.functionWordRatio) },
                    { label: t('fingerprint.metric.fourCharIdiomDensity'), value: formatNumber(obj.fourCharIdiomDensity, t('fingerprint.metric.unit.perK')) },
                ];
            case 'rhetoric':
                return [
                    { label: t('fingerprint.metric.metaphorDensity'), value: formatNumber(obj.metaphorDensity, t('fingerprint.metric.unit.perK')) },
                    { label: t('fingerprint.metric.personificationDensity'), value: formatNumber(obj.personificationDensity, t('fingerprint.metric.unit.perK')) },
                    { label: t('fingerprint.metric.hyperboleDensity'), value: formatNumber(obj.hyperboleDensity, t('fingerprint.metric.unit.perK')) },
                    { label: t('fingerprint.metric.antithesisDensity'), value: formatNumber(obj.antithesisDensity, t('fingerprint.metric.unit.perK')) },
                ];
            case 'perspective': {
                const pd = obj.personDistribution as Record<string, number> | undefined;
                return [
                    { label: t('fingerprint.metric.firstPerson'), value: pd ? formatRatio(pd.first) : '—' },
                    { label: t('fingerprint.metric.thirdPerson'), value: pd ? formatRatio(pd.third) : '—' },
                    { label: t('fingerprint.metric.perspectiveSwitchFreq'), value: formatNumber(obj.perspectiveSwitchFrequency, t('fingerprint.metric.unit.perK')) },
                ];
            }
            case 'emotion':
                return [
                    { label: t('fingerprint.metric.emotionalTone'), value: typeof obj.emotionalTone === 'string' ? obj.emotionalTone : '—' },
                    { label: t('fingerprint.metric.emotionalFluctuation'), value: formatNumber(obj.emotionalFluctuationFrequency, t('fingerprint.metric.unit.perK')) },
                ];
            case 'tension':
                return [
                    { label: t('fingerprint.metric.suspenseDensity'), value: formatNumber(obj.suspenseDensity, t('fingerprint.metric.unit.perK')) },
                    { label: t('fingerprint.metric.conflictFrequency'), value: formatNumber(obj.conflictFrequency, t('fingerprint.metric.unit.perK')) },
                    { label: t('fingerprint.metric.turningPointDensity'), value: formatNumber(obj.turningPointDensity, t('fingerprint.metric.unit.perK')) },
                ];
            case 'infoDensity':
                return [
                    { label: t('fingerprint.metric.infoDensity'), value: formatNumber(obj.infoDensity, t('fingerprint.metric.unit.perHundred')) },
                    { label: t('fingerprint.metric.properNounDensity'), value: formatNumber(obj.properNounDensity, t('fingerprint.metric.unit.perK')) },
                    { label: t('fingerprint.metric.settingInjectionFrequency'), value: formatNumber(obj.settingInjectionFrequency, t('fingerprint.metric.unit.perK')) },
                ];
            case 'dialogue':
                return [
                    { label: t('fingerprint.metric.dialogueRatio'), value: formatRatio(obj.dialogueRatio) },
                    { label: t('fingerprint.metric.dialogueStyleTag'), value: typeof obj.dialogueStyleTag === 'string' ? obj.dialogueStyleTag : '—' },
                    { label: t('fingerprint.metric.personalizationLevel'), value: formatRatio(obj.personalizationLevel) },
                    { label: t('fingerprint.metric.subtextRatio'), value: formatRatio(obj.subtextRatio) },
                ];
            case 'description':
                return [
                    { label: t('fingerprint.metric.environmentDescriptionRatio'), value: formatRatio(obj.environmentDescriptionRatio) },
                    { label: t('fingerprint.metric.detailDensity'), value: formatNumber(obj.detailDensity, t('fingerprint.metric.unit.perHundred')) },
                ];
            case 'narration':
                return [
                    { label: t('fingerprint.metric.narrationSpeed'), value: formatNumber(obj.narrationSpeed, t('fingerprint.metric.unit.perK')) },
                    { label: t('fingerprint.metric.timeJumpFrequency'), value: formatNumber(obj.timeJumpFrequency, t('fingerprint.metric.unit.perK')) },
                    { label: t('fingerprint.metric.sceneSwitchFrequency'), value: formatNumber(obj.sceneSwitchFrequency, t('fingerprint.metric.unit.perK')) },
                ];
            case 'languageTexture':
                return [
                    { label: t('fingerprint.metric.writtenLevel'), value: formatRatio(obj.writtenLevel) },
                    { label: t('fingerprint.metric.colloquialLevel'), value: formatRatio(obj.colloquialLevel) },
                    { label: t('fingerprint.metric.archaismLevel'), value: formatRatio(obj.archaismLevel) },
                    { label: t('fingerprint.metric.regionalWordDensity'), value: formatNumber(obj.regionalWordDensity, t('fingerprint.metric.unit.perK')) },
                ];
            default:
                return [];
        }
    }

    private renderSamples(container: HTMLElement, fp: StyleFingerprint): void {
        const section = container.createDiv({ cls: 'nw-fp-detail-section' });
        const header = section.createDiv({ cls: 'nw-fp-samples-head' });
        header.createSpan({ text: t('fingerprint.detail.samplesTitle'), cls: 'nw-fp-samples-title' });
        header.createSpan({ text: t('fingerprint.detail.samplesCount', { count: fp.samples.length }), cls: 'nw-fp-samples-count' });

        const samplesList = section.createDiv({
            cls: 'nw-fp-samples-list'
        });

        if (fp.samples.length === 0) {
            samplesList.createDiv({
                cls: 'nw-fp-detail-samples-empty',
                text: t('fingerprint.detail.samplesEmpty')
            });
            return;
        }

        fp.samples.forEach((sample, idx) => {
            const sampleEl = samplesList.createDiv({
                cls: 'nw-fp-sample'
            });
            sampleEl.createDiv({
                text: t('fingerprint.detail.sampleLabel', { n: idx + 1 }),
                cls: 'nw-fp-sample-label'
            });
            const textEl = sampleEl.createDiv({
                cls: 'nw-fp-sample-body'
            });
            textEl.textContent = sample;
        });
    }

    private renderActions(container: HTMLElement, fp: StyleFingerprint): void {
        const canEdit = this.options.canEdit !== false;
        const btnRow = container.createDiv({ cls: 'nw-fp-actions' });

        if (this.options.onToggle) {
            const toggleBtn = btnRow.createEl('button', {
                text: this.isEnabled(fp) ? t('fingerprint.detail.toggleDisable') : t('fingerprint.detail.toggleEnable'),
                cls: 'nw-fp-btn',
                attr: { type: 'button' },
            });
            toggleBtn.addEventListener('click', () => { void (async () => {
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
            })(); });
        }

        if (canEdit && this.options.onReextract) {
            const reextractBtn = btnRow.createEl('button', {
                text: t('fingerprint.detail.reextract'),
                cls: 'nw-fp-btn',
                attr: { type: 'button' },
            });
            reextractBtn.addEventListener('click', () => { void (async () => {
                const confirmed = await OperationConfirmModal.confirm(this.app, {
                    title: t('fingerprint.detail.reextractTitle'),
                    description: t('fingerprint.detail.reextractDesc'),
                    confirmText: t('fingerprint.detail.reextractOk'),
                    cancelText: t('common.cancel'),
                });
                if (!confirmed) return;
                this.options.onReextract?.(fp);
            })(); });
        }

        // 强度调节入口（V2 Task 7）
        if (this.options.onOpenIntensity) {
            const intensityBtn = btnRow.createEl('button', {
                text: t('fingerprint.detail.intensity'),
                cls: 'nw-fp-btn nw-fp-btn--plain',
                attr: { type: 'button' },
            });
            intensityBtn.addEventListener('click', () => {
                this.options.onOpenIntensity?.(fp);
            });
        }

        if (canEdit && this.options.onDelete) {
            const deleteBtn = btnRow.createEl('button', {
                text: t('fingerprint.detail.delete'),
                cls: 'nw-fp-btn nw-fp-btn--danger',
                attr: { type: 'button' },
            });
            deleteBtn.addEventListener('click', () => { void (async () => {
                const confirmed = await OperationConfirmModal.confirm(this.app, {
                    title: t('fingerprint.detail.deleteTitle'),
                    description: t('fingerprint.detail.deleteDesc', { name: fp.name }),
                    warning: t('fingerprint.detail.deleteWarning'),
                    confirmText: t('fingerprint.detail.deleteOk'),
                    cancelText: t('common.cancel'),
                });
                if (!confirmed) return;
                this.options.onDelete?.(fp);
                this.close();
            })(); });
        }

        const closeBtn = btnRow.createEl('button', {
            text: t('fingerprint.detail.close'),
            cls: 'nw-fp-btn nw-fp-btn--primary',
            attr: { type: 'button' },
        });
        closeBtn.addEventListener('click', () => this.close());
    }
}
