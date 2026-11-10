import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * F1（维度⑤二轮）：模板自举与规则副本清理不再挡在命令/Ribbon/视图注册之前。
 * 这里锁住执行顺序契约，避免后续把 `await ensureTemplateScaffold` 放回 onload 主链。
 */
const ROOT = path.resolve(__dirname, '../../..');
const main = fs.readFileSync(path.join(ROOT, 'main.ts'), 'utf8');

describe('启动维护延后（F1）', () => {
    it('onload 主链不再 await 模板自举/规则清理', () => {
        const start = main.indexOf('async onload()');
        // 维护方法定义在 onload 之后，用它作为 onload 片段的结束边界
        const end = main.indexOf('private _scheduleStartupMaintenance');
        expect(start).toBeGreaterThan(-1);
        expect(end).toBeGreaterThan(start);
        const onload = main.slice(start, end);
        expect(onload).toContain('this._scheduleStartupMaintenance()');
        expect(onload).not.toContain('await ensureTemplateScaffold');
        expect(onload).not.toContain('await this._checkRulesVersion()');
    });

    it('维护任务在布局就绪 + 延迟 + 卸载守卫之后执行', () => {
        const start = main.indexOf('private _scheduleStartupMaintenance');
        const end = main.indexOf('private _scheduleSessionRetentionPrune');
        expect(start).toBeGreaterThan(-1);
        expect(end).toBeGreaterThan(start);
        const body = main.slice(start, end);
        expect(body).toContain('onLayoutReady');
        expect(body).toContain('window.setTimeout');
        expect(body).toContain('this._isUnloaded');
        expect(body).toContain('_runStartupMaintenance');
    });

    it('维护方法内部才调用模板自举与规则清理', () => {
        const start = main.indexOf('private async _runStartupMaintenance');
        const end = main.indexOf('private _scheduleSessionRetentionPrune');
        const body = main.slice(start, end);
        expect(body).toContain('await ensureTemplateScaffold(this.app)');
        expect(body).toContain('await this._checkRulesVersion()');
        expect(body).toContain('this._isUnloaded');
    });
});
