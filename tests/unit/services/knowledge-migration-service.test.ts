/**
 * M13/M14：世界观/设定库迁移服务
 */

import { describe, expect, it } from 'vitest';
import { App, Vault } from 'obsidian';
import { KnowledgeMigrationService } from '@/services/knowledge-migration-service';

const WORLDVIEW = '# 世界观总览\n\n## 灵气体系\n\n灵气分九品。\n\n## 地理\n\n东荒、南岭。\n';
const SETTING = '# 设定库\n\n## 货币\n\n灵石、灵晶。\n';

const make = () => {
    const vault = new Vault() as Vault & { _seedFile(path: string, content: string): unknown };
    const app = new App();
    app.vault = vault;
    const project = 'p';
    vault._seedFile(`${project}/01-世界架构/世界观总览.md`, WORLDVIEW);
    vault._seedFile(`${project}/01-世界架构/设定库.md`, SETTING);
    let wld = 0;
    let set = 0;
    const service = new KnowledgeMigrationService(app, async (type, pathFor) => {
        const id = type === 'worldview' ? `WLD-000${++wld}` : `SET-000${++set}`;
        void pathFor(id);
        return id;
    });
    return { service, vault, project };
};

describe('KnowledgeMigrationService', () => {
    it('dry-run 返回条目数不写盘', async () => {
        const { service, project } = make();
        const result = await service.migrate(project, true);
        expect(result.dryRun).toBe(true);
        expect(result.worldview).toBe(2);
        expect(result.setting).toBe(1);
        expect(result.cards).toEqual([]);
    });

    it('执行后写条目卡并替换为派生视图', async () => {
        const { service, project, vault } = make();
        const result = await service.migrate(project, false);
        expect(result.failures).toEqual([]);
        expect(result.cards).toHaveLength(3);
        expect(result.backups).toHaveLength(2);
        const worldCard = result.cards.find(path => path.includes('WLD-0001'));
        expect(worldCard).toBeDefined();
        const content = await vault.read(vault.getAbstractFileByPath(worldCard!) as never);
        expect(content).toContain('type: worldview');
        expect(content).toContain('# 灵气体系');
        const derived = await vault.read(vault.getAbstractFileByPath(`${project}/01-世界架构/世界观总览.md`) as never);
        expect(derived).toContain('请勿手改');
        expect(derived).toContain('灵气体系');
    });

    it('备份保留原文', async () => {
        const { service, project, vault } = make();
        const result = await service.migrate(project, false);
        const backup = result.backups.find(path => path.includes('设定库'));
        expect(backup).toBeDefined();
        const text = await vault.read(vault.getAbstractFileByPath(backup!) as never);
        expect(text).toContain('灵石、灵晶');
    });

    it('无文件时安全返回', async () => {
        const { service } = make();
        const result = await service.migrate('不存在', false);
        expect(result.cards).toEqual([]);
        expect(result.failures).toEqual([]);
    });
});
