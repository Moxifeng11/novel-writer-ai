import { describe, it, expect, beforeEach } from 'vitest';
import { App, Vault } from '../__mocks__/obsidian';
import { TestProjectScaffold } from './helpers/project-scaffold';
import {
  assertWorldviewStructure,
  assertCharacterStructure,
  assertEntityRelationsValid,
  assertHasFrontmatter,
} from './helpers/custom-assertions';
import { XUANHUAN_SCENARIO, ROMANCE_SCENARIO, MYSTERY_SCENARIO } from './fixtures/scenarios';
import {
  pjWorldview,
  pjCharFile,
  pjLocFile,
  pjFactionFile,
  pjItemFile,
  pjCharsDir,
  pjLocsDir,
  pjFactionsDir,
  pjItemsDir,
} from '../../shared/paths';
import { parseFrontmatter } from '../../shared/frontmatter';
import { characterFromMarkdown, locationFromMarkdown, factionFromMarkdown, itemFromMarkdown } from '../../shared/entity-models';

describe('设定生成流程 - 世界观生成', () => {
  let app: App;
  let vault: Vault;
  let scaffold: TestProjectScaffold;

  beforeEach(async () => {
    app = new App();
    vault = app.vault as any;
    scaffold = new TestProjectScaffold(app, '世界观测试项目');
    await scaffold.createBasicStructure();
  });

  it('生成世界观总览：验证结构完整', async () => {
    const path = await scaffold.addWorldview(XUANHUAN_SCENARIO.worldview);
    const content = await vault.readByPath(path);

    assertWorldviewStructure(content);
    expect(content).toContain(XUANHUAN_SCENARIO.worldview.worldName);
    expect(content).toContain(XUANHUAN_SCENARIO.worldview.genre);
  });

  it('世界观包含核心模块：世界概述、修炼体系、地理环境、历史沿革', async () => {
    const path = await scaffold.addWorldview(XUANHUAN_SCENARIO.worldview);
    const content = await vault.readByPath(path);

    expect(content).toContain('世界概述');
    expect(content).toContain('修炼体系');
    expect(content).toContain('地理环境');
    expect(content).toContain('历史沿革');
  });

  it('玄幻世界观：包含修炼体系和境界划分', async () => {
    const path = await scaffold.addWorldview(XUANHUAN_SCENARIO.worldview);
    const content = await vault.readByPath(path);

    expect(content).toContain('炼气');
    expect(content).toContain('筑基');
    expect(content).toContain('金丹');
    expect(content).toContain('元婴');
  });

  it('都市世界观：不包含修炼元素', async () => {
    const path = await scaffold.addWorldview(ROMANCE_SCENARIO.worldview);
    const content = await vault.readByPath(path);

    expect(content).not.toContain('炼气');
    expect(content).not.toContain('筑基');
    expect(content).toContain('现代都市');
  });
});

describe('设定生成流程 - 人物设定', () => {
  let app: App;
  let vault: Vault;
  let scaffold: TestProjectScaffold;

  beforeEach(async () => {
    app = new App();
    vault = app.vault as any;
    scaffold = new TestProjectScaffold(app, '人物测试项目');
    await scaffold.createBasicStructure();
  });

  it('生成主角设定：验证完整人设结构', async () => {
    const mainChar = XUANHUAN_SCENARIO.characters.find(c => c.role === '主角')!;
    const path = await scaffold.addCharacter(mainChar);
    const content = await vault.readByPath(path);

    assertCharacterStructure(content);
    expect(content).toContain(mainChar.name);
    expect(content).toContain(mainChar.role);
    expect(content).toContain('身份背景');
    expect(content).toContain('性格特点');
    expect(content).toContain('能力设定');
    expect(content).toContain('人物关系');
  });

  it('生成人物实体模型：验证 entity-models 转换', async () => {
    const mainChar = XUANHUAN_SCENARIO.characters.find(c => c.role === '主角')!;
    const path = await scaffold.addCharacter(mainChar);
    const content = await vault.readByPath(path);

    const model = characterFromMarkdown(content, path);

    expect(model.category).toBe('character');
    expect(model.name).toBe(mainChar.name);
    expect(model.identity).toBe(mainChar.identity);
    expect(model.gender).toBe(mainChar.gender);
    expect(model.specialAbility).toBe(mainChar.ability);
    expect(model.faction).toBe(mainChar.faction);
    expect(model.cultivationLevel).toBe(mainChar.cultivationLevel);
  });

  it('批量生成人物：验证数量和角色分布', async () => {
    const paths = await scaffold.addCharacters(XUANHUAN_SCENARIO.characters);

    expect(paths.length).toBe(XUANHUAN_SCENARIO.characters.length);

    const roles = XUANHUAN_SCENARIO.characters.map(c => c.role);
    expect(roles).toContain('主角');
    expect(roles).toContain('女主角');
    expect(roles).toContain('男配角');
    expect(roles).toContain('反派');
  });

  it('人物属性合理性：姓名非空，角色明确', async () => {
    for (const char of XUANHUAN_SCENARIO.characters) {
      expect(char.name).toBeTruthy();
      expect(char.role).toBeTruthy();
      expect(char.name.length).toBeGreaterThan(0);
    }
  });
});

describe('设定生成流程 - 地点设定', () => {
  let app: App;
  let vault: Vault;
  let scaffold: TestProjectScaffold;

  beforeEach(async () => {
    app = new App();
    vault = app.vault as any;
    scaffold = new TestProjectScaffold(app, '地点测试项目');
    await scaffold.createBasicStructure();
  });

  it('生成地点设定：验证地点结构完整', async () => {
    const loc = XUANHUAN_SCENARIO.locations[0];
    const path = await scaffold.addLocation(loc);
    const content = await vault.readByPath(path);

    expect(content).toContain(loc.name);
    expect(content).toContain(loc.type);
    assertHasFrontmatter(content, ['名称', '类型', '重要程度']);
  });

  it('地点实体模型转换', async () => {
    const loc = XUANHUAN_SCENARIO.locations[0];
    const path = await scaffold.addLocation(loc);
    const content = await vault.readByPath(path);

    const model = locationFromMarkdown(content, path);

    expect(model.category).toBe('location');
    expect(model.name).toBe(loc.name);
    expect(model.type).toBe(loc.type);
    expect(model.importance).toBe(loc.importance);
  });

  it('地点类型多样性：宗门、城市、秘境、森林', async () => {
    const types = new Set(XUANHUAN_SCENARIO.locations.map(l => l.type));

    expect(types.size).toBeGreaterThanOrEqual(3);
    expect(types.has('宗门')).toBe(true);
    expect(types.has('城市')).toBe(true);
  });
});

describe('设定生成流程 - 势力设定', () => {
  let app: App;
  let vault: Vault;
  let scaffold: TestProjectScaffold;

  beforeEach(async () => {
    app = new App();
    vault = app.vault as any;
    scaffold = new TestProjectScaffold(app, '势力测试项目');
    await scaffold.createBasicStructure();
  });

  it('生成势力设定：验证势力结构完整', async () => {
    const faction = XUANHUAN_SCENARIO.factions[0];
    const path = await scaffold.addFaction(faction);
    const content = await vault.readByPath(path);

    expect(content).toContain(faction.name);
    expect(content).toContain(faction.type);
    assertHasFrontmatter(content, ['名称', '类型', '领袖']);
  });

  it('势力实体模型转换', async () => {
    const faction = XUANHUAN_SCENARIO.factions[0];
    const path = await scaffold.addFaction(faction);
    const content = await vault.readByPath(path);

    const model = factionFromMarkdown(content, path);

    expect(model.category).toBe('faction');
    expect(model.name).toBe(faction.name);
    expect(model.type).toBe(faction.type);
    expect(model.leader).toBe(faction.leader);
  });

  it('势力对立关系：正道与魔道并存', async () => {
    const factionTypes = XUANHUAN_SCENARIO.factions.map(f => f.type);

    expect(factionTypes).toContain('正道宗门');
    expect(factionTypes).toContain('魔道势力');
  });
});

describe('设定生成流程 - 物品设定', () => {
  let app: App;
  let vault: Vault;
  let scaffold: TestProjectScaffold;

  beforeEach(async () => {
    app = new App();
    vault = app.vault as any;
    scaffold = new TestProjectScaffold(app, '物品测试项目');
    await scaffold.createBasicStructure();
  });

  it('生成物品设定：验证物品结构完整', async () => {
    const item = XUANHUAN_SCENARIO.items[0];
    const path = await scaffold.addItem(item);
    const content = await vault.readByPath(path);

    expect(content).toContain(item.name);
    expect(content).toContain(item.type);
    assertHasFrontmatter(content, ['名称', '类型', '品阶/等级']);
  });

  it('物品实体模型转换', async () => {
    const item = XUANHUAN_SCENARIO.items[0];
    const path = await scaffold.addItem(item);
    const content = await vault.readByPath(path);

    const model = itemFromMarkdown(content, path);

    expect(model.category).toBe('item');
    expect(model.name).toBe(item.name);
    expect(model.type).toBe(item.type);
    expect(model.grade).toBe(item.grade);
  });

  it('物品品阶分级：神器、法宝、丹药等不同级别', async () => {
    const grades = XUANHUAN_SCENARIO.items.map(i => i.grade);
    expect(grades.length).toBeGreaterThan(0);

    const uniqueGrades = new Set(grades.filter(Boolean));
    expect(uniqueGrades.size).toBeGreaterThanOrEqual(2);
  });
});

describe('设定生成流程 - 实体关联验证', () => {
  let app: App;
  let vault: Vault;
  let scaffold: TestProjectScaffold;

  beforeEach(async () => {
    app = new App();
    vault = app.vault as any;
    scaffold = new TestProjectScaffold(app, '关联测试项目');
    await scaffold.createBasicStructure();
  });

  it('人物所属势力必须存在', async () => {
    await scaffold.buildFullProject({
      projectName: '关联测试项目',
      characters: XUANHUAN_SCENARIO.characters,
      factions: XUANHUAN_SCENARIO.factions,
    });

    const factionNames = new Set(XUANHUAN_SCENARIO.factions.map(f => f.name));

    for (const char of XUANHUAN_SCENARIO.characters) {
      if (char.faction) {
        expect(factionNames.has(char.faction)).toBe(true);
        const factionPath = pjFactionFile('关联测试项目', char.faction);
        expect(vault.exists(factionPath)).toBe(true);
      }
    }
  });

  it('物品归属人物必须存在', async () => {
    await scaffold.buildFullProject({
      projectName: '关联测试项目',
      characters: XUANHUAN_SCENARIO.characters,
      items: XUANHUAN_SCENARIO.items,
    });

    const charNames = new Set(XUANHUAN_SCENARIO.characters.map(c => c.name));

    for (const item of XUANHUAN_SCENARIO.items) {
      if (item.owner) {
        expect(charNames.has(item.owner)).toBe(true);
      }
    }
  });

  it('所有关联引用完整性校验', async () => {
    await scaffold.buildFullProject({
      projectName: '关联测试项目',
      worldview: XUANHUAN_SCENARIO.worldview,
      characters: XUANHUAN_SCENARIO.characters,
      locations: XUANHUAN_SCENARIO.locations,
      factions: XUANHUAN_SCENARIO.factions,
      items: XUANHUAN_SCENARIO.items,
    });

    assertEntityRelationsValid(XUANHUAN_SCENARIO.characters, XUANHUAN_SCENARIO.factions);

    expect(vault.exists(pjWorldview('关联测试项目'))).toBe(true);
    expect(vault.exists(pjCharsDir('关联测试项目') + '/')).toBe(true);
    expect(vault.exists(pjLocsDir('关联测试项目') + '/')).toBe(true);
    expect(vault.exists(pjFactionsDir('关联测试项目') + '/')).toBe(true);
    expect(vault.exists(pjItemsDir('关联测试项目') + '/')).toBe(true);
  });
});

describe('设定生成流程 - 多题材设定对比', () => {
  let app: App;

  beforeEach(() => {
    app = new App();
  });

  it('玄幻题材：修炼体系完整，势力众多', () => {
    const chars = XUANHUAN_SCENARIO.characters;
    const factions = XUANHUAN_SCENARIO.factions;

    expect(chars.some(c => c.cultivationLevel)).toBe(true);
    expect(factions.length).toBeGreaterThanOrEqual(2);
  });

  it('言情题材：情感关系复杂，现代背景', () => {
    const chars = ROMANCE_SCENARIO.characters;
    const worldview = ROMANCE_SCENARIO.worldview;

    expect(chars.length).toBeGreaterThanOrEqual(3);
    expect(worldview.genre).toContain('言情');
  });

  it('悬疑题材：案件相关，推理元素', () => {
    const chars = MYSTERY_SCENARIO.characters;
    const worldview = MYSTERY_SCENARIO.worldview;

    expect(chars.some(c => c.role === '反派')).toBe(true);
    expect(worldview.genre).toContain('悬疑');
  });
});
