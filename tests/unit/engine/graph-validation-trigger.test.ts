import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

/**
 * F-1（2026-11-10 生命周期审计）回归：结算后防抖的图谱校验定时器必须在
 * 插件 onunload 时被清空——否则卸载后 5 秒内回调仍执行，读全库并写诊断文件。
 *
 * 用 vi.useFakeTimers 控制 5s 防抖窗口；mock 掉 graph-validator 的两个导出，
 * 以「校验/写报告是否被调用」作为回调是否执行的探针。
 */

const validateMock = vi.fn();
const writeMock = vi.fn();

vi.mock('../../../engine/graph/graph-validator', () => ({
    validateProjectGraph: (...args: unknown[]) => validateMock(...args),
    writeGraphValidationReport: (...args: unknown[]) => writeMock(...args),
}));

import {
    cancelScheduledGraphValidations,
    runGraphValidation,
    scheduleGraphValidation,
} from '../../../engine/graph/graph-validation-trigger';

const APP = { vault: {}, metadataCache: { resolvedLinks: {} } } as never;
const PROJECT = '长篇小说/测试书';

beforeEach(() => {
    vi.useFakeTimers();
    validateMock.mockReset();
    writeMock.mockReset();
    validateMock.mockResolvedValue({ skipped: '', issues: [], scannedEntities: 0, scannedLinks: 0, generatedAt: '' });
    writeMock.mockResolvedValue('报告.md');
    cancelScheduledGraphValidations();
});

afterEach(() => {
    vi.useRealTimers();
    cancelScheduledGraphValidations();
});

describe('graph-validation-trigger — 卸载清理（F-1）', () => {
    it('未取消时：5s 后回调执行校验并写报告', async () => {
        scheduleGraphValidation(APP, PROJECT, 5000);
        await vi.advanceTimersByTimeAsync(5000);
        expect(validateMock).toHaveBeenCalledTimes(1);
        expect(writeMock).toHaveBeenCalledTimes(1);
    });

    it('cancel 后：pending 定时器被清空，回调不再执行', async () => {
        scheduleGraphValidation(APP, PROJECT, 5000);
        cancelScheduledGraphValidations();
        await vi.advanceTimersByTimeAsync(10_000);
        expect(validateMock).not.toHaveBeenCalled();
        expect(writeMock).not.toHaveBeenCalled();
    });

    it('同项目重复调度：只保留最后一次（防抖语义不回归）', async () => {
        scheduleGraphValidation(APP, PROJECT, 5000);
        scheduleGraphValidation(APP, PROJECT, 5000);
        scheduleGraphValidation(APP, PROJECT, 5000);
        await vi.advanceTimersByTimeAsync(5000);
        expect(validateMock).toHaveBeenCalledTimes(1);
        expect(writeMock).toHaveBeenCalledTimes(1);
    });

    it('runGraphValidation 直连路径：校验+写报告+返回报告', async () => {
        const report = await runGraphValidation(APP, PROJECT);
        expect(validateMock).toHaveBeenCalledTimes(1);
        expect(writeMock).toHaveBeenCalledTimes(1);
        expect(report.skipped).toBe('');
    });
});
