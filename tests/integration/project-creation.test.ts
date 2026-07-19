import { describe, it, expect, beforeEach } from 'vitest';
import { App, Vault } from '../__mocks__/obsidian';
import { TestProjectScaffold } from './helpers/project-scaffold';
import {
  assertFolderStructure,
  assertFileStructure,
  assertWorldviewStructure,
  assertCharacterStructure,
} from './helpers/custom-assertions';
import { XUANHUAN_SCENARIO, ROMANCE_SCENARIO, MYSTERY_SCENARIO } from './fixtures/scenarios';
import {
  pjWorldview,
  pjCharsDir,
  pjLocsDir,
  pjFactionsDir,
  pjItemsDir,
  pjOutlineDir,
  pjVolumeOutlineDir,
  pjBodyDir,
  pjTimelineDir,
  pjControlDir,
  pjFanficDir,
  pjCharFile,
  SUBDIR_WORLD_ARCH,
} from '../../shared/paths';

describe('项目创建流程 - 基础结构', () => {
  let app: App;
  let vault: Vault;

  beforeEach(() => {
    app = new App();
    vault = app.vault as any;
  });

  it('创建空项目：验证所有目录结构正确生成', async () => {
    const projectName = '测试空项目';
    const scaffold = new TestProjectScaffold(app, projectName);

    await scaffold.createBasicStructure();

    const expectedFolders = [
      `${projectName}/`,
      `${projectName}/${SUBDIR_WORLD_ARCH}/`,
      `${pjCharsDir(projectName)}/`,
      `${pjLocsDir(projectName)}/`,
      `${pjFactionsDir(projectName)}/`,
      `${pjItemsDir(projectName)}/`,
      `${pjOutlineDir(projectName)}/`,
      `${pjVolumeOutlineDir(projectName)}/`,
      `${pjBodyDir(projectName, 1)}/`,
      `${pjTimelineDir(projectName)}/`,
      `${pjControlDir(projectName)}/`,
      `${pjFanficDir(projectName)}/`,
    ];

    assertFolderStructure(vault, expectedFolders);
    expect(vault.exists(`${projectName}/`)).toBe(true);
  });

  it('项目目录命名正确：不包含非法字符', async () => {
    const validProjectName = '我的小说项目';
    const scaffold = new TestProjectScaffold(app, validProjectName);
    await scaffold.createBasicStructure();

    expect(vault.exists(`${validProjectName}/`)).toBe(true);
    expect(scaffold.getProjectName()).toBe(validProjectName);
  });
});

describe('项目创建流程 - 玄幻修仙场景', () => {
  let app: App;
  let vault: Vault;
  let scaffold: TestProjectScaffold;

  beforeEach(async () => {
    app = new App();
    vault = app.vault as any;
    scaffold = new TestProjectScaffold(app, '玄幻修仙项目');
  });

  it('完整创建玄幻项目：世界观+人物+地点+势力+物品+大纲+章节', async () => {
    const result = await scaffold.buildFullProject({
      projectName: '玄幻修仙项目',
      worldview: XUANHUAN_SCENARIO.worldview,
      characters: XUANHUAN_SCENARIO.characters,
      locations: XUANHUAN_SCENARIO.locations,
      factions: XUANHUAN_SCENARIO.factions,
      items: XUANHUAN_SCENARIO.items,
      chapters: XUANHUAN_SCENARIO.chapters,
      volumeOutline: XUANHUAN_SCENARIO.volumeOutline,
    });

    expect(result.worldviewPath).toBeDefined();
    expect(result.characterPaths.length).toBe(XUANHUAN_SCENARIO.characters.length);
    expect(result.locationPaths.length).toBe(XUANHUAN_SCENARIO.locations.length);
    expect(result.factionPaths.length).toBe(XUANHUAN_SCENARIO.factions.length);
    expect(result.itemPaths.length).toBe(XUANHUAN_SCENARIO.items.length);
    expect(result.chapterPaths.length).toBe(XUANHUAN_SCENARIO.chapters.length);
    expect(result.volumeOutlinePath).toBeDefined();

    const worldviewContent = await vault.readByPath(result.worldviewPath!);
    assertWorldviewStructure(worldviewContent);
    expect(worldviewContent).toContain('天元大陆');
    expect(worldviewContent).toContain('玄幻修仙');
  });

  it('验证人物文件生成正确：主角、女主、配角、反派', async () => {
    await scaffold.buildFullProject({
      projectName: '玄幻修仙项目',
      characters: XUANHUAN_SCENARIO.characters,
    });

    for (const char of XUANHUAN_SCENARIO.characters) {
      const charPath = pjCharFile('玄幻修仙项目', char.name);
      expect(vault.exists(charPath)).toBe(true);

      const content = await vault.readByPath(charPath);
      assertCharacterStructure(content);
      expect(content).toContain(char.name);
      expect(content).toContain(char.role);
    }
  });

  it('验证势力与人物关联：人物所属势力必须存在', async () => {
    await scaffold.buildFullProject({
      projectName: '玄幻修仙项目',
      characters: XUANHUAN_SCENARIO.characters,
      factions: XUANHUAN_SCENARIO.factions,
    });

    const factionNames = new Set(XUANHUAN_SCENARIO.factions.map(f => f.name));

    for (const char of XUANHUAN_SCENARIO.characters) {
      if (char.faction) {
        expect(factionNames.has(char.faction)).toBe(true);
        const factionPath = pjFactionsDir('玄幻修仙项目') + '/' + char.faction + '.md';
        expect(vault.exists(factionPath)).toBe(true);
      }
    }
  });
});

describe('项目创建流程 - 都市言情场景', () => {
  let app: App;
  let vault: Vault;
  let scaffold: TestProjectScaffold;

  beforeEach(async () => {
    app = new App();
    vault = app.vault as any;
    scaffold = new TestProjectScaffold(app, '都市言情项目');
  });

  it('完整创建都市言情项目：验证现代题材适配', async () => {
    const result = await scaffold.buildFullProject({
      projectName: '都市言情项目',
      worldview: ROMANCE_SCENARIO.worldview,
      characters: ROMANCE_SCENARIO.characters,
      locations: ROMANCE_SCENARIO.locations,
      factions: ROMANCE_SCENARIO.factions,
      chapters: ROMANCE_SCENARIO.chapters,
      volumeOutline: ROMANCE_SCENARIO.volumeOutline,
    });

    expect(result.worldviewPath).toBeDefined();

    const worldviewContent = await vault.readByPath(result.worldviewPath!);
    expect(worldviewContent).toContain('现代都市');
    expect(worldviewContent).toContain('都市言情');
  });

  it('验证言情人物配置：女主、男主、闺蜜、情敌', async () => {
    await scaffold.buildFullProject({
      projectName: '都市言情项目',
      characters: ROMANCE_SCENARIO.characters,
    });

    const charNames = ROMANCE_SCENARIO.characters.map(c => c.name);
    expect(charNames).toContain('苏晚');
    expect(charNames).toContain('顾延深');
    expect(charNames).toContain('林薇薇');
    expect(charNames).toContain('白若曦');

    const mainChar = ROMANCE_SCENARIO.characters.find(c => c.role === '女主角');
    expect(mainChar).toBeDefined();
    expect(mainChar!.gender).toBe('女');
  });
});

describe('项目创建流程 - 悬疑推理场景', () => {
  let app: App;
  let vault: Vault;
  let scaffold: TestProjectScaffold;

  beforeEach(async () => {
    app = new App();
    vault = app.vault as any;
    scaffold = new TestProjectScaffold(app, '悬疑推理项目');
  });

  it('完整创建悬疑项目：验证悬疑题材配置', async () => {
    const result = await scaffold.buildFullProject({
      projectName: '悬疑推理项目',
      worldview: MYSTERY_SCENARIO.worldview,
      characters: MYSTERY_SCENARIO.characters,
      locations: MYSTERY_SCENARIO.locations,
      factions: MYSTERY_SCENARIO.factions,
      chapters: MYSTERY_SCENARIO.chapters,
      volumeOutline: MYSTERY_SCENARIO.volumeOutline,
    });

    expect(result.worldviewPath).toBeDefined();

    const worldviewContent = await vault.readByPath(result.worldviewPath!);
    expect(worldviewContent).toContain('迷雾城');
    expect(worldviewContent).toContain('悬疑推理');
  });

  it('验证悬疑人物配置：主角、法医、老刑警、神秘反派', async () => {
    await scaffold.buildFullProject({
      projectName: '悬疑推理项目',
      characters: MYSTERY_SCENARIO.characters,
    });

    const roles = MYSTERY_SCENARIO.characters.map(c => c.role);
    expect(roles).toContain('主角');
    expect(roles).toContain('女主角');
    expect(roles).toContain('男配角');
    expect(roles).toContain('反派');
  });
});

describe('项目创建流程 - 多场景对比', () => {
  let app: App;

  beforeEach(() => {
    app = new App();
  });

  it('三个场景项目可同时创建互不干扰', async () => {
    const project1 = new TestProjectScaffold(app, '项目1_玄幻');
    const project2 = new TestProjectScaffold(app, '项目2_言情');
    const project3 = new TestProjectScaffold(app, '项目3_悬疑');

    await project1.createBasicStructure();
    await project2.createBasicStructure();
    await project3.createBasicStructure();

    const vault = app.vault as any;
    expect(vault.exists('项目1_玄幻/')).toBe(true);
    expect(vault.exists('项目2_言情/')).toBe(true);
    expect(vault.exists('项目3_悬疑/')).toBe(true);
  });

  it('不同题材世界观内容差异明显', async () => {
    const scenarios = [XUANHUAN_SCENARIO, ROMANCE_SCENARIO, MYSTERY_SCENARIO];
    const worldviews: string[] = [];

    for (const scenario of scenarios) {
      const scaffold = new TestProjectScaffold(app, `项目_${scenario.id}`);
      await scaffold.createBasicStructure();
      const path = await scaffold.addWorldview(scenario.worldview);
      const content = await scaffold.readFile(path);
      worldviews.push(content);
    }

    expect(worldviews[0]).not.toBe(worldviews[1]);
    expect(worldviews[1]).not.toBe(worldviews[2]);
    expect(worldviews[0]).not.toBe(worldviews[2]);
  });
});
