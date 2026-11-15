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
import type { ProjectIndex } from '@/shared/project-index-model';
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
    /**
     * 取项目索引（M1：含 frontmatter 派生字段）。
     *
     * @param project - 项目路径
     * @returns 项目索引
     */
    getProjectIndex(project: string): Promise<ProjectIndex>;
    /**
     * 迁移时间线/伏笔（M14）。
     *
     * @param project - 项目路径
     * @param dryRun - 是否只预览
     * @returns 迁移结果
     */
    /**
     * 协同写作注入差异（M7）。
     *
     * @param sessionKey - 会话键
     * @param sceneKey - 场景键
     * @param keys - 本次需要的条目 key
     * @returns 差异结果
     */
    /**
     * 实测注入量对比（M14）。
     *
     * @param project - 项目路径
     * @param sceneIndex - 场景序号
     * @returns 实测结果
     */
    /**
     * 迁移世界观/设定库（M13）。
     *
     * @param project - 项目路径
     * @param dryRun - 是否只预览
     * @returns 迁移结果
     */
    /**
     * 生成短篇/剧本派生视图（M8/M9）。
     *
     * @param project - 项目路径
     * @param mode - short | script
     * @param dryRun - 是否只预览
     * @returns 生成结果
     */
    generateUnitDerivedViews(project: string, mode: 'short' | 'script', dryRun?: boolean): Promise<{
        dryRun: boolean;
        units: number;
        scenes: number;
        derivedPath: string;
        backups: string[];
        failures: Array<{ path: string; reason: string }>;
        summary: string;
    }>;
    migrateKnowledge(project: string, dryRun?: boolean): Promise<{
        dryRun: boolean;
        worldview: number;
        setting: number;
        cards: string[];
        backups: string[];
        failures: Array<{ path: string; reason: string }>;
        summary: string;
    }>;
    /**
     * 采集写作效果基线（架构整改 §3.3）。
     *
     * @param project - 项目路径
     * @param chapterName - 章节名
     * @param model - 模型
     * @returns 基线结果
     */
    /**
     * 重建断言索引（C3）。
     *
     * @param project - 项目路径
     * @param dryRun - 是否只预览
     * @returns 重建结果
     */
    /**
     * 同步关系设定图（C4）。
     *
     * @param project - 项目路径
     * @param dryRun - 是否只预览
     * @returns 同步结果
     */
    /**
     * 生成后校验（B1）。
     *
     * @param project - 项目路径
     * @param chapterName - 章节名
     * @returns 校验报告
     */
    runPostGenerationCheck(project: string, chapterName: string): Promise<{
        project: string;
        chapterName: string;
        checkedAt: number;
        passed: boolean;
        counts: Record<string, number>;
        items: Array<{ kind: string; severity: string; message: string; suggestion?: string; refs?: string[] }>;
    }>;
    syncRelationGraph(project: string, dryRun?: boolean): Promise<{
        dryRun: boolean;
        derived: number;
        keptManual: number;
        skipped: number;
        removed: number;
        warnings: string[];
    }>;
    rebuildAssertions(project: string, dryRun?: boolean): Promise<{
        dryRun: boolean;
        count: number;
        path: string;
        backup?: string;
        warnings?: string[];
    }>;
    runBaselineProbe(project: string, chapterName: string, model?: string): Promise<{
        model: string;
        full: { chars: number; promptTokens: number; totalTokens: number };
        scene: { chars: number; promptTokens: number; totalTokens: number };
        reductionPercent: number;
        report: string;
    }>;
    measureContextMetrics(project: string, sceneIndex?: number): Promise<{
        beforeChars: number;
        afterChars: number;
        report: string;
        legacyFiles: number;
        sceneIndex: number;
    }>;
    cowriteDelta(sessionKey: string, sceneKey: string, keys: string[]): {
        delta: { sameScene: boolean; added: string[]; removed: string[]; unchanged: string[] };
        inject: boolean;
        snapshot: { sceneKey: string; keys: string[]; at: number };
    };
    migrateLedger(project: string, dryRun?: boolean): Promise<{
        dryRun: boolean;
        summary: string;
        cards: string[];
        backups: string[];
        failures: Array<{ path: string; reason: string }>;
    }>;
    /**
     * 构建场景上下文包（M5）：场景锚点 → 精确检索 → 迭代装配 → 提示词段落。
     *
     * @param project - 项目路径
     * @param sceneExpandText - 「Scene 展开」全文
     * @param sceneIndex - 目标场景序号（1 起）
     * @returns 上下文包
     */
    buildSceneContext(project: string, sceneExpandText: string, sceneIndex?: number): Promise<{
        section: string;
        session: unknown;
        assembly: { coverage: { required: number; loaded: number; missing: string[] } };
        unresolved: string[];
        ambiguous: string[];
        scene: unknown;
        sceneCount: number;
    }>;
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
