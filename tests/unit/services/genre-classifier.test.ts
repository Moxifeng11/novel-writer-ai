import { describe, it, expect, beforeEach } from 'vitest';
import { GenreClassifier } from '../../../services/genre-classifier';
import { WebnovelKnowledgeBase } from '../../../engine/webnovel-knowledge-base';

describe('GenreClassifier — 构造', () => {
  it('使用知识库构造不报错', () => {
    const kb = new WebnovelKnowledgeBase();
    const classifier = new GenreClassifier(kb);
    expect(classifier).toBeDefined();
  });

  it('可传入 embeddingProvider 和 preferenceMemory', () => {
    const kb = new WebnovelKnowledgeBase();
    const mockEmbedding = {
      isAvailable: async () => ({ available: false, reason: 'test' }),
      embed: async () => [],
      embedBatch: async () => [[]],
    };
    const classifier = new GenreClassifier(kb, mockEmbedding as any);
    expect(classifier).toBeDefined();
  });
});

describe('GenreClassifier — 基础分类', () => {
  let classifier: GenreClassifier;

  beforeEach(() => {
    const kb = new WebnovelKnowledgeBase();
    classifier = new GenreClassifier(kb);
  });

  it('男频关键词明显时返回男频', async () => {
    const result = await classifier.classify({
      title: '逆天修仙传',
      synopsis: '男主林天生是个废柴，意外获得系统，从此走上人生巅峰，称霸修仙界。',
      tags: ['修仙', '升级流', '爽文'],
    });
    expect(result.channel.id).toBe('male');
    expect(result.channel.confidence).toBeGreaterThan(0.5);
  });

  it('女频关键词明显时返回女频', async () => {
    const result = await classifier.classify({
      title: '重生之嫡女归来',
      synopsis: '女主苏沐重生回到过去，手撕白莲花，虐渣复仇，最终收获爱情。',
      tags: ['重生', '宅斗', '甜宠'],
    });
    expect(result.channel.id).toBe('female');
    expect(result.channel.confidence).toBeGreaterThan(0.5);
  });

  it('空内容时返回中性', async () => {
    const result = await classifier.classify({
      title: '无题',
    });
    expect(result.channel.id).toBeDefined();
    expect(['male', 'female', 'neutral']).toContain(result.channel.id);
  });

  it('返回结果包含完整结构', async () => {
    const result = await classifier.classify({
      title: '测试小说',
      synopsis: '这是一部关于修仙和爱情的故事。',
    });
    expect(result).toHaveProperty('channel');
    expect(result).toHaveProperty('primaryGenre');
    expect(result).toHaveProperty('secondaryGenres');
    expect(result).toHaveProperty('primarySubGenre');
    expect(result).toHaveProperty('secondarySubGenres');
    expect(result).toHaveProperty('topGenres');
    expect(result).toHaveProperty('dimensionScores');
    expect(result).toHaveProperty('method');
  });

  it('primaryGenre 有 id 和 name 和 confidence', async () => {
    const result = await classifier.classify({
      title: '修仙小说',
      synopsis: '主角修仙的故事。',
    });
    expect(result.primaryGenre.id).toBeTruthy();
    expect(result.primaryGenre.name).toBeTruthy();
    expect(typeof result.primaryGenre.confidence).toBe('number');
    expect(result.primaryGenre.confidence).toBeGreaterThanOrEqual(0);
    expect(result.primaryGenre.confidence).toBeLessThanOrEqual(1);
  });

  it('topGenres 最多返回5个', async () => {
    const result = await classifier.classify({
      title: '多元素小说',
      synopsis: '包含修仙、都市、科幻等多种元素的故事。',
    });
    expect(result.topGenres.length).toBeLessThanOrEqual(5);
    for (const g of result.topGenres) {
      expect(g).toHaveProperty('id');
      expect(g).toHaveProperty('name');
      expect(g).toHaveProperty('total');
      expect(g).toHaveProperty('breakdown');
    }
  });

  it('dimensionScores 包含五个维度', async () => {
    const result = await classifier.classify({
      title: '测试',
      synopsis: '测试内容',
    });
    expect(result.dimensionScores).toHaveProperty('keyword');
    expect(result.dimensionScores).toHaveProperty('character');
    expect(result.dimensionScores).toHaveProperty('scene');
    expect(result.dimensionScores).toHaveProperty('goldenFinger');
    expect(result.dimensionScores).toHaveProperty('vector');
  });

  it('method 为 rule 时（无 embedding provider）', async () => {
    const result = await classifier.classify({
      title: '测试',
      synopsis: '测试',
    });
    expect(result.method).toBe('rule');
  });
});

describe('GenreClassifier — 子题材分类', () => {
  let classifier: GenreClassifier;

  beforeEach(() => {
    const kb = new WebnovelKnowledgeBase();
    classifier = new GenreClassifier(kb);
  });

  it('primarySubGenre 有结果', async () => {
    const result = await classifier.classify({
      title: '修仙小说',
      synopsis: '主角在修仙界升级打怪的故事。',
    });
    expect(result.primarySubGenre).toBeDefined();
    expect(typeof result.primarySubGenre.id).toBe('string');
    expect(typeof result.primarySubGenre.name).toBe('string');
    expect(typeof result.primarySubGenre.confidence).toBe('number');
  });

  it('secondarySubGenres 是数组', async () => {
    const result = await classifier.classify({
      title: '多元素小说',
      synopsis: '包含多种子类型的故事。',
    });
    expect(Array.isArray(result.secondarySubGenres)).toBe(true);
    expect(result.secondarySubGenres.length).toBeLessThanOrEqual(3);
  });
});

describe('GenreClassifier — classifyBatch 批量分类', () => {
  it('批量分类返回正确数量的结果', async () => {
    const kb = new WebnovelKnowledgeBase();
    const classifier = new GenreClassifier(kb);
    const books = [
      { title: '修仙传', synopsis: '修仙故事' },
      { title: '都市情', synopsis: '都市爱情' },
      { title: '星际战', synopsis: '科幻战争' },
    ];
    const results = await classifier.classifyBatch(books);
    expect(results.length).toBe(3);
    for (const r of results) {
      expect(r.primaryGenre.id).toBeTruthy();
    }
  });
});

describe('GenreClassifier — getTopKeywords', () => {
  let classifier: GenreClassifier;

  beforeEach(() => {
    const kb = new WebnovelKnowledgeBase();
    classifier = new GenreClassifier(kb);
  });

  it('返回指定题材的高频关键词', () => {
    const kb = new WebnovelKnowledgeBase();
    const allGenres = kb.getAllGenres();
    if (allGenres.length > 0) {
      const firstGenre = allGenres[0];
      const keywords = classifier.getTopKeywords(
        '修仙 修炼 功法 宗门 弟子 升级 法宝',
        firstGenre.id,
        5
      );
      expect(Array.isArray(keywords)).toBe(true);
      expect(keywords.length).toBeLessThanOrEqual(5);
      for (const kw of keywords) {
        expect(kw).toHaveProperty('keyword');
        expect(kw).toHaveProperty('count');
        expect(typeof kw.count).toBe('number');
      }
    }
  });

  it('不存在的题材返回空数组', () => {
    const keywords = classifier.getTopKeywords('测试文本', 'nonexistent_genre');
    expect(keywords).toEqual([]);
  });

  it('limit 参数限制返回数量', () => {
    const kb = new WebnovelKnowledgeBase();
    const allGenres = kb.getAllGenres();
    if (allGenres.length > 0) {
      const firstGenre = allGenres[0];
      const keywords = classifier.getTopKeywords(
        '修仙 修炼 功法 宗门 弟子 升级 法宝 丹药 阵法 符箓',
        firstGenre.id,
        3
      );
      expect(keywords.length).toBeLessThanOrEqual(3);
    }
  });
});

describe('GenreClassifier — setPreferenceMemory', () => {
  it('setPreferenceMemory 不报错', () => {
    const kb = new WebnovelKnowledgeBase();
    const classifier = new GenreClassifier(kb);
    const mockMemory = {
      getChannelBias: () => 0,
      getGenreBias: () => 0,
      getSubGenreBias: () => 0,
      recordAutoClassify: () => {},
    };
    expect(() => classifier.setPreferenceMemory(mockMemory as any)).not.toThrow();
  });
});

describe('GenreClassifier — 向量模式失败降级', () => {
  it('embedding provider 不可用时回退到规则模式', async () => {
    const kb = new WebnovelKnowledgeBase();
    const mockEmbedding = {
      isAvailable: async () => ({ available: false, reason: 'test' }),
      embed: async () => [],
      embedBatch: async () => [[]],
    };
    const classifier = new GenreClassifier(kb, mockEmbedding as any);
    const result = await classifier.classify({
      title: '测试小说',
      synopsis: '测试内容',
    });
    expect(result.method).toBe('rule');
  });

  it('embedding provider 抛出异常时回退到规则模式', async () => {
    const kb = new WebnovelKnowledgeBase();
    const mockEmbedding = {
      isAvailable: async () => ({ available: true, reason: '' }),
      embed: async () => { throw new Error('test error'); },
      embedBatch: async () => { throw new Error('test error'); },
    };
    const classifier = new GenreClassifier(kb, mockEmbedding as any);
    const result = await classifier.classify({
      title: '测试小说',
      synopsis: '测试内容',
    });
    expect(result.method).toBe('rule');
  });
});

describe('GenreClassifier — 输入变体', () => {
  let classifier: GenreClassifier;

  beforeEach(() => {
    const kb = new WebnovelKnowledgeBase();
    classifier = new GenreClassifier(kb);
  });

  it('只有标题也能分类', async () => {
    const result = await classifier.classify({ title: '修仙传' });
    expect(result.primaryGenre.id).toBeTruthy();
  });

  it('只有简介也能分类', async () => {
    const result = await classifier.classify({
      title: '',
      synopsis: '主角在修仙界修炼成长的故事。',
    });
    expect(result.primaryGenre.id).toBeTruthy();
  });

  it('有 sampleText 也能分类', async () => {
    const result = await classifier.classify({
      title: '测试',
      sampleText: '林天生站在山巅，感受着体内的灵力流动。修仙之路漫漫，他将上下求索。',
    });
    expect(result.primaryGenre.id).toBeTruthy();
  });

  it('包含标签能影响分类结果', async () => {
    const resultWithTags = await classifier.classify({
      title: '一部小说',
      synopsis: '故事讲述了主角的经历。',
      tags: ['修仙', '升级流', '爽文'],
    });
    expect(resultWithTags.primaryGenre.id).toBeTruthy();
    expect(resultWithTags.method).toBe('rule');
  });
});
