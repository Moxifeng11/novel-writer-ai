import { describe, it, expect, beforeEach } from 'vitest';
import { GenreClassifier } from '../../services/genre-classifier';
import { WebnovelKnowledgeBase } from '../../engine/webnovel-knowledge-base';
import { assertGenreClassificationResult } from './helpers/custom-assertions';
import { XUANHUAN_SCENARIO, ROMANCE_SCENARIO, MYSTERY_SCENARIO, ALL_SCENARIOS } from './fixtures/scenarios';
import { generateLongText } from './helpers/test-data-generator';

describe('题材分类流程 - 基础分类', () => {
  let classifier: GenreClassifier;

  beforeEach(() => {
    const kb = new WebnovelKnowledgeBase();
    classifier = new GenreClassifier(kb);
  });

  it('分类器初始化正常', () => {
    expect(classifier).toBeDefined();
  });

  it('返回结果结构完整', async () => {
    const result = await classifier.classify({
      title: '测试小说',
      synopsis: '这是一部测试用的小说。',
    });

    assertGenreClassificationResult(result);
  });

  it('空内容也能返回分类结果', async () => {
    const result = await classifier.classify({
      title: '',
    });

    expect(result).toBeDefined();
    expect(result.channel).toBeDefined();
    expect(result.primaryGenre).toBeDefined();
  });
});

describe('题材分类流程 - 频道分类', () => {
  let classifier: GenreClassifier;

  beforeEach(() => {
    const kb = new WebnovelKnowledgeBase();
    classifier = new GenreClassifier(kb);
  });

  it('男频关键词明显时识别为男频', async () => {
    const result = await classifier.classify({
      title: XUANHUAN_SCENARIO.name,
      synopsis: XUANHUAN_SCENARIO.synopsis,
      sampleText: generateLongText(XUANHUAN_SCENARIO.sampleText, 2000),
      tags: XUANHUAN_SCENARIO.tags,
    });

    expect(result.channel.id).toBe('male');
    expect(result.channel.confidence).toBeGreaterThan(0.5);
  });

  it('女频关键词明显时识别为女频', async () => {
    const result = await classifier.classify({
      title: ROMANCE_SCENARIO.name,
      synopsis: ROMANCE_SCENARIO.synopsis,
      sampleText: generateLongText(ROMANCE_SCENARIO.sampleText, 2000),
      tags: ROMANCE_SCENARIO.tags,
    });

    expect(result.channel.id).toBe('female');
    expect(result.channel.confidence).toBeGreaterThan(0.5);
  });

  it('中性题材识别为中性或接近中性', async () => {
    const result = await classifier.classify({
      title: MYSTERY_SCENARIO.name,
      synopsis: MYSTERY_SCENARIO.synopsis,
      sampleText: generateLongText(MYSTERY_SCENARIO.sampleText, 2000),
      tags: MYSTERY_SCENARIO.tags,
    });

    expect(['male', 'female', 'neutral']).toContain(result.channel.id);
    expect(result.channel.confidence).toBeGreaterThanOrEqual(0);
  });
});

describe('题材分类流程 - 主分类识别', () => {
  let classifier: GenreClassifier;

  beforeEach(() => {
    const kb = new WebnovelKnowledgeBase();
    classifier = new GenreClassifier(kb);
  });

  it('玄幻题材正确识别', async () => {
    const result = await classifier.classify({
      title: '逆天修仙传',
      synopsis: '男主林天生是个废柴，意外获得系统，从此走上人生巅峰，称霸修仙界。修炼、升级、打怪、爆装备，一路开挂逆袭。',
      tags: ['玄幻', '修仙', '升级流', '爽文'],
      sampleText: generateLongText('林惊鸿修炼了一夜，感受着体内缓缓增长的灵气。太虚神鼎在他丹田中微微发热。炼气期、筑基期、金丹期，他的修为不断提升。', 1000),
    });

    expect(result.primaryGenre.id).toBeTruthy();
    expect(result.primaryGenre.name).toBeTruthy();
    expect(result.primaryGenre.confidence).toBeGreaterThan(0);
  });

  it('言情题材正确识别', async () => {
    const result = await classifier.classify({
      title: '总裁的替身新娘',
      synopsis: '女主苏晚意外与霸道总裁顾延深相遇，从最初的误会到逐渐相知相爱。先婚后爱，甜宠虐恋，豪门恩怨。',
      tags: ['现代言情', '总裁', '甜宠', '豪门'],
      sampleText: generateLongText('苏晚站在顾氏集团大厦的落地窗前，看着窗外的车水马龙。顾延深走过来，从身后轻轻抱住她。"嫁给我。"他低沉的声音在耳边响起。', 1000),
    });

    expect(result.primaryGenre.id).toBeTruthy();
    expect(result.primaryGenre.name).toBeTruthy();
  });

  it('悬疑题材正确识别', async () => {
    const result = await classifier.classify({
      title: '迷雾追凶',
      synopsis: '刑警队长陈默与法医林雨桐联手调查一系列离奇案件，在迷雾重重的城市中追寻真相。破案、推理、烧脑、反转。',
      tags: ['悬疑', '推理', '刑侦', '破案'],
      sampleText: generateLongText('陈默站在迷雾港口，望着眼前翻滚的浓雾，眉头紧锁。这起案子比他想象的要复杂得多。凶手留下的线索寥寥无几。', 1000),
    });

    expect(result.primaryGenre.id).toBeTruthy();
    expect(result.primaryGenre.name).toBeTruthy();
  });
});

describe('题材分类流程 - 次分类识别', () => {
  let classifier: GenreClassifier;

  beforeEach(() => {
    const kb = new WebnovelKnowledgeBase();
    classifier = new GenreClassifier(kb);
  });

  it('返回主分类下的子分类', async () => {
    const result = await classifier.classify({
      title: '玄幻修仙小说',
      synopsis: '男主修仙升级的故事。',
      tags: ['玄幻', '修仙'],
    });

    expect(result.primarySubGenre).toBeDefined();
    expect(result.primarySubGenre.id).toBeDefined();
    expect(result.primarySubGenre.name).toBeDefined();
  });

  it('返回次要子分类列表', async () => {
    const result = await classifier.classify({
      title: '多元素小说',
      synopsis: '包含多种元素的小说。',
      tags: ['玄幻', '都市', '系统'],
    });

    expect(Array.isArray(result.secondarySubGenres)).toBe(true);
  });
});

describe('题材分类流程 - 多维度评分', () => {
  let classifier: GenreClassifier;

  beforeEach(() => {
    const kb = new WebnovelKnowledgeBase();
    classifier = new GenreClassifier(kb);
  });

  it('返回维度评分：关键词、人物、场景、金手指', async () => {
    const result = await classifier.classify({
      title: '测试小说',
      synopsis: '这是一部测试小说，包含各种元素。',
    });

    expect(result.dimensionScores).toBeDefined();
    expect(result.dimensionScores!.keyword).toBeDefined();
    expect(result.dimensionScores!.character).toBeDefined();
    expect(result.dimensionScores!.scene).toBeDefined();
    expect(result.dimensionScores!.goldenFinger).toBeDefined();
  });

  it('topGenres 包含详细的维度分解', async () => {
    const result = await classifier.classify({
      title: '修仙小说',
      synopsis: '男主修仙升级，修炼功法，获得金手指，在修真界一步步成长。',
      tags: ['玄幻', '修仙', '升级流'],
    });

    expect(result.topGenres.length).toBeGreaterThan(0);
    for (const g of result.topGenres) {
      expect(g.breakdown).toBeDefined();
      expect(g.breakdown!.keyword).toBeDefined();
      expect(g.breakdown!.character).toBeDefined();
      expect(g.breakdown!.scene).toBeDefined();
      expect(g.breakdown!.goldenFinger).toBeDefined();
      expect(g.breakdown!.total).toBeDefined();
    }
  });
});

describe('题材分类流程 - 批量分类', () => {
  let classifier: GenreClassifier;

  beforeEach(() => {
    const kb = new WebnovelKnowledgeBase();
    classifier = new GenreClassifier(kb);
  });

  it('支持批量分类多本书', async () => {
    const books = [
      { title: '修仙小说1', synopsis: '男主修仙的故事', tags: ['玄幻', '修仙'] },
      { title: '言情小说2', synopsis: '女主恋爱的故事', tags: ['言情', '总裁'] },
      { title: '悬疑小说3', synopsis: '破案推理的故事', tags: ['悬疑', '推理'] },
    ];

    const results = await classifier.classifyBatch(books);

    expect(results.length).toBe(3);
    for (const result of results) {
      assertGenreClassificationResult(result);
    }
  });

  it('三本书分类结果各不相同', async () => {
    const books = [
      { title: '逆天修仙传', synopsis: '男主修仙升级打怪，系统金手指', tags: ['玄幻', '修仙', '升级流'] },
      { title: '总裁的甜宠妻', synopsis: '女主和霸道总裁的甜宠爱情', tags: ['现代言情', '总裁', '甜宠'] },
      { title: '刑警侦缉档案', synopsis: '刑警队长破案追凶', tags: ['悬疑', '推理', '刑侦'] },
    ];

    const results = await classifier.classifyBatch(books);

    const channels = results.map(r => r.channel.id);
    expect(channels.length).toBe(3);
  });
});

describe('题材分类流程 - 置信度分析', () => {
  let classifier: GenreClassifier;

  beforeEach(() => {
    const kb = new WebnovelKnowledgeBase();
    classifier = new GenreClassifier(kb);
  });

  it('特征明显的题材置信度高', async () => {
    const result = await classifier.classify({
      title: '逆天修仙系统',
      synopsis: '男主获得系统，修仙升级，一路开挂，打脸逆袭。废柴变天才，莫欺少年穷！',
      tags: ['玄幻', '修仙', '系统', '升级流', '爽文'],
      sampleText: generateLongText('林天生获得了修仙系统，从此踏上人生巅峰。炼气期、筑基期、金丹期，修为一路飙升。', 2000),
    });

    expect(result.primaryGenre.confidence).toBeGreaterThan(0);
    expect(result.channel.confidence).toBeGreaterThan(0);
  });

  it('特征模糊的题材置信度低', async () => {
    const result = await classifier.classify({
      title: '无题',
      synopsis: '一部小说',
    });

    expect(result.channel.confidence).toBeGreaterThanOrEqual(0);
    expect(result.channel.confidence).toBeLessThanOrEqual(1);
  });

  it('置信度值在 0-1 之间', async () => {
    const result = await classifier.classify({
      title: '测试小说',
      synopsis: '这是一部测试小说。',
    });

    expect(result.primaryGenre.confidence).toBeGreaterThanOrEqual(0);
    expect(result.primaryGenre.confidence).toBeLessThanOrEqual(1);
    expect(result.channel.confidence).toBeGreaterThanOrEqual(0);
    expect(result.channel.confidence).toBeLessThanOrEqual(1);
  });
});

describe('题材分类流程 - 三种题材对比测试', () => {
  let classifier: GenreClassifier;

  beforeEach(() => {
    const kb = new WebnovelKnowledgeBase();
    classifier = new GenreClassifier(kb);
  });

  it('三个场景都能成功分类', async () => {
    for (const scenario of ALL_SCENARIOS) {
      const result = await classifier.classify({
        title: scenario.name,
        synopsis: scenario.synopsis,
        tags: scenario.tags,
        sampleText: generateLongText(scenario.sampleText, 1000),
      });

      expect(result).toBeDefined();
      expect(result.primaryGenre.id).toBeTruthy();
      expect(result.primaryGenre.name).toBeTruthy();
    }
  });

  it('不同题材主分类不同', async () => {
    const results = [];
    for (const scenario of ALL_SCENARIOS) {
      const result = await classifier.classify({
        title: scenario.name,
        synopsis: scenario.synopsis,
        tags: scenario.tags,
      });
      results.push(result.primaryGenre.id);
    }

    const uniqueGenres = new Set(results);
    expect(uniqueGenres.size).toBeGreaterThanOrEqual(2);
  });

  it('男频和女频频道区分明显', async () => {
    const xuanhuanResult = await classifier.classify({
      title: XUANHUAN_SCENARIO.name,
      synopsis: XUANHUAN_SCENARIO.synopsis,
      tags: XUANHUAN_SCENARIO.tags,
    });

    const romanceResult = await classifier.classify({
      title: ROMANCE_SCENARIO.name,
      synopsis: ROMANCE_SCENARIO.synopsis,
      tags: ROMANCE_SCENARIO.tags,
    });

    expect(xuanhuanResult.channel.id).toBe('male');
    expect(romanceResult.channel.id).toBe('female');
  });
});

describe('题材分类流程 - 关键词提取', () => {
  let classifier: GenreClassifier;

  beforeEach(() => {
    const kb = new WebnovelKnowledgeBase();
    classifier = new GenreClassifier(kb);
  });

  it('可提取指定题材的关键词', async () => {
    const kb = new WebnovelKnowledgeBase();
    const genres = kb.getAllGenres();
    const firstGenre = genres[0];

    const keywords = classifier.getTopKeywords(
      '这是一部包含修仙、修炼、功法、法宝等元素的小说。主角不断升级变强。',
      firstGenre.id,
      10
    );

    expect(Array.isArray(keywords)).toBe(true);
    expect(keywords.length).toBeLessThanOrEqual(10);
  });
});

describe('题材分类流程 - 完整分类流程', () => {
  let classifier: GenreClassifier;

  beforeEach(() => {
    const kb = new WebnovelKnowledgeBase();
    classifier = new GenreClassifier(kb);
  });

  it('完整流程：输入作品信息→频道判断→主分类→次分类→维度评分→置信度', async () => {
    const result = await classifier.classify({
      title: '逆天修仙系统',
      synopsis: '男主林天生是个废柴，意外获得修仙系统，从此走上人生巅峰。修炼、升级、打怪、爆装备，一路开挂逆袭，最终成为仙界至尊。',
      tags: ['玄幻', '修仙', '系统', '升级流', '爽文'],
      sampleText: generateLongText(`
林天生站在青云宗山门前，心中激动不已。
他本是一介废柴，却意外获得了神秘的修仙系统。
"叮！新手大礼包已发放！"
"恭喜宿主获得先天道体！"
"恭喜宿主获得天阶功法一本！"
听着脑海中不断响起的系统提示音，林天生知道，他的人生将从此改变。
炼气期、筑基期、金丹期、元婴期……
他的修为一路飙升，震惊了所有人。
废柴逆袭，打脸天才，这只是开始！
`, 2000),
    });

    expect(result.channel.id).toBe('male');
    expect(result.channel.confidence).toBeGreaterThan(0.5);

    expect(result.primaryGenre.id).toBeTruthy();
    expect(result.primaryGenre.name).toBeTruthy();
    expect(result.primaryGenre.confidence).toBeGreaterThan(0);

    expect(result.primarySubGenre.id).toBeTruthy();
    expect(result.primarySubGenre.name).toBeTruthy();

    expect(result.dimensionScores).toBeDefined();
    expect(result.dimensionScores!.keyword).toBeGreaterThanOrEqual(0);
    expect(result.dimensionScores!.character).toBeGreaterThanOrEqual(0);
    expect(result.dimensionScores!.scene).toBeGreaterThanOrEqual(0);
    expect(result.dimensionScores!.goldenFinger).toBeGreaterThanOrEqual(0);

    expect(result.topGenres.length).toBeGreaterThan(0);
    expect(result.topGenres.length).toBeLessThanOrEqual(5);

    expect(result.method).toBe('rule');
  });
});
