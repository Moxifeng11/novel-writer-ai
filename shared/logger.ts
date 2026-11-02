/**
 * Logger — 结构化日志抽象
 *
 * 替代散落的 console.warn/log/error + 手动 [模块名] 前缀。
 * 提供：
 * - 模块级作用域（自动添加 [ModuleName] 前缀）
 * - 日志级别控制（debug / info / warn / error / silent）
 * - 运行时可切换级别
 * - 零依赖，可直接替换所有 console 调用
 *
 * 用法：
 *   const log = createLogger('ContextManager');
 *   log.warn('加载失败:', err);        // → [ContextManager] 加载失败: ...
 *   log.debug('详细信息');              // → 仅 debug 级别开启时输出
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
    silent: 4,
};

/** 全局日志级别（模块级单例） */
let globalLogLevel: LogLevel = 'warn';

/**
 * 设置全局日志级别
 *
 * @param level - 层级或档位
 */
export function setGlobalLogLevel(level: LogLevel): void {
    globalLogLevel = level;
}

/**
 * 获取当前全局日志级别
 *
  * @returns LogLevel 实例
 */
export function getGlobalLogLevel(): LogLevel {
    return globalLogLevel;
}

export interface Logger {
    /** 调试信息（仅 debug 级别开启时输出） */
    debug(...args: unknown[]): void;
    /** 一般信息（debug / info 级别输出） */
    info(...args: unknown[]): void;
    /** 警告（debug / info / warn 级别输出） */
    warn(...args: unknown[]): void;
    /** 错误（除 silent 外均输出） */
    error(...args: unknown[]): void;
    /**
     * 带前缀的子作用域
     *
     * @param scope - 作用域
      * @returns Logger 实例
     */
    child(scope: string): Logger;
}

/**
 * 创建模块级 Logger
 * @param scope 模块名称，会作为 [scope] 前缀输出
 * @param level 可选的模块级日志覆盖（不设则跟随全局）
  * @returns Logger 实例
 */
export function createLogger(scope: string, level?: LogLevel): Logger {
    const prefix = `[${scope}]`;

    const shouldLog = (msgLevel: LogLevel): boolean => {
        const effectiveLevel = level ?? globalLogLevel;
        return LOG_LEVEL_PRIORITY[msgLevel] >= LOG_LEVEL_PRIORITY[effectiveLevel];
    };

    return {
        debug(...args: unknown[]) {
            if (shouldLog('debug')) console.log(prefix, ...args);
        },
        info(...args: unknown[]) {
            if (shouldLog('info')) console.log(prefix, ...args);
        },
        warn(...args: unknown[]) {
            if (shouldLog('warn')) console.warn(prefix, ...args);
        },
        error(...args: unknown[]) {
            if (shouldLog('error')) console.error(prefix, ...args);
        },
        child(childScope: string) {
            return createLogger(`${scope}:${childScope}`, level);
        },
    };
}
