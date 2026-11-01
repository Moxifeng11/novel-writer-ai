/**
 * 步骤完成后分片刷新的结构契约（G6-5）
 *
 * 真正的节点计数在 E2E（STEP_REFRESH_CHURN：分片 71 / 整页 494）。
 * 这里锁住结构本身，防止有人在没有 OBSIDIAN_PATH 的环境里把分片改回整页：
 *  - 提示词区必须渲染 7 个 data-nw-region 区块
 *  - 步骤成功后必须走 afterStep（有 refreshAfterStep 时优先），而不是直接整页重建
 *  - 导航项必须带 data-nw-substep，分片刷新才能更新完成标记
 */
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const root = path.resolve(__dirname, '../../..');
const view = fs.readFileSync(path.join(root, 'ui/full-writer-view.ts'), 'utf8');
const runner = fs.readFileSync(path.join(root, 'engine/step-runner.ts'), 'utf8');
const controller = fs.readFileSync(path.join(root, 'ui/full-writer/step-render-controller.ts'), 'utf8');

const REGIONS = ['notice', 'actions', 'status', 'planning', 'review', 'result', 'extras'];

describe('分片刷新区域', () => {
    it('提示词区渲染全部 7 个区域', () => {
        for (const name of REGIONS) {
            expect(view).toContain(`this.stepRegion(area, '${name}')`);
        }
    });

    it('refreshAfterStep 逐个重绘区域，而不是重建容器', () => {
        const start = view.indexOf('private refreshAfterStep');
        expect(start).toBeGreaterThan(-1);
        const block = view.slice(start, view.indexOf('private replaceStepRegion', start));
        for (const name of REGIONS) {
            expect(block).toContain(`this.replaceStepRegion(area, '${name}'`);
        }
        // 只在结构不完整时退回整页渲染
        expect(block).toContain('void this.renderInContainer(this.tabContent)');
    });

    it('步骤成功后走 afterStep：有 refreshAfterStep 优先，否则整页重建', () => {
        const start = runner.indexOf('private async afterStep');
        expect(start).toBeGreaterThan(-1);
        const block = runner.slice(start, start + 400);
        expect(block).toContain('ctx.refreshAfterStep');
        expect(block).toContain('ctx.renderInContainer(ctx.tabContent)');

        // 主流程的成功路径必须调用 afterStep
        expect(runner).toContain('await this.afterStep(ctx);');
    });

    it('导航项带 data-nw-substep，分片刷新才能定位', () => {
        expect(controller).toContain("sub.setAttr('data-nw-substep', stepKey)");
        expect(view).toContain("querySelectorAll<HTMLElement>('[data-nw-substep]')");
    });
});
