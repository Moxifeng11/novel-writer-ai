export interface TestProject {
  name: string;
  type: 'original' | 'fanfic';
  worldview?: string;
  protagonistName?: string;
}

export interface TestChapter {
  volume: number;
  chapter: number;
  title: string;
  summary?: string;
}

export interface TestScene {
  order: number;
  title: string;
  type: string;
  summary: string;
}

export interface TestCharacter {
  name: string;
  identity?: string;
  gender?: string;
  age?: string;
}

export function generateProjectName(prefix: string = 'test-project'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

export function generateChapterTitle(volume: number, chapter: number): string {
  return `第${volume}卷第${chapter}章：测试章节`;
}

export function generateSceneTitle(order: number): string {
  return `场景${order}：测试场景`;
}

export function generateCharacterName(prefix: string = '测试角色'): string {
  return `${prefix}${Math.floor(Math.random() * 1000)}`;
}

export function createTestProject(name?: string): TestProject {
  return {
    name: name || generateProjectName(),
    type: 'original',
    worldview: '这是一个测试世界观，包含奇幻元素和修炼体系。',
    protagonistName: generateCharacterName('主角'),
  };
}

export function createTestChapter(volume: number, chapter: number): TestChapter {
  return {
    volume,
    chapter,
    title: generateChapterTitle(volume, chapter),
    summary: `测试章节${chapter}的内容概要`,
  };
}

export function createTestScenes(count: number): TestScene[] {
  const scenes: TestScene[] = [];
  const types = ['action', 'dialogue', 'emotion', 'description', 'transition'];
  
  for (let i = 1; i <= count; i++) {
    scenes.push({
      order: i,
      title: generateSceneTitle(i),
      type: types[(i - 1) % types.length],
      summary: `这是第${i}个测试场景的概要描述，包含场景的主要内容和情节发展。`,
    });
  }
  
  return scenes;
}

export function createTestCharacter(name?: string): TestCharacter {
  const genders = ['男', '女', '未知'];
  return {
    name: name || generateCharacterName(),
    identity: '测试身份',
    gender: genders[Math.floor(Math.random() * genders.length)],
    age: `${Math.floor(Math.random() * 50) + 10}`,
  };
}

export function createTestData(): {
  project: TestProject;
  chapters: TestChapter[];
  scenes: TestScene[];
  characters: TestCharacter[];
} {
  const project = createTestProject();
  const chapters = [
    createTestChapter(1, 1),
    createTestChapter(1, 2),
    createTestChapter(2, 1),
  ];
  const scenes = createTestScenes(5);
  const characters = [
    createTestCharacter('主角'),
    createTestCharacter('配角1'),
    createTestCharacter('反派'),
  ];
  
  return { project, chapters, scenes, characters };
}