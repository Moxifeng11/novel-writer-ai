import { describe, it, expect, beforeEach } from 'vitest';
import { StepResultSaver } from '../../../engine/step-result-saver';
import { MockFileSystem } from '../../../shared/file-system-port';

describe('StepResultSaver 健壮性', () => {
    let mockFs: MockFileSystem;

    beforeEach(() => {
        mockFs = new MockFileSystem();
    });

    describe('构造函数 - 空指针防护', () => {
        it('不传任何参数时，构造函数不报错', () => {
            expect(() => {
                new StepResultSaver({});
            }).not.toThrow();
        });

        it('只传 fs 时正常工作', () => {
            expect(() => {
                new StepResultSaver({ fs: mockFs });
            }).not.toThrow();
        });
    });

    describe('saveStepResult 参数校验', () => {
        it('chapDir 为空时返回 false，不报错', async () => {
            const saver = new StepResultSaver({ fs: mockFs });
            const result = await saver.saveStepResult('infoPlan', 'test', '', '第1章', '第1卷');
            expect(result).toBe(false);
        });

        it('未知 stepKey 时返回 false，不报错', async () => {
            const saver = new StepResultSaver({ fs: mockFs });
            const result = await saver.saveStepResult(
                'unknownStep',
                'test',
                '测试项目/03-大纲与章节/步骤结果/第1卷/第1章',
                '第1章',
                '第1卷'
            );
            expect(result).toBe(false);
        });
    });

    describe('getEntityNames 空路径处理', () => {
        it('project 为空时返回空结果，不崩溃', async () => {
            const saver = new StepResultSaver({ fs: mockFs });
            const result = await saver.getEntityNames('');
            expect(result).not.toBeNull();
            expect(Array.isArray(result?.chars)).toBe(true);
        });
    });
});
