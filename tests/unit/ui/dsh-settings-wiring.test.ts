/**
 * dsh 可选后端的接线契约（D）
 *
 * 真实进程不在单测里跑；这里锁住「默认关闭 / 桌面端 / 明确写入确认 / 可回退」
 * 这些不能退化的接线点。
 */
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const root = path.resolve(__dirname, '../../..');
const read = (rel: string): string => fs.readFileSync(path.join(root, rel), 'utf8');

describe('设置与默认值', () => {
    it('默认 native；dsh 字段存在', () => {
        expect(read('main.ts')).toContain("agentBackend?: 'native' | 'dsh'");
        expect(read('main.ts')).toContain('dshAllowVaultWrite?: boolean');
        const defaults = read('core/settings-service.ts');
        expect(defaults).toContain("agentBackend: 'native'");
        expect(defaults).toContain('dshAllowVaultWrite: false');
    });

    it('设置页有独立 Agent 后端分区', () => {
        expect(read('ui/settings-tab.ts')).toContain('AgentBackendSection');
        expect(read('ui/settings-tab.ts')).toContain("case 'agent'");
        const section = read('ui/settings/agent-section.ts');
        expect(section).toContain('DeepSeek Harness（实验）');
        // 写入必须说明是整会话、不是逐次
        expect(section).toContain('没有逐次审批');
    });
});

describe('工作台接线', () => {
    it('仅在显式选择 dsh 时启动，并保留回退', () => {
        const view = read('ui/agent-workbench-view.ts');
        expect(view).toContain("(this.plugin.settings.agentBackend || 'native') === 'dsh'");
        expect(view).toContain('await this.bootDsh(ctx)');
        expect(view).toContain('已回退到内置 Agent');
    });

    it('写入前二次确认；默认只读', () => {
        const view = read('ui/agent-workbench-view.ts');
        expect(view).toContain('dsh 将可写入整个 vault');
        expect(view).toContain("allowWrite ? 'workspace-write' : 'read-only'");
    });

    it('关闭/重启/切离线都会终止 dsh 进程', () => {
        const view = read('ui/agent-workbench-view.ts');
        const occurrences = view.split('this.dshSession?.close()').length - 1;
        expect(occurrences).toBeGreaterThanOrEqual(3);
    });

    it('dsh 回合用 idle 状态收口，不假设 per-prompt 结果', () => {
        const view = read('ui/agent-workbench-view.ts');
        expect(view).toContain('await dsh.waitForIdle');
        expect(view).toContain('dsh 没有返回可见回复');
    });
});
