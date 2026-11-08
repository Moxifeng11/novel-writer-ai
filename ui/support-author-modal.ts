/**
 * support-author-modal.ts — 「支持作者」面板（支付宝收钱码）
 *
 * 直接展示静态收钱码图片（data URI 内嵌，社区市场只分发 main.js/manifest/styles），
 * 用户用支付宝扫码即可。插件不发起支付、不读取支付信息。
 */
import { Modal } from 'obsidian';
import { ALIPAY_SUPPORT_QR_DATA_URI } from '@/shared/support-qr.generated';
import { describeAlipaySupport } from '@/shared/support-author';

/** 支持作者面板 */
export class SupportAuthorModal extends Modal {
    /**
     * 打开面板时构建内容。
     */
    onOpen(): void {
        const info = describeAlipaySupport();
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h3', { text: `💝 ${info.title}` });
        contentEl.createEl('p', { text: info.intro });

        const qrWrap = contentEl.createDiv({ cls: 'nw-support-qr-wrap' });
        qrWrap.createEl('img', {
            cls: 'nw-support-qr-img',
            attr: {
                src: ALIPAY_SUPPORT_QR_DATA_URI,
                alt: '支付宝收钱码',
            },
        });
        qrWrap.createEl('p', { text: info.caption, cls: 'nw-support-qr-caption' });

        contentEl.createEl('p', { text: info.note, cls: 'nw-text-12-muted' });
    }

    /**
     * 关闭时清空内容。
     */
    onClose(): void {
        this.contentEl.empty();
    }
}
