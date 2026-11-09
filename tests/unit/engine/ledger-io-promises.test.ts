import { describe, expect, it } from 'vitest';
import { App, TFile } from 'obsidian';
import { invalidateStoryLedger, loadStoryLedger } from '../../../engine/ledger/ledger-io';
import { openPromises } from '../../../engine/ledger/ledger-index';

/**
 * F-3（2026-11-10 生命周期审计）回归：承诺账本此前不参与台账缓存签名，
 * 且 association-resolver 会就地改写共享缓存的 `ledger.promises`——导致
 * 章节摘要的「未兑现承诺」读到空/陈旧值。修复后：
 *  - 承诺文件 mtime+size 纳入签名，变更自动重建；
 *  - 承诺记录直接进缓存的 StoryLedger.promises（association-resolver 不再注入）。
 */

const PROJECT = '长篇小说/测试书';

const TIMELINE = `### 主线纪元

| 时间 | 对应章节 | 事件 | 影响 |
|---|---|---|---|
| 清晨 | 第1章 | 外门考核 | 林玄暴露体质 |
`;

const FORESHADOW = `## 未回收伏笔

| # | 伏笔名称 | 重要程度 | 埋设章节 | 计划回收 | 相关人物 | 关联主线 | 当前状态 |
|---|---------|---------|---------|---------|---------|---------|---------|
| 1 | 令牌的来历 | 高 | 第1章 | 第3章 | 林玄 | 身世主线 | 未揭示 |
`;

const PROMISE_V1 = `# 承诺/谜团账本

| # | 承诺/谜团 | 类型 | 提出章 | 提出角色 | 预期兑现 | 状态 | 最近推进章 | 备注 |
|---|---|---|---|---|---|---|---|---|
| 1 | 三招之约 | 角色承诺 | 第1章 | 林玄 | 第3章 | open | 第1章 | 考核承诺 |
`;

const PROMISE_V2 = `${PROMISE_V1.trimEnd()}
| 2 | 三年之约 | 角色承诺 | 第1章 | 林玄 | 第9章 | open | 第1章 | 延期承诺 |
`;

function seedFile(app: App, path: string, content: string): void {
    (app.vault as unknown as { _seedFile: (p: string, c: string) => void })._seedFile(path, content);
}

function makeApp(): App {
    const app = new App();
    seedFile(app, `${PROJECT}/02-时间线与伏笔/时间线看板.md`, TIMELINE);
    seedFile(app, `${PROJECT}/02-时间线与伏笔/伏笔库.md`, FORESHADOW);
    return app;
}

describe('ledger-io — 承诺账本纳入缓存签名（F-3）', () => {
    it('承诺文件存在时记录进 StoryLedger.promises', async () => {
        const app = makeApp();
        seedFile(app, `${PROJECT}/02-时间线与伏笔/承诺账本.md`, PROMISE_V1);

        const ledger = await loadStoryLedger(app, PROJECT);
        expect(ledger.promises).toHaveLength(1);
        expect(ledger.promises[0]).toMatchObject({
            name: '三招之约',
            raisedChapter: '第1章',
            status: 'open',
        });
        expect(openPromises(ledger, 1).map((record) => record.name)).toEqual(['三招之约']);
    });

    it('承诺文件变更后签名失效，缓存自动重建（不再读到陈旧承诺）', async () => {
        const app = makeApp();
        const promisePath = `${PROJECT}/02-时间线与伏笔/承诺账本.md`;
        seedFile(app, promisePath, PROMISE_V1);
        invalidateStoryLedger(PROJECT);
        expect((await loadStoryLedger(app, PROJECT)).promises[0].name).toBe('三招之约');

        // 模拟结算写入新承诺（新增一行 → size 变化 → 签名失效）
        seedFile(app, promisePath, PROMISE_V2);
        const ledger = await loadStoryLedger(app, PROJECT);
        expect(ledger.promises.map((record) => record.name)).toEqual(['三招之约', '三年之约']);
    });

    it('无承诺文件时 promises 为空，不抛错', async () => {
        const app = makeApp();
        const ledger = await loadStoryLedger(app, PROJECT);
        expect(ledger.promises).toHaveLength(0);
    });
});
