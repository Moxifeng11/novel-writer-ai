import { describe, it, expect, beforeEach } from 'vitest';
import {
  EntityContextEngine,
  getEntityContextEngine,
} from '../../../engine/entity-context-engine';
import type {
  AnyEntityDomainModel,
  CharacterDomainModel,
  FactionDomainModel,
  LocationDomainModel,
  ItemDomainModel,
} from '../../../shared/entity-models';
import type { CharacterPairRelation } from '../../../engine/relationship-engine';

function makeCharacter(
  id: string,
  name: string,
  options: Partial<CharacterDomainModel> = {}
): CharacterDomainModel {
  return {
    id,
    name,
    category: 'character',
    filePath: `${id}.md`,
    tags: [],
    entityStatus: undefined,
    createdAt: undefined,
    lastChangedAt: undefined,
    lastChangedReason: undefined,
    frontmatter: {},
    body: '',
    content: null,
    identity: '',
    currentStatus: '',
    currentEmotion: '',
    currentLocation: '',
    faction: '',
    personalityTags: '',
    specialAbility: '',
    background: '',
    appearance: '',
    soul: null,
    personality: null,
    arc: null,
    relations: [],
    ...options,
  };
}

function makeFaction(
  id: string,
  name: string,
  options: Partial<FactionDomainModel> = {}
): FactionDomainModel {
  return {
    id,
    name,
    category: 'faction',
    filePath: `${id}.md`,
    tags: [],
    entityStatus: undefined,
    createdAt: undefined,
    lastChangedAt: undefined,
    lastChangedReason: undefined,
    frontmatter: {},
    body: '',
    content: null,
    alias: '',
    type: '',
    description: '',
    leader: '',
    rank: '',
    ...options,
  };
}

function makeLocation(
  id: string,
  name: string,
  options: Partial<LocationDomainModel> = {}
): LocationDomainModel {
  return {
    id,
    name,
    category: 'location',
    filePath: `${id}.md`,
    tags: [],
    entityStatus: undefined,
    createdAt: undefined,
    lastChangedAt: undefined,
    lastChangedReason: undefined,
    frontmatter: {},
    body: '',
    content: null,
    alias: '',
    type: '',
    description: '',
    importance: '',
    geography: '',
    inhabitants: '',
    worldRegion: '',
    ...options,
  };
}

function makeItem(
  id: string,
  name: string,
  options: Partial<ItemDomainModel> = {}
): ItemDomainModel {
  return {
    id,
    name,
    category: 'item',
    filePath: `${id}.md`,
    tags: [],
    entityStatus: undefined,
    createdAt: undefined,
    lastChangedAt: undefined,
    lastChangedReason: undefined,
    frontmatter: {},
    body: '',
    content: null,
    type: '',
    grade: '',
    description: '',
    effect: '',
    owner: '',
    ...options,
  };
}

function makeRelation(
  charA: string,
  charB: string,
  state: Partial<CharacterPairRelation['state']> = {}
): CharacterPairRelation {
  return {
    charA,
    charB,
    state: {
      trust: 50,
      attraction: 0,
      fear: 0,
      resentment: 0,
      dependence: 0,
      status: '朋友',
      history: '',
      ...state,
    },
    lastUpdatedChapter: '1',
  };
}

describe('EntityContextEngine — 构造与单例', () => {
  it('默认构造函数不报错', () => {
    const engine = new EntityContextEngine();
    expect(engine).toBeDefined();
  });

  it('getEntityContextEngine 返回单例', () => {
    const instance1 = getEntityContextEngine();
    const instance2 = getEntityContextEngine();
    expect(instance1).toBe(instance2);
  });
});

describe('EntityContextEngine — 实体选择：边界情况', () => {
  let engine: EntityContextEngine;

  beforeEach(() => {
    engine = new EntityContextEngine();
  });

  it('空实体列表返回空结果', () => {
    const result = engine.selectRelevantEntities([], { project: 'test' });
    expect(result).toEqual([]);
  });

  it('空选项也能正常工作', () => {
    const entities = [makeCharacter('c1', '林惊鸿')];
    const result = engine.selectRelevantEntities(entities, { project: 'test' });
    expect(result.length).toBe(1);
    expect(result[0].entity.name).toBe('林惊鸿');
  });

  it('手动排除的实体不会出现在结果中', () => {
    const entities = [
      makeCharacter('c1', '林惊鸿'),
      makeCharacter('c2', '苏白'),
    ];
    const result = engine.selectRelevantEntities(entities, {
      project: 'test',
      manuallyExcluded: ['c1'],
    });
    expect(result.length).toBe(1);
    expect(result[0].entity.id).toBe('c2');
  });

  it('按名称排除的实体不会出现在结果中', () => {
    const entities = [
      makeCharacter('c1', '林惊鸿'),
      makeCharacter('c2', '苏白'),
    ];
    const result = engine.selectRelevantEntities(entities, {
      project: 'test',
      manuallyExcluded: ['林惊鸿'],
    });
    expect(result.length).toBe(1);
    expect(result[0].entity.name).toBe('苏白');
  });

  it('maxEntities 限制返回数量', () => {
    const entities: CharacterDomainModel[] = [];
    for (let i = 0; i < 10; i++) {
      entities.push(makeCharacter(`c${i}`, `角色${i}`));
    }
    const result = engine.selectRelevantEntities(entities, {
      project: 'test',
      maxEntities: 3,
    });
    expect(result.length).toBe(3);
  });

  it('结果按分数降序排列', () => {
    const entities = [
      makeCharacter('c1', '甲'),
      makeCharacter('c2', '乙'),
      makeCharacter('c3', '丙'),
    ];
    const result = engine.selectRelevantEntities(entities, {
      project: 'test',
      currentSceneText: '乙出场说话，甲在旁边听着。',
    });
    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1].totalScore).toBeGreaterThanOrEqual(result[i].totalScore);
    }
  });
});

describe('EntityContextEngine — 实体选择：评分维度', () => {
  let engine: EntityContextEngine;

  beforeEach(() => {
    engine = new EntityContextEngine();
  });

  it('手动固定的实体获得最高分', () => {
    const entities = [
      makeCharacter('c1', '林惊鸿'),
      makeCharacter('c2', '苏白'),
    ];
    const result = engine.selectRelevantEntities(entities, {
      project: 'test',
      manuallyPinned: ['c2'],
    });
    expect(result[0].entity.id).toBe('c2');
    expect(result[0].reasons.some(r => r.type === 'manually_pinned')).toBe(true);
  });

  it('关键词匹配：场景文本中出现的实体会加分', () => {
    const entities = [
      makeCharacter('c1', '林惊鸿'),
      makeCharacter('c2', '苏白'),
    ];
    const result = engine.selectRelevantEntities(entities, {
      project: 'test',
      currentSceneText: '林惊鸿走了进来，林惊鸿四处张望。',
    });
    const lin = result.find(r => r.entity.name === '林惊鸿');
    const su = result.find(r => r.entity.name === '苏白');
    expect(lin!.totalScore).toBeGreaterThan(su!.totalScore);
    expect(lin!.reasons.some(r => r.type === 'keyword_match')).toBe(true);
  });

  it('场景地点匹配：当前场景地点对应的地点实体加分', () => {
    const entities = [
      makeLocation('l1', '青云宗'),
      makeLocation('l2', '天魔殿'),
    ];
    const result = engine.selectRelevantEntities(entities, {
      project: 'test',
      sceneLocation: '青云宗',
    });
    expect(result[0].entity.name).toBe('青云宗');
    expect(result[0].reasons.some(r => r.type === 'scene_location')).toBe(true);
  });

  it('场景势力匹配：场景势力对应的势力实体加分', () => {
    const entities = [
      makeFaction('f1', '青云宗'),
      makeFaction('f2', '天魔殿'),
    ];
    const result = engine.selectRelevantEntities(entities, {
      project: 'test',
      sceneFactions: ['青云宗'],
    });
    expect(result[0].entity.name).toBe('青云宗');
    expect(result[0].reasons.some(r => r.type === 'scene_faction')).toBe(true);
  });

  it('角色重要度：主角获得更高基础分', () => {
    const protagonist = makeCharacter('c1', '林惊鸿', {
      identity: '主角 复仇少年',
      tags: ['主角'],
    });
    const minor = makeCharacter('c2', '路人甲', {
      identity: '路人',
      tags: ['配角'],
    });
    const result = engine.selectRelevantEntities([protagonist, minor], {
      project: 'test',
    });
    expect(result[0].entity.name).toBe('林惊鸿');
    expect(result[0].importanceLevel).toBe('protagonist');
    expect(result[0].reasons.some(r => r.type === 'character_important')).toBe(true);
  });

  it('剧情阶段：实体标签与剧情阶段匹配时加分', () => {
    const entity = makeCharacter('c1', '林惊鸿', {
      tags: ['修炼', '成长'],
    });
    const result = engine.selectRelevantEntities([entity], {
      project: 'test',
      plotPhase: '修炼',
    });
    expect(result[0].reasons.some(r => r.type === 'plot_phase')).toBe(true);
  });

  it('最近出场：近期出场的实体获得加分', () => {
    const engineWithHistory = new EntityContextEngine();
    const entity = makeCharacter('c1', '林惊鸿');
    engineWithHistory.recordAppearance('test', 'c1', '林惊鸿', 'character', 5);

    const result = engineWithHistory.selectRelevantEntities([entity], {
      project: 'test',
      currentChapter: 6,
    });
    expect(result[0].reasons.some(r => r.type === 'recent_appearance')).toBe(true);
  });

  it('关系链：与场景人物有关系的实体加分', () => {
    const lin = makeCharacter('c1', '林惊鸿');
    const su = makeCharacter('c2', '苏白');
    const relations = [makeRelation('林惊鸿', '苏白', { trust: 80 })];

    const result = engine.selectRelevantEntities([lin, su], {
      project: 'test',
      sceneCharacters: ['林惊鸿'],
    }, relations);

    const suResult = result.find(r => r.entity.name === '苏白');
    expect(suResult).toBeDefined();
    expect(suResult!.reasons.some(r => r.type === 'relation_chain')).toBe(true);
  });
});

describe('EntityContextEngine — 出场追踪', () => {
  let engine: EntityContextEngine;

  beforeEach(() => {
    engine = new EntityContextEngine();
  });

  it('recordAppearance 记录实体出场', () => {
    engine.recordAppearance('test', 'c1', '林惊鸿', 'character', 1);
    const record = engine.getAppearanceRecord('test', 'c1');
    expect(record).toBeDefined();
    expect(record!.entityId).toBe('c1');
    expect(record!.chapters).toEqual([1]);
    expect(record!.appearanceCount).toBe(1);
    expect(record!.firstAppearanceChapter).toBe(1);
    expect(record!.lastAppearanceChapter).toBe(1);
  });

  it('同一章节多次记录只算一次', () => {
    engine.recordAppearance('test', 'c1', '林惊鸿', 'character', 1);
    engine.recordAppearance('test', 'c1', '林惊鸿', 'character', 1);
    const record = engine.getAppearanceRecord('test', 'c1');
    expect(record!.appearanceCount).toBe(1);
    expect(record!.chapters.length).toBe(1);
  });

  it('多章节出场记录正确', () => {
    engine.recordAppearance('test', 'c1', '林惊鸿', 'character', 3);
    engine.recordAppearance('test', 'c1', '林惊鸿', 'character', 1);
    engine.recordAppearance('test', 'c1', '林惊鸿', 'character', 5);
    const record = engine.getAppearanceRecord('test', 'c1');
    expect(record!.chapters).toEqual([1, 3, 5]);
    expect(record!.appearanceCount).toBe(3);
    expect(record!.firstAppearanceChapter).toBe(1);
    expect(record!.lastAppearanceChapter).toBe(5);
  });

  it('未出场的实体返回 undefined', () => {
    const record = engine.getAppearanceRecord('test', 'nonexistent');
    expect(record).toBeUndefined();
  });

  it('extractAppearancesFromChapter 从正文中批量提取', () => {
    const entities = [
      makeCharacter('c1', '林惊鸿'),
      makeCharacter('c2', '苏白'),
      makeCharacter('c3', '路人甲'),
    ];
    const content = '林惊鸿和苏白一起走在森林中，林惊鸿说着话。';
    engine.extractAppearancesFromChapter('test', 1, content, entities);

    const r1 = engine.getAppearanceRecord('test', 'c1');
    const r2 = engine.getAppearanceRecord('test', 'c2');
    const r3 = engine.getAppearanceRecord('test', 'c3');

    expect(r1).toBeDefined();
    expect(r2).toBeDefined();
    expect(r3).toBeUndefined();
  });

  it('getLongAbsentEntities 获取长时间未出场实体', () => {
    const entities = [
      makeCharacter('c1', '林惊鸿'),
      makeCharacter('c2', '苏白'),
      makeCharacter('c3', '长老'),
    ];
    engine.recordAppearance('test', 'c1', '林惊鸿', 'character', 1);
    engine.recordAppearance('test', 'c2', '苏白', 'character', 8);
    engine.recordAppearance('test', 'c3', '长老', 'character', 3);

    const absent = engine.getLongAbsentEntities('test', 10, 5, entities);
    expect(absent.length).toBeGreaterThan(0);
    for (const a of absent) {
      expect(a.absentChapters).toBeGreaterThanOrEqual(5);
    }
  });

  it('clearAppearanceCache 清除项目缓存', () => {
    engine.recordAppearance('test', 'c1', '林惊鸿', 'character', 1);
    expect(engine.getAppearanceRecord('test', 'c1')).toBeDefined();

    engine.clearAppearanceCache('test');
    expect(engine.getAppearanceRecord('test', 'c1')).toBeUndefined();
  });
});

describe('EntityContextEngine — 智能上下文构建', () => {
  let engine: EntityContextEngine;

  beforeEach(() => {
    engine = new EntityContextEngine();
  });

  it('buildSmartContext 返回分类后的实体', () => {
    const entities: AnyEntityDomainModel[] = [
      makeCharacter('c1', '林惊鸿'),
      makeFaction('f1', '青云宗'),
      makeLocation('l1', '大殿'),
      makeItem('i1', '倚天剑'),
    ];
    const scored = engine.selectRelevantEntities(entities, { project: 'test' });
    const result = engine.buildSmartContext(scored, { project: 'test' });

    expect(result.characters.length).toBe(1);
    expect(result.factions.length).toBe(1);
    expect(result.locations.length).toBe(1);
    expect(result.items.length).toBe(1);
    expect(result.selectionSummary.totalEntities).toBe(4);
    expect(result.selectionSummary.selectedCount).toBe(4);
  });

  it('tokenBudget 限制上下文大小', () => {
    const entities: AnyEntityDomainModel[] = [];
    for (let i = 0; i < 20; i++) {
      entities.push(makeCharacter(`c${i}`, `角色${i}`, {
        identity: `一个非常非常长的身份描述，用来占用token预算空间`.repeat(10),
        background: `一段很长的背景故事，用来消耗token`.repeat(10),
      }));
    }
    const scored = engine.selectRelevantEntities(entities, { project: 'test' });
    const result = engine.buildSmartContext(scored, {
      project: 'test',
      tokenBudget: 500,
    });
    expect(result.selectionSummary.estimatedTokens).toBeLessThanOrEqual(500);
  });

  it('角色重要度决定信息裁剪级别', () => {
    const protagonist = makeCharacter('c1', '林惊鸿', {
      identity: '主角',
      tags: ['主角'],
      personalityTags: '冷静、聪明',
      specialAbility: '绝世武功',
      background: '身世成谜的少年',
      currentStatus: '修炼中',
      currentEmotion: '平静',
      faction: '青云宗',
    });
    const minor = makeCharacter('c2', '路人甲', {
      identity: '路人',
      tags: ['配角'],
    });
    const scored = engine.selectRelevantEntities([protagonist, minor], {
      project: 'test',
    });
    const result = engine.buildSmartContext(scored, { project: 'test' });

    const mainChar = result.characters.find(c => c.name === '林惊鸿');
    const minorChar = result.characters.find(c => c.name === '路人甲');

    expect(mainChar).toBeDefined();
    expect(minorChar).toBeDefined();
    expect(mainChar!.detailLevel).toBe('full');
    expect(minorChar!.detailLevel).toBe('brief');
    expect(mainChar!.summary.length).toBeGreaterThan(minorChar!.summary.length);
  });

  it('关系过滤：只保留与出场人物相关的关系', () => {
    const characters = [
      makeCharacter('c1', '林惊鸿'),
      makeCharacter('c2', '苏白'),
      makeCharacter('c3', '长老'),
    ];
    const relations = [
      makeRelation('林惊鸿', '苏白', { trust: 90 }),
      makeRelation('林惊鸿', '长老', { trust: 60 }),
      makeRelation('苏白', '长老', { trust: 50 }),
    ];
    const scored = engine.selectRelevantEntities(characters, {
      project: 'test',
      manuallyPinned: ['c1', 'c2', 'c3'],
    }, relations);
    const result = engine.buildSmartContext(scored, {
      project: 'test',
      tokenBudget: 5000,
    }, relations);

    expect(result.characters.length).toBeGreaterThanOrEqual(2);
    expect(result.relations.length).toBeGreaterThan(0);
    const selectedNames = new Set(result.characters.map(c => c.name));
    for (const rel of result.relations) {
      const fromIn = selectedNames.has(rel.from);
      const toIn = selectedNames.has(rel.to);
      expect(fromIn || toIn).toBe(true);
    }
  });

  it('missingEntities 列出场景中但设定库中没有的人物', () => {
    const entities = [makeCharacter('c1', '林惊鸿')];
    const scored = engine.selectRelevantEntities(entities, { project: 'test' });
    const result = engine.buildSmartContext(scored, {
      project: 'test',
      sceneCharacters: ['林惊鸿', '苏白', '不知名人物'],
    });
    expect(result.missingEntities).toContain('苏白');
    expect(result.missingEntities).toContain('不知名人物');
  });

  it('formatSmartContextForPrompt 格式化为提示词文本', () => {
    const entities: AnyEntityDomainModel[] = [
      makeCharacter('c1', '林惊鸿', { identity: '主角' }),
      makeLocation('l1', '青云宗', { type: '宗门' }),
    ];
    const scored = engine.selectRelevantEntities(entities, { project: 'test' });
    const context = engine.buildSmartContext(scored, { project: 'test' });
    const formatted = engine.formatSmartContextForPrompt(context);

    expect(formatted).toContain('出场人物');
    expect(formatted).toContain('相关地点');
    expect(formatted).toContain('林惊鸿');
    expect(formatted).toContain('青云宗');
  });
});

describe('EntityContextEngine — 结果结构', () => {
  let engine: EntityContextEngine;

  beforeEach(() => {
    engine = new EntityContextEngine();
  });

  it('ScoredEntity 包含完整字段', () => {
    const entity = makeCharacter('c1', '林惊鸿');
    const result = engine.selectRelevantEntities([entity], { project: 'test' });
    const scored = result[0];

    expect(scored).toHaveProperty('entity');
    expect(scored).toHaveProperty('totalScore');
    expect(scored).toHaveProperty('reasons');
    expect(scored).toHaveProperty('importanceLevel');
    expect(scored).toHaveProperty('lastAppearanceChapter');
    expect(scored).toHaveProperty('appearanceCount');
    expect(typeof scored.totalScore).toBe('number');
    expect(Array.isArray(scored.reasons)).toBe(true);
  });

  it('每个选择理由包含 type、score、description', () => {
    const entity = makeCharacter('c1', '林惊鸿');
    const result = engine.selectRelevantEntities([entity], {
      project: 'test',
      manuallyPinned: ['c1'],
    });
    const reasons = result[0].reasons;
    expect(reasons.length).toBeGreaterThan(0);
    for (const reason of reasons) {
      expect(reason).toHaveProperty('type');
      expect(reason).toHaveProperty('score');
      expect(reason).toHaveProperty('description');
      expect(typeof reason.score).toBe('number');
    }
  });
});
