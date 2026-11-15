/**
 * M8/M9：单元派生视图服务
 */

import { describe, expect, it } from 'vitest';
import { App, Vault } from 'obsidian';
import { UnitDerivedService } from '@/services/unit-derived-service';

const SHORT_UNIT = (n: number, goal: string): string => `---
tags: [短篇正文]
节: "第${n}节"
status: pending
---

# 第${n}节

## 本节目标
- 核心冲突：${goal}
- 信息推进：推进${n}
- 情绪转折：紧张
- 结尾钩子：钩子${n}

正文：
`;

const SCRIPT_UNIT = (n: number): string => `---
tags: [剧本]
集: "第${n}集"
---

# 第${n}集

## 基本信息
- 单集时长：10分钟
- 本集核心冲突：冲突${n}
- 本集爽点/反转：反转${n}
- 结尾钩子：钩子${n}

## 场次

### ${n}-1 日/内 山门
人物：林玄
△动作

### ${n}-2 夜/外 后山
人物：林玄
△动作
`;

const make = (files: Record<string, string>) => {
    const vault = new Vault() as Vault & { _seedFile(path: string, content: string): unknown };
    const app = new App();
    app.vault = vault;
    for (const [path, content] of Object.entries(files)) vault._seedFile(path, content);
    return { service: new UnitDerivedService(app), vault, app };
};

describe('UnitDerivedService — 短篇', () => {
    const base = '短篇小说/测试';
    it('由节文件生成分节大纲', async () => {
        const { service, vault } = make({
            [`${base}/短篇创作/03-正文/第01节.md`]: SHORT_UNIT(1, '开门'),
            [`${base}/短篇创作/03-正文/第02节.md`]: SHORT_UNIT(2, '追击'),
        });
        const result = await service.generate(base, 'short', false);
        expect(result.units).toBe(2);
        expect(result.failures).toEqual([]);
        expect(result.derivedPath).toContain('分节大纲.md');
        const derived = await vault.read(vault.getAbstractFileByPath(result.derivedPath) as never);
        expect(derived).toContain('请勿手改');
        expect(derived).toContain('## 第1节');
        expect(derived).toContain('- 冲突：开门');
        expect(derived).toContain('## 第2节');
    });

    it('dry-run 不写文件', async () => {
        const { service, vault } = make({ [`${base}/短篇创作/03-正文/第01节.md`]: SHORT_UNIT(1, 'x') });
        const result = await service.generate(base, 'short', true);
        expect(result.dryRun).toBe(true);
        expect(vault.getAbstractFileByPath(result.derivedPath)).toBeFalsy();
    });
});

describe('UnitDerivedService — 剧本', () => {
    const base = '剧本/测试';
    it('由集文件生成分集大纲并统计场次', async () => {
        const { service, vault } = make({
            [`${base}/剧本创作/03-剧本/第01集.md`]: SCRIPT_UNIT(1),
            [`${base}/剧本创作/03-剧本/第02集.md`]: SCRIPT_UNIT(2),
        });
        const result = await service.generate(base, 'script', false);
        expect(result.units).toBe(2);
        expect(result.scenes).toBe(4);
        const derived = await vault.read(vault.getAbstractFileByPath(result.derivedPath) as never);
        expect(derived).toContain('分集大纲');
        expect(derived).toContain('- 核心冲突：冲突1');
        expect(derived).toContain('EP01-S01');
    });

    it('无单元文件时返回空摘要且不写盘', async () => {
        const { service } = make({});
        const result = await service.generate('空项目', 'script', false);
        expect(result.units).toBe(0);
        expect(result.summary).toContain('没有可解析');
    });
});
