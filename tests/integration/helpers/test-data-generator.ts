

export interface CharacterData {
  name: string;
  role: string;
  identity?: string;
  gender?: string;
  age?: string;
  background?: string;
  personality?: string;
  ability?: string;
  faction?: string;
  cultivationLevel?: string;
}

export interface LocationData {
  name: string;
  type: string;
  description?: string;
  geography?: string;
  inhabitants?: string;
  importance?: string;
}

export interface FactionData {
  name: string;
  type: string;
  leader?: string;
  description?: string;
  rank?: string;
}

export interface ItemData {
  name: string;
  type: string;
  grade?: string;
  description?: string;
  effect?: string;
  owner?: string;
}

export interface ChapterData {
  volume: number;
  chapter: number;
  title: string;
  content: string;
  wordCount?: number;
}

export interface WorldviewData {
  worldName: string;
  genre: string;
  description: string;
  cultivationSystem?: string;
  geography?: string;
  history?: string;
}

export function generateWorldviewMarkdown(data: WorldviewData): string {
  return `---
title: ${data.worldName}
genre: ${data.genre}
worldType: 原生世界
---

# ${data.worldName}

## 世界概述
${data.description}

## 修炼体系
${data.cultivationSystem || '暂无详细设定'}

## 地理环境
${data.geography || '暂无详细设定'}

## 历史沿革
${data.history || '暂无详细设定'}
`;
}

export function generateCharacterMarkdown(char: CharacterData): string {
  return `---
name: ${char.name}
姓名: ${char.name}
role: ${char.role}
身份: ${char.identity || ''}
性别: ${char.gender || ''}
年龄: ${char.age || ''}
所属势力: ${char.faction || ''}
修为等级: ${char.cultivationLevel || ''}
性格标签: ${char.personality || ''}
金手指/特殊能力: ${char.ability || ''}
人物背景: ${char.background || ''}
---

# ${char.name}

## 身份背景
${char.background || `${char.name}是${char.role}。`}

## 外貌特征
待补充

## 性格特点
${char.personality || '待补充'}

## 能力设定
${char.ability || '待补充'}

## 人物关系
待补充
`;
}

export function generateLocationMarkdown(loc: LocationData): string {
  return `---
名称: ${loc.name}
类型: ${loc.type}
描述: ${loc.description || ''}
地理特征: ${loc.geography || ''}
主要居民/势力: ${loc.inhabitants || ''}
重要程度: ${loc.importance || '普通'}
---

# ${loc.name}

## 基本信息
${loc.description || `${loc.name}是一个${loc.type}。`}

## 地理环境
${loc.geography || '待补充'}

## 历史背景
待补充

## 相关事件
待补充
`;
}

export function generateFactionMarkdown(faction: FactionData): string {
  return `---
名称: ${faction.name}
类型: ${faction.type}
领袖: ${faction.leader || ''}
描述: ${faction.description || ''}
地位/排名: ${faction.rank || ''}
---

# ${faction.name}

## 基本信息
${faction.description || `${faction.name}是一个${faction.type}势力。`}

## 组织架构
待补充

## 势力范围
待补充

## 重要成员
${faction.leader ? `- ${faction.leader}（领袖）` : '待补充'}
`;
}

export function generateItemMarkdown(item: ItemData): string {
  return `---
名称: ${item.name}
类型: ${item.type}
品阶/等级: ${item.grade || ''}
描述: ${item.description || ''}
效果: ${item.effect || ''}
所属/归属: ${item.owner || ''}
---

# ${item.name}

## 基本描述
${item.description || `${item.name}是一件${item.type}。`}

## 外观特征
待补充

## 能力效果
${item.effect || '待补充'}

## 历史渊源
待补充
`;
}

export function generateChapterMarkdown(chapter: ChapterData): string {
  const wordCount = chapter.wordCount || chapter.content.length;
  return `---
title: ${chapter.title}
chapterNumber: ${chapter.chapter}
volume: ${chapter.volume}
wordCount: ${wordCount}
---

# ${chapter.title}

${chapter.content}
`;
}

export function generateVolumeOutlineMarkdown(
  volume: number,
  title: string,
  chapters: Array<{ number: number; title: string; summary: string }>
): string {
  const chaptersList = chapters
    .map(c => `### 第${c.number}章：${c.title}\n${c.summary}`)
    .join('\n\n');

  return `---
volume: ${volume}
title: ${title}
chapterCount: ${chapters.length}
---

# 第${volume}卷：${title}

## 卷概述
本卷讲述了主角的成长历程。

## 章节列表

${chaptersList}
`;
}

export function generateLongText(baseText: string, targetLength: number): string {
  let result = baseText;
  while (result.length < targetLength) {
    result += '\n\n' + baseText;
  }
  return result.slice(0, targetLength);
}

export function generateRandomName(prefix: string, index: number): string {
  const suffixes = ['明', '华', '强', '芳', '静', '杰', '敏', '伟', '丽', '军'];
  const suffix = suffixes[index % suffixes.length];
  return `${prefix}${suffix}`;
}

export function generateBatchCharacters(count: number, baseRole: string = '配角'): CharacterData[] {
  const chars: CharacterData[] = [];
  for (let i = 0; i < count; i++) {
    chars.push({
      name: generateRandomName('角色', i),
      role: i === 0 ? '主角' : baseRole,
      identity: `${baseRole}${i + 1}号`,
      gender: i % 2 === 0 ? '男' : '女',
      age: `${20 + i}岁`,
      background: `这是第${i + 1}个${baseRole}的背景故事。`,
      personality: i % 2 === 0 ? '冷静沉稳' : '热情开朗',
      ability: `技能${i + 1}`,
    });
  }
  return chars;
}

export function generateBatchLocations(count: number): LocationData[] {
  const locs: LocationData[] = [];
  const types = ['城市', '山脉', '河流', '森林', '秘境', '宗门'];
  for (let i = 0; i < count; i++) {
    locs.push({
      name: `地点${i + 1}`,
      type: types[i % types.length],
      description: `这是第${i + 1}个地点的描述。`,
      importance: i < 3 ? '重要' : '普通',
    });
  }
  return locs;
}
