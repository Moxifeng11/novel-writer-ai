/**
 * BatchCreateModal — 批量建章编排回归（v4.0 目录结构）
 *
 * 覆盖此前无任何测试的批量建章主流程 `ui/batch-create-modal.ts#batchCreate`：
 * - 卷目录 / 章目录创建
 * - 每章 8 类步骤文件 + 1 个正文文件
 * - 重复执行幂等（已存在则跳过，不重复渲染模板）
 *
 * 说明：入口仅存在于 Modal（无可编程 API），故按 UI 层单测方式直接调用私有 `batchCreate`。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { App } from 'obsidian';
import { pjBodyDir, pjBodyFile, pjStepDir } from '../../../shared/paths';

// 避开重型依赖链：main（含 obsidian 编译产物）、context-manager、template-service
vi.mock('../../../main', () => ({ default: class {} }));
vi.mock('../../../engine/context-manager', () => ({ ContextManager: class {} }));
vi.mock('../../../services/template-service', () => ({ TemplateService: class {} }));

import { BatchCreateModal } from '../../../ui/batch-create-modal';

/** 与 batchCreate 内 stepFileTypes 的 type 一一对应 */
const STEP_TYPES = [
    '信息规划',
    '情节蒸馏',
    '大纲摘要',
    '情绪规划',
    'Scene展开',
    '角色灵魂',
    '质量控制',
    '分析报告',
];

function makeTemplateService() {
    return {
        getStepTemplate: vi.fn(async (key: string) => `# step ${key}`),
        getBodyTemplate: vi.fn(async () => '---\n标题: 测试\n---\n正文'),
    };
}

/** mock Vault 提供的测试辅助方法（不在 obsidian 类型声明中） */
function vaultExists(app: App, path: string): boolean {
    return (app.vault as unknown as { exists: (p: string) => boolean }).exists(path);
}

function makeModal(app: App, templateService: ReturnType<typeof makeTemplateService>): BatchCreateModal {
    const plugin = {
        ctxManager: {},
        engineRegistry: { get: vi.fn(() => templateService) },
    };
    const modal = new BatchCreateModal(app, plugin as never);
    // Modal 基类 mock 的构造器不接收 app，需显式回填被测实例的 app
    (modal as unknown as { app: App }).app = app;
    return modal;
}

describe('BatchCreateModal — 批量建章编排', () => {
    let app: App;

    beforeEach(() => {
        // 仓库测试环境为 node（无 jsdom），按既有约定注入最小 document 垫片供 Modal 基类字段初始化
        (globalThis as unknown as { document: unknown }).document = { createElement: () => ({}) };
        app = new App();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('为每章创建 8 类步骤文件与正文文件，并建好卷 / 章目录', async () => {
        const ts = makeTemplateService();
        const modal = makeModal(app, ts);

        await (modal as unknown as { batchCreate: (a: string, b: string, c: number, d: number) => Promise<void> })
            .batchCreate('测试项目', '第1卷', 1, 3);

        // 目录
        expect(vaultExists(app, `${pjBodyDir('测试项目', 1)}/`)).toBe(true);
        expect(vaultExists(app, `${pjStepDir('测试项目', 1, 1)}/`)).toBe(true);
        expect(vaultExists(app, `${pjStepDir('测试项目', 1, 3)}/`)).toBe(true);

        // 文件
        const paths = app.vault.getFiles().map((f) => f.path);
        for (let i = 1; i <= 3; i++) {
            expect(paths).toContain(pjBodyFile('测试项目', 1, i));
            for (const type of STEP_TYPES) {
                expect(paths).toContain(`${pjStepDir('测试项目', 1, i)}/第${i}章_${type}.md`);
            }
        }

        // 3 章 × 8 模板 + 3 次正文模板
        expect(ts.getStepTemplate).toHaveBeenCalledTimes(24);
        expect(ts.getBodyTemplate).toHaveBeenCalledTimes(3);
    });

    it('重复执行幂等：已存在文件不重复创建、不重复渲染模板', async () => {
        const ts = makeTemplateService();
        const modal = makeModal(app, ts);
        const call = modal as unknown as { batchCreate: (a: string, b: string, c: number, d: number) => Promise<void> };

        await call.batchCreate('测试项目', '第1卷', 1, 2);
        const filesAfterFirst = app.vault.getFiles().length;
        const stepCallsAfterFirst = ts.getStepTemplate.mock.calls.length;

        await call.batchCreate('测试项目', '第1卷', 1, 2);

        expect(app.vault.getFiles().length).toBe(filesAfterFirst);
        // 第二轮全部命中 existing，模板不再被调用
        expect(ts.getStepTemplate.mock.calls.length).toBe(stepCallsAfterFirst);
        expect(ts.getBodyTemplate).toHaveBeenCalledTimes(2);
    });
});
