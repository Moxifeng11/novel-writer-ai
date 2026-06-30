/**
 * core/ — 插件核心服务层
 *
 * 从 main.ts 拆分的独立服务模块，通过接口依赖实现解耦。
 * main.ts 负责组装这些服务并注入依赖。
 */

export { CryptoService } from './crypto-service';
export type { CryptoServiceDeps } from './crypto-service';

export { ThemeManager } from './theme-manager';
export type { ThemeSettings } from './theme-manager';

export { ProviderManager } from './provider-manager';
export type { ProviderSettings, ProviderManagerCallbacks } from './provider-manager';

export { CommandRegistry, parseChapterFromPath } from './command-registry';
export type { CommandRegistryDeps } from './command-registry';

export { SettingsService, getDefaultSettings } from './settings-service';
export type { SettingsServiceDeps } from './settings-service';
