/**
 * password-modal.ts — API 密钥加密口令弹窗（F4，技术审计）
 *
 * 配套 core/crypto-service.ts 的 v2 口令派生：
 * - ask 模式：解密已加密密钥时输入口令
 * - set 模式：首次启用加密时设定口令（输入两次）
 *
 * 返回 Promise；用户取消或直接关闭弹窗 → resolve(null)。
 * 口令本身不经由任何持久化通道，仅由 CryptoService 存于内存（会话级）。
 */

import { App, Modal } from 'obsidian';


/**
 * PasswordModal 类。
 */
export class PasswordModal extends Modal {
    private readonly mode: 'ask' | 'set';
    private resolved = false;
    private resolve!: (password: string | null) => void;

    private constructor(app: App, mode: 'ask' | 'set') {
        super(app);
        this.mode = mode;
    }

    /**
     * 询问已有口令（解密场景）；取消/关闭返回 null
     *
     * @param app - Obsidian 应用实例
      * @returns 文本结果 或 null
     */
    static ask(app: App): Promise<string | null> {
        return new PasswordModal(app, 'ask').openAndWait();
    }

    /**
     * 设定新口令（首次加密场景）；两次输入须一致，取消/关闭返回 null
     *
     * @param app - Obsidian 应用实例
      * @returns 文本结果 或 null
     */
    static setup(app: App): Promise<string | null> {
        return new PasswordModal(app, 'set').openAndWait();
    }

    private openAndWait(): Promise<string | null> {
        return new Promise(resolve => {
            this.resolve = resolve;
            this.open();
        });
    }

    /**
     * onOpen 方法。
     */
    onOpen(): void {
        this.modalEl.addClass('nw-scope');
        const { contentEl } = this;
        contentEl.empty();

        if (this.mode === 'set') {
            contentEl.createEl('h2', { text: '🔐 设置密钥加密口令' });
            contentEl.createEl('p', {
                text: '为保存的 AI 服务商 API 密钥设置加密口令。口令不会写入任何文件，仅本次会话有效；Obsidian 重启后首次使用时需重新输入。忘记口令不会丢失数据——重新在设置中填入密钥即可。',
                cls: 'nw-password-modal-hint'
            });
        } else {
            contentEl.createEl('h2', { text: '🔑 输入加密口令' });
            contentEl.createEl('p', {
                text: 'API 密钥已启用口令加密，请输入口令以读取。',
                cls: 'nw-password-modal-hint'
            });
        }

        const inputEl = contentEl.createEl('input', { type: 'password' });
        inputEl.placeholder = '请输入口令';
        inputEl.addClass('nw-password-input');
        const confirmEl = this.mode === 'set'
            ? contentEl.createEl('input', { type: 'password' })
            : null;
        if (confirmEl) {
            confirmEl.placeholder = '再次输入以确认';
            confirmEl.addClass('nw-password-input');
        }

        const errorEl = contentEl.createEl('div', { cls: 'nw-password-error' });

        const buttonRow = contentEl.createEl('div', { cls: 'nw-password-button-row' });
        const cancelButton = buttonRow.createEl('button', { text: '取消', cls: 'nw-btn' });
        const okButton = buttonRow.createEl('button', { text: this.mode === 'set' ? '设置口令' : '解锁', cls: 'nw-btn nw-btn-primary' });

        const finish = (password: string | null) => {
            if (this.resolved) return;
            this.resolved = true;
            this.resolve(password);
            this.close();
        };

        const submit = () => {
            const value = inputEl.value;
            if (!value) {
                errorEl.setText('口令不能为空');
                return;
            }
            if (this.mode === 'set') {
                if (value.length < 6) {
                    errorEl.setText('口令至少 6 个字符');
                    return;
                }
                if (value !== confirmEl?.value) {
                    errorEl.setText('两次输入不一致');
                    return;
                }
            }
            finish(value);
        };

        okButton.onclick = submit;
        cancelButton.onclick = () => finish(null);
        inputEl.addEventListener('keydown', e => {
            if (e.key === 'Enter') submit();
        });
        if (confirmEl) {
            confirmEl.addEventListener('keydown', e => {
                if (e.key === 'Enter') submit();
            });
        }
        inputEl.focus();
    }

    /**
     * onClose 方法。
     */
    onClose(): void {
        // 用户直接关闭弹窗（Esc / 点遮罩）视同取消
        if (!this.resolved) {
            this.resolved = true;
            this.resolve(null);
        }
        this.contentEl.empty();
    }
}
