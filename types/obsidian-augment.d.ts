/**
 * Obsidian 类型增强：声明插件自定义的 Workspace 事件。
 *
 * 背景：obsidian 1.13.0 的 `Workspace.on` / `Workspace.trigger` 只有针对内置事件名的
 * 字面量重载，没有 `string` 兜底重载，因此自定义事件名（如 `novel-writer:project-created`）
 * 会触发 TS2769。通过对 `Workspace` 接口做声明合并补充重载即可让自定义事件获得类型支持，
 * 同时保留对回调参数的类型检查（优于 `as any` 强转）。
 *
 * 事件命名规范：novel-writer:<domain>:<action>
 * - project: 项目生命周期（创建、切换、删除）
 * - settings: 设置变更（上下文范围、模型切换等）
 * - context: 上下文状态（涉及实体变更、面板刷新请求）
 * - entity: 实体数据（状态变更、新增删除）
 */
import 'obsidian';

/** 项目创建事件载荷 */
export interface NovelWriterProjectCreatedPayload {
    projectName: string;
    projectType: 'original' | 'fanfic';
}

/** 项目切换事件载荷 */
export interface NovelWriterProjectSwitchedPayload {
    projectName: string;
}

/** 设置变更事件载荷 */
export interface NovelWriterSettingsChangedPayload {
    keys: string[];
}

/** 上下文范围变更载荷 */
export interface NovelWriterContextScopeChangedPayload {
    scope: 'full' | 'compact';
}

/** 涉及实体变更载荷 */
export interface NovelWriterInvolvedEntitiesChangedPayload {
    project: string;
    chars: Set<string>;
    locs: Set<string>;
    factions: Set<string>;
    items: Set<string>;
}

/** 请求刷新上下文面板载荷 */
export interface NovelWriterRefreshContextPanelPayload {
    project?: string;
}

/** 正文写盘完成载荷（协同写作 / 批量 / 续写 / 自动写作统一广播） */
export interface NovelWriterBodyWrittenPayload {
    path: string;
}

declare module 'obsidian' {
    interface Workspace {
        // ─── project 域 ───
        on(
            name: 'novel-writer:project-created',
            callback: (data: NovelWriterProjectCreatedPayload) => void,
            ctx?: unknown,
        ): EventRef;
        trigger(
            name: 'novel-writer:project-created',
            data: NovelWriterProjectCreatedPayload,
        ): void;

        on(
            name: 'novel-writer:project-switched',
            callback: (data: NovelWriterProjectSwitchedPayload) => void,
            ctx?: unknown,
        ): EventRef;
        trigger(
            name: 'novel-writer:project-switched',
            data: NovelWriterProjectSwitchedPayload,
        ): void;

        // ─── settings 域 ───
        on(
            name: 'novel-writer:settings-changed',
            callback: (data: NovelWriterSettingsChangedPayload) => void,
            ctx?: unknown,
        ): EventRef;
        trigger(
            name: 'novel-writer:settings-changed',
            data: NovelWriterSettingsChangedPayload,
        ): void;

        on(
            name: 'novel-writer:context-scope-changed',
            callback: (data: NovelWriterContextScopeChangedPayload) => void,
            ctx?: unknown,
        ): EventRef;
        trigger(
            name: 'novel-writer:context-scope-changed',
            data: NovelWriterContextScopeChangedPayload,
        ): void;

        // ─── context 域 ───
        on(
            name: 'novel-writer:involved-entities-changed',
            callback: (data: NovelWriterInvolvedEntitiesChangedPayload) => void,
            ctx?: unknown,
        ): EventRef;
        trigger(
            name: 'novel-writer:involved-entities-changed',
            data: NovelWriterInvolvedEntitiesChangedPayload,
        ): void;

        on(
            name: 'novel-writer:refresh-context-panel',
            callback: (data: NovelWriterRefreshContextPanelPayload) => void,
            ctx?: unknown,
        ): EventRef;
        trigger(
            name: 'novel-writer:refresh-context-panel',
            data: NovelWriterRefreshContextPanelPayload,
        ): void;

        on(
            name: 'novel-writer:run-targeted-revision',
            callback: (data: Record<string, never>) => void,
            ctx?: unknown,
        ): EventRef;
        trigger(
            name: 'novel-writer:run-targeted-revision',
            data: Record<string, never>,
        ): void;

        // ─── body 域 ───
        on(
            name: 'novel-writer:body-written',
            callback: (data: NovelWriterBodyWrittenPayload) => void,
            ctx?: unknown,
        ): EventRef;
        trigger(
            name: 'novel-writer:body-written',
            data: NovelWriterBodyWrittenPayload,
        ): void;
    }

    /** Obsidian 内部 Plugins API — 未暴露在官方类型定义中 */
    interface Plugins {
        disablePlugin(id: string): void;
        enablePlugin(id: string): Promise<void>;
        getPlugin(id: string): unknown;
    }

    interface App {
        plugins: Plugins;
        /** Obsidian 内部 Commands API — 未暴露在官方类型定义中 */
        commands: {
            listCommands(): Array<{ id: string; name: string; [key: string]: unknown }>;
            executeCommandById(id: string): boolean;
            [key: string]: unknown;
        };
        /** Obsidian 内部：在系统文件管理器中打开文件夹（未暴露在官方类型） */
        showInFolder?(path: string): void;
    }

    /** DataAdapter 增强：添加 basePath 属性 */
    interface DataAdapter {
        /** 获取 vault 的实际文件系统路径（适配移动端/桌面端） */
        basePath?: string;
    }
}

