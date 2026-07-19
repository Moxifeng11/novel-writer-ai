import { Vault, App } from '../../__mocks__/obsidian';
import {
  pjWorldview,
  pjCharFile,
  pjLocFile,
  pjFactionFile,
  pjItemFile,
  pjBodyFile,
  pjVolumeOutlineFile,
  pjCharsDir,
  pjLocsDir,
  pjFactionsDir,
  pjItemsDir,
  pjBodyDir,
  pjVolumeOutlineDir,
  pjOutlineDir,
  pjTimelineDir,
  pjControlDir,
  pjFanficDir,
  pjSettingLib,
  pjWritingStyle,
  SUBDIR_WORLD_ARCH,
} from '../../../shared/paths';
import {
  generateWorldviewMarkdown,
  generateCharacterMarkdown,
  generateLocationMarkdown,
  generateFactionMarkdown,
  generateItemMarkdown,
  generateChapterMarkdown,
  generateVolumeOutlineMarkdown,
  type CharacterData,
  type LocationData,
  type FactionData,
  type ItemData,
  type ChapterData,
  type WorldviewData,
} from './test-data-generator';

export interface TestProjectConfig {
  projectName: string;
  worldview?: WorldviewData;
  characters?: CharacterData[];
  locations?: LocationData[];
  factions?: FactionData[];
  items?: ItemData[];
  chapters?: ChapterData[];
  volumeOutline?: {
    volume: number;
    title: string;
    chapters: Array<{ number: number; title: string; summary: string }>;
  };
}

export class TestProjectScaffold {
  private vault: Vault;
  private app: App;
  private projectName: string;

  constructor(app: App, projectName: string) {
    this.app = app;
    this.vault = app.vault as any;
    this.projectName = projectName;
  }

  async createBasicStructure(): Promise<void> {
    await this.vault.createFolder(`${this.projectName}/`);
    await this.vault.createFolder(`${this.projectName}/${SUBDIR_WORLD_ARCH}/`);
    await this.vault.createFolder(pjCharsDir(this.projectName) + '/');
    await this.vault.createFolder(pjLocsDir(this.projectName) + '/');
    await this.vault.createFolder(pjFactionsDir(this.projectName) + '/');
    await this.vault.createFolder(pjItemsDir(this.projectName) + '/');
    await this.vault.createFolder(pjOutlineDir(this.projectName) + '/');
    await this.vault.createFolder(pjVolumeOutlineDir(this.projectName) + '/');
    await this.vault.createFolder(pjBodyDir(this.projectName, 1) + '/');
    await this.vault.createFolder(pjTimelineDir(this.projectName) + '/');
    await this.vault.createFolder(pjControlDir(this.projectName) + '/');
    await this.vault.createFolder(pjFanficDir(this.projectName) + '/');
  }

  async addWorldview(worldview: WorldviewData): Promise<string> {
    const path = pjWorldview(this.projectName);
    const content = generateWorldviewMarkdown(worldview);
    await this.vault.write(path, content);
    return path;
  }

  async addCharacter(char: CharacterData): Promise<string> {
    const path = pjCharFile(this.projectName, char.name);
    const content = generateCharacterMarkdown(char);
    await this.vault.write(path, content);
    return path;
  }

  async addCharacters(chars: CharacterData[]): Promise<string[]> {
    const paths: string[] = [];
    for (const char of chars) {
      paths.push(await this.addCharacter(char));
    }
    return paths;
  }

  async addLocation(loc: LocationData): Promise<string> {
    const path = pjLocFile(this.projectName, loc.name);
    const content = generateLocationMarkdown(loc);
    await this.vault.write(path, content);
    return path;
  }

  async addLocations(locs: LocationData[]): Promise<string[]> {
    const paths: string[] = [];
    for (const loc of locs) {
      paths.push(await this.addLocation(loc));
    }
    return paths;
  }

  async addFaction(faction: FactionData): Promise<string> {
    const path = pjFactionFile(this.projectName, faction.name);
    const content = generateFactionMarkdown(faction);
    await this.vault.write(path, content);
    return path;
  }

  async addFactions(factions: FactionData[]): Promise<string[]> {
    const paths: string[] = [];
    for (const faction of factions) {
      paths.push(await this.addFaction(faction));
    }
    return paths;
  }

  async addItem(item: ItemData): Promise<string> {
    const path = pjItemFile(this.projectName, item.name);
    const content = generateItemMarkdown(item);
    await this.vault.write(path, content);
    return path;
  }

  async addItems(items: ItemData[]): Promise<string[]> {
    const paths: string[] = [];
    for (const item of items) {
      paths.push(await this.addItem(item));
    }
    return paths;
  }

  async addChapter(chapter: ChapterData): Promise<string> {
    const dir = pjBodyDir(this.projectName, chapter.volume);
    if (!this.vault.exists(dir)) {
      await this.vault.createFolder(dir + '/');
    }
    const path = pjBodyFile(this.projectName, chapter.volume, chapter.chapter);
    const content = generateChapterMarkdown(chapter);
    await this.vault.write(path, content);
    return path;
  }

  async addChapters(chapters: ChapterData[]): Promise<string[]> {
    const paths: string[] = [];
    for (const chapter of chapters) {
      paths.push(await this.addChapter(chapter));
    }
    return paths;
  }

  async addVolumeOutline(
    volume: number,
    title: string,
    chapters: Array<{ number: number; title: string; summary: string }>
  ): Promise<string> {
    const path = pjVolumeOutlineFile(this.projectName, volume);
    const content = generateVolumeOutlineMarkdown(volume, title, chapters);
    await this.vault.write(path, content);
    return path;
  }

  async addSettingLib(content: string): Promise<string> {
    const path = pjSettingLib(this.projectName);
    await this.vault.write(path, content);
    return path;
  }

  async addWritingStyle(content: string): Promise<string> {
    const path = pjWritingStyle(this.projectName);
    await this.vault.write(path, content);
    return path;
  }

  async buildFullProject(config: TestProjectConfig): Promise<{
    worldviewPath?: string;
    characterPaths: string[];
    locationPaths: string[];
    factionPaths: string[];
    itemPaths: string[];
    chapterPaths: string[];
    volumeOutlinePath?: string;
  }> {
    await this.createBasicStructure();

    const result = {
      characterPaths: [] as string[],
      locationPaths: [] as string[],
      factionPaths: [] as string[],
      itemPaths: [] as string[],
      chapterPaths: [] as string[],
    };

    let worldviewPath: string | undefined;
    if (config.worldview) {
      worldviewPath = await this.addWorldview(config.worldview);
    }

    if (config.characters && config.characters.length > 0) {
      result.characterPaths = await this.addCharacters(config.characters);
    }

    if (config.locations && config.locations.length > 0) {
      result.locationPaths = await this.addLocations(config.locations);
    }

    if (config.factions && config.factions.length > 0) {
      result.factionPaths = await this.addFactions(config.factions);
    }

    if (config.items && config.items.length > 0) {
      result.itemPaths = await this.addItems(config.items);
    }

    if (config.chapters && config.chapters.length > 0) {
      result.chapterPaths = await this.addChapters(config.chapters);
    }

    let volumeOutlinePath: string | undefined;
    if (config.volumeOutline) {
      volumeOutlinePath = await this.addVolumeOutline(
        config.volumeOutline.volume,
        config.volumeOutline.title,
        config.volumeOutline.chapters
      );
    }

    return {
      worldviewPath,
      ...result,
      volumeOutlinePath,
    };
  }

  async readFile(path: string): Promise<string> {
    return this.vault.readByPath(path);
  }

  exists(path: string): boolean {
    return this.vault.exists(path);
  }

  getProjectName(): string {
    return this.projectName;
  }

  getVault(): Vault {
    return this.vault;
  }

  getApp(): App {
    return this.app;
  }
}

export async function createTestProject(
  app: App,
  projectName: string,
  config?: Partial<TestProjectConfig>
): Promise<TestProjectScaffold> {
  const scaffold = new TestProjectScaffold(app, projectName);
  await scaffold.createBasicStructure();
  return scaffold;
}
