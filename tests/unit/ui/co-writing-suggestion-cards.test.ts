import { describe, it, expect } from 'vitest';
import {
    associationConfidenceText,
    riskBadgeLabel,
    validationTitle,
} from '../../../ui/co-writing/suggestion-cards';

/**
 * 建议卡的纯文案决策：风险徽标、校验标题、联想置信度。
 * 这些文本直接展示给用户，锁定避免「高风险显示成中风险」这类回退。
 */
describe('co-writing suggestion-cards 文案', () => {
    it('高风险与中风险徽标区分', () => {
        expect(riskBadgeLabel('high')).toBe('⚠️ 剧透风险（高）');
        expect(riskBadgeLabel('medium')).toBe('⚠️ 剧透风险（中）');
    });

    it('降级优先于通过/风险', () => {
        expect(validationTitle(true, true)).toBe('⚠️ 校验未完成（结果无法解析）');
        expect(validationTitle(false, true)).toBe('✅ 验证通过');
        expect(validationTitle(false, false)).toBe('⚠️ 存在风险');
    });

    it('置信度四舍五入为百分比', () => {
        expect(associationConfidenceText(0.826)).toBe('置信 83%');
        expect(associationConfidenceText()).toBe('置信 0%');
    });
});
