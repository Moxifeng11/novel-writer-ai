/**
 * M14 ②：注入量实测服务
 */

import { describe, expect, it } from 'vitest';
import { App, Vault } from 'obsidian';
import { ContextMetricsService } from '@/services/context-metrics-service';

const make = (files: Record<string, string>) => {
    const vault = new Vault() as Vault & { _seedFile(path: string, content: string): unknown };
    const app = new App();
    app.vault = vault;
    for (const [path, content] of Object.entries(files)) vault._seedFile(path, content);
    // 目录：mock vault 自动建父目录
    const service = new ContextMetricsService(app, async () => ({ section: '【当前场景】场景1「测试」\n【本场已加载上下文】- 要素（1）' }));
    return { service, vault, app };
};

const BASE = 'p';
const legacy = (chars: number) => 'x'.repeat(chars);

describe('ContextMetricsService', () => {
    it('统计旧策略整份注入量并对比新策略', async () => {
        const { service } = make({
            [`${BASE}/01-世界架构/世界观总览.md`]: legacy(2000),
            [`${BASE}/01-世界架构/设定库.md`]: legacy(1000),
            [`${BASE}/02-时间线与伏笔/伏笔库.md`]: legacy(500),
            [`${BASE}/02-时间线与伏笔/时间线看板.md`]: legacy(500),
            [`${BASE}/03-大纲与章节/步骤结果/第1卷/第1章/第1章_Scene展开.md`]: '## 场景1：测试\n- 在场人物：林玄',
        });
        const result = await service.measure(BASE);
        expect(result.legacyFiles).toBe(4);
        expect(result.beforeChars).toBe(4000);
        expect(result.afterChars).toBeGreaterThan(0);
        expect(result.afterChars).toBeLessThan(result.beforeChars);
        expect(result.report).toContain('改造前');
        expect(result.comparison.tokenDeltaPercent).toBeLessThan(0);
    });

    it('人物目录内每个 md 都计入旧策略', async () => {
        const { service } = make({
            [`${BASE}/01-世界架构/人物/CHR-0001_林玄.md`]: legacy(300),
            [`${BASE}/01-世界架构/人物/CHR-0002_苏婉.md`]: legacy(300),
        });
        const result = await service.measure(BASE);
        expect(result.legacyFiles).toBe(2);
        expect(result.beforeChars).toBe(600);
    });

    it('有 Scene 展开时使用场景上下文', async () => {
        let called = false;
        const vault = new Vault() as Vault & { _seedFile(path: string, content: string): unknown };
        const app = new App();
        app.vault = vault;
        vault._seedFile(`${BASE}/03-大纲与章节/步骤结果/第1卷/第1章/第1章_Scene展开.md`, '## 场景1：测试\n- 在场人物：林玄');
        const service = new ContextMetricsService(app, async () => { called = true; return { section: '【当前场景】' }; });
        const result = await service.measure(BASE);
        expect(called).toBe(true);
        expect(result.afterChars).toBeGreaterThan(0);
    });

    it('无数据时报告提示暂无', async () => {
        // mock vault 没有 createFolder，先建目录文件集为空会返回空统计
        const { service } = make({});
        const result = await service.measure('未知道目');
        expect(result.beforeChars).toBe(0);
        expect(result.report).toContain('暂无注入账本数据');
    });
});
