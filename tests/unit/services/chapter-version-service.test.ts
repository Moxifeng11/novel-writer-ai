import { describe, it, expect, beforeEach } from 'vitest';
import { App, Vault, TFile } from '../../__mocks__/obsidian';
import { ChapterVersionService } from '../../../services/chapter-version-service';
import { countWords } from '../../../shared/diff-utils';
import { pjVersionIndexFile } from '../../../shared/paths';

describe('ChapterVersionService — 构造', () => {
  let app: App;

  beforeEach(() => {
    app = new App();
  });

  it('使用 App 构造不报错', () => {
    const service = new ChapterVersionService(app as any);
    expect(service).toBeDefined();
  });
});

describe('ChapterVersionService — 保存版本', () => {
  let app: App;
  let service: ChapterVersionService;
  let vault: Vault;

  const TEST_PROJECT = '测试项目';
  const TEST_CHAPTER = '第1章';
  const TEST_PATH = `${TEST_PROJECT}/03-大纲与章节/正文/第1卷/第1章_正文.md`;

  beforeEach(() => {
    app = new App();
    vault = app.vault as any;
    service = new ChapterVersionService(app as any);
    vault._seedFile(TEST_PATH, '这是第1章的内容。\n林惊鸿走进了大厅。');
  });

  it('saveVersion 成功保存并返回版本元数据', async () => {
    const result = await service.saveVersion(
      TEST_PROJECT, 'chapter', TEST_CHAPTER, TEST_PATH,
      '这是第1章的内容。\n林惊鸿走进了大厅。',
      { type: 'manual', note: '测试保存', tags: ['测试'] }
    );
    expect(result).toBeDefined();
    expect(result.id).toBeTruthy();
    expect(result.version).toBe(1);
    expect(result.type).toBe('manual');
    expect(result.note).toBe('测试保存');
    expect(result.tags).toEqual(['测试']);
    expect(result.wordCount).toBeGreaterThan(0);
    expect(result.contentType).toBe('chapter');
  });

  it('连续保存两个版本，版本号递增', async () => {
    const v1 = await service.saveVersion(
      TEST_PROJECT, 'chapter', TEST_CHAPTER, TEST_PATH,
      '第一版内容。',
      { type: 'manual' }
    );
    expect(v1.version).toBe(1);

    const v2 = await service.saveVersion(
      TEST_PROJECT, 'chapter', TEST_CHAPTER, TEST_PATH,
      '第二版内容，更多文字。',
      { type: 'ai-generate' }
    );
    expect(v2.version).toBe(2);
    expect(v2.wordCountDelta).toBeDefined();
  });

  it('空内容也能保存', async () => {
    const result = await service.saveVersion(
      TEST_PROJECT, 'chapter', TEST_CHAPTER, TEST_PATH,
      '',
      { type: 'manual' }
    );
    expect(result).toBeDefined();
    expect(result.wordCount).toBe(0);
  });

  it('字数统计与 countWords 一致', async () => {
    const content = '林惊鸿走进了大厅。Hello world.';
    const result = await service.saveVersion(
      TEST_PROJECT, 'chapter', TEST_CHAPTER, TEST_PATH,
      content,
      { type: 'manual' }
    );
    expect(result.wordCount).toBe(countWords(content));
  });
});

describe('ChapterVersionService — 版本列表查询', () => {
  let app: App;
  let service: ChapterVersionService;
  let vault: Vault;

  const TEST_PROJECT = '测试项目';
  const TEST_CHAPTER = '第1章';
  const TEST_PATH = `${TEST_PROJECT}/03-大纲与章节/正文/第1卷/第1章_正文.md`;

  beforeEach(async () => {
    app = new App();
    vault = app.vault as any;
    service = new ChapterVersionService(app as any);
    vault._seedFile(TEST_PATH, '初始内容');
  });

  it('getVersions 返回版本列表（按版本号倒序）', async () => {
    await service.saveVersion(TEST_PROJECT, 'chapter', TEST_CHAPTER, TEST_PATH, 'v1', { type: 'manual' });
    await service.saveVersion(TEST_PROJECT, 'chapter', TEST_CHAPTER, TEST_PATH, 'v2', { type: 'ai-generate' });
    await service.saveVersion(TEST_PROJECT, 'chapter', TEST_CHAPTER, TEST_PATH, 'v3', { type: 'polish' });

    const versions = await service.getVersions(TEST_PROJECT, 'chapter', TEST_CHAPTER, TEST_PATH);
    expect(versions.length).toBe(3);
    expect(versions[0].version).toBe(3);
    expect(versions[1].version).toBe(2);
    expect(versions[2].version).toBe(1);
  });

  it('不存在的内容返回空数组', async () => {
    const versions = await service.getVersions(TEST_PROJECT, 'chapter', '不存在的章节', '不存在的路径.md');
    expect(versions).toEqual([]);
  });

  it('索引中的越界路径被丢弃，回滚直接拒绝（安全审计 P1）', async () => {
    const indexPath = pjVersionIndexFile(TEST_PROJECT, 'chapter', TEST_CHAPTER);
    const evil = {
      id: 'evil-1',
      version: 9,
      createdAt: new Date().toISOString(),
      type: 'manual',
      contentType: 'chapter',
      wordCount: 1,
      wordCountDelta: 1,
      lineCount: 1,
      tags: [],
      note: 'forged',
      project: TEST_PROJECT,
      contentKey: TEST_CHAPTER,
      sourcePath: '../.obsidian/plugins/novel-writer-ai/main.js',
      versionPath: '.obsidian/plugins/novel-writer-ai/data.json',
    };
    vault._seedFile(indexPath, JSON.stringify({
      contentType: 'chapter',
      project: TEST_PROJECT,
      contentKey: TEST_CHAPTER,
      sourcePath: TEST_PATH,
      latestVersion: 9,
      versions: [evil],
    }));

    const index = await service.getVersionIndex(TEST_PROJECT, 'chapter', TEST_CHAPTER, TEST_PATH);
    expect(index.versions).toEqual([]);
    expect(index.latestVersion).toBe(0);
    await expect(service.rollbackToVersion(evil as never, 'current')).rejects.toThrow('版本索引路径非法');
  });

  it('partialRollback 只回滚选中行、走锁写回正文并生成 rollback 版本（C-2）', async () => {
    const original = '第一行\n第二行\n第三行';
    const v1 = await service.saveVersion(
      TEST_PROJECT, 'chapter', TEST_CHAPTER, TEST_PATH, original, { type: 'manual' },
    );
    const current = '第一行\n改过的第二行\n第三行';

    const result = await service.partialRollback(v1, current, [1]);

    expect(result.success).toBe(true);
    expect(result.newContent).toBe(original);
    expect(await vault.adapter.read(TEST_PATH)).toBe(original);
    expect(result.autoSavedVersion?.type).toBe('rollback');
    // 自动保存的是回滚前的当前内容，不是目标版本
    const autoContent = await service.getVersionContent(result.autoSavedVersion!);
    expect(autoContent).toBe(current);
  });

  it('partialRollback 拒绝非法版本索引（contentKey 穿越）', async () => {
    const v1 = await service.saveVersion(
      TEST_PROJECT, 'chapter', TEST_CHAPTER, TEST_PATH, '内容', { type: 'manual' },
    );
    await expect(service.partialRollback({ ...v1, contentKey: '../evil' }, '内容', [0]))
      .rejects.toThrow('版本索引路径非法');
  });

  it('saveVersion 拒绝目录 sourcePath（D-4：定向修订备份不可回滚）', async () => {
    const dir = `${TEST_PROJECT}/03-大纲与章节/步骤结果/第1卷/第1章`;
    await vault.createFolder(dir);
    await expect(service.saveVersion(TEST_PROJECT, 'chapter', TEST_CHAPTER, dir, '内容', { type: 'manual' }))
      .rejects.toThrow('源路径必须是正文文件');
  });

  it('getVersionIndex 返回完整索引', async () => {
    await service.saveVersion(TEST_PROJECT, 'chapter', TEST_CHAPTER, TEST_PATH, '测试', { type: 'manual' });
    const index = await service.getVersionIndex(TEST_PROJECT, 'chapter', TEST_CHAPTER, TEST_PATH);
    expect(index).toBeDefined();
    expect(index.contentType).toBe('chapter');
    expect(index.project).toBe(TEST_PROJECT);
    expect(index.contentKey).toBe(TEST_CHAPTER);
    expect(index.latestVersion).toBe(1);
    expect(index.versions.length).toBe(1);
  });

  it('SEC-1 残留：contentKey 含穿越/分隔符时 saveVersion 直接拒绝', async () => {
    for (const badKey of ['../evil', 'a/b', 'a\\b', '..', '']) {
      await expect(service.saveVersion(TEST_PROJECT, 'chapter', badKey, TEST_PATH, 'x', { type: 'manual' }))
        .rejects.toThrow('版本键非法');
    }
  });

  it('SEC-1 残留：sourcePath 越界时 saveVersion 直接拒绝', async () => {
    for (const badSource of ['../main.js', '.obsidian/plugins/x/data.json', '/abs/path.md', 'C:/x.md']) {
      await expect(service.saveVersion(TEST_PROJECT, 'chapter', TEST_CHAPTER, badSource, 'x', { type: 'manual' }))
        .rejects.toThrow('源路径非法');
    }
  });
});

describe('ChapterVersionService — 获取版本内容', () => {
  let app: App;
  let service: ChapterVersionService;
  let vault: Vault;

  const TEST_PROJECT = '测试项目';
  const TEST_CHAPTER = '第1章';
  const TEST_PATH = `${TEST_PROJECT}/03-大纲与章节/正文/第1卷/第1章_正文.md`;

  beforeEach(async () => {
    app = new App();
    vault = app.vault as any;
    service = new ChapterVersionService(app as any);
    vault._seedFile(TEST_PATH, '初始内容');
  });

  it('getVersionContent 返回对应版本的内容', async () => {
    const content = '这是要保存的测试内容。';
    const meta = await service.saveVersion(
      TEST_PROJECT, 'chapter', TEST_CHAPTER, TEST_PATH,
      content, { type: 'manual' }
    );
    const readContent = await service.getVersionContent(meta);
    expect(readContent).toBe(content);
  });

  it('versionPath 属性正确指向内容文件', async () => {
    const meta = await service.saveVersion(
      TEST_PROJECT, 'chapter', TEST_CHAPTER, TEST_PATH,
      '测试内容', { type: 'manual' }
    );
    expect(meta.versionPath).toContain(TEST_PROJECT);
    expect(meta.versionPath).toContain('_versions');
  });
});

describe('ChapterVersionService — Diff 对比', () => {
  let app: App;
  let service: ChapterVersionService;
  let vault: Vault;

  const TEST_PROJECT = '测试项目';
  const TEST_CHAPTER = '第1章';
  const TEST_PATH = `${TEST_PROJECT}/03-大纲与章节/正文/第1卷/第1章_正文.md`;

  beforeEach(async () => {
    app = new App();
    vault = app.vault as any;
    service = new ChapterVersionService(app as any);
    vault._seedFile(TEST_PATH, '初始内容');
  });

  it('compareVersions 返回行级 diff 和统计', async () => {
    const v1 = await service.saveVersion(
      TEST_PROJECT, 'chapter', TEST_CHAPTER, TEST_PATH,
      '第一行\n第二行\n第三行', { type: 'manual' }
    );
    const v2 = await service.saveVersion(
      TEST_PROJECT, 'chapter', TEST_CHAPTER, TEST_PATH,
      '第一行\n修改后的行\n第三行\n新增的行', { type: 'ai-generate' }
    );
    const result = await service.compareVersions(v1, v2);
    expect(result).toBeDefined();
    expect(result.lineDiffs).toBeDefined();
    expect(Array.isArray(result.lineDiffs)).toBe(true);
    expect(result.lineDiffs.length).toBeGreaterThan(0);
    expect(result.stats).toBeDefined();
    expect(result.stats).toHaveProperty('addedLines');
    expect(result.stats).toHaveProperty('changeRatio');
    for (const d of result.lineDiffs) {
      expect(d).toHaveProperty('op');
      expect(['equal', 'insert', 'delete', 'replace']).toContain(d.op);
    }
  });

  it('相同版本的 diff 全部为 equal', async () => {
    const v1 = await service.saveVersion(
      TEST_PROJECT, 'chapter', TEST_CHAPTER, TEST_PATH,
      '相同内容', { type: 'manual' }
    );
    const result = await service.compareVersions(v1, v1);
    expect(result.lineDiffs.every(d => d.op === 'equal')).toBe(true);
  });
});

describe('ChapterVersionService — compareVersionWithCurrent', () => {
  let app: App;
  let service: ChapterVersionService;
  let vault: Vault;

  const TEST_PROJECT = '测试项目';
  const TEST_CHAPTER = '第1章';
  const TEST_PATH = `${TEST_PROJECT}/03-大纲与章节/正文/第1卷/第1章_正文.md`;

  beforeEach(async () => {
    app = new App();
    vault = app.vault as any;
    service = new ChapterVersionService(app as any);
    vault._seedFile(TEST_PATH, '初始内容');
  });

  it('compareVersionWithCurrent 对比版本与当前内容', async () => {
    const v1 = await service.saveVersion(
      TEST_PROJECT, 'chapter', TEST_CHAPTER, TEST_PATH,
      '旧内容\n第二行', { type: 'manual' }
    );
    const result = await service.compareVersionWithCurrent(v1, '新内容\n第二行\n第三行');
    expect(result).toBeDefined();
    expect(result.lineDiffs).toBeDefined();
    expect(result.stats).toBeDefined();
    expect(result.stats.addedLines).toBeGreaterThanOrEqual(0);
  });
});

describe('ChapterVersionService — compareChars 字符级 diff', () => {
  let app: App;
  let service: ChapterVersionService;
  let vault: Vault;

  const TEST_PROJECT = '测试项目';
  const TEST_CHAPTER = '第1章';
  const TEST_PATH = `${TEST_PROJECT}/03-大纲与章节/正文/第1卷/第1章_正文.md`;

  beforeEach(async () => {
    app = new App();
    vault = app.vault as any;
    service = new ChapterVersionService(app as any);
    vault._seedFile(TEST_PATH, '初始内容');
  });

  it('compareChars 返回字符级 diff', async () => {
    const result = await service.compareChars('hello', 'hello world');
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
    for (const r of result) {
      expect(r).toHaveProperty('op');
      expect(r).toHaveProperty('content');
    }
  });
});

describe('ChapterVersionService — 版本标签和备注管理', () => {
  let app: App;
  let service: ChapterVersionService;
  let vault: Vault;

  const TEST_PROJECT = '测试项目';
  const TEST_CHAPTER = '第1章';
  const TEST_PATH = `${TEST_PROJECT}/03-大纲与章节/正文/第1卷/第1章_正文.md`;

  beforeEach(async () => {
    app = new App();
    vault = app.vault as any;
    service = new ChapterVersionService(app as any);
    vault._seedFile(TEST_PATH, '初始内容');
  });

  it('updateVersionTags 更新标签成功', async () => {
    const v1 = await service.saveVersion(
      TEST_PROJECT, 'chapter', TEST_CHAPTER, TEST_PATH,
      '测试', { type: 'manual', tags: ['初始'] }
    );
    const updated = await service.updateVersionTags(
      TEST_PROJECT, 'chapter', TEST_CHAPTER, v1.id, ['重要', '已审核']
    );
    expect(updated).toBe(true);

    const versions = await service.getVersions(TEST_PROJECT, 'chapter', TEST_CHAPTER, TEST_PATH);
    const target = versions.find(v => v.id === v1.id);
    expect(target).toBeDefined();
    expect(target!.tags).toEqual(['重要', '已审核']);
  });

  it('updateVersionNote 更新备注成功', async () => {
    const v1 = await service.saveVersion(
      TEST_PROJECT, 'chapter', TEST_CHAPTER, TEST_PATH,
      '测试', { type: 'manual' }
    );
    const updated = await service.updateVersionNote(
      TEST_PROJECT, 'chapter', TEST_CHAPTER, v1.id, '这是一个重要的版本'
    );
    expect(updated).toBe(true);

    const versions = await service.getVersions(TEST_PROJECT, 'chapter', TEST_CHAPTER, TEST_PATH);
    const target = versions.find(v => v.id === v1.id);
    expect(target!.note).toBe('这是一个重要的版本');
  });
});

describe('ChapterVersionService — 删除版本', () => {
  let app: App;
  let service: ChapterVersionService;
  let vault: Vault;

  const TEST_PROJECT = '测试项目';
  const TEST_CHAPTER = '第1章';
  const TEST_PATH = `${TEST_PROJECT}/03-大纲与章节/正文/第1卷/第1章_正文.md`;

  beforeEach(async () => {
    app = new App();
    vault = app.vault as any;
    service = new ChapterVersionService(app as any);
    vault._seedFile(TEST_PATH, '初始内容');
  });

  it('deleteVersion 删除成功后版本数减少', async () => {
    const v1 = await service.saveVersion(
      TEST_PROJECT, 'chapter', TEST_CHAPTER, TEST_PATH,
      'v1', { type: 'manual' }
    );
    await service.saveVersion(
      TEST_PROJECT, 'chapter', TEST_CHAPTER, TEST_PATH,
      'v2', { type: 'manual' }
    );
    const versionsBefore = await service.getVersions(TEST_PROJECT, 'chapter', TEST_CHAPTER, TEST_PATH);
    expect(versionsBefore.length).toBe(2);

    const deleted = await service.deleteVersion(
      TEST_PROJECT, 'chapter', TEST_CHAPTER, v1.id
    );
    expect(deleted).toBe(true);

    const versionsAfter = await service.getVersions(TEST_PROJECT, 'chapter', TEST_CHAPTER, TEST_PATH);
    expect(versionsAfter.length).toBe(1);
  });

  it('getLatestVersion 返回最新版本', async () => {
    await service.saveVersion(
      TEST_PROJECT, 'chapter', TEST_CHAPTER, TEST_PATH,
      'v1', { type: 'manual' }
    );
    const v2 = await service.saveVersion(
      TEST_PROJECT, 'chapter', TEST_CHAPTER, TEST_PATH,
      'v2', { type: 'manual' }
    );

    const latest = await service.getLatestVersion(
      TEST_PROJECT, 'chapter', TEST_CHAPTER, TEST_PATH
    );
    expect(latest).toBeDefined();
    expect(latest!.version).toBe(v2.version);
    expect(latest!.id).toBe(v2.id);
  });

  it('getLatestVersion 没有版本时返回 null', async () => {
    const latest = await service.getLatestVersion(
      TEST_PROJECT, 'chapter', '不存在的章节', TEST_PATH
    );
    expect(latest).toBeNull();
  });
});

describe('ChapterVersionService — 并发保存不丢版本', () => {
  it('两个并发 saveVersion 得到连续版本号，索引保留两条', async () => {
    const app = new App();
    const vault = app.vault as any;
    const service = new ChapterVersionService(app as any);
    const path = '长篇小说/书X/03-大纲与章节/正文/第1卷/第1章_正文.md';
    vault._seedFile(path, '初始正文');

    const [a, b] = await Promise.all([
      service.saveVersion('长篇小说/书X', 'chapter', '第1章', path, '内容 A', { type: 'manual' }),
      service.saveVersion('长篇小说/书X', 'chapter', '第1章', path, '内容 B', { type: 'manual' }),
    ]);

    expect(new Set([a.version, b.version]).size).toBe(2);
    const versions = await service.getVersions('长篇小说/书X', 'chapter', '第1章', path);
    expect(versions.length).toBe(2);
    expect(versions.map(v => v.version).sort()).toEqual([1, 2]);
  });
});
