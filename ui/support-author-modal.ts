/**
 * support-author-modal.ts — 「支持作者」面板（支付宝转账）
 *
 * 只展示收款账号与操作步骤：插件不发起支付、不读取支付信息。
 * 复制走 `navigator.clipboard`，失败时回退为「选中输入框内容」让用户手动复制
 * （移动端 WebView 偶尔拒绝 clipboard 权限）。
 */
import { Modal, Notice, Setting } from 'obsidian';
import { describeAlipaySupport } from '@/shared/support-author';
import { showSuccessNotice } from '@/ui/components/notice-helpers';

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

        const accountInput = contentEl.createEl('input', {
            type: 'text',
            value: info.account,
            cls: 'nw-input',
            attr: { readonly: 'readonly', 'aria-label': '支付宝账号' },
        });
        // 只读输入框：让用户可以手动选中/复制（clipboard 被拒时的兜底）
        accountInput.addEventListener('click', () => accountInput.select());

        new Setting(contentEl)
            .setName('支付宝账号')
            .setDesc('点击右侧复制，或直接选中账号')
            .addButton(btn => btn
                .setButtonText('📋 复制账号')
                .onClick(async () => {
                    try {
                        await navigator.clipboard.writeText(info.account);
                        showSuccessNotice('已复制支付宝账号', { timeout: 2000 });
                    } catch {
                        accountInput.select();
                        new Notice('已选中账号，请手动复制（Ctrl+C / 长按复制）', 4000);
                    }
                }));

        const stepsEl = contentEl.createEl('ol');
        for (const step of info.steps) {
            stepsEl.createEl('li', { text: step });
        }
        contentEl.createEl('p', { text: info.note, cls: 'nw-text-12-muted' });
    }

    /**
     * 关闭时清空内容。
     */
    onClose(): void {
        this.contentEl.empty();
    }
}
