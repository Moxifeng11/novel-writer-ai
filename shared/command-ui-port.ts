/**
 * command-ui-port.ts — 命令 UI 执行端口
 *
 * core 层不允许依赖 ui。命令注册表只为每个命令登记 id 与回调，
 * 真正需要构造 Modal / 打开视图的分支由 ui 层实现本端口，core 只做委托。
 */

import type { Editor } from 'obsidian';

/** 版本历史所需的当前文件上下文（由 core 解析后透传，避免 ui 重写路径判定） */
export interface VersionFileContext {
    project: string;
    contentType: 'chapter' | 'outline' | 'worldview' | 'character' | 'setting';
    contentKey: string;
    sourcePath: string;
    content: string;
}

/** 命令调用的可选载荷（编辑器 / 项目 / 版本上下文由 core 透传） */
export interface CommandUiPayload {
    editor?: Editor;
    project?: string;
    versionContext?: VersionFileContext;
}

export interface CommandUiPort {
    /**
     * 执行一个 UI 类命令。
     * @returns true = 已由 UI 层处理；false = 该 id 不属于 UI 执行器（core 不再兜底）
     */
    executeCommand(id: string, payload?: CommandUiPayload): Promise<boolean>;
}

/**
 * 缺省端口：未注入时命令不会静默丢失，而是返回 false。
 * 仅用于测试或初始化时序兜底，生产环境必须注入真实实现。
 */
export const NOOP_COMMAND_UI_PORT: CommandUiPort = {
    async executeCommand() {
        return false;
    },
};
