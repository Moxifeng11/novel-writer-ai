/**
 * fingerprint-v2-detail.ts — 指纹详情面板的十二维结构化展示（V2）
 *
 * V2 指纹（version:'v2'）在磁盘上携带 12 维特征（描述/样本/状态）；
 * 详情面板此前只显示 V1 的 7 维字符串投影。本模块把 12 维渲染为
 * 独立小节，与 7 维区块互补。数据装配（buildV2FeatureRows）与
 * DOM 渲染（renderV2FeaturesSection）分离，前者可单测。
 */
import type { V2Fingerprint, StyleFingerprintFeaturesV2, StyleDimensionKeyV2, DimensionStatus } from '@/engine/style/style-dimensions-v2';

/** 单个维度的展示行。 */
export interface V2FeatureRow {
    key: StyleDimensionKeyV2;
    label: string;
    description: string;
    status: DimensionStatus;
    /** 最多展示 2 条代表性示例 */
    samples: string[];
}

/** 十二维的中文标签（展示顺序即此数组顺序）。 */
export const V2_FEATURE_LABELS: ReadonlyArray<{ key: StyleDimensionKeyV2; label: string }> = [
    { key: 'rhythm', label: '节奏' },
    { key: 'sentencePattern', label: '句式' },
    { key: 'wordChoice', label: '用词' },
    { key: 'rhetoric', label: '修辞' },
    { key: 'perspective', label: '视角' },
    { key: 'emotion', label: '情绪' },
    { key: 'tension', label: '张力' },
    { key: 'infoDensity', label: '信息量' },
    { key: 'dialogue', label: '对话' },
    { key: 'description', label: '描写' },
    { key: 'narration', label: '叙事' },
    { key: 'languageTexture', label: '语言质感' },
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
    return V2_FEATURE_LABELS.map(({ key, label }) => {
        const dim = features[key];
        return {
            key,
            label,
            description: (dim?.description || '').trim() || '样本未体现',
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
    const section = container.createDiv({ cls: 'nw-fingerprint-v2-section nw-mb-lg' });

    const titleRow = section.createDiv({
        cls: 'nw-u-d-flex-2 nw-u-ai-center-2 nw-u-gap-8px-2 nw-u-marginbottom-8px-2'
    });
    titleRow.createEl('h4', {
        text: '🧬 十二维结构化特征',
        cls: 'nw-fp-section-h4 nw-u-m-0-2'
    });
    titleRow.createEl('span', {
        text: '本地词表统计 · V2',
        cls: 'nw-u-fs-11px-2 nw-u-c-text-muted-2'
    });

    for (const row of buildV2FeatureRows(v2.features)) {
        const block = section.createDiv({ cls: 'nw-u-marginbottom-10px-2' });

        const head = block.createDiv({
            cls: 'nw-u-d-flex-2 nw-u-ai-center-2 nw-u-gap-6px-2 nw-u-marginbottom-4px-2'
        });
        head.createEl('span', {
            text: row.label,
            cls: 'nw-u-fs-12px-2 nw-u-c-text-muted-2'
        });
        if (row.status !== 'complete') {
            head.createEl('span', {
                text: '样本不足',
                cls: 'nw-u-fs-11px-2 nw-u-c-text-faint-2'
            });
        }

        block.createDiv({
            text: row.description,
            cls: 'nw-u-fs-13px-2 nw-u-lh-1-5-2 nw-u-p-8px-12px-2 nw-u-bg-background-secondary-2 nw-u-brd-4px-2'
        });

        if (row.samples.length > 0) {
            const sampleWrap = block.createDiv({
                cls: 'nw-u-margintop-4px-2 nw-u-fs-11px-2 nw-u-c-text-muted-2'
            });
            for (const sample of row.samples) {
                sampleWrap.createDiv({
                    text: `「${sample}」`,
                    cls: 'nw-u-marginbottom-2px-2'
                });
            }
        }
    }
}
