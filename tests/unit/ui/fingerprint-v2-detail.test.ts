import { describe, expect, it } from 'vitest';
import {
    buildV2FeatureRows,
    V2_FEATURE_LABELS,
} from '../../../ui/views/fingerprint-v2-detail';
import type { StyleFingerprintFeaturesV2 } from '../../../engine/style/style-dimensions-v2';

/**
 * 指纹详情面板十二维展示的数据装配（纯函数）：
 * 顺序固定、pending 维度可识别、空描述回退「样本未体现」、样本最多 2 条。
 * DOM 渲染（renderV2FeaturesSection）由真实 Electron E2E 覆盖，这里不测。
 */

function makeFeatures(over: Partial<Record<string, { description?: string; status?: 'complete' | 'pending'; samples?: string[] }>> = {}): StyleFingerprintFeaturesV2 {
    const features = {} as StyleFingerprintFeaturesV2;
    for (const { key } of V2_FEATURE_LABELS) {
        const o = over[key] ?? {};
        (features as unknown as Record<string, unknown>)[key] = {
            description: o.description ?? `${key} 的描述`,
            status: o.status ?? 'complete',
            samples: o.samples ?? [`${key}-示例1`, `${key}-示例2`, `${key}-示例3`],
        };
    }
    return features;
}

describe('buildV2FeatureRows', () => {
    it('按固定顺序输出 12 行，标签与键一一对应', () => {
        const rows = buildV2FeatureRows(makeFeatures());
        expect(rows).toHaveLength(12);
        expect(rows.map(r => r.key)).toEqual(V2_FEATURE_LABELS.map(l => l.key));
        expect(rows.map(r => r.label)).toEqual(V2_FEATURE_LABELS.map(l => l.label));
    });

    it('pending 维度可识别；空描述回退「样本未体现」', () => {
        const rows = buildV2FeatureRows(makeFeatures({
            emotion: { status: 'pending', description: '  ' },
        }));
        const emotion = rows.find(r => r.key === 'emotion')!;
        expect(emotion.status).toBe('pending');
        expect(emotion.description).toBe('样本未体现');
        const rhythm = rows.find(r => r.key === 'rhythm')!;
        expect(rhythm.status).toBe('complete');
        expect(rhythm.description).toBe('rhythm 的描述');
    });

    it('样本最多保留 2 条', () => {
        const rows = buildV2FeatureRows(makeFeatures({
            tension: { samples: ['甲', '乙', '丙'] },
        }));
        expect(rows.find(r => r.key === 'tension')!.samples).toEqual(['甲', '乙']);
    });
});
