/**
 * logger.test.ts — 结构化日志 Logger 单元测试
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    createLogger,
    setGlobalLogLevel,
    getGlobalLogLevel,
} from '../../../shared/logger';
import type { LogLevel } from '../../../shared/logger';

describe('Logger', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let consoleLogSpy: any;
    let consoleWarnSpy: any;
    let consoleErrorSpy: any;

    beforeEach(() => {
        consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        setGlobalLogLevel('warn'); // 重置为默认
    });

    afterEach(() => {
        consoleLogSpy.mockRestore();
        consoleWarnSpy.mockRestore();
        consoleErrorSpy.mockRestore();
        setGlobalLogLevel('warn');
    });

    describe('createLogger', () => {
        it('warn 级别默认输出 warn', () => {
            const log = createLogger('Test');
            log.warn('test warning');
            expect(consoleWarnSpy).toHaveBeenCalledWith('[Test]', 'test warning');
        });

        it('warn 级别不输出 debug', () => {
            const log = createLogger('Test');
            log.debug('debug info');
            expect(consoleLogSpy).not.toHaveBeenCalled();
        });

        it('warn 级别不输出 info', () => {
            const log = createLogger('Test');
            log.info('info message');
            expect(consoleLogSpy).not.toHaveBeenCalled();
        });

        it('warn 级别输出 error', () => {
            const log = createLogger('Test');
            log.error('error!');
            expect(consoleErrorSpy).toHaveBeenCalledWith('[Test]', 'error!');
        });
    });

    describe('日志级别控制', () => {
        it('debug 级别输出所有日志', () => {
            setGlobalLogLevel('debug');
            const log = createLogger('Test');
            log.debug('d');
            log.info('i');
            log.warn('w');
            log.error('e');
            expect(consoleLogSpy).toHaveBeenCalledTimes(2); // debug + info
            expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
            expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
        });

        it('error 级别只输出 error', () => {
            setGlobalLogLevel('error');
            const log = createLogger('Test');
            log.debug('d');
            log.info('i');
            log.warn('w');
            log.error('e');
            expect(consoleLogSpy).not.toHaveBeenCalled();
            expect(consoleWarnSpy).not.toHaveBeenCalled();
            expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
        });

        it('silent 级别不输出任何日志', () => {
            setGlobalLogLevel('silent');
            const log = createLogger('Test');
            log.debug('d');
            log.info('i');
            log.warn('w');
            log.error('e');
            expect(consoleLogSpy).not.toHaveBeenCalled();
            expect(consoleWarnSpy).not.toHaveBeenCalled();
            expect(consoleErrorSpy).not.toHaveBeenCalled();
        });
    });

    describe('模块级覆盖', () => {
        it('模块级 level 覆盖全局设置', () => {
            setGlobalLogLevel('silent');
            const log = createLogger('Test', 'debug');
            log.debug('visible');
            expect(consoleLogSpy).toHaveBeenCalledWith('[Test]', 'visible');
        });
    });

    describe('child', () => {
        it('子 logger 带组合前缀', () => {
            const log = createLogger('Parent');
            const child = log.child('Child');
            child.warn('msg');
            expect(consoleWarnSpy).toHaveBeenCalledWith('[Parent:Child]', 'msg');
        });

        it('子 logger 继承日志级别', () => {
            setGlobalLogLevel('error');
            const log = createLogger('Parent');
            const child = log.child('Child');
            child.warn('suppressed');
            expect(consoleWarnSpy).not.toHaveBeenCalled();
        });
    });

    describe('getGlobalLogLevel / setGlobalLogLevel', () => {
        it('读写一致', () => {
            setGlobalLogLevel('debug');
            expect(getGlobalLogLevel()).toBe('debug');
            setGlobalLogLevel('error');
            expect(getGlobalLogLevel()).toBe('error');
        });
    });
});
