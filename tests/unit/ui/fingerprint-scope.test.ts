/**
 * fingerprint-scope.test.ts — 模板层是「来源库」而非注入层
 *
 * 注入链（getEnabledFingerprints / getFingerprintPromptParts）只处理 project / global，
 * template 指纹的启用状态与强度没有消费方；三个 UI 入口必须用同一判定隐藏这两个控件，
 * 否则用户会以为「模板指纹启用了但正文没变化」。
 */

import { describe, it, expect } from 'vitest';
import { isSourceOnlyFingerprintScope } from '../../../ui/fingerprint-utils';

describe('fingerprint-utils — 模板层来源库判定', () => {
    it('template 视为来源库（隐藏启用/强度控件）', () => {
        expect(isSourceOnlyFingerprintScope('template')).toBe(true);
    });

    it('global / project 参与注入（保留控件）', () => {
        expect(isSourceOnlyFingerprintScope('global')).toBe(false);
        expect(isSourceOnlyFingerprintScope('project')).toBe(false);
    });
});
