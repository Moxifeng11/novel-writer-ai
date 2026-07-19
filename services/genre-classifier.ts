import type { EmbeddingProvider } from '../engine/embedding/embedding-provider';
import { WebnovelKnowledgeBase, type GenreConfig, type SubGenreConfig } from '../engine/webnovel-knowledge-base';
import { GenrePreferenceMemory } from './genre-preference-memory';

export interface GenreClassificationResult {
  channel: { id: 'male' | 'female' | 'neutral'; name: string; confidence: number };
  primaryGenre: { id: string; name: string; confidence: number };
  secondaryGenres: { id: string; name: string; confidence: number }[];
  primarySubGenre: { id: string; name: string; confidence: number };
  secondarySubGenres: { id: string; name: string; confidence: number }[];
  topGenres: Array<{
    id: string;
    name: string;
    subGenreId?: string;
    subGenreName?: string;
    total: number;
    breakdown?: GenreScoreBreakdown;
  }>;
  dimensionScores?: {
    keyword: number;
    character: number;
    scene: number;
    goldenFinger: number;
    vector: number;
  };
  method?: 'rule' | 'vector' | 'hybrid';
}

interface BookInfo {
  title: string;
  synopsis?: string;
  sampleText?: string;
  tags?: string[];
}

interface GenreScoreBreakdown {
  keyword: number;
  character: number;
  scene: number;
  goldenFinger: number;
  vector: number;
  total: number;
}

const CHANNEL_NAMES: Record<'male' | 'female' | 'neutral', string> = {
  male: '男频',
  female: '女频',
  neutral: '中性',
};

const MALE_KEYWORDS = [
  '男主', '他', '先生', '公子', '少爷', '王爷', '皇帝', '将军', '兵王', '赘婿',
  '神豪', '系统', '修仙', '玄幻', '升级', '修炼', '功法', '法宝', '宗门', '弟子',
  '争霸', '天下', '江山', '皇位', '权谋', '军事', '战争', '科幻', '机甲', '星际',
  '游戏', '电竞', '网游', '副本', 'BOSS', '升级流', '爽文', '打脸', '逆袭',
  '废柴', '天才', '老爷爷', '退婚', '莫欺少年穷', '逆天', '无敌', '称霸',
];

const FEMALE_KEYWORDS = [
  '女主', '她', '小姐', '夫人', '皇后', '贵妃', '公主', '王妃', '嫡女', '庶女',
  '言情', '爱情', '恋爱', '宠文', '甜文', '虐恋', '宫斗', '宅斗', '种田', '经商',
  '穿越', '重生', '复仇', '萌宝', '总裁', '豪门', '娱乐圈', '校园青春', '闺蜜',
  '追妻火葬场', '先婚后爱', '替身', '白月光', '霸道总裁', '甜宠', '撒糖',
  '妃嫔', '福晋', '格格', '嬷嬷', '丫鬟', '夫人', '少奶奶', '白莲花', '绿茶',
];

const AMBIGUOUS_PAIRS = [
  { a: 'xuanhuan_xianxia', b: 'lishi_junshi', keywords: ['穿越', '重生', '系统', '权谋', '争霸'] },
  { a: 'xuanhuan_xianxia', b: 'kehuan_moshi', keywords: ['系统', '升级', '异能', '进化', '空间'] },
  { a: 'dushi_modern', b: 'xuanhuan_xianxia', keywords: ['重生', '系统', '异能', '都市修真', '灵气复苏'] },
  { a: 'gudai_yanqing', b: 'lishi_junshi', keywords: ['穿越', '重生', '权谋', '夺嫡', '宫斗'] },
  { a: 'xiandai_yanqing', b: 'dushi_modern', keywords: ['总裁', '豪门', '重生', '娱乐圈', '职场'] },
  { a: 'xuanyi_tuili', b: 'kehuan_moshi', keywords: ['无限流', '恐怖', '系统', '副本', '生存'] },
];

const DEFAULT_WEIGHTS = {
  keyword: 0.35,
  character: 0.2,
  scene: 0.15,
  goldenFinger: 0.2,
  vector: 0.1,
};

const CANDIDATE_THRESHOLD = 0.3;
const SECONDARY_GENRE_THRESHOLD = 0.6;
const MAX_SECONDARY_GENRES = 3;

export class GenreClassifier {
  private kb: WebnovelKnowledgeBase;
  private embeddingProvider?: EmbeddingProvider;
  private preferenceMemory?: GenrePreferenceMemory;

  constructor(
    kb: WebnovelKnowledgeBase,
    embeddingProvider?: EmbeddingProvider,
    preferenceMemory?: GenrePreferenceMemory
  ) {
    this.kb = kb;
    this.embeddingProvider = embeddingProvider;
    this.preferenceMemory = preferenceMemory;
  }

  setPreferenceMemory(memory: GenrePreferenceMemory): void {
    this.preferenceMemory = memory;
  }

  async classify(bookInfo: BookInfo): Promise<GenreClassificationResult> {
    const combinedText = this.combineBookInfo(bookInfo);
    const lowerText = combinedText.toLowerCase();

    this.preferenceMemory?.recordAutoClassify();

    const channelResult = this.classifyChannel(lowerText);

    const firstPhaseGenres = this.firstPhaseRuleMatch(lowerText);

    const candidateGenres = firstPhaseGenres.filter(
      g => g.total >= CANDIDATE_THRESHOLD * (firstPhaseGenres[0]?.total || 1)
    );

    let finalGenreResults = firstPhaseGenres;
    let method: 'rule' | 'vector' | 'hybrid' = 'rule';

    if (this.embeddingProvider && candidateGenres.length > 0) {
      try {
        const vectorEnhanced = await this.secondPhaseVectorVerify(
          bookInfo,
          candidateGenres.map(g => g.id)
        );

        finalGenreResults = this.mergeScores(firstPhaseGenres, vectorEnhanced);
        method = 'hybrid';
      } catch {
        // 向量失败时使用纯规则结果
      }
    }

    finalGenreResults = this.applyPreferenceBias(finalGenreResults);
    finalGenreResults = this.resolveAmbiguities(finalGenreResults, lowerText);

    finalGenreResults.sort((a, b) => b.total - a.total);

    const primaryGenre = finalGenreResults[0];
    const primaryGenreId = primaryGenre?.id || '';
    const subGenreResults = this.classifySubGenresEnhanced(lowerText, primaryGenreId);

    let finalSubGenreResults = subGenreResults;
    if (this.embeddingProvider && primaryGenreId) {
      try {
        const subVectorEnhanced = await this.secondPhaseSubGenreVectorVerify(
          bookInfo,
          primaryGenreId,
          subGenreResults.map(s => s.id)
        );
        finalSubGenreResults = this.mergeSubGenreScores(subGenreResults, subVectorEnhanced);
      } catch {
        // 向量失败时使用纯规则结果
      }
    }

    finalSubGenreResults = this.applySubGenrePreferenceBias(primaryGenreId, finalSubGenreResults);
    finalSubGenreResults.sort((a, b) => b.total - a.total);

    const maxGenreScore = finalGenreResults[0]?.total || 1;
    const maxSubGenreScore = finalSubGenreResults[0]?.total || 1;

    const secondaryGenres = finalGenreResults
      .slice(1)
      .filter(g => g.total >= SECONDARY_GENRE_THRESHOLD * maxGenreScore)
      .slice(0, MAX_SECONDARY_GENRES)
      .map(g => ({
        id: g.id,
        name: this.getGenreName(g.id),
        confidence: Math.min(g.total / maxGenreScore, 1),
      }));

    const secondarySubGenres = finalSubGenreResults
      .slice(1)
      .filter(s => s.total >= SECONDARY_GENRE_THRESHOLD * maxSubGenreScore)
      .slice(0, MAX_SECONDARY_GENRES)
      .map(s => ({
        id: s.id,
        name: this.getSubGenreName(primaryGenreId, s.id),
        confidence: Math.min(s.total / maxSubGenreScore, 1),
      }));

    const primaryGenreResult = finalGenreResults[0] ?? { id: '', name: '', total: 0, keyword: 0, character: 0, scene: 0, goldenFinger: 0, vector: 0 };
    const primarySubGenreResult = finalSubGenreResults[0] ?? { id: '', name: '', total: 0, keyword: 0, character: 0, scene: 0, goldenFinger: 0, vector: 0 };

    const topGenres = finalGenreResults.slice(0, 5).map(g => {
      const subGenreForGenre = g.id === primaryGenreId ? finalSubGenreResults[0] : null;
      return {
        id: g.id,
        name: this.getGenreName(g.id),
        subGenreId: subGenreForGenre?.id,
        subGenreName: subGenreForGenre ? this.getSubGenreName(g.id, subGenreForGenre.id) : undefined,
        total: Math.min(g.total / maxGenreScore, 1),
        breakdown: {
          keyword: g.keyword,
          character: g.character,
          scene: g.scene,
          goldenFinger: g.goldenFinger,
          vector: g.vector,
          total: g.total,
        },
      };
    });

    return {
      channel: {
        id: channelResult.id,
        name: CHANNEL_NAMES[channelResult.id],
        confidence: channelResult.confidence,
      },
      primaryGenre: {
        id: primaryGenreResult.id,
        name: this.getGenreName(primaryGenreResult.id),
        confidence: Math.min(primaryGenreResult.total / maxGenreScore, 1),
      },
      secondaryGenres,
      primarySubGenre: {
        id: primarySubGenreResult.id,
        name: this.getSubGenreName(primaryGenreId, primarySubGenreResult.id),
        confidence: maxSubGenreScore > 0 ? Math.min(primarySubGenreResult.total / maxSubGenreScore, 1) : 0,
      },
      secondarySubGenres,
      topGenres,
      dimensionScores: {
        keyword: primaryGenreResult.keyword,
        character: primaryGenreResult.character,
        scene: primaryGenreResult.scene,
        goldenFinger: primaryGenreResult.goldenFinger,
        vector: primaryGenreResult.vector,
      },
      method,
    };
  }

  private combineBookInfo(bookInfo: BookInfo): string {
    const parts: string[] = [bookInfo.title];
    if (bookInfo.synopsis) parts.push(bookInfo.synopsis);
    if (bookInfo.sampleText) parts.push(bookInfo.sampleText);
    if (bookInfo.tags && bookInfo.tags.length > 0) parts.push(bookInfo.tags.join(' '));
    return parts.join(' ');
  }

  private classifyChannel(text: string): { id: 'male' | 'female' | 'neutral'; confidence: number } {
    let maleScore = 0;
    let femaleScore = 0;

    for (const kw of MALE_KEYWORDS) {
      const regex = new RegExp(kw.toLowerCase(), 'g');
      const matches = text.match(regex);
      if (matches) {
        maleScore += matches.length;
      }
    }

    for (const kw of FEMALE_KEYWORDS) {
      const regex = new RegExp(kw.toLowerCase(), 'g');
      const matches = text.match(regex);
      if (matches) {
        femaleScore += matches.length;
      }
    }

    const malePronoun = (text.match(/\b他\b/g) || []).length;
    const femalePronoun = (text.match(/\b她\b/g) || []).length;
    maleScore += malePronoun * 0.3;
    femaleScore += femalePronoun * 0.3;

    const allGenres = this.kb.getAllGenres();
    for (const genre of allGenres) {
      const genreScore = this.calculateGenreKeywordScore(text, genre);
      if (genre.category === 'male') {
        maleScore += genreScore * 0.5;
      } else if (genre.category === 'female') {
        femaleScore += genreScore * 0.5;
      }
    }

    if (this.preferenceMemory) {
      maleScore += this.preferenceMemory.getChannelBias('male') * 10;
      femaleScore += this.preferenceMemory.getChannelBias('female') * 10;
    }

    const total = maleScore + femaleScore;
    if (total === 0) {
      return { id: 'neutral', confidence: 0.5 };
    }

    const maleRatio = maleScore / total;
    const femaleRatio = femaleScore / total;
    const diff = Math.abs(maleRatio - femaleRatio);

    if (diff < 0.12) {
      return { id: 'neutral', confidence: 0.5 + diff };
    }

    if (maleRatio > femaleRatio) {
      return { id: 'male', confidence: Math.min(maleRatio, 0.95) };
    } else {
      return { id: 'female', confidence: Math.min(femaleRatio, 0.95) };
    }
  }

  private firstPhaseRuleMatch(text: string): Array<{ id: string; total: number } & GenreScoreBreakdown> {
    const allGenres = this.kb.getAllGenres();
    const results: Array<{ id: string; total: number } & GenreScoreBreakdown> = [];

    for (const genre of allGenres) {
      const breakdown = this.calculateGenreBreakdown(text, genre);
      if (breakdown.total > 0) {
        results.push({
          id: genre.id,
          ...breakdown,
        });
      }
    }

    results.sort((a, b) => b.total - a.total);
    return results;
  }

  private calculateGenreBreakdown(text: string, genre: GenreConfig): GenreScoreBreakdown {
    const keywordScore = this.calculateGenreKeywordScore(text, genre);
    const characterScore = this.calculateCharacterScore(text, genre);
    const sceneScore = this.calculateSceneScore(text, genre);
    const goldenFingerScore = this.calculateGoldenFingerScore(text, genre);

    const total =
      keywordScore * DEFAULT_WEIGHTS.keyword +
      characterScore * DEFAULT_WEIGHTS.character +
      sceneScore * DEFAULT_WEIGHTS.scene +
      goldenFingerScore * DEFAULT_WEIGHTS.goldenFinger;

    return {
      keyword: keywordScore,
      character: characterScore,
      scene: sceneScore,
      goldenFinger: goldenFingerScore,
      vector: 0,
      total,
    };
  }

  private calculateGenreKeywordScore(text: string, genre: GenreConfig): number {
    let score = 0;

    if (text.includes(genre.name.toLowerCase())) {
      score += 20;
    }

    for (const tag of genre.personalityTags) {
      if (text.includes(tag.toLowerCase())) {
        score += 0.6;
      }
    }

    for (const ability of genre.abilityTypes) {
      if (text.includes(ability.toLowerCase())) {
        score += 1.0;
      }
    }

    for (const bg of genre.backgroundTypes) {
      if (text.includes(bg.toLowerCase())) {
        score += 0.8;
      }
    }

    for (const role of genre.roleTypes) {
      if (text.includes(role.toLowerCase())) {
        score += 0.5;
      }
    }

    for (const technique of genre.techniques) {
      for (const keyword of technique.keywords) {
        if (text.includes(keyword.toLowerCase())) {
          score += technique.baseConfidence * technique.genreWeight;
        }
      }
    }

    if (genre.subGenres) {
      for (const subGenre of genre.subGenres) {
        for (const keyword of subGenre.keywords) {
          if (text.includes(keyword.toLowerCase())) {
            score += 0.5;
          }
        }
      }
    }

    return score;
  }

  private calculateCharacterScore(text: string, genre: GenreConfig): number {
    let score = 0;
    let totalRoles = 0;

    for (const role of genre.roleTypes) {
      const regex = new RegExp(role.toLowerCase(), 'g');
      const matches = text.match(regex);
      if (matches) {
        score += matches.length;
        totalRoles += matches.length;
      }
    }

    for (const tag of genre.personalityTags) {
      if (text.includes(tag.toLowerCase())) {
        score += 0.5;
      }
    }

    return Math.min(score / 10, 1);
  }

  private calculateSceneScore(text: string, genre: GenreConfig): number {
    let score = 0;

    for (const bg of genre.backgroundTypes) {
      const regex = new RegExp(bg.toLowerCase(), 'g');
      const matches = text.match(regex);
      if (matches) {
        score += matches.length;
      }
    }

    return Math.min(score / 8, 1);
  }

  private calculateGoldenFingerScore(text: string, genre: GenreConfig): number {
    let score = 0;

    for (const ability of genre.abilityTypes) {
      const regex = new RegExp(ability.toLowerCase(), 'g');
      const matches = text.match(regex);
      if (matches) {
        score += matches.length;
      }
    }

    for (const technique of genre.techniques) {
      if (technique.category === 'cool_point') {
        for (const keyword of technique.keywords) {
          if (text.includes(keyword.toLowerCase())) {
            score += technique.genreWeight;
          }
        }
      }
    }

    return Math.min(score / 15, 1);
  }

  private async secondPhaseVectorVerify(
    bookInfo: BookInfo,
    candidateIds: string[]
  ): Promise<Map<string, number>> {
    if (!this.embeddingProvider) {
      return new Map();
    }

    const availability = await this.embeddingProvider.isAvailable();
    if (!availability.available) {
      return new Map();
    }

    const bookText = this.combineBookInfo(bookInfo);
    const bookEmbedding = await this.embeddingProvider.embed(bookText);

    const candidates = candidateIds
      .map(id => this.kb.getGenre(id))
      .filter((g): g is GenreConfig => g !== undefined);

    const genreDescriptions = candidates.map(g =>
      `${g.name} ${g.description} ${g.abilityTypes.join(' ')} ${g.backgroundTypes.join(' ')} ${g.roleTypes.join(' ')}`
    );
    const genreEmbeddings = await this.embeddingProvider.embedBatch(genreDescriptions);

    const vectorScores = new Map<string, number>();
    candidates.forEach((genre, i) => {
      const score = this.cosineSimilarity(bookEmbedding, genreEmbeddings[i]);
      vectorScores.set(genre.id, score);
    });

    return vectorScores;
  }

  private mergeScores(
    ruleScores: Array<{ id: string; total: number } & GenreScoreBreakdown>,
    vectorScores: Map<string, number>
  ): Array<{ id: string; total: number } & GenreScoreBreakdown> {
    const maxRuleScore = Math.max(...ruleScores.map(s => s.total), 1);
    const maxVectorScore = Math.max(...Array.from(vectorScores.values()), 0.01);

    return ruleScores.map(s => {
      const vectorScore = vectorScores.get(s.id) || 0;
      const normalizedVector = vectorScore / maxVectorScore;
      const normalizedRule = s.total / maxRuleScore;

      const merged = normalizedRule * (1 - DEFAULT_WEIGHTS.vector) + normalizedVector * DEFAULT_WEIGHTS.vector;

      return {
        id: s.id,
        keyword: s.keyword,
        character: s.character,
        scene: s.scene,
        goldenFinger: s.goldenFinger,
        vector: normalizedVector,
        total: merged * maxRuleScore,
      };
    });
  }

  private applyPreferenceBias(
    scores: Array<{ id: string; total: number } & GenreScoreBreakdown>
  ): Array<{ id: string; total: number } & GenreScoreBreakdown> {
    if (!this.preferenceMemory) return scores;

    return scores.map(s => {
      const bias = this.preferenceMemory!.getGenreBias(s.id);
      return {
        ...s,
        total: s.total * (1 + bias * 0.3),
      };
    });
  }

  private resolveAmbiguities(
    scores: Array<{ id: string; total: number } & GenreScoreBreakdown>,
    text: string
  ): Array<{ id: string; total: number } & GenreScoreBreakdown> {
    if (scores.length < 2) return scores;

    const scoreMap = new Map(scores.map(s => [s.id, s]));

    for (const pair of AMBIGUOUS_PAIRS) {
      const scoreA = scoreMap.get(pair.a);
      const scoreB = scoreMap.get(pair.b);

      if (!scoreA || !scoreB) continue;

      const diff = Math.abs(scoreA.total - scoreB.total);
      const maxScore = Math.max(scoreA.total, scoreB.total);

      if (diff / maxScore < 0.15) {
        const genreA = this.kb.getGenre(pair.a);
        const genreB = this.kb.getGenre(pair.b);

        if (!genreA || !genreB) continue;

        let aUnique = 0;
        let bUnique = 0;

        for (const ability of genreA.abilityTypes) {
          if (!genreB.abilityTypes.includes(ability)) {
            const regex = new RegExp(ability.toLowerCase(), 'g');
            aUnique += (text.match(regex) || []).length;
          }
        }

        for (const ability of genreB.abilityTypes) {
          if (!genreA.abilityTypes.includes(ability)) {
            const regex = new RegExp(ability.toLowerCase(), 'g');
            bUnique += (text.match(regex) || []).length;
          }
        }

        for (const bg of genreA.backgroundTypes) {
          if (!genreB.backgroundTypes.includes(bg)) {
            const regex = new RegExp(bg.toLowerCase(), 'g');
            aUnique += (text.match(regex) || []).length * 0.5;
          }
        }

        for (const bg of genreB.backgroundTypes) {
          if (!genreA.backgroundTypes.includes(bg)) {
            const regex = new RegExp(bg.toLowerCase(), 'g');
            bUnique += (text.match(regex) || []).length * 0.5;
          }
        }

        if (aUnique > bUnique) {
          scoreA.total *= 1.15;
        } else if (bUnique > aUnique) {
          scoreB.total *= 1.15;
        }
      }
    }

    return Array.from(scoreMap.values());
  }

  private classifySubGenresEnhanced(
    text: string,
    genreId: string
  ): Array<{ id: string; total: number } & GenreScoreBreakdown> {
    const subGenres = this.kb.getSubGenres(genreId);
    if (subGenres.length === 0) return [];

    const parentGenre = this.kb.getGenre(genreId);
    const results: Array<{ id: string; total: number } & GenreScoreBreakdown> = [];

    for (const subGenre of subGenres) {
      const breakdown = this.calculateSubGenreBreakdown(text, subGenre, parentGenre);
      if (breakdown.total > 0) {
        results.push({
          id: subGenre.id,
          ...breakdown,
        });
      }
    }

    results.sort((a, b) => b.total - a.total);
    return results;
  }

  private calculateSubGenreBreakdown(
    text: string,
    subGenre: SubGenreConfig,
    parentGenre?: GenreConfig
  ): GenreScoreBreakdown {
    let keywordScore = 0;

    if (text.includes(subGenre.name.toLowerCase())) {
      keywordScore += 15;
    }

    for (const keyword of subGenre.keywords) {
      const regex = new RegExp(keyword.toLowerCase(), 'g');
      const matches = text.match(regex);
      if (matches) {
        keywordScore += matches.length;
      }
    }

    for (const title of subGenre.exampleTitles) {
      if (text.includes(title.toLowerCase())) {
        keywordScore += 3;
      }
    }

    let characterScore = 0;
    let sceneScore = 0;
    let goldenFingerScore = 0;

    if (subGenre.features) {
      for (const role of subGenre.features.characterTypes) {
        const regex = new RegExp(role.toLowerCase(), 'g');
        characterScore += (text.match(regex) || []).length;
      }
      characterScore = Math.min(characterScore / 5, 1);

      for (const scene of subGenre.features.sceneTypes) {
        const regex = new RegExp(scene.toLowerCase(), 'g');
        sceneScore += (text.match(regex) || []).length;
      }
      sceneScore = Math.min(sceneScore / 5, 1);

      for (const gf of subGenre.features.goldenFingerTypes) {
        const regex = new RegExp(gf.toLowerCase(), 'g');
        goldenFingerScore += (text.match(regex) || []).length;
      }
      goldenFingerScore = Math.min(goldenFingerScore / 5, 1);
    } else if (parentGenre) {
      characterScore = this.calculateCharacterScore(text, parentGenre) * 0.5;
      sceneScore = this.calculateSceneScore(text, parentGenre) * 0.5;
      goldenFingerScore = this.calculateGoldenFingerScore(text, parentGenre) * 0.5;
    }

    const total =
      keywordScore * DEFAULT_WEIGHTS.keyword +
      characterScore * DEFAULT_WEIGHTS.character +
      sceneScore * DEFAULT_WEIGHTS.scene +
      goldenFingerScore * DEFAULT_WEIGHTS.goldenFinger;

    return {
      keyword: keywordScore,
      character: characterScore,
      scene: sceneScore,
      goldenFinger: goldenFingerScore,
      vector: 0,
      total,
    };
  }

  private async secondPhaseSubGenreVectorVerify(
    bookInfo: BookInfo,
    genreId: string,
    candidateIds: string[]
  ): Promise<Map<string, number>> {
    if (!this.embeddingProvider) {
      return new Map();
    }

    const availability = await this.embeddingProvider.isAvailable();
    if (!availability.available) {
      return new Map();
    }

    const bookText = this.combineBookInfo(bookInfo);
    const bookEmbedding = await this.embeddingProvider.embed(bookText);

    const subGenres = candidateIds
      .map(id => this.kb.getSubGenre(genreId, id))
      .filter((s): s is SubGenreConfig => s !== null);

    const subGenreDescriptions = subGenres.map(sg =>
      `${sg.name} ${sg.description} ${sg.keywords.join(' ')}`
    );
    const subGenreEmbeddings = await this.embeddingProvider.embedBatch(subGenreDescriptions);

    const vectorScores = new Map<string, number>();
    subGenres.forEach((sg, i) => {
      const score = this.cosineSimilarity(bookEmbedding, subGenreEmbeddings[i]);
      vectorScores.set(sg.id, score);
    });

    return vectorScores;
  }

  private mergeSubGenreScores(
    ruleScores: Array<{ id: string; total: number } & GenreScoreBreakdown>,
    vectorScores: Map<string, number>
  ): Array<{ id: string; total: number } & GenreScoreBreakdown> {
    const maxRuleScore = Math.max(...ruleScores.map(s => s.total), 1);
    const maxVectorScore = Math.max(...Array.from(vectorScores.values()), 0.01);

    return ruleScores.map(s => {
      const vectorScore = vectorScores.get(s.id) || 0;
      const normalizedVector = vectorScore / maxVectorScore;
      const normalizedRule = s.total / maxRuleScore;

      const merged = normalizedRule * (1 - DEFAULT_WEIGHTS.vector * 0.5) + normalizedVector * DEFAULT_WEIGHTS.vector * 0.5;

      return {
        id: s.id,
        keyword: s.keyword,
        character: s.character,
        scene: s.scene,
        goldenFinger: s.goldenFinger,
        vector: normalizedVector,
        total: merged * maxRuleScore,
      };
    });
  }

  private applySubGenrePreferenceBias(
    genreId: string,
    scores: Array<{ id: string; total: number } & GenreScoreBreakdown>
  ): Array<{ id: string; total: number } & GenreScoreBreakdown> {
    if (!this.preferenceMemory) return scores;

    return scores.map(s => {
      const bias = this.preferenceMemory!.getSubGenreBias(genreId, s.id);
      return {
        ...s,
        total: s.total * (1 + bias * 0.3),
      };
    });
  }

  private getGenreName(genreId: string): string {
    if (!genreId) return '';
    const genre = this.kb.getGenre(genreId);
    return genre?.name || genreId;
  }

  private getSubGenreName(genreId: string, subGenreId: string): string {
    if (!genreId || !subGenreId) return '';
    const sub = this.kb.getSubGenre(genreId, subGenreId);
    return sub?.name || subGenreId;
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  async classifyBatch(books: BookInfo[]): Promise<GenreClassificationResult[]> {
    const results: GenreClassificationResult[] = [];
    for (const book of books) {
      results.push(await this.classify(book));
    }
    return results;
  }

  getTopKeywords(text: string, genreId: string, limit: number = 10): { keyword: string; count: number }[] {
    const genre = this.kb.getGenre(genreId);
    if (!genre) return [];

    const lowerText = text.toLowerCase();
    const keywordCounts: { keyword: string; count: number }[] = [];

    const allKeywords = [
      ...genre.personalityTags,
      ...genre.abilityTypes,
      ...genre.backgroundTypes,
      ...genre.roleTypes,
      ...genre.techniques.flatMap(t => t.keywords),
      ...(genre.subGenres?.flatMap(s => s.keywords) || []),
    ];

    const uniqueKeywords = [...new Set(allKeywords)];

    for (const kw of uniqueKeywords) {
      const regex = new RegExp(kw.toLowerCase(), 'g');
      const matches = lowerText.match(regex);
      if (matches && matches.length > 0) {
        keywordCounts.push({ keyword: kw, count: matches.length });
      }
    }

    keywordCounts.sort((a, b) => b.count - a.count);
    return keywordCounts.slice(0, limit);
  }
}
