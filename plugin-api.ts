/**
 * plugin-api.ts — 插件公共接口类型定义
 *
 * 设计原则：
 * 1. 按功能拆分子接口，降低耦合
 * 2. 子接口可独立使用，也可组合成完整 API
 * 3. 运行时零改动，仅做类型层约束
 *
 * 使用方式：
 * - 引擎层只用 settings → 注入 NovelWriterSettingsAPI
 * - UI 层用提供商管理 → 注入 NovelWriterProviderAPI
 * - 工作台用视图控制 → 注入 NovelWriterWorkspaceAPI
 */

import type { App, TFile } from 'obsidian';
import type { NovelWriterSettings } from './main';
import type { AIEngine } from './engine/ai-engine';
import type { ContextManager } from './engine/context-manager';
import type { FloatWorkspaceManager } from './ui/workspace-manager';
import type { PluginCacheManager } from './shared/plugin-cache';
import type { EngineRegistry } from './engine/engine-registry';
import type { CommandUiPort } from './shared/command-ui-port';

/** 提供商信息 */
export interface ProviderInfo {
    id: string;
    name: string;
    endpoint: string;
    models: string[];
    maxContext: number;
    maxOutput: number;
    /** @deprecated 请使用 isDefault，单轨制下不再区分预设和自定义 */
    isPreset: boolean;
    isDefault?: boolean;
    isHidden?: boolean;
}

/** 模型限制 */
export interface ModelLimits {
    maxContext: number;
    maxOutput: number;
}

/** ─── 子接口：设置访问 ─── */
export interface NovelWriterSettingsAPI {
    readonly settings: NovelWriterSettings;
    saveSettings(): Promise<void>;
}

/** ─── 子接口：核心引擎访问 ─── */
export interface NovelWriterEngineAPI {
    readonly aiEngine: AIEngine;
    readonly ctxManager: ContextManager;
    readonly cacheManager: PluginCacheManager;
    readonly engineRegistry: EngineRegistry;
}

/** ─── 子接口：模型/提供商管理 ─── */
export interface NovelWriterProviderAPI {
    getCurrentProviderId(): string | null;
    switchProviderByEndpoint(endpoint: string): boolean;
    resolveModelLimits(modelName: string, endpoint?: string): ModelLimits;
    updateModelLimitsFromModel(modelName: string): void;
    setCurrentModelOverride(field: 'maxContext' | 'maxOutput', value: number): void;
    addCustomProvider(name: string, endpoint: string, models: string[], maxContext: number, maxOutput: number, apiKey: string): string | null;
    deleteCustomProvider(id: string): boolean;
    getAllProviders(): ProviderInfo[];
    hidePreset(presetId: string): boolean;
    restorePreset(presetId: string): boolean;
    restoreAllPresets(): void;
    savePresetOverride(presetId: string, name: string, endpoint: string, models: string[], maxContext: number, maxOutput: number): boolean;
    updateStatusBarText(): void;
    openProviderSwitcher(): void;
}

/** ─── 子接口：视图/工作台控制 ─── */
export interface NovelWriterWorkspaceAPI {
    readonly app: App;
    /** 插件清单（用于定位插件数据目录，如分析会话快照） */
    readonly manifest?: { dir?: string };
    openFullWriterView(): Promise<void>;
    activateCoWritingView(project?: string, chapterName?: string, volume?: string, chapterNum?: number): Promise<void>;
    openCoWritingFromActiveContext(): Promise<void>;
    openChapterInFullWriter(project: string, chapterPath: string): void;
    safeOpenFile(file: TFile): Promise<void>;
    getActiveProject(): string | null;
    refreshFullWriterContextPanel(): void;
    executeCommand(commandId: string): boolean;
    /** 命令 UI 执行端口（main 注入；core 只依赖接口，不依赖 ui） */
    readonly commandUiPort?: CommandUiPort;
}

/** ─── 子接口：主题/样式 ─── */
export interface NovelWriterThemeAPI {
    injectThemeVariables(): void;
    injectLayoutVariables(): void;
}

/** ─── 子接口：工作台运行时状态（跨模块共享） ─── */
export interface NovelWriterRuntimeStateAPI {
    _isWorkbenchContext: boolean;
    _involvedChars: Set<string>;
    _involvedLocs: Set<string>;
    _involvedFactions: Set<string>;
    _involvedItems: Set<string>;
    workspaceManager?: FloatWorkspaceManager;
    _pendingReloadState: { project: string; chapterFileName: string; volume?: string; chapDir?: string } | null;
    _pendingEntityProject: string | null;
    _pendingEntityContext: { project: string; isEarlyStage: boolean } | null;
}

/** ─── 完整插件公共 API（组合所有子接口） ─── */
export interface NovelWriterPluginAPI
    extends NovelWriterSettingsAPI,
        NovelWriterEngineAPI,
        NovelWriterProviderAPI,
        NovelWriterWorkspaceAPI,
        NovelWriterThemeAPI,
        NovelWriterRuntimeStateAPI {}
