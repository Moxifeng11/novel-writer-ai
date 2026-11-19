/**
 * autosave-snapshot.ts — 高危自动保存字段的「恢复上次值」支持
 *
 * 背景（审计 A-15）：设置页改完即时落盘、没有撤销；供应商 Base URL 与 API Key
 * 这类字段填错会直接让请求全挂，用户唯一的退路是凭记忆手动改回去。
 *
 * 这里提供一个**进程内**快照（只存上一次值，不写盘、不持久化）：
 * 字段变更前 capture，变更后按钮可用，点击还原上一次值。
 */

/** 会话内「上一次值」快照：键 → 值。 */
export class AutoSaveSnapshot {
    private readonly previous = new Map<string, string>();

    /**
     * 记录某字段的上一次值。
     *
     * 同一个键只保留最早的一次（连续改两次仍能一次退回起点）。
     *
     * @param key - 快照键，建议 `<字段>:<对象 id>`
     * @param value - 变更前的值
     */
    capture(key: string, value: string): void {
        if (!this.previous.has(key)) this.previous.set(key, value);
    }

    /**
     * 读取某字段的上一次值。
     *
     * @param key - 快照键
     * @returns 上一次值；没有快照时为 undefined
     */
    get(key: string): string | undefined {
        return this.previous.get(key);
    }

    /**
     * 丢弃某字段的快照（还原之后调用）。
     *
     * @param key - 快照键
     */
    clear(key: string): void {
        this.previous.delete(key);
    }
}

/** 恢复按钮的构建参数。 */
export interface RestoreButtonOptions {
    /** 按钮文案（已 i18n） */
    label: string;
    /** 悬停说明（已 i18n） */
    title: string;
    /** 是否可用：无快照时禁用，避免点了没反应 */
    isAvailable: () => boolean;
    /** 点击后的还原动作 */
    onRestore: () => void | Promise<void>;
}

/**
 * 创建「恢复上次值」按钮。
 *
 * @param parent - 按钮要挂到的容器
 * @param options - 文案、可用性判断与还原动作
 * @returns 按钮与其刷新方法
 */
export function createRestoreButton(
    parent: HTMLElement,
    options: RestoreButtonOptions,
): { button: HTMLButtonElement; refresh: () => void } {
    const button = parent.createEl('button', {
        cls: 'nw-api-restore-btn',
        text: options.label,
        attr: { type: 'button', title: options.title },
    });
    const refresh = (): void => {
        button.disabled = !options.isAvailable();
    };
    refresh();
    button.onclick = () => {
        if (!options.isAvailable()) return;
        void options.onRestore();
    };
    return { button, refresh };
}
