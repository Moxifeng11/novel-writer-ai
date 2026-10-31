/**
 * plugin-capabilities.ts — 插件能力接口
 *
 * 目的：将 engine 层与 NovelWriterPlugin 具体类型解耦，遵循依赖倒置原则。
 *
 * 背景：
 * - 13 个 engine/ 文件直接导入 NovelWriterPlugin
 * - 这违反了依赖倒置原则，导致 engine 层依赖具体实现而非抽象
 *
 * 使用方式：
 * 1. 创建 PluginCapabilities 实例，从 plugin 中提取所需能力
 * 2. engine 类的构造函数接收 PluginCapabilities 而非 NovelWriterPlugin
 * 3. UI 层（如 main.ts）负责构建 PluginCapabilities 实例
 *
 * 示例：
 * ```typescript
 * // main.ts
 * const capabilities: PluginCapabilities = {
 *     app: plugin.app,
 *     settings: plugin.settings,
 *     aiEngine: plugin.aiEngine,
 * };
 *
 * // engine/xxx.ts
 * class SomeEngine {
 *     constructor(private capabilities: PluginCapabilities) {
 *         this.app = capabilities.app;
 *     }
 * }
 * ```
 */

/** 插件设置类型（从 settings.ts 中提取关键字段） */
export interface PluginSettings {
    defaultModel: string;
    flashModel: string;
    proModel: string;
    maxOutput: number;
    maxContext: number;
    defaultWordCount: number;
    defaultVolumeCount: number;
    deaiEnabled: boolean;
    autoGenerateEnabled: boolean;
    maxApiRetries?: number;
    maxEntityBatchRetries?: number;
    maxUnrevealedForeshadow?: number;
}

/** 实体缓存管理器接口（用于 capabilities 注入） */
export interface EntityCachePort {
    getEntry: (project: string, path: string) => { mtime: number; frontmatter: Record<string, unknown> } | undefined;
    updateEntry: (project: string, path: string, mtime: number, frontmatter: Record<string, unknown>, entityType: string) => void;
    cleanup: (project: string, existingPaths: Set<string>) => void;
}

/** 插件能力接口 — engine 层只需要知道这些能力 */
export interface PluginCapabilities {
    /** Obsidian App 实例 */
    app: import('obsidian').App;
    /** 插件设置 */
    settings: PluginSettings;
    /** AI 引擎实例 */
    aiEngine?: import('../engine/ai-engine').AIEngine;
    /** AI API 客户端实例 */
    aiApiClient?: import('../engine/ai-api-client').AIApiClient;
    /** 上下文管理器实例 */
    contextManager?: import('../engine/context-manager').ContextManager;
    /** 伏笔管理器实例 */
    foreshadowManager?: import('../engine/foreshadow-manager').ForeshadowManager;
    /** 审查代理实例 */
    reviewAgent?: import('../engine/review-agent').ReviewAgent;
    /** 文件系统抽象（可选，已有懒加载兜底） */
    fs?: import('./file-system-port').FileSystemPort;
    /** Vault 元数据抽象（可选，已有懒加载兜底） */
    vaultMeta?: import('./file-system-port').VaultMetaPort;
    /** 实体缓存管理器（可选，由 capabilities 注入） */
    entityCache?: EntityCachePort;
}

/**
 * 从 NovelWriterPlugin 实例提取 PluginCapabilities
 */
export function extractPluginCapabilities(plugin: {
    app: import('obsidian').App;
    settings: PluginSettings;
    aiEngine?: import('../engine/ai-engine').AIEngine;
    contextManager?: import('../engine/context-manager').ContextManager;
}): PluginCapabilities {
    return {
        app: plugin.app,
        settings: plugin.settings,
        aiEngine: plugin.aiEngine,
        contextManager: plugin.contextManager,
    };
}
