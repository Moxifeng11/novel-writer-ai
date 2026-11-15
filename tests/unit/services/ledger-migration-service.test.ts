import { describe, expect, it } from 'vitest';
import { App, Vault } from 'obsidian';
import { LedgerMigrationService } from '@/services/ledger-migration-service';

const TIMELINE = `| 时间 | 事件 | 章节 |
|---|---|---|
| 0012-03-05 | 入门大典 | 第3章 |
| 0012-03-06 | 断剑异动 | 第4章 |
`;
const FORESHADOW = `## 未回收
| 伏笔 | 埋设章节 |
|---|---|
| 断剑来历 | 第4章 |
`;

const make = () => {
    const vault = new Vault() as Vault & { _seedFile(path: string, content: string): unknown };
    const app = new App();
    app.vault = vault;
    const project = '长篇小说/书A';
    vault._seedFile(`${project}/02-时间线与伏笔/时间线看板.md`, TIMELINE);
    vault._seedFile(`${project}/02-时间线与伏笔/伏笔库.md`, FORESHADOW);
    let n = 0;
    const service = new LedgerMigrationService(app, async type => {
        n += 1;
        return type === 'timeline' ? `EVT-000${n}` : `FSH-000${n}`;
    });
    return { app, vault, project, service };
};

describe('LedgerMigrationService', () => {
    it('dry-run 只返回计划不写盘', async () => {
        const { service, project, vault } = make();
        const result = await service.migrate(project, true);
        expect(result.dryRun).toBe(true);
        expect(result.cards).toEqual([]);
        // dry-run 不产生任何新文件（只应存在初始的两份台账）
        expect(vault.getFiles().filter(file => file.extension === 'md')).toHaveLength(2);
    });

    it('执行后写条目卡并替换为派生视图', async () => {
        const { service, project, vault } = make();
        const result = await service.migrate(project, false);
        expect(result.failures).toEqual([]);
        expect(result.cards.length).toBe(3);
        expect(result.backups.length).toBe(2);
        const timelineCard = result.cards.find(path => path.includes('时间线事件'));
        expect(timelineCard).toBeDefined();
        const content = await vault.read(vault.getAbstractFileByPath(timelineCard!) as never);
        expect(content).toContain('type: timeline');
        expect(content).toContain('id: EVT-0001');
        const board = await vault.read(vault.getAbstractFileByPath(`${project}/02-时间线与伏笔/时间线看板.md`) as never);
        expect(board).toContain('请勿手改');
        expect(board).toContain('EVT-0001');
    });

    it('备份保留原内容', async () => {
        const { service, project, vault } = make();
        const result = await service.migrate(project, false);
        const backup = result.backups.find(path => path.includes('时间线看板'));
        expect(backup).toBeDefined();
        const text = await vault.read(vault.getAbstractFileByPath(backup!) as never);
        expect(text).toContain('入门大典');
    });

    it('无看板时安全返回', async () => {
        const { service } = make();
        const result = await service.migrate('长篇小说/空项目', false);
        expect(result.cards).toEqual([]);
        expect(result.failures).toEqual([]);
    });
});
