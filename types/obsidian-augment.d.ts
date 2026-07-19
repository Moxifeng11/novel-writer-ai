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

declare module 'obsidian' {
    interface Workspace {
        // ─── project 域 ───
        on(
            name: 'novel-writer:project-created',
            callback: (data: NovelWriterProjectCreatedPayload) => any,
            ctx?: any,
        ): EventRef;
        trigger(
            name: 'novel-writer:project-created',
            data: NovelWriterProjectCreatedPayload,
        ): void;

        on(
            name: 'novel-writer:project-switched',
            callback: (data: NovelWriterProjectSwitchedPayload) => any,
            ctx?: any,
        ): EventRef;
        trigger(
            name: 'novel-writer:project-switched',
            data: NovelWriterProjectSwitchedPayload,
        ): void;

        // ─── settings 域 ───
        on(
            name: 'novel-writer:settings-changed',
            callback: (data: NovelWriterSettingsChangedPayload) => any,
            ctx?: any,
        ): EventRef;
        trigger(
            name: 'novel-writer:settings-changed',
            data: NovelWriterSettingsChangedPayload,
        ): void;

        on(
            name: 'novel-writer:context-scope-changed',
            callback: (data: NovelWriterContextScopeChangedPayload) => any,
            ctx?: any,
        ): EventRef;
        trigger(
            name: 'novel-writer:context-scope-changed',
            data: NovelWriterContextScopeChangedPayload,
        ): void;

        // ─── context 域 ───
        on(
            name: 'novel-writer:involved-entities-changed',
            callback: (data: NovelWriterInvolvedEntitiesChangedPayload) => any,
            ctx?: any,
        ): EventRef;
        trigger(
            name: 'novel-writer:involved-entities-changed',
            data: NovelWriterInvolvedEntitiesChangedPayload,
        ): void;

        on(
            name: 'novel-writer:refresh-context-panel',
            callback: (data: NovelWriterRefreshContextPanelPayload) => any,
            ctx?: any,
        ): EventRef;
        trigger(
            name: 'novel-writer:refresh-context-panel',
            data: NovelWriterRefreshContextPanelPayload,
        ): void;
    }

    /** Obsidian 内部 Plugins API — 未暴露在官方类型定义中 */
    interface Plugins {
        disablePlugin(id: string): void;
        enablePlugin(id: string): Promise<void>;
        getPlugin(id: string): any;
    }

    interface App {
        plugins: Plugins;
        /** Obsidian 内部 Commands API — 未暴露在官方类型定义中 */
        commands: {
            listCommands(): Array<{ id: string; name: string; [key: string]: any }>;
            executeCommandById(id: string): boolean;
            [key: string]: any;
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

/** Window 对象增强：添加 novelAI 属性 */
declare global {
    interface Window {
        /** 小说工坊内部注册表（开发调试用） */
        novelAI?: import('../engine/internal-registry').InternalRegistry;
    }
}
