import { describe, it, expect } from 'vitest';
import { ALIPAY_SUPPORT_ACCOUNT, describeAlipaySupport } from '../../../shared/support-author';

/**
 * 「支持作者」展示信息（2026-11-09 用户要求：设置页增加支付宝支持按钮）。
 *
 * 这里只锁定纯展示契约：账号形态、步骤包含转账指引、边界说明明确「不发起支付」。
 * 不做真实支付——纯客户端插件不能内嵌商户私钥（见 support-author.ts 注释）。
 */
describe('describeAlipaySupport', () => {
    it('账号是纯数字的收款账号', () => {
        expect(ALIPAY_SUPPORT_ACCOUNT).toMatch(/^\d{8,16}$/);
        expect(describeAlipaySupport().account).toBe(ALIPAY_SUPPORT_ACCOUNT);
    });

    it('步骤包含「打开支付宝 → 转账 → 输入账号」', () => {
        const info = describeAlipaySupport();
        const joined = info.steps.join(' ');
        expect(joined).toContain('支付宝');
        expect(joined).toContain('转账');
        expect(joined).toContain(ALIPAY_SUPPORT_ACCOUNT);
    });

    it('边界说明明确自愿且不发起支付/不收集信息', () => {
        const info = describeAlipaySupport();
        expect(info.note).toContain('自愿');
        expect(info.note).toContain('不发起支付');
        expect(info.note).toContain('不收集');
    });
});
