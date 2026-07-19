import { describe, it, expect } from 'vitest';
import {
  scanExistingVolumes,
  detectVolumeConflict,
  VolumeScanResult,
} from '../../../shared/volume-conflict-detector';

describe('scanExistingVolumes — 卷目录扫描', () => {
  const projectPath = '我的小说';

  it('无 filePaths 时返回空结果', () => {
    const result = scanExistingVolumes(projectPath);
    expect(result.volumeCount).toBe(0);
    expect(result.chaptersPerVolume).toEqual([]);
    expect(result.volumeFiles).toEqual([]);
  });

  it('空 filePaths 数组时返回空结果', () => {
    const result = scanExistingVolumes(projectPath, []);
    expect(result.volumeCount).toBe(0);
    expect(result.chaptersPerVolume).toEqual([]);
    expect(result.volumeFiles).toEqual([]);
  });

  it('单卷单章：正确识别卷和章节数', () => {
    const files = ['我的小说/volumes/第1卷/第1章_正文.md'];
    const result = scanExistingVolumes(projectPath, files);
    expect(result.volumeCount).toBe(1);
    expect(result.chaptersPerVolume).toEqual([1]);
    expect(result.volumeFiles).toHaveLength(1);
    expect(result.volumeFiles[0].volumeNumber).toBe(1);
    expect(result.volumeFiles[0].volumeName).toBe('第1卷');
    expect(result.volumeFiles[0].chapterCount).toBe(1);
    expect(result.volumeFiles[0].filePaths).toEqual(files);
  });

  it('多卷多章：按卷号升序排序', () => {
    const files = [
      '我的小说/volumes/第2卷/第5章_正文.md',
      '我的小说/volumes/第1卷/第3章_正文.md',
      '我的小说/volumes/第1卷/第1章_正文.md',
      '我的小说/volumes/第3卷/第10章_正文.md',
    ];
    const result = scanExistingVolumes(projectPath, files);
    expect(result.volumeCount).toBe(3);
    expect(result.chaptersPerVolume).toEqual([3, 5, 10]);
    expect(result.volumeFiles[0].volumeNumber).toBe(1);
    expect(result.volumeFiles[1].volumeNumber).toBe(2);
    expect(result.volumeFiles[2].volumeNumber).toBe(3);
  });

  it('章节数取最大值（识别断章）', () => {
    const files = [
      '我的小说/volumes/第1卷/第1章_正文.md',
      '我的小说/volumes/第1卷/第3章_正文.md',
    ];
    const result = scanExistingVolumes(projectPath, files);
    expect(result.volumeFiles[0].chapterCount).toBe(3);
  });

  it('过滤非 volumes 路径文件', () => {
    const files = [
      '我的小说/volumes/第1卷/第1章_正文.md',
      '我的小说/其他目录/第2卷/第1章_正文.md',
      '我的小说/volumes/第1卷/笔记.md',
    ];
    const result = scanExistingVolumes(projectPath, files);
    expect(result.volumeCount).toBe(1);
    expect(result.volumeFiles[0].filePaths).toHaveLength(2);
    expect(result.volumeFiles[0].chapterCount).toBe(1);
  });

  it('支持不同章节文件名格式', () => {
    const files = [
      '我的小说/volumes/第1卷/第1章_正文.md',
      '我的小说/volumes/第1卷/第2章 正文.md',
      '我的小说/volumes/第1卷/第3章.md',
    ];
    const result = scanExistingVolumes(projectPath, files);
    expect(result.volumeFiles[0].chapterCount).toBe(3);
  });

  it('忽略非 .md 文件', () => {
    const files = [
      '我的小说/volumes/第1卷/第1章_正文.md',
      '我的小说/volumes/第1卷/图片.png',
      '我的小说/volumes/第1卷/数据.json',
    ];
    const result = scanExistingVolumes(projectPath, files);
    expect(result.volumeFiles[0].chapterCount).toBe(1);
    expect(result.volumeFiles[0].filePaths).toHaveLength(3);
  });
});

describe('detectVolumeConflict — 冲突检测', () => {
  const makeExisting = (
    chaptersPerVolume: number[]
  ): VolumeScanResult => ({
    volumeCount: chaptersPerVolume.length,
    chaptersPerVolume,
    volumeFiles: chaptersPerVolume.map((count, idx) => ({
      volumeNumber: idx + 1,
      volumeName: `第${idx + 1}卷`,
      chapterCount: count,
      filePaths: [],
    })),
  });

  it('无冲突：卷数和章节数均相同', () => {
    const existing = makeExisting([10, 10, 10]);
    const result = detectVolumeConflict(existing, 3, [10, 10, 10]);
    expect(result.conflictType).toBe('none');
    expect(result.details.addedVolumes).toBeUndefined();
    expect(result.details.removedVolumes).toBeUndefined();
    expect(result.details.chapterMismatches).toBeUndefined();
    expect(result.message).toContain('无冲突');
  });

  it('more_volumes：数据层卷数多于新大纲', () => {
    const existing = makeExisting([10, 10, 10, 10]);
    const result = detectVolumeConflict(existing, 2, [10, 10]);
    expect(result.conflictType).toBe('more_volumes');
    expect(result.details.removedVolumes).toEqual([3, 4]);
    expect(result.details.addedVolumes).toBeUndefined();
    expect(result.message).toContain('4 卷');
    expect(result.message).toContain('2 卷');
  });

  it('fewer_volumes：数据层卷数少于新大纲', () => {
    const existing = makeExisting([10, 10]);
    const result = detectVolumeConflict(existing, 4, [10, 10, 10, 10]);
    expect(result.conflictType).toBe('fewer_volumes');
    expect(result.details.addedVolumes).toEqual([3, 4]);
    expect(result.details.removedVolumes).toBeUndefined();
    expect(result.message).toContain('2 卷');
    expect(result.message).toContain('4 卷');
  });

  it('same_count_different_chapters：卷数相同但章节数不同', () => {
    const existing = makeExisting([10, 8, 12]);
    const result = detectVolumeConflict(existing, 3, [10, 10, 12]);
    expect(result.conflictType).toBe('same_count_different_chapters');
    expect(result.details.chapterMismatches).toEqual([
      { volumeNumber: 2, existing: 8, planned: 10 },
    ]);
    expect(result.details.addedVolumes).toBeUndefined();
    expect(result.details.removedVolumes).toBeUndefined();
    expect(result.message).toContain('第2卷');
  });

  it('多卷章节数均不匹配', () => {
    const existing = makeExisting([5, 5, 5]);
    const result = detectVolumeConflict(existing, 3, [10, 10, 10]);
    expect(result.conflictType).toBe('same_count_different_chapters');
    expect(result.details.chapterMismatches).toHaveLength(3);
    expect(result.details.chapterMismatches![0]).toEqual({
      volumeNumber: 1, existing: 5, planned: 10,
    });
  });

  it('空数据层 vs 新大纲：fewer_volumes', () => {
    const existing = makeExisting([]);
    const result = detectVolumeConflict(existing, 3, [10, 10, 10]);
    expect(result.conflictType).toBe('fewer_volumes');
    expect(result.details.addedVolumes).toEqual([1, 2, 3]);
  });

  it('新大纲为 0 卷 vs 有数据层：more_volumes', () => {
    const existing = makeExisting([10]);
    const result = detectVolumeConflict(existing, 0, []);
    expect(result.conflictType).toBe('more_volumes');
    expect(result.details.removedVolumes).toEqual([1]);
  });

  it('重叠卷正确计算', () => {
    const existing = makeExisting([10, 10, 10]);
    const result = detectVolumeConflict(existing, 5, [10, 10, 10, 8, 8]);
    expect(result.conflictType).toBe('fewer_volumes');
    expect(result.details.overlappingVolumes).toEqual([1, 2, 3]);
    expect(result.details.addedVolumes).toEqual([4, 5]);
  });

  it('冲突详情包含所有字段', () => {
    const existing = makeExisting([10, 8, 12, 15]);
    const result = detectVolumeConflict(existing, 3, [10, 10, 12]);
    expect(result.conflictType).toBe('more_volumes');
    expect(result.existingVolumes.volumeCount).toBe(4);
    expect(result.newConfigVolumes).toBe(3);
    expect(result.newConfigChaptersPerVolume).toEqual([10, 10, 12]);
    expect(result.details.removedVolumes).toEqual([4]);
    expect(result.details.overlappingVolumes).toEqual([1, 2, 3]);
    expect(result.details.chapterMismatches).toEqual([
      { volumeNumber: 2, existing: 8, planned: 10 },
    ]);
  });
});
