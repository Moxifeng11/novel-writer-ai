/**
 * fingerprint-v2-detail.ts — 指纹详情面板的十二维结构化展示（V2）
 *
 * V2 指纹（version:'v2'）在磁盘上携带 12 维特征（描述/样本/状态）；
 * 详情面板此前只显示 V1 的 7 维字符串投影。本模块把 12 维渲染为
 * 独立小节，与 7 维区块互补。数据装配（buildV2FeatureRows）与
 * DOM 渲染（renderV2FeaturesSection）分离，前者可单测。
 */
import { t } from '@/i18n';
import type { V2Fingerprint, StyleFingerprintFeaturesV2, StyleDimensionKeyV2, DimensionStatus } from '@/engine/style/style-dimensions-v2';
import { dimensionNameV2 } from '@/ui/fingerprint-utils';

/** 单个维度的展示行。 */
export interface V2FeatureRow {
    key: StyleDimensionKeyV2;
    label: string;
    description: string;
    status: DimensionStatus;
    /** 最多展示 2 条代表性示例 */
    samples: string[];
}

/** 十二维展示顺序（i18n 第16片：label 改 labelKey，随语言求值；顺序即渲染顺序）。 */
export const V2_FEATURE_LABELS: ReadonlyArray<{ key: StyleDimensionKeyV2; labelKey: string }> = [
    { key: 'rhythm', labelKey: 'fingerprint.dim.rhythm.name' },
    { key: 'sentencePattern', labelKey: 'fingerprint.dim.sentencePattern.name' },
    { key: 'wordChoice', labelKey: 'fingerprint.dim.wordChoice.name' },
    { key: 'rhetoric', labelKey: 'fingerprint.dim.rhetoric.name' },
    { key: 'perspective', labelKey: 'fingerprint.dim.perspective.name' },
    { key: 'emotion', labelKey: 'fingerprint.dim.emotion.name' },
    { key: 'tension', labelKey: 'fingerprint.dim.tension.name' },
    { key: 'infoDensity', labelKey: 'fingerprint.dim.infoDensity.name' },
    { key: 'dialogue', labelKey: 'fingerprint.dim.dialogue.name' },
    { key: 'description', labelKey: 'fingerprint.dim.description.name' },
    { key: 'narration', labelKey: 'fingerprint.dim.narration.name' },
    { key: 'languageTexture', labelKey: 'fingerprint.dim.languageTexture.name' },
];

const MAX_SAMPLES_PER_DIM = 2;

/**
 * 把十二维特征装配为展示行（纯函数）。
 *
 * @param features - V2 指纹的十二维特征
 * @returns 按固定顺序排列的展示行；description 为空时回退「样本未体现」
 *
 * @example
 * ```ts
 * const rows = buildV2FeatureRows(v2.features);
 * rows.filter(r => r.status !== 'complete'); // 样本不足的维度
 * ```
 */
export function buildV2FeatureRows(features: StyleFingerprintFeaturesV2): V2FeatureRow[] {
    return V2_FEATURE_LABELS.map(({ key, labelKey }) => {
        const dim = features[key];
        return {
            key,
            label: dimensionNameV2(key),
            description: (dim?.description || '').trim() || t('fingerprint.v2.noSample'),
            status: dim?.status ?? 'pending',
            samples: (dim?.samples || []).slice(0, MAX_SAMPLES_PER_DIM),
        };
    });
}

/**
 * 渲染十二维小节（追加到容器末尾；调用方保证 v2 为 version:'v2'）。
 *
 * @param container - 详情面板容器
 * @param v2 - V2 指纹
 *
 * @example
 * ```ts
 * const v2 = library.getV2Fingerprint(fp.id);
 * if (v2) renderV2FeaturesSection(panel, v2);
 * ```
 */
export function renderV2FeaturesSection(container: HTMLElement, v2: V2Fingerprint): void {
    const section = container.createDiv({ cls: 'nw-fingerprint-v2-section' });

    const titleRow = section.createDiv({
        cls: 'nw-fp-v2-title-row'
    });
    titleRow.createEl('h4', {
        text: t('fingerprint.v2.sectionTitle'),
        cls: 'nw-fp-section-h4 nw-fp-section-title'
    });
    titleRow.createEl('span', {
        text: t('fingerprint.v2.kindBadge'),
        cls: 'nw-fp-v2-kind'
    });

    for (const row of buildV2FeatureRows(v2.features)) {
        const block = section.createDiv({ cls: 'nw-fp-v2-dim' });

        const head = block.createDiv({
            cls: 'nw-fp-v2-dim-head'
        });
        head.createEl('span', {
            text: row.label,
            cls: 'nw-fp-v2-dim-label'
        });
        if (row.status !== 'complete') {
            head.createEl('span', {
                text: t('fingerprint.v2.sampleInsufficient'),
                cls: 'nw-fp-v2-dim-pending'
            });
        }

        block.createDiv({
            text: row.description,
            cls: 'nw-fp-v2-desc'
        });

        if (row.samples.length > 0) {
            const sampleWrap = block.createDiv({
                cls: 'nw-fp-v2-samples'
            });
            for (const sample of row.samples) {
                sampleWrap.createDiv({
                    text: `「${sample}」`,
                    cls: 'nw-fp-v2-sample'
                });
            }
        }
    }
}
