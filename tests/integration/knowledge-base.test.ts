import { describe, it, expect, beforeEach } from 'vitest';
import { App, Vault } from '../__mocks__/obsidian';
import { XUANHUAN_SCENARIO, ROMANCE_SCENARIO, MYSTERY_SCENARIO, ALL_SCENARIOS } from './fixtures/scenarios';
import { generateLongText } from './helpers/test-data-generator';
import {
  kbKnowledgeBaseDir,
  kbBookDir,
  kbBookBasicInfoFile,
  kbBookStyleFingerprintFile,
  kbBookRhythmAnalysisFile,
  kbBookWritingTechniquesFile,
  kbBookStructureBreakdownFile,
  kbBookCharacterExtractionFile,
  kbBookForeshadowDBFile,
  kbIndexFile,
  kbConfigDir,
} from '../../shared/paths';
import { parseFrontmatter } from '../../shared/frontmatter';

interface BookDeconstructionResult {
  basicInfo: any;
  styleFingerprint: any;
  rhythmAnalysis: string;
  writingTechniques: string;
  structureBreakdown: string;
  characterExtraction: string;
  foreshadowDB: string;
}

function simulateBookDeconstruction(
  bookName: string,
  sampleText: string,
  synopsis: string,
  tags: string[]
): BookDeconstructionResult {
  return {
    basicInfo: {
      id: `kb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name: bookName,
      wordCount: sampleText.length,
      themeTags: tags,
      techniqueTags: ['伏笔', '节奏', '人物塑造'],
      synopsis,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      breakdownStatus: 'completed',
      breakdownProgress: 100,
    },
    styleFingerprint: {
      sentenceLength: { avg: 15, variance: 8 },
      vocabulary: { uniqueRatio: 0.3, level: 'medium' },
      rhythm: { type: 'steady', beat: 'medium' },
      dialogueRatio: 0.35,
      descriptionRatio: 0.45,
    },
    rhythmAnalysis: `# ${bookName} - 节奏分析\n\n## 整体节奏\n整体节奏平稳，张弛有度。\n\n## 章节节奏分布\n- 开篇：慢节奏，铺垫背景\n- 发展：中速推进，逐步升温\n- 高潮：快节奏，冲突密集\n- 结局：收束节奏，余韵悠长`,
    writingTechniques: `# ${bookName} - 写作技巧分析\n\n## 伏笔运用\n使用了多种伏笔技巧，前后呼应。\n\n## 人物塑造\n通过对话和行动塑造人物性格。\n\n## 场景描写\n场景描写生动，有画面感。`,
    structureBreakdown: `# ${bookName} - 结构拆解\n\n## 整体结构\n采用经典三幕式结构。\n\n## 第一幕：起\n交代背景，引出主角。\n\n## 第二幕：承转\n冲突升级，主角成长。\n\n## 第三幕：合\n高潮结局，收束全文。`,
    characterExtraction: `# ${bookName} - 人设提取\n\n## 主要人物\n### 主角\n性格鲜明，有成长弧光。\n\n### 配角\n各有特色，功能明确。`,
    foreshadowDB: `# ${bookName} - 伏笔库\n\n## 前期伏笔\n- 伏笔1：神秘的过去\n- 伏笔2：特殊能力\n\n## 后期回收\n- 回收方式：关键剧情揭示`,
  };
}

describe('知识库拆解流程 - 基础拆解', () => {
  let app: App;
  let vault: Vault;

  beforeEach(() => {
    app = new App();
    vault = app.vault as any;
  });

  it('知识库初始化：验证知识库目录结构', async () => {
    const baseDir = kbKnowledgeBaseDir('测试知识库');
    await vault.createFolder(baseDir + '/');
    await vault.createFolder(kbConfigDir('测试知识库') + '/');

    expect(vault.exists(baseDir)).toBe(true);
    expect(vault.exists(kbConfigDir('测试知识库'))).toBe(true);
  });

  it('导入单本书：验证书籍目录创建', async () => {
    const baseDir = '测试知识库';
    const bookName = '测试小说';
    const bookDir = kbBookDir(bookName, baseDir);

    await vault.createFolder(baseDir + '/');
    await vault.createFolder(bookDir + '/');

    expect(vault.exists(bookDir)).toBe(true);
  });

  it('生成基本信息：验证基本信息文件结构', async () => {
    const baseDir = '测试知识库';
    const bookName = XUANHUAN_SCENARIO.name;
    const bookDir = kbBookDir(bookName, baseDir);
    const basicInfoPath = kbBookBasicInfoFile(bookName, baseDir);

    await vault.createFolder(baseDir + '/');
    await vault.createFolder(bookDir + '/');

    const result = simulateBookDeconstruction(
      bookName,
      XUANHUAN_SCENARIO.sampleText,
      XUANHUAN_SCENARIO.synopsis,
      XUANHUAN_SCENARIO.tags
    );

    const basicInfoContent = `---
id: ${result.basicInfo.id}
name: ${result.basicInfo.name}
wordCount: ${result.basicInfo.wordCount}
breakdownStatus: ${result.basicInfo.breakdownStatus}
breakdownProgress: ${result.basicInfo.breakdownProgress}
themeTags: ${JSON.stringify(result.basicInfo.themeTags)}
createdAt: ${result.basicInfo.createdAt}
updatedAt: ${result.basicInfo.updatedAt}
---

# ${bookName}

## 内容简介
${result.basicInfo.synopsis}

## 主题标签
${result.basicInfo.themeTags.map((t: string) => `- ${t}`).join('\n')}
`;

    await vault.write(basicInfoPath, basicInfoContent);

    expect(vault.exists(basicInfoPath)).toBe(true);
    const content = await vault.readByPath(basicInfoPath);
    const fm = parseFrontmatter(content);
    expect(fm.name).toBe(bookName);
    expect(fm.breakdownStatus).toBe('completed');
    expect(content).toContain(XUANHUAN_SCENARIO.synopsis);
  });
});

describe('知识库拆解流程 - 多维度拆解', () => {
  let app: App;
  let vault: Vault;

  beforeEach(() => {
    app = new App();
    vault = app.vault as any;
  });

  async function setupBook(baseDir: string, bookName: string): Promise<string> {
    await vault.createFolder(baseDir + '/');
    const bookDir = kbBookDir(bookName, baseDir);
    await vault.createFolder(bookDir + '/');
    return bookDir;
  }

  it('风格指纹拆解：验证风格维度完整', async () => {
    const baseDir = '风格测试库';
    const bookName = '风格测试小说';
    await setupBook(baseDir, bookName);

    const stylePath = kbBookStyleFingerprintFile(bookName, baseDir);
    const result = simulateBookDeconstruction(bookName, '测试文本', '测试简介', []);

    await vault.write(stylePath, JSON.stringify(result.styleFingerprint, null, 2));

    expect(vault.exists(stylePath)).toBe(true);
    const content = await vault.readByPath(stylePath);
    const data = JSON.parse(content);

    expect(data.sentenceLength).toBeDefined();
    expect(data.sentenceLength.avg).toBeGreaterThan(0);
    expect(data.vocabulary).toBeDefined();
    expect(data.rhythm).toBeDefined();
    expect(data.dialogueRatio).toBeGreaterThanOrEqual(0);
    expect(data.dialogueRatio).toBeLessThanOrEqual(1);
  });

  it('节奏分析拆解：验证节奏分析结构', async () => {
    const baseDir = '节奏测试库';
    const bookName = '节奏测试小说';
    await setupBook(baseDir, bookName);

    const rhythmPath = kbBookRhythmAnalysisFile(bookName, baseDir);
    const result = simulateBookDeconstruction(bookName, '测试文本', '测试简介', []);

    await vault.write(rhythmPath, result.rhythmAnalysis);

    expect(vault.exists(rhythmPath)).toBe(true);
    const content = await vault.readByPath(rhythmPath);
    expect(content).toContain('节奏分析');
    expect(content).toContain('整体节奏');
  });

  it('写作技巧拆解：验证技巧分析维度', async () => {
    const baseDir = '技巧测试库';
    const bookName = '技巧测试小说';
    await setupBook(baseDir, bookName);

    const techniquesPath = kbBookWritingTechniquesFile(bookName, baseDir);
    const result = simulateBookDeconstruction(bookName, '测试文本', '测试简介', []);

    await vault.write(techniquesPath, result.writingTechniques);

    expect(vault.exists(techniquesPath)).toBe(true);
    const content = await vault.readByPath(techniquesPath);
    expect(content).toContain('写作技巧');
    expect(content).toContain('伏笔');
    expect(content).toContain('人物塑造');
  });

  it('结构拆解：验证结构分析完整度', async () => {
    const baseDir = '结构测试库';
    const bookName = '结构测试小说';
    await setupBook(baseDir, bookName);

    const structurePath = kbBookStructureBreakdownFile(bookName, baseDir);
    const result = simulateBookDeconstruction(bookName, '测试文本', '测试简介', []);

    await vault.write(structurePath, result.structureBreakdown);

    expect(vault.exists(structurePath)).toBe(true);
    const content = await vault.readByPath(structurePath);
    expect(content).toContain('结构拆解');
    expect(content).toContain('第一幕');
    expect(content).toContain('第二幕');
    expect(content).toContain('第三幕');
  });

  it('人设提取拆解：验证人物提取结果', async () => {
    const baseDir = '人设测试库';
    const bookName = '人设测试小说';
    await setupBook(baseDir, bookName);

    const characterPath = kbBookCharacterExtractionFile(bookName, baseDir);
    const result = simulateBookDeconstruction(bookName, '测试文本', '测试简介', []);

    await vault.write(characterPath, result.characterExtraction);

    expect(vault.exists(characterPath)).toBe(true);
    const content = await vault.readByPath(characterPath);
    expect(content).toContain('人设提取');
    expect(content).toContain('主要人物');
  });

  it('伏笔库拆解：验证伏笔提取结果', async () => {
    const baseDir = '伏笔测试库';
    const bookName = '伏笔测试小说';
    await setupBook(baseDir, bookName);

    const foreshadowPath = kbBookForeshadowDBFile(bookName, baseDir);
    const result = simulateBookDeconstruction(bookName, '测试文本', '测试简介', []);

    await vault.write(foreshadowPath, result.foreshadowDB);

    expect(vault.exists(foreshadowPath)).toBe(true);
    const content = await vault.readByPath(foreshadowPath);
    expect(content).toContain('伏笔库');
    expect(content).toContain('前期伏笔');
  });
});

describe('知识库拆解流程 - 全流程模拟', () => {
  let app: App;
  let vault: Vault;

  beforeEach(() => {
    app = new App();
    vault = app.vault as any;
  });

  it('完整拆解流程：从导入到六维拆解完成', async () => {
    const baseDir = '完整流程测试库';
    const scenario = XUANHUAN_SCENARIO;
    const bookName = scenario.name;
    const bookDir = kbBookDir(bookName, baseDir);

    await vault.createFolder(baseDir + '/');
    await vault.createFolder(kbConfigDir(baseDir) + '/');
    await vault.createFolder(bookDir + '/');

    const result = simulateBookDeconstruction(
      bookName,
      scenario.sampleText,
      scenario.synopsis,
      scenario.tags
    );

    const basicInfoPath = kbBookBasicInfoFile(bookName, baseDir);
    const stylePath = kbBookStyleFingerprintFile(bookName, baseDir);
    const rhythmPath = kbBookRhythmAnalysisFile(bookName, baseDir);
    const techniquesPath = kbBookWritingTechniquesFile(bookName, baseDir);
    const structurePath = kbBookStructureBreakdownFile(bookName, baseDir);
    const characterPath = kbBookCharacterExtractionFile(bookName, baseDir);
    const foreshadowPath = kbBookForeshadowDBFile(bookName, baseDir);

    await vault.write(basicInfoPath, JSON.stringify(result.basicInfo));
    await vault.write(stylePath, JSON.stringify(result.styleFingerprint));
    await vault.write(rhythmPath, result.rhythmAnalysis);
    await vault.write(techniquesPath, result.writingTechniques);
    await vault.write(structurePath, result.structureBreakdown);
    await vault.write(characterPath, result.characterExtraction);
    await vault.write(foreshadowPath, result.foreshadowDB);

    const expectedFiles = [
      basicInfoPath,
      stylePath,
      rhythmPath,
      techniquesPath,
      structurePath,
      characterPath,
      foreshadowPath,
    ];

    for (const file of expectedFiles) {
      expect(vault.exists(file)).toBe(true);
    }
  });
});

describe('知识库拆解流程 - 多题材对比', () => {
  let app: App;
  let vault: Vault;

  beforeEach(() => {
    app = new App();
    vault = app.vault as any;
  });

  it('三种题材书籍可同时导入知识库', async () => {
    const baseDir = '多题材测试库';
    await vault.createFolder(baseDir + '/');
    await vault.createFolder(kbConfigDir(baseDir) + '/');

    for (const scenario of ALL_SCENARIOS) {
      const bookDir = kbBookDir(scenario.name, baseDir);
      await vault.createFolder(bookDir + '/');

      const result = simulateBookDeconstruction(
        scenario.name,
        scenario.sampleText,
        scenario.synopsis,
        scenario.tags
      );

      const basicInfoPath = kbBookBasicInfoFile(scenario.name, baseDir);
      await vault.write(basicInfoPath, JSON.stringify(result.basicInfo));
    }

    for (const scenario of ALL_SCENARIOS) {
      const bookDir = kbBookDir(scenario.name, baseDir);
      expect(vault.exists(bookDir)).toBe(true);
    }
  });

  it('不同题材风格差异明显', async () => {
    const baseDir = '风格对比库';
    await vault.createFolder(baseDir + '/');

    const fingerprints: any[] = [];

    for (const scenario of ALL_SCENARIOS) {
      const bookDir = kbBookDir(scenario.name, baseDir);
      await vault.createFolder(bookDir + '/');

      const result = simulateBookDeconstruction(
        scenario.name,
        scenario.sampleText,
        scenario.synopsis,
        scenario.tags
      );

      fingerprints.push(result.styleFingerprint);
    }

    expect(fingerprints.length).toBe(3);
    expect(fingerprints[0]).toBeDefined();
    expect(fingerprints[1]).toBeDefined();
    expect(fingerprints[2]).toBeDefined();
  });
});
