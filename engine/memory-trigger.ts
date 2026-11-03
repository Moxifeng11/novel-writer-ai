/**
 * Memory Trigger Engine — V2 Phase 3 记忆触发系统
 *
 * 核心职责：
 * - 管理每个角色的记忆碎片（MemoryShard）
 * - 感官元素匹配：当前场景的感官细节 → 触发相关记忆
 * - 触发记忆文本注入 scene-expander / 正文生成 prompt
 *
 * 数据存储：{project}/02-时间线与伏笔/记忆碎片/{角色名}_记忆碎片.md
 * 格式：YAML frontmatter + 正文描述
 *
 * 匹配策略（启发式）：
 * 1. 感官关键词精确匹配（高权重）
 * 2. 情境模式模糊匹配（中权重）
 * 3. 角色关系上下文加分
 */

import { App, TFile } from 'obsidian';
import { pjMemoryShardsDir } from '@/shared/paths';
import type { Notifier } from '@/shared/types';
import { NOOP_NOTIFIER } from '@/shared/types';
import { FileSystemPort, VaultMetaPort, ObsidianFileSystem, ObsidianVaultMeta } from '@/shared/file-system-port';
import { createLogger } from '@/shared/logger';


const log = createLogger('MemoryTrigger');
/** 记忆碎片 */
export interface MemoryShard {
  /** 唯一标识，如 m001 */
  id: string;
  /** 所属角色名 */
  characterName: string;
  /** 记忆标题 */
  title: string;
  /** 记忆正文 */
  content: string;
  /** 触发感官元素 */
  triggers: SensoryTriggers;
  /** 情绪标签（多个） */
  emotions: string[];
  /** 重要性 1-10（越高越容易触发） */
  importance: number;
  /** 关联关系（如"父亲"、"秦老爷"——触发时匹配在场角色） */
  relatedCharacters: string[];
  /** 发生时间描述（如 "三年前" "童年"） */
  timeContext: string;
  /** 是否已被揭示（已写进正文则为 true，避免重复触发） */
  revealed: boolean;
  /** 已揭示于哪一章 */
  revealedChapter?: string;
}

/** 感官触发元素 */
export interface SensoryTriggers {
  /** 气味（如 "檀香" "血腥味" "桂花香"） */
  smells: string[];
  /** 声音（如 "钟声" "雨声" "剑鸣"） */
  sounds: string[];
  /** 触感（如 "冰冷" "粗糙" "丝滑"） */
  touches: string[];
  /** 视觉场景（如 "黄昏" "瓦房" "墓地"） */
  visuals: string[];
  /** 关键词（对话/叙述中出现的词语触发的记忆） */
  keywords: string[];
}

/** 触发结果 */
export interface TriggeredMemory {
  shard: MemoryShard;
  /** 匹配分数（0-1） */
  score: number;
  /** 匹配原因 */
  reason: string;
}

/** 触发上下文 */
export interface TriggerContext {
  /** 当前场景中的感官元素 */
  sensoryElements: string[];
  /** 当前在场的角色名列表 */
  presentCharacters: string[];
  /** 当前场景地点 */
  location?: string;
  /** 当前章节号 */
  chapterNumber: number;
}

/**
 * 记忆碎片文件路径
 *
 * @param project - 项目（路径或对象）
 * @returns 文本结果
 */
export function getMemoryDir(project: string): string {
  return pjMemoryShardsDir(project);
}

/**
 * 获取角色记忆路径。
 * @param project - 项目（路径或对象）
 * @param characterName - 角色名称
 * @returns 文本结果
 */
export function getCharacterMemoryPath(project: string, characterName: string): string {
  return `${getMemoryDir(project)}/${characterName}_记忆碎片.md`;
}

// === 感官关键词词典 ===
const SENSORY_DICT: Record<string, string[]> = {
  smell: ['香', '臭', '腥', '腐', '甜', '酸', '焦', '烟', '酒', '药', '血', '霉', '花', '草', '檀', '麝', '桂', '兰', '梅', '松', '茶', '奶', '蜜'],
  sound: ['钟', '鼓', '琴', '笛', '箫', '剑', '刀', '风', '雨', '雷', '水', '火', '笑', '哭', '喊', '叫', '叹', '敲', '碎', '裂', '炸', '鸣'],
  touch: ['冷', '热', '冰', '暖', '硬', '软', '粗', '细', '滑', '湿', '干', '粘', '刺', '痒', '麻', '痛', '轻', '重', '柔', '锐', '钝'],
  visual: ['红', '黑', '白', '金', '银', '暗', '亮', '昏', '晨', '夜', '月', '日', '星', '火', '血', '影', '雾', '光', '墓', '殿', '楼', '院', '巷', '街', '桥', '河', '山', '林', '荒', '破', '旧', '新'],
};

/**
 * 从文本中提取感官元素
 *
 * @param text - 文本内容
  * @returns string[] } 结果
 */
export function extractSensoryElements(text: string): { smells: string[]; sounds: string[]; touches: string[]; visuals: string[] } {
  const smells: string[] = [];
  const sounds: string[] = [];
  const touches: string[] = [];
  const visuals: string[] = [];

  for (const kw of SENSORY_DICT.smell) {
    if (text.includes(kw)) smells.push(kw);
  }
  for (const kw of SENSORY_DICT.sound) {
    if (text.includes(kw)) sounds.push(kw);
  }
  for (const kw of SENSORY_DICT.touch) {
    if (text.includes(kw)) touches.push(kw);
  }
  for (const kw of SENSORY_DICT.visual) {
    if (text.includes(kw)) visuals.push(kw);
  }

  return { smells, sounds, touches, visuals };
}

/**
 * 核心匹配函数：从角色记忆库中找出被当前场景触发的记忆
 * @param shards - 分片列表
 * @param context - 上下文
 * @param maxResults - 最大结果列表
 * @returns 结果数组
 */
export function matchMemories(
  shards: MemoryShard[],
  context: TriggerContext,
  maxResults: number = 3,
): TriggeredMemory[] {
  const results: TriggeredMemory[] = [];
  const unrevealed = shards.filter(s => !s.revealed);

  for (const shard of unrevealed) {
    let score = 0;
    const reasons: string[] = [];

    // 1. 感官关键词匹配（高权重：每个匹配 +0.15）
    const allTriggers = [
      ...shard.triggers.smells,
      ...shard.triggers.sounds,
      ...shard.triggers.touches,
      ...shard.triggers.visuals,
      ...shard.triggers.keywords,
    ];

    for (const trigger of allTriggers) {
      for (const elem of context.sensoryElements) {
        if (elem.includes(trigger) || trigger.includes(elem)) {
          score += 0.15;
          reasons.push(`感官「${trigger}」→「${elem}」`);
        }
      }
    }

    // 2. 角色关系加分（每个在场关联角色 +0.1）
    for (const relChar of shard.relatedCharacters) {
      if (context.presentCharacters.includes(relChar)) {
        score += 0.1;
        reasons.push(`关联角色「${relChar}」在场`);
      }
    }

    // 3. 重要性加权
    score *= (shard.importance / 5); // importance 5=基准1.0, 10=2.0

    // 4. 匹配度至少需要 0.3 才触发
    if (score >= 0.3) {
      results.push({
        shard,
        score: Math.min(score, 1.0),
        reason: reasons.join('；'),
      });
    }
  }

  // 按分数降序排列，取 top N
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, maxResults);
}

/**
 * 生成触发记忆的 prompt 文本（用于注入 AI prompt）
 * @param triggered - 是否触发
 * @param protagonistName - 主角名称
 * @returns 文本结果
 */
export function formatTriggeredMemoriesForPrompt(
  triggered: TriggeredMemory[],
  protagonistName: string,
): string {
  if (triggered.length === 0) return '无触发记忆。';

  const lines: string[] = [`${protagonistName}在当下场景中感知到了以下记忆碎片：`];

  for (const t of triggered) {
    const s = t.shard;
    const snippet = s.content.length > 200
      ? s.content.slice(0, 200) + '...'
      : s.content;

    lines.push(`\n■ 记忆 #${s.id}「${s.title}」（匹配: ${t.reason}，得分: ${t.score.toFixed(2)}）`);
    lines.push(`  时间: ${s.timeContext} | 情绪: ${s.emotions.join('、')}`);
    lines.push(`  内容: ${snippet}`);
  }

  return lines.join('\n');
}

/**
 * 读取单个角色的记忆碎片
 * @param app - Obsidian 应用实例
 * @param project - 项目（路径或对象）
 * @param characterName - 角色名称
 * @returns 结果数组
 */
export async function loadCharacterMemories(app: App, project: string, characterName: string): Promise<MemoryShard[]> {
  const path = getCharacterMemoryPath(project, characterName);
  const vaultMeta = new ObsidianVaultMeta(app);
  const fs = new ObsidianFileSystem(app);
  const file = vaultMeta.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) return [];

  try {
    const content = await fs.read(path);
    return parseMemoryFile(content, characterName);
  } catch {
    return [];
  }
}

/**
 * 解析记忆碎片文件
 * @param content - 内容
 * @param characterName - 角色名称
 * @returns 结果数组
 */
function parseMemoryFile(content: string, characterName: string): MemoryShard[] {
  const shards: MemoryShard[] = [];
  const sections = content.split(/^## /gm);

  for (const section of sections) {
    if (!section.trim()) continue;
    const headerMatch = section.match(/^(m\d+)\s+(.+)/);
    if (!headerMatch) continue;

    const id = headerMatch[1];
    const title = headerMatch[2].trim();
    const body = section.slice(headerMatch[0].length).trim();

    // 从正文中解析元数据
    const getTag = (tag: string): string => {
      const m = body.match(new RegExp(`^${tag}:\\s*(.+)$`, 'm'));
      return m ? m[1].trim() : '';
    };
    const getList = (tag: string): string[] => {
      const m = body.match(new RegExp(`^${tag}:\\s*(.+)$`, 'm'));
      return m ? m[1].split(/[,，]/).map(s => s.trim()).filter(Boolean) : [];
    };

    shards.push({
      id,
      characterName,
      title,
      content: body,
      triggers: {
        smells: getList('trigger_smells'),
        sounds: getList('trigger_sounds'),
        touches: getList('trigger_touches'),
        visuals: getList('trigger_visuals'),
        keywords: getList('trigger_keywords'),
      },
      emotions: getList('emotions'),
      importance: parseInt(getTag('importance')) || 5,
      relatedCharacters: getList('related_characters'),
      timeContext: getTag('time_context') || '',
      revealed: body.includes('revealed: true'),
      revealedChapter: getTag('revealed_chapter') || undefined,
    });
  }

  return shards;
}

/**
 * 读取项目中所有角色的记忆碎片（用于场景扩展注入）
 * @param app - Obsidian 应用实例
 * @param project - 项目（路径或对象）
 * @param presentCharacters - 出场角色
 * @param protagonistName - 主角名称
 * @returns 结果数组
 */
export async function loadAllMemories(app: App, project: string, presentCharacters: string[], protagonistName: string): Promise<MemoryShard[]> {
  const allShards: MemoryShard[] = [];
  for (const charName of presentCharacters) {
    const shards = await loadCharacterMemories(app, project, charName);
    allShards.push(...shards);
  }
  return allShards;
}

/**
 * 完整触发流程：加载 → 提取感官 → 匹配 → 格式化
 * @param app - Obsidian 应用实例
 * @param project - 项目（路径或对象）
 * @param sceneText - 场景文本
 * @param presentCharacters - 出场角色
 * @param protagonistName - 主角名称
 * @param chapterNumber - 章号
 * @param location - 地点
  * @returns string }> 结果
 */
export async function gatherTriggeredMemories(
  app: App,
  project: string,
  sceneText: string,
  presentCharacters: string[],
  protagonistName: string,
  chapterNumber: number,
  location?: string,
): Promise<{ triggered: TriggeredMemory[]; promptText: string }> {
  // 1. 加载所有在场角色的记忆
  const allShards = await loadAllMemories(app, project, presentCharacters, protagonistName);
  if (allShards.length === 0) {
    return { triggered: [], promptText: '无触发记忆。' };
  }

  // 2. 从场景文本中提取感官元素
  const sensory = extractSensoryElements(sceneText);
  const context: TriggerContext = {
    sensoryElements: [...sensory.smells, ...sensory.sounds, ...sensory.touches, ...sensory.visuals],
    presentCharacters,
    location,
    chapterNumber,
  };

  // 3. 匹配
  const triggered = matchMemories(allShards, context);

  // 4. 格式化
  const promptText = formatTriggeredMemoriesForPrompt(triggered, protagonistName);

  return { triggered, promptText };
}

/**
 * 标记记忆为已揭示
 * @param app - Obsidian 应用实例
 * @param project - 项目（路径或对象）
 * @param characterName - 角色名称
 * @param memoryId - 记忆ID
 * @param chapterNumber - 章号
 * @param notifier - 通知器
 */
export async function markMemoryRevealed(
  app: App,
  project: string,
  characterName: string,
  memoryId: string,
  chapterNumber: string,
  notifier: Notifier = NOOP_NOTIFIER,
): Promise<void> {
  const path = getCharacterMemoryPath(project, characterName);
  const vaultMeta = new ObsidianVaultMeta(app);
  const fs = new ObsidianFileSystem(app);
  const file = vaultMeta.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) return;

  try {
    const content = await fs.read(path);
    const replaced = content.replace(
      new RegExp(`^## ${memoryId} ([\\s\\S]*?)(?=^## |$)`, 'm'),
      (match) => `${match}
revealed: true
revealed_chapter: ${chapterNumber}`,
    );
    await fs.write(path, replaced);
    notifier.showNotice(`📝 记忆碎片 ${memoryId} 已标记为在第 ${chapterNumber} 章揭示`);
  } catch (e) {
    log.warn(`[MemoryTrigger] 标记记忆 ${memoryId} 失败:`, e);
  }
}
