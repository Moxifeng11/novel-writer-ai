import { App, Modal } from 'obsidian';
import { STORAGE_KEY_PREFIXES } from '../../../shared/storage-keys';

/**
 * 操作确认弹窗配置选项
 */
export interface OperationConfirmOptions {
	title: string;
	description: string;
	etaMin?: number;
	etaMax?: number;
	steps?: string[];
	confirmText?: string;
	cancelText?: string;
	rememberKey?: string;
	warning?: string;
}

/**
 * 通用操作确认弹窗组件
 *
 * 用于在执行耗时操作前向用户展示操作详情、预估时间和执行步骤，
 * 并支持"不再提示"功能以提升高频操作的使用体验。
 */
export class OperationConfirmModal extends Modal {
	private options: OperationConfirmOptions;
	private resolve: ((value: boolean) => void) | null = null;
	private rememberChecked = false;

	constructor(app: App, options: OperationConfirmOptions) {
		super(app);
		this.options = options;
	}

	/**
	 * 打开弹窗并返回 Promise
	 * @returns true 表示用户确认，false 表示用户取消
	 */
	openAndWait(): Promise<boolean> {
		return new Promise((resolve) => {
			this.resolve = resolve;
			this.open();
		});
	}

	/**
	 * 静态辅助方法，一行代码调用确认弹窗
	 *
	 * 如果提供了 rememberKey 且用户之前已勾选"不再提示"，
	 * 则直接返回 true，不显示弹窗。
	 * @param app - Obsidian 应用实例
	 * @param options - 配置项
	 * @returns 是否成功
	 */
	static confirm(app: App, options: OperationConfirmOptions): Promise<boolean> {
		if (options.rememberKey) {
			const stored = localStorage.getItem(STORAGE_KEY_PREFIXES.operationConfirm + options.rememberKey);
			if (stored === '1') {
				return Promise.resolve(true);
			}
		}
		const modal = new OperationConfirmModal(app, options);
		return modal.openAndWait();
	}

	/**
	 * 重置"不再提示"偏好
	 * @param rememberKey - 记忆键
	 */
	static resetRemember(rememberKey: string): void {
		localStorage.removeItem(STORAGE_KEY_PREFIXES.operationConfirm + rememberKey);
	}

	onOpen(): void {
		this.modalEl.addClass('nw-scope');

		const { contentEl } = this;
		contentEl.empty();

		const wrapper = contentEl.parentElement as HTMLElement;
		if (wrapper) {
			wrapper.addClass('nw-modal');
		}
		contentEl.style.width = '100%';
		contentEl.style.setProperty('overflow-y', 'auto', 'important');
		contentEl.style.maxWidth = '480px';

		this.render();
	}

	onClose(): void {
		this.contentEl.empty();
		if (this.resolve) {
			this.resolve(false);
			this.resolve = null;
		}
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();

		const header = contentEl.createDiv({
			attr: {
				style: 'padding: 20px 24px 16px; border-bottom: 1px solid var(--background-modifier-border);',
			},
		});
		header.createEl('h2', {
			text: this.options.title,
			attr: {
				style: 'margin: 0; font-size: 18px; font-weight: 600; color: var(--text-normal);',
			},
		});

		const body = contentEl.createDiv({
			attr: {
				style: 'padding: 16px 24px;',
			},
		});

		body.createEl('p', {
			text: this.options.description,
			attr: {
				style: 'margin: 0 0 16px 0; font-size: 14px; line-height: 1.6; color: var(--text-normal);',
			},
		});

		if (this.options.warning) {
			const warningBox = body.createDiv({
				attr: {
					style: 'padding: 12px 14px; background: rgba(249, 115, 22, 0.1); border: 1px solid rgba(249, 115, 22, 0.3); border-radius: 6px; margin-bottom: 16px;',
				},
			});
			warningBox.createEl('div', {
				text: '⚠️ ' + this.options.warning,
				attr: {
					style: 'font-size: 13px; line-height: 1.5; color: var(--text-warning, #f97316); font-weight: 500;',
				},
			});
		}

		if (this.options.etaMin !== undefined || this.options.etaMax !== undefined) {
			const etaBox = body.createDiv({
				attr: {
					style: 'display: flex; align-items: center; gap: 8px; padding: 10px 14px; background: var(--background-secondary); border-radius: 6px; margin-bottom: 16px;',
				},
			});
			etaBox.createEl('span', {
				text: '⏱️',
				attr: { style: 'font-size: 16px;' },
			});
			etaBox.createEl('span', {
				text: '预估时间：' + this.formatEta(),
				attr: {
					style: 'font-size: 13px; color: var(--text-muted); font-weight: 500;',
				},
			});
		}

		if (this.options.steps && this.options.steps.length > 0) {
			const stepsLabel = body.createEl('div', {
				text: '将执行以下步骤：',
				attr: {
					style: 'font-size: 13px; font-weight: 600; color: var(--text-normal); margin-bottom: 10px;',
				},
			});

			const stepsList = body.createDiv({
				attr: {
					style: 'display: flex; flex-direction: column; gap: 6px;',
				},
			});

			this.options.steps.forEach((step, index) => {
				const stepItem = stepsList.createDiv({
					attr: {
						style: 'display: flex; align-items: flex-start; gap: 10px; font-size: 13px; line-height: 1.5; color: var(--text-muted);',
					},
				});
				stepItem.createEl('span', {
					text: String(index + 1),
					attr: {
						style: 'display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; border-radius: 50%; background: var(--background-modifier-border); color: var(--text-muted); font-size: 11px; font-weight: 600; flex-shrink: 0; margin-top: 1px;',
					},
				});
				stepItem.createEl('span', { text: step });
			});
		}

		const footer = contentEl.createDiv({
			attr: {
				style: 'padding: 16px 24px 20px; border-top: 1px solid var(--background-modifier-border);',
			},
		});

		if (this.options.rememberKey) {
			const rememberRow = footer.createDiv({
				attr: {
					style: 'margin-bottom: 14px;',
				},
			});
			const label = rememberRow.createEl('label', {
				attr: {
					style: 'display: flex; align-items: center; gap: 8px; cursor: pointer; font-size: 13px; color: var(--text-muted);',
				},
			});
			const checkbox = label.createEl('input', {
				attr: {
					type: 'checkbox',
					style: 'cursor: pointer;',
				},
			});
			checkbox.addEventListener('change', () => {
				this.rememberChecked = checkbox.checked;
			});
			label.createSpan({ text: '不再提示此操作' });
		}

		const btnRow = footer.createDiv({
			attr: {
				style: 'display: flex; gap: 10px; justify-content: flex-end;',
			},
		});

		const cancelBtn = btnRow.createEl('button', {
			text: this.options.cancelText || '取消',
			cls: 'nw-btn nw-btn-secondary',
			attr: {
				type: 'button',
				style: 'padding: 8px 20px;',
			},
		});
		cancelBtn.addEventListener('click', () => {
			this.handleCancel();
		});

		const confirmBtn = btnRow.createEl('button', {
			text: this.options.confirmText || '开始',
			cls: 'nw-btn nw-btn-primary novel-writer-primary-button',
			attr: {
				type: 'button',
				style: 'padding: 8px 24px;',
			},
		});
		confirmBtn.addEventListener('click', () => {
			this.handleConfirm();
		});
	}

	private formatEta(): string {
		const { etaMin, etaMax } = this.options;

		if (etaMin === undefined && etaMax === undefined) return '';

		const min = etaMin ?? etaMax!;
		const max = etaMax ?? etaMin!;

		if (min === max) {
			return this.formatDuration(min);
		}

		return `${this.formatDuration(min)} - ${this.formatDuration(max)}`;
	}

	private formatDuration(ms: number): string {
		const seconds = Math.round(ms / 1000);

		if (seconds < 60) {
			return `${seconds} 秒`;
		}

		const minutes = seconds / 60;

		if (minutes < 1) {
			return `${seconds} 秒`;
		}

		if (minutes < 10) {
			const wholeMin = Math.floor(minutes);
			const secs = Math.round((minutes - wholeMin) * 60);
			if (secs === 0) {
				return `${wholeMin} 分钟`;
			}
			return `${wholeMin} 分 ${secs} 秒`;
		}

		return `${Math.round(minutes)} 分钟`;
	}

	private handleConfirm(): void {
		if (this.rememberChecked && this.options.rememberKey) {
			localStorage.setItem(STORAGE_KEY_PREFIXES.operationConfirm + this.options.rememberKey, '1');
		}
		if (this.resolve) {
			this.resolve(true);
			this.resolve = null;
		}
		this.close();
	}

	private handleCancel(): void {
		if (this.resolve) {
			this.resolve(false);
			this.resolve = null;
		}
		this.close();
	}
}
