import { describe, it, expect } from 'vitest';
import { ALIPAY_SUPPORT_CAPTION, describeAlipaySupport } from '../../../shared/support-author';
import { ALIPAY_SUPPORT_QR_DATA_URI } from '../../../shared/support-qr.generated';

/**
 * 「支持作者」展示信息（2026-11-09 用户要求：直接展示支付宝收钱码，账号方式作废）。
 *
 * 这里锁定纯展示契约：收钱码是有效内嵌图片、指引包含扫码、边界说明明确「不发起支付」。
 * 不做真实支付——纯客户端插件不能内嵌商户私钥（见 support-author.ts 注释）。
 */
describe('describeAlipaySupport（收钱码）', () => {
    it('收钱码以 data URI 内嵌且是有效图像', () => {
        // 格式不锁死：v4.83.0 把 39KB JPEG 换成 12KB 4 色 PNG（黑白模块更锐利、体积约 1/3）
        expect(ALIPAY_SUPPORT_QR_DATA_URI).toMatch(/^data:image\/(png|jpeg|webp);base64,/);
        // 生成物应包含实际图像数据（不是空占位）
        expect(ALIPAY_SUPPORT_QR_DATA_URI.length).toBeGreaterThan(10_000);
    });

    it('扫码指引提到支付宝扫一扫', () => {
        const info = describeAlipaySupport();
        expect(info.caption).toBe(ALIPAY_SUPPORT_CAPTION);
        expect(info.caption).toContain('支付宝');
        expect(info.caption).toContain('扫一扫');
    });

    it('不再展示转账账号', () => {
        const info = describeAlipaySupport();
        expect(JSON.stringify(info)).not.toContain('2667520188');
        expect(info).not.toHaveProperty('account');
    });

    it('边界说明明确自愿且不发起支付/不收集信息', () => {
        const info = describeAlipaySupport();
        expect(info.note).toContain('自愿');
        expect(info.note).toContain('不发起支付');
        expect(info.note).toContain('不收集');
    });
});
