import { expect } from 'vitest';
import { parseFrontmatter, parseMarkdownContent } from '../../../shared/frontmatter';

export function assertHasFrontmatter(content: string, keys: string[]): void {
  const fm = parseFrontmatter(content);
  for (const key of keys) {
    expect(fm[key]).toBeDefined();
  }
}

export function assertFrontmatterValue(content: string, key: string, expectedValue: string | number | boolean): void {
  const fm = parseFrontmatter(content);
  expect(fm[key]).toBe(String(expectedValue));
}

export function assertHasMarkdownSections(content: string, sectionTitles: string[]): void {
  const parsed = parseMarkdownContent(content);
  const titles = parsed.sections.map(s => s.title);
  for (const title of sectionTitles) {
    expect(titles).toContain(title);
  }
}

export function assertChapterStructure(content: string): void {
  expect(content).toContain('# ');
  const fm = parseFrontmatter(content);
  expect(fm.title).toBeDefined();
  expect(fm.chapterNumber).toBeDefined();
}

export function assertCharacterStructure(content: string): void {
  const fm = parseFrontmatter(content);
  expect(fm.name || fm['姓名']).toBeDefined();
  const parsed = parseMarkdownContent(content);
  expect(parsed.sections.length).toBeGreaterThan(0);
}

export function assertWorldviewStructure(content: string): void {
  const fm = parseFrontmatter(content);
  expect(fm.title).toBeDefined();
  expect(fm.genre).toBeDefined();
  const parsed = parseMarkdownContent(content);
  expect(parsed.sections.length).toBeGreaterThanOrEqual(2);
}

export function assertEntityRelationsValid(
  characters: Array<{ name: string; faction?: string }>,
  factions: Array<{ name: string }>
): void {
  const factionNames = new Set(factions.map(f => f.name));
  for (const char of characters) {
    if (char.faction) {
      expect(factionNames.has(char.faction)).toBe(true);
    }
  }
}

export function assertVersionMetadata(version: any): void {
  expect(version).toBeDefined();
  expect(version.id).toBeTruthy();
  expect(version.version).toBeGreaterThan(0);
  expect(version.createdAt).toBeDefined();
  expect(version.wordCount).toBeDefined();
}

export function assertGenreClassificationResult(result: any): void {
  expect(result).toHaveProperty('channel');
  expect(result.channel).toHaveProperty('id');
  expect(result.channel).toHaveProperty('name');
  expect(result.channel).toHaveProperty('confidence');
  expect(['male', 'female', 'neutral']).toContain(result.channel.id);

  expect(result).toHaveProperty('primaryGenre');
  expect(result.primaryGenre).toHaveProperty('id');
  expect(result.primaryGenre).toHaveProperty('name');
  expect(result.primaryGenre).toHaveProperty('confidence');

  expect(result).toHaveProperty('secondaryGenres');
  expect(Array.isArray(result.secondaryGenres)).toBe(true);

  expect(result).toHaveProperty('topGenres');
  expect(Array.isArray(result.topGenres)).toBe(true);
  expect(result.topGenres.length).toBeLessThanOrEqual(5);

  expect(result).toHaveProperty('method');
  expect(['rule', 'vector', 'hybrid']).toContain(result.method);
}

export function assertWordCount(content: string, minWords: number): void {
  const chineseChars = (content.match(/[\u4e00-\u9fa5]/g) || []).length;
  expect(chineseChars).toBeGreaterThanOrEqual(minWords);
}

export function assertFileStructure(vault: any, expectedFiles: string[]): void {
  for (const file of expectedFiles) {
    expect(vault.exists(file)).toBe(true);
  }
}

export function assertFolderStructure(vault: any, expectedFolders: string[]): void {
  for (const folder of expectedFolders) {
    expect(vault.exists(folder)).toBe(true);
  }
}

export function assertDiffStats(stats: any): void {
  expect(stats).toHaveProperty('addedLines');
  expect(stats).toHaveProperty('deletedLines');
  expect(stats).toHaveProperty('modifiedLines');
  expect(typeof stats.addedLines).toBe('number');
  expect(typeof stats.deletedLines).toBe('number');
  expect(typeof stats.modifiedLines).toBe('number');
}

export function assertCharacterSoulComplete(soul: any): void {
  expect(soul).toBeDefined();
  const soulDimensions = [
    'desire', 'fear', 'obsession', 'shame', 'trauma',
    'weakness', 'soft_spot', 'rage_trigger', 'moral_boundary'
  ];
  for (const dim of soulDimensions) {
    expect(soul[dim]).toBeDefined();
  }
}
