import { describe, it, expect, beforeEach } from 'vitest';
import { App, Vault } from '../__mocks__/obsidian';
import { TestProjectScaffold } from './helpers/project-scaffold';
import {
  assertChapterStructure,
  assertHasFrontmatter,
  assertWordCount,
  assertFileStructure,
} from './helpers/custom-assertions';
import { XUANHUAN_SCENARIO, ROMANCE_SCENARIO, MYSTERY_SCENARIO } from './fixtures/scenarios';
import { generateLongText, generateChapterMarkdown } from './helpers/test-data-generator';
import {
  pjBodyFile,
  pjVolumeOutlineFile,
  pjBodyDir,
} from '../../shared/paths';
import { parseFrontmatter } from '../../shared/frontmatter';
import { countWords } from '../../shared/diff-utils';

describe('章节生成流程 - 基础章节操作', () => {
  let app: App;
  let vault: Vault;
  let scaffold: TestProjectScaffold;

  beforeEach(async () => {
    app = new App();
    vault = app.vault as any;
    scaffold = new TestProjectScaffold(app, '章节测试项目');
    await scaffold.createBasicStructure();
  });

  it('生成单章节：验证文件结构和内容完整性', async () => {
    const chapterData = {
      volume: 1,
      chapter: 1,
      title: '第一章：初入修仙界',
      content: generateLongText('林惊鸿站在山门前，心中激动不已。', 2000),
    };

    const path = await scaffold.addChapter(chapterData);

    expect(vault.exists(path)).toBe(true);
    const content = await vault.readByPath(path);
    assertChapterStructure(content);
    expect(content).toContain('第一章：初入修仙界');
    expect(content).toContain('林惊鸿');
  });

  it('章节字数统计：验证 frontmatter 中字数正确', async () => {
    const testContent = generateLongText('这是一段测试文字，用于验证字数统计功能。', 1500);
    const chapterData = {
      volume: 1,
      chapter: 2,
      title: '第二章：字数测试',
      content: testContent,
      wordCount: countWords(testContent),
    };

    const path = await scaffold.addChapter(chapterData);
    const content = await vault.readByPath(path);
    const fm = parseFrontmatter(content);

    expect(fm.wordCount).toBeDefined();
    expect(parseInt(fm.wordCount)).toBeGreaterThan(1000);
  });

  it('多章节生成：验证卷目录结构正确', async () => {
    const chapters = [
      { volume: 1, chapter: 1, title: '第一章', content: generateLongText('第一章内容', 1000) },
      { volume: 1, chapter: 2, title: '第二章', content: generateLongText('第二章内容', 1000) },
      { volume: 1, chapter: 3, title: '第三章', content: generateLongText('第三章内容', 1000) },
    ];

    const paths = await scaffold.addChapters(chapters);

    expect(paths.length).toBe(3);

    for (let i = 1; i <= 3; i++) {
      const chapterPath = pjBodyFile('章节测试项目', 1, i);
      expect(vault.exists(chapterPath)).toBe(true);
    }
  });
});

describe('章节生成流程 - 大纲驱动生成', () => {
  let app: App;
  let vault: Vault;
  let scaffold: TestProjectScaffold;

  beforeEach(async () => {
    app = new App();
    vault = app.vault as any;
    scaffold = new TestProjectScaffold(app, '大纲驱动项目');
    await scaffold.createBasicStructure();
  });

  it('从分卷大纲生成章节：验证章节数量匹配', async () => {
    const volumeData = XUANHUAN_SCENARIO.volumeOutline;
    await scaffold.addVolumeOutline(
      volumeData.volume,
      volumeData.title,
      volumeData.chapters
    );

    const outlinePath = pjVolumeOutlineFile('大纲驱动项目', 1);
    expect(vault.exists(outlinePath)).toBe(true);

    const outlineContent = await vault.readByPath(outlinePath);
    expect(outlineContent).toContain(volumeData.title);
    expect(outlineContent).toContain('第1章');
    expect(outlineContent).toContain('第2章');
    expect(outlineContent).toContain('第3章');
  });

  it('章节与大纲对应关系：每章标题与大纲一致', async () => {
    const volumeData = XUANHUAN_SCENARIO.volumeOutline;
    await scaffold.addVolumeOutline(
      volumeData.volume,
      volumeData.title,
      volumeData.chapters
    );

    for (const chapterInfo of volumeData.chapters) {
      const chapterData = {
        volume: 1,
        chapter: chapterInfo.number,
        title: `第${chapterInfo.number}章：${chapterInfo.title}`,
        content: generateLongText(chapterInfo.summary, 2000),
      };
      await scaffold.addChapter(chapterData);

      const chapterPath = pjBodyFile('大纲驱动项目', 1, chapterInfo.number);
      const content = await vault.readByPath(chapterPath);
      expect(content).toContain(chapterInfo.title);
    }
  });
});

describe('章节生成流程 - 玄幻场景', () => {
  let app: App;
  let vault: Vault;

  beforeEach(async () => {
    app = new App();
    vault = app.vault as any;
  });

  it('玄幻章节包含修炼元素验证', async () => {
    const scaffold = new TestProjectScaffold(app, '玄幻章节测试');
    await scaffold.createBasicStructure();
    await scaffold.buildFullProject({
      projectName: '玄幻章节测试',
      chapters: XUANHUAN_SCENARIO.chapters,
    });

    for (const chapter of XUANHUAN_SCENARIO.chapters) {
      const path = pjBodyFile('玄幻章节测试', chapter.volume, chapter.chapter);
      const content = await vault.readByPath(path);
      expect(content).toContain('林惊鸿');
    }
  });

  it('玄幻章节字数达标：每章不少于2000字', async () => {
    const scaffold = new TestProjectScaffold(app, '玄幻字数测试');
    await scaffold.createBasicStructure();
    await scaffold.buildFullProject({
      projectName: '玄幻字数测试',
      chapters: XUANHUAN_SCENARIO.chapters,
    });

    for (const chapter of XUANHUAN_SCENARIO.chapters) {
      const path = pjBodyFile('玄幻字数测试', chapter.volume, chapter.chapter);
      const content = await vault.readByPath(path);
      const wordCount = countWords(content);
      expect(wordCount).toBeGreaterThan(1000);
    }
  });
});

describe('章节生成流程 - 言情场景', () => {
  let app: App;
  let vault: Vault;

  beforeEach(async () => {
    app = new App();
    vault = app.vault as any;
  });

  it('言情章节包含情感元素验证', async () => {
    const scaffold = new TestProjectScaffold(app, '言情章节测试');
    await scaffold.createBasicStructure();
    await scaffold.buildFullProject({
      projectName: '言情章节测试',
      chapters: ROMANCE_SCENARIO.chapters,
    });

    for (const chapter of ROMANCE_SCENARIO.chapters) {
      const path = pjBodyFile('言情章节测试', chapter.volume, chapter.chapter);
      const content = await vault.readByPath(path);
      expect(content).toContain('苏晚');
    }
  });
});

describe('章节生成流程 - 悬疑场景', () => {
  let app: App;
  let vault: Vault;

  beforeEach(async () => {
    app = new App();
    vault = app.vault as any;
  });

  it('悬疑章节包含推理元素验证', async () => {
    const scaffold = new TestProjectScaffold(app, '悬疑章节测试');
    await scaffold.createBasicStructure();
    await scaffold.buildFullProject({
      projectName: '悬疑章节测试',
      chapters: MYSTERY_SCENARIO.chapters,
    });

    for (const chapter of MYSTERY_SCENARIO.chapters) {
      const path = pjBodyFile('悬疑章节测试', chapter.volume, chapter.chapter);
      const content = await vault.readByPath(path);
      expect(content).toContain('陈默');
    }
  });
});

describe('章节生成流程 - 章节内容一致性', () => {
  let app: App;
  let vault: Vault;

  beforeEach(() => {
    app = new App();
    vault = app.vault as any;
  });

  it('章节内容结构一致性：所有章节格式统一', async () => {
    const scaffold = new TestProjectScaffold(app, '一致性测试');
    await scaffold.createBasicStructure();

    const chapters = [
      { volume: 1, chapter: 1, title: '第一章', content: '内容1' },
      { volume: 1, chapter: 2, title: '第二章', content: '内容2' },
      { volume: 1, chapter: 3, title: '第三章', content: '内容3' },
    ];

    const paths = await scaffold.addChapters(chapters);

    for (const path of paths) {
      const content = await vault.readByPath(path);
      assertHasFrontmatter(content, ['title', 'chapterNumber', 'volume']);
      expect(content).toContain('# ');
    }
  });

  it('章节编号连续性：从1开始连续递增', async () => {
    const scaffold = new TestProjectScaffold(app, '编号测试');
    await scaffold.createBasicStructure();

    for (let i = 1; i <= 5; i++) {
      await scaffold.addChapter({
        volume: 1,
        chapter: i,
        title: `第${i}章`,
        content: `第${i}章内容`,
      });
    }

    for (let i = 1; i <= 5; i++) {
      const path = pjBodyFile('编号测试', 1, i);
      const content = await vault.readByPath(path);
      const fm = parseFrontmatter(content);
      expect(parseInt(fm.chapterNumber)).toBe(i);
    }
  });
});

describe('章节生成流程 - 多卷支持', () => {
  let app: App;
  let vault: Vault;
  let scaffold: TestProjectScaffold;

  beforeEach(async () => {
    app = new App();
    vault = app.vault as any;
    scaffold = new TestProjectScaffold(app, '多卷测试项目');
    await scaffold.createBasicStructure();
  });

  it('支持多卷结构：第1卷和第2卷独立存在', async () => {
    await scaffold.addChapter({ volume: 1, chapter: 1, title: '第1卷第1章', content: '内容' });
    await scaffold.addChapter({ volume: 1, chapter: 2, title: '第1卷第2章', content: '内容' });
    await scaffold.addChapter({ volume: 2, chapter: 1, title: '第2卷第1章', content: '内容' });

    expect(vault.exists(pjBodyDir('多卷测试项目', 1) + '/')).toBe(true);
    expect(vault.exists(pjBodyDir('多卷测试项目', 2) + '/')).toBe(true);

    expect(vault.exists(pjBodyFile('多卷测试项目', 1, 1))).toBe(true);
    expect(vault.exists(pjBodyFile('多卷测试项目', 2, 1))).toBe(true);
  });
});
