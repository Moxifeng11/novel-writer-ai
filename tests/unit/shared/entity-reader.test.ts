/**
 * P0-3：实体文件读取唯一入口
 *
 * 钉住统一口径：只收 .md、排除「模板」、递归子目录、跨项目隔离、路径升序；
 * 统计与列表来自同一函数，避免「实体管理器排除了模板，统计却把模板算进去」。
 */
import { describe, it, expect } from 'vitest';
import { App } from 'obsidian';
import {
    listEntityFiles,
    countProjectEntities,
    isEntityTemplateFile,
    entityDir,
} from '../../../shared/entity-reader';
import { pjCharsDir, pjFactionsDir, pjLocsDir, pjItemsDir, pjWorldview } from '../../../shared/paths';

const PROJECT = '测试书';
const OTHER = '别的书';

function makeApp(): App {
    return new App();
}

function seed(app: App, path: string): void {
    (app.vault as any)._seedFile(path, '# 实体\n\n内容');
}

describe('entity-reader — 列表口径', () => {
    it('排除模板文件与非 md 文件', () => {
        const app = makeApp();
        seed(app, `${pjCharsDir(PROJECT)}/沈砚.md`);
        seed(app, `${pjCharsDir(PROJECT)}/人物模板.md`);
        seed(app, `${pjCharsDir(PROJECT)}/封面.png`);

        const files = listEntityFiles(app, PROJECT, 'characters');

        expect(files.map(f => f.name)).toEqual(['沈砚.md']);
    });

    it('递归包含子目录，并跨项目隔离', () => {
        const app = makeApp();
        seed(app, `${pjLocsDir(PROJECT)}/主城/青云城.md`);
        seed(app, `${pjLocsDir(OTHER)}/别处.md`);
        seed(app, `${pjCharsDir(PROJECT)}/不应混入.md`);

        const files = listEntityFiles(app, PROJECT, 'locations');

        expect(files.map(f => f.path)).toEqual([`${pjLocsDir(PROJECT)}/主城/青云城.md`]);
    });

    it('输出按路径升序，与种子顺序无关', () => {
        const app = makeApp();
        seed(app, `${pjFactionsDir(PROJECT)}/乙宗.md`);
        seed(app, `${pjFactionsDir(PROJECT)}/甲门.md`);
        seed(app, `${pjFactionsDir(PROJECT)}/丙派.md`);

        const names = listEntityFiles(app, PROJECT, 'factions').map(f => f.name);

        expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    });
});

describe('entity-reader — 统计口径', () => {
    it('世界观文件存在计 1；四类实体排除模板后计数', () => {
        const app = makeApp();
        seed(app, pjWorldview(PROJECT));
        seed(app, `${pjCharsDir(PROJECT)}/沈砚.md`);
        seed(app, `${pjCharsDir(PROJECT)}/人物模板.md`);
        seed(app, `${pjFactionsDir(PROJECT)}/九脉宗.md`);
        seed(app, `${pjLocsDir(PROJECT)}/青云城.md`);
        seed(app, `${pjLocsDir(PROJECT)}/地点模板.md`);
        seed(app, `${pjItemsDir(PROJECT)}/断魂剑.md`);
        seed(app, `${pjItemsDir(PROJECT)}/物品模板.md`);

        const stats = countProjectEntities(app, PROJECT);

        expect(stats).toEqual({ worldview: 1, characters: 1, factions: 1, locations: 1, items: 1 });
    });

    it('空项目全 0；模板文件不产生虚高数量', () => {
        const app = makeApp();
        seed(app, `${pjCharsDir(PROJECT)}/人物模板.md`);

        expect(countProjectEntities(app, PROJECT)).toEqual({
            worldview: 0, characters: 0, factions: 0, locations: 0, items: 0,
        });
    });

    it('统计数量与列表长度同源', () => {
        const app = makeApp();
        seed(app, `${pjItemsDir(PROJECT)}/一.md`);
        seed(app, `${pjItemsDir(PROJECT)}/二.md`);

        expect(countProjectEntities(app, PROJECT).items).toBe(listEntityFiles(app, PROJECT, 'items').length);
    });
});

describe('entity-reader — 辅助函数', () => {
    it('isEntityTemplateFile 识别模板后缀名', () => {
        expect(isEntityTemplateFile('人物模板.md')).toBe(true);
        expect(isEntityTemplateFile('沈砚.md')).toBe(false);
    });

    it('entityDir 与 paths 保持同一目录定义', () => {
        expect(entityDir(PROJECT, 'characters')).toBe(pjCharsDir(PROJECT));
        expect(entityDir(PROJECT, 'items')).toBe(pjItemsDir(PROJECT));
    });
});
