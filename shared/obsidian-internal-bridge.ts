/**
 * obsidian-internal-bridge.ts — 受控访问 Obsidian 未公开 API 的唯一出口
 *
 * 背景（社区审核视角）：`app.commands`、`app.setting` 不在公开 API 类型里，
 * 官方审核建议避免；但「打开插件设置页」「把命令派发给未被本插件注册的命令」
 * 没有公开替代。做法：把全部私有访问收口到本文件，统一做能力守卫 + 版本容错，
 * 其它业务代码一律不得直接触碰（门禁 `private-api` 会拦）。
 *
 * 每个函数都：
 *  - 先判 `typeof` 能力存在，缺能力时返回失败而不是抛错；
 *  - 注释说明为什么必须用私有 API。
 */

import type { App } from 'obsidian';

/** 私有 commands 桥的最小形状 */
interface CommandsBridge {
    listCommands?: () => Array<{ id: string; name?: string }>;
    executeCommandById?: (id: string) => boolean;
}

/** 私有 setting 桥的最小形状 */
interface SettingBridge {
    open?: () => void;
    openTabById?: (id: string) => void;
}

/**
 * 列出 Obsidian 已注册命令（id + 展示名；拿不到时返回空数组）。
 *
 * @param app - Obsidian 应用
 * @returns 命令列表
 */
export function listObsidianCommands(app: App): Array<{ id: string; name: string }> {
    const commands = (app as unknown as { commands?: CommandsBridge }).commands;
    if (typeof commands?.listCommands !== 'function') return [];
    try {
        return (commands.listCommands() ?? [])
            .map(command => ({ id: String(command?.id ?? ''), name: String(command?.name ?? '') }))
            .filter(command => command.id.length > 0);
    } catch {
        // silent-ok: 私有 API 结构变化时返回空列表，仅影响诊断计数
        return [];
    }
}

/**
 * 把命令 id 派发给 Obsidian 命令系统（本插件未注册的命令的兜底路由）。
 *
 * 为什么必须：用户/外部脚本可能调用其它插件或核心命令；本插件 registry 只登记自己的命令。
 *
 * @param app - Obsidian 应用
 * @param commandId - 命令 id
 * @returns 是否成功派发
 */
export function executeObsidianCommand(app: App, commandId: string): boolean {
    const commands = (app as unknown as { commands?: CommandsBridge }).commands;
    if (typeof commands?.executeCommandById !== 'function') return false;
    try {
        return commands.executeCommandById(commandId) === true;
    } catch {
        // silent-ok: 命令不存在/已卸载时返回 false，由调用方提示
        return false;
    }
}

/**
 * 打开某插件的设置页（Obsidian 无公开 API）。
 *
 * @param app - Obsidian 应用
 * @param pluginId - 插件 id
 * @returns 是否成功打开
 */
export function openPluginSettingsTab(app: App, pluginId: string): boolean {
    const setting = (app as unknown as { setting?: SettingBridge }).setting;
    if (typeof setting?.openTabById !== 'function') return false;
    try {
        setting.openTabById(pluginId);
        return true;
    } catch {
        // silent-ok: 设置页结构变化时返回 false，调用方提示用户手动打开
        return false;
    }
}

