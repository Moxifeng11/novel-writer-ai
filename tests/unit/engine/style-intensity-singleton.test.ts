/**
 * style-intensity-singleton.test.ts — StyleIntensityEngine 模块级单例测试
 *
 * 覆盖：
 *   - 多次 getStyleIntensityEngine() 返回同一实例
 *   - 共享实例与新建实例的计算结果一致（共享不改变行为）
 */

import { describe, it, expect } from 'vitest';
import {
    StyleIntensityEngine,
    getStyleIntensityEngine,
} from '../../../engine/style/style-intensity-engine';

describe('StyleIntensityEngine 共享单例', () => {
    it('两次 getStyleIntensityEngine() 返回同一实例', () => {
        const first = getStyleIntensityEngine();
        const second = getStyleIntensityEngine();

        expect(first).toBe(second);
    });

    it('共享实例与新建实例的 previewIntensity 结果一致', () => {
        const config = { globalIntensity: 0.5 };

        const sharedPreview = getStyleIntensityEngine().previewIntensity(config);
        const freshPreview = new StyleIntensityEngine().previewIntensity(config);

        expect(sharedPreview).toEqual(freshPreview);
    });
});
