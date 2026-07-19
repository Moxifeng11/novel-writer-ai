import { describe, it, expect, beforeEach } from 'vitest';
import { App, Vault } from '../__mocks__/obsidian';
import { ChapterVersionService } from '../../services/chapter-version-service';
import {
  assertVersionMetadata,
  assertDiffStats,
} from './helpers/custom-assertions';
import { XUANHUAN_SCENARIO } from './fixtures/scenarios';
import { generateLongText } from './helpers/test-data-generator';
import { pjBodyFile } from '../../shared/paths';
import { countWords } from '../../shared/diff-utils';

describe('版本管理流程 - 基础版本保存', () => {
  let app: App;
  let service: ChapterVersionService;
  let vault: Vault;

  const TEST_PROJECT = '版本测试项目';
  const TEST_CHAPTER = '第1章';
  const TEST_PATH = pjBodyFile(TEST_PROJECT, 1, 1);

  beforeEach(() => {
    app = new App();
    vault = app.vault as any;
    service = new ChapterVersionService(app as any);
    vault._seedFile(TEST_PATH, '初始内容。');
  });

  it('保存第一个版本：验证版本元数据正确', async () => {
    const content = generateLongText(XUANHUAN_SCENARIO.sampleText, 2000);
    const result = await service.saveVersion(
      TEST_PROJECT,
      'chapter',
      TEST_CHAPTER,
      TEST_PATH,
      content,
      { type: 'manual', note: '初始版本', tags: ['初始', '测试'] }
    );

    assertVersionMetadata(result);
    expect(result.version).toBe(1);
    expect(result.type).toBe('manual');
    expect(result.note).toBe('初始版本');
    expect(result.tags).toContain('初始');
    expect(result.tags).toContain('测试');
    expect(result.wordCount).toBe(countWords(content));
    expect(result.contentType).toBe('chapter');
    expect(result.contentKey).toBe(TEST_CHAPTER);
    expect(result.project).toBe(TEST_PROJECT);
  });

  it('连续保存多个版本：版本号递增', async () => {
    const v1Content = '第一版内容。这是最初的版本。';
    const v2Content = '第二版内容。添加了一些新的情节。';
    const v3Content = '第三版内容。大幅修改，增加了更多细节。';

    const v1 = await service.saveVersion(TEST_PROJECT, 'chapter', TEST_CHAPTER, TEST_PATH, v1Content, { type: 'manual' });
    const v2 = await service.saveVersion(TEST_PROJECT, 'chapter', TEST_CHAPTER, TEST_PATH, v2Content, { type: 'ai-generate' });
    const v3 = await service.saveVersion(TEST_PROJECT, 'chapter', TEST_CHAPTER, TEST_PATH, v3Content, { type: 'manual' });

    expect(v1.version).toBe(1);
    expect(v2.version).toBe(2);
    expect(v3.version).toBe(3);
    expect(v2.type).toBe('ai-generate');
  });

  it('字数变化统计：验证 wordCountDelta 正确', async () => {
    const v1Content = '短内容。';
    const v2Content = generateLongText('更长的内容，增加了很多文字。', 500);

    const v1 = await service.saveVersion(TEST_PROJECT, 'chapter', TEST_CHAPTER, TEST_PATH, v1Content, { type: 'manual' });
    const v2 = await service.saveVersion(TEST_PROJECT, 'chapter', TEST_CHAPTER, TEST_PATH, v2Content, { type: 'manual' });

    expect(v1.wordCountDelta).toBeDefined();
    expect(v2.wordCountDelta).toBeDefined();
    expect(v2.wordCount).toBeGreaterThan(v1.wordCount);
  });
});

describe('版本管理流程 - 版本查询', () => {
  let app: App;
  let service: ChapterVersionService;
  let vault: Vault;

  const TEST_PROJECT = '版本查询项目';
  const TEST_CHAPTER = '第1章';
  const TEST_PATH = pjBodyFile(TEST_PROJECT, 1, 1);

  beforeEach(async () => {
    app = new App();
    vault = app.vault as any;
    service = new ChapterVersionService(app as any);
    vault._seedFile(TEST_PATH, '初始内容');

    for (let i = 1; i <= 5; i++) {
      await service.saveVersion(
        TEST_PROJECT,
        'chapter',
        TEST_CHAPTER,
        TEST_PATH,
        `第${i}版内容。版本号${i}。`,
        { type: i % 2 === 0 ? 'ai-generate' : 'manual', note: `版本${i}` }
      );
    }
  });

  it('获取版本列表：按版本号倒序排列', async () => {
    const versions = await service.getVersions(TEST_PROJECT, 'chapter', TEST_CHAPTER, TEST_PATH);

    expect(versions.length).toBe(5);
    expect(versions[0].version).toBe(5);
    expect(versions[1].version).toBe(4);
    expect(versions[4].version).toBe(1);
  });

  it('获取最新版本', async () => {
    const latest = await service.getLatestVersion(TEST_PROJECT, 'chapter', TEST_CHAPTER, TEST_PATH);

    expect(latest).not.toBeNull();
    expect(latest!.version).toBe(5);
  });

  it('获取指定版本内容', async () => {
    const versions = await service.getVersions(TEST_PROJECT, 'chapter', TEST_CHAPTER, TEST_PATH);
    const v3 = versions.find(v => v.version === 3)!;

    const content = await service.getVersionContent(v3);

    expect(content).toContain('第3版内容');
    expect(content).toContain('版本号3');
  });

  it('版本索引结构正确', async () => {
    const index = await service.getVersionIndex(TEST_PROJECT, 'chapter', TEST_CHAPTER, TEST_PATH);

    expect(index.latestVersion).toBe(5);
    expect(index.versions.length).toBe(5);
    expect(index.contentType).toBe('chapter');
    expect(index.project).toBe(TEST_PROJECT);
    expect(index.contentKey).toBe(TEST_CHAPTER);
  });
});

describe('版本管理流程 - 版本对比', () => {
  let app: App;
  let service: ChapterVersionService;
  let vault: Vault;

  const TEST_PROJECT = '版本对比项目';
  const TEST_CHAPTER = '第1章';
  const TEST_PATH = pjBodyFile(TEST_PROJECT, 1, 1);

  beforeEach(() => {
    app = new App();
    vault = app.vault as any;
    service = new ChapterVersionService(app as any);
    vault._seedFile(TEST_PATH, '初始');
  });

  it('两个版本对比：返回 diff 和统计信息', async () => {
    const v1Content = `第一章
这是第一段。
这是第二段。
这是第三段。`;

    const v2Content = `第一章
这是第一段（修改过）。
这是新插入的段落。
这是第三段。
这是新增的结尾段。`;

    const v1 = await service.saveVersion(TEST_PROJECT, 'chapter', TEST_CHAPTER, TEST_PATH, v1Content, { type: 'manual' });
    const v2 = await service.saveVersion(TEST_PROJECT, 'chapter', TEST_CHAPTER, TEST_PATH, v2Content, { type: 'manual' });

    const result = await service.compareVersions(v1, v2);

    expect(result).toBeDefined();
    expect(result.lineDiffs).toBeDefined();
    expect(Array.isArray(result.lineDiffs)).toBe(true);
    assertDiffStats(result.stats);
  });

  it('版本与当前内容对比', async () => {
    const v1Content = '旧版本内容。';
    const currentContent = '当前内容，有修改。';

    const v1 = await service.saveVersion(TEST_PROJECT, 'chapter', TEST_CHAPTER, TEST_PATH, v1Content, { type: 'manual' });

    const result = await service.compareVersionWithCurrent(v1, currentContent);

    expect(result).toBeDefined();
    expect(result.lineDiffs).toBeDefined();
    assertDiffStats(result.stats);
  });

  it('字符级 diff 对比', async () => {
    const oldText = '这是旧文本';
    const newText = '这是新文本内容';

    const result = await service.compareChars(oldText, newText);

    expect(result).toBeDefined();
    expect(Array.isArray(result)).toBe(true);
  });
});

describe('版本管理流程 - 版本回滚', () => {
  let app: App;
  let service: ChapterVersionService;
  let vault: Vault;

  const TEST_PROJECT = '回滚测试项目';
  const TEST_CHAPTER = '第1章';
  const TEST_PATH = pjBodyFile(TEST_PROJECT, 1, 1);

  beforeEach(async () => {
    app = new App();
    vault = app.vault as any;
    service = new ChapterVersionService(app as any);
    vault._seedFile(TEST_PATH, '初始内容');
  });

  it('回滚到指定版本：内容正确还原', async () => {
    const v1Content = '第一版内容。这是最初的版本。';
    const v2Content = '第二版内容。这个版本有很多修改。';

    const v1 = await service.saveVersion(TEST_PROJECT, 'chapter', TEST_CHAPTER, TEST_PATH, v1Content, { type: 'manual', note: 'v1' });
    const v2 = await service.saveVersion(TEST_PROJECT, 'chapter', TEST_CHAPTER, TEST_PATH, v2Content, { type: 'manual', note: 'v2' });

    const rollbackResult = await service.rollbackToVersion(v1, v2Content);

    expect(rollbackResult.success).toBe(true);
    expect(rollbackResult.rolledBackContent).toBe(v1Content);
    expect(rollbackResult.autoSavedVersion).not.toBeNull();
    expect(rollbackResult.autoSavedVersion!.type).toBe('rollback');
  });

  it('回滚前自动保存当前版本', async () => {
    const v1Content = '第一版';
    const v2Content = '第二版';
    const currentContent = '当前内容，未保存';

    await service.saveVersion(TEST_PROJECT, 'chapter', TEST_CHAPTER, TEST_PATH, v1Content, { type: 'manual' });
    const v2 = await service.saveVersion(TEST_PROJECT, 'chapter', TEST_CHAPTER, TEST_PATH, v2Content, { type: 'manual' });

    const versionsBefore = await service.getVersions(TEST_PROJECT, 'chapter', TEST_CHAPTER, TEST_PATH);
    const countBefore = versionsBefore.length;

    await service.rollbackToVersion(v2, currentContent);

    const versionsAfter = await service.getVersions(TEST_PROJECT, 'chapter', TEST_CHAPTER, TEST_PATH);
    expect(versionsAfter.length).toBe(countBefore + 1);
  });

  it('回滚历史记录生成', async () => {
    const v1Content = '第一版内容';
    const v2Content = '第二版内容';

    const v1 = await service.saveVersion(TEST_PROJECT, 'chapter', TEST_CHAPTER, TEST_PATH, v1Content, { type: 'manual' });
    const v2 = await service.saveVersion(TEST_PROJECT, 'chapter', TEST_CHAPTER, TEST_PATH, v2Content, { type: 'manual' });

    await service.rollbackToVersion(v1, v2Content);

    const history = await service.getRollbackHistory(TEST_PROJECT);
    expect(history.length).toBeGreaterThan(0);
    expect(history[0].toVersion).toBe(v1.version);
    expect(history[0].rolledBackAt).toBeDefined();
  });
});

describe('版本管理流程 - 版本元数据管理', () => {
  let app: App;
  let service: ChapterVersionService;
  let vault: Vault;

  const TEST_PROJECT = '元数据项目';
  const TEST_CHAPTER = '第1章';
  const TEST_PATH = pjBodyFile(TEST_PROJECT, 1, 1);

  beforeEach(async () => {
    app = new App();
    vault = app.vault as any;
    service = new ChapterVersionService(app as any);
    vault._seedFile(TEST_PATH, '初始');
  });

  it('更新版本标签', async () => {
    const v1 = await service.saveVersion(TEST_PROJECT, 'chapter', TEST_CHAPTER, TEST_PATH, '内容', { type: 'manual', tags: ['旧标签'] });

    const result = await service.updateVersionTags(
      TEST_PROJECT, 'chapter', TEST_CHAPTER, v1.id, ['新标签1', '新标签2']
    );

    expect(result).toBe(true);

    const versions = await service.getVersions(TEST_PROJECT, 'chapter', TEST_CHAPTER, TEST_PATH);
    const updated = versions.find(v => v.id === v1.id)!;
    expect(updated.tags).toContain('新标签1');
    expect(updated.tags).toContain('新标签2');
  });

  it('更新版本备注', async () => {
    const v1 = await service.saveVersion(TEST_PROJECT, 'chapter', TEST_CHAPTER, TEST_PATH, '内容', { type: 'manual', note: '旧备注' });

    const result = await service.updateVersionNote(
      TEST_PROJECT, 'chapter', TEST_CHAPTER, v1.id, '新的备注内容'
    );

    expect(result).toBe(true);

    const versions = await service.getVersions(TEST_PROJECT, 'chapter', TEST_CHAPTER, TEST_PATH);
    const updated = versions.find(v => v.id === v1.id)!;
    expect(updated.note).toBe('新的备注内容');
  });

  it('删除版本', async () => {
    const v1 = await service.saveVersion(TEST_PROJECT, 'chapter', TEST_CHAPTER, TEST_PATH, 'v1内容', { type: 'manual' });
    const v2 = await service.saveVersion(TEST_PROJECT, 'chapter', TEST_CHAPTER, TEST_PATH, 'v2内容', { type: 'manual' });

    const versionsBefore = await service.getVersions(TEST_PROJECT, 'chapter', TEST_CHAPTER, TEST_PATH);
    expect(versionsBefore.length).toBe(2);

    const result = await service.deleteVersion(TEST_PROJECT, 'chapter', TEST_CHAPTER, v1.id);
    expect(result).toBe(true);

    const versionsAfter = await service.getVersions(TEST_PROJECT, 'chapter', TEST_CHAPTER, TEST_PATH);
    expect(versionsAfter.length).toBe(1);
    expect(versionsAfter[0].id).toBe(v2.id);
  });
});

describe('版本管理流程 - 多种内容类型', () => {
  let app: App;
  let service: ChapterVersionService;
  let vault: Vault;

  const TEST_PROJECT = '多类型项目';

  beforeEach(() => {
    app = new App();
    vault = app.vault as any;
    service = new ChapterVersionService(app as any);
  });

  it('支持章节版本管理', async () => {
    const chapterPath = pjBodyFile(TEST_PROJECT, 1, 1);
    vault._seedFile(chapterPath, '章节内容');

    const result = await service.saveVersion(
      TEST_PROJECT, 'chapter', '第1章', chapterPath, '章节内容', { type: 'manual' }
    );

    expect(result.contentType).toBe('chapter');
    expect(result.contentKey).toBe('第1章');
  });

  it('支持大纲版本管理', async () => {
    const outlinePath = `${TEST_PROJECT}/03-大纲与章节/分卷大纲/第1卷_分卷大纲.md`;
    vault._seedFile(outlinePath, '大纲内容');

    const result = await service.saveVersion(
      TEST_PROJECT, 'outline', '第1卷大纲', outlinePath, '大纲内容', { type: 'manual' }
    );

    expect(result.contentType).toBe('outline');
    expect(result.contentKey).toBe('第1卷大纲');
  });

  it('支持设定版本管理', async () => {
    const settingPath = `${TEST_PROJECT}/01-世界架构/世界观总览.md`;
    vault._seedFile(settingPath, '设定内容');

    const result = await service.saveVersion(
      TEST_PROJECT, 'worldview', '世界观', settingPath, '设定内容', { type: 'manual' }
    );

    expect(result.contentType).toBe('worldview');
    expect(result.contentKey).toBe('世界观');
  });
});

describe('版本管理流程 - 完整版本生命周期', () => {
  let app: App;
  let service: ChapterVersionService;
  let vault: Vault;

  const TEST_PROJECT = '完整生命周期项目';
  const TEST_CHAPTER = '第1章';
  const TEST_PATH = pjBodyFile(TEST_PROJECT, 1, 1);

  beforeEach(() => {
    app = new App();
    vault = app.vault as any;
    service = new ChapterVersionService(app as any);
    vault._seedFile(TEST_PATH, '初始草稿');
  });

  it('完整流程：创建→修改→对比→回滚→验证', async () => {
    const v1Content = generateLongText('第一版：初稿完成。', 1000);
    const v2Content = generateLongText('第二版：大幅修改，增加细节。', 2000);
    const v3Content = generateLongText('第三版：最终润色完成。', 1500);

    const v1 = await service.saveVersion(TEST_PROJECT, 'chapter', TEST_CHAPTER, TEST_PATH, v1Content, {
      type: 'manual',
      note: '初稿完成',
      tags: ['draft'],
    });
    expect(v1.version).toBe(1);

    const v2 = await service.saveVersion(TEST_PROJECT, 'chapter', TEST_CHAPTER, TEST_PATH, v2Content, {
      type: 'ai-generate',
      note: 'AI扩写',
      tags: ['ai-generated'],
    });
    expect(v2.version).toBe(2);
    expect(v2.wordCount).toBeGreaterThan(v1.wordCount);

    const v3 = await service.saveVersion(TEST_PROJECT, 'chapter', TEST_CHAPTER, TEST_PATH, v3Content, {
      type: 'manual',
      note: '润色完成',
      tags: ['final'],
    });
    expect(v3.version).toBe(3);

    const diffResult = await service.compareVersions(v1, v3);
    expect(diffResult.stats.addedLines).toBeGreaterThan(0);

    const rollbackResult = await service.rollbackToVersion(v2, v3Content);
    expect(rollbackResult.success).toBe(true);
    expect(rollbackResult.rolledBackContent).toBe(v2Content);
    expect(rollbackResult.autoSavedVersion).not.toBeNull();

    const versions = await service.getVersions(TEST_PROJECT, 'chapter', TEST_CHAPTER, TEST_PATH);
    expect(versions.length).toBe(4);
  });
});
