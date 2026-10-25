import { App, TFile } from 'obsidian';
import { isFanficValueFilled, validateFanficSettings } from '../../shared/template-validator';
import { pjFanficDir, pjProjectMeta } from '../../shared/paths';

export interface FanficSettingsValues {
  workName: string;
  workType: string;
  author: string;
  worldviewType: string;
  powerSystem: string;
  coreRules: string;
  mustFollow: string;
  adaptScope: string;
  redlines: string;
}

export function buildFanficSettingsContent(values: FanficSettingsValues): string {
  return `---
作品名称: ${values.workName.trim()}
作品类型: ${values.workType.trim()}
作者: ${values.author.trim()}
世界观类型: ${values.worldviewType.trim()}
力量体系: ${values.powerSystem.trim()}
核心规则: ${values.coreRules.trim()}
---

# ${values.workName.trim()} 同人设定

## 原作核心设定
- **世界观类型**：${values.worldviewType.trim()}
- **力量体系**：${values.powerSystem.trim()}
- **核心规则**：${values.coreRules.trim()}

## 主要人物
- **人物名**：（待补充）
  - **原作定位**：（待补充）
  - **在同人中的变化**：（待补充）

## 势力组织
- **势力名**：（待补充）
  - **原作定位**：（待补充）
  - **在同人中的变化**：（待补充）

## 创作规则
- **必须遵守的原作规则**：${values.mustFollow.trim()}
- **允许改编的范围**：${values.adaptScope.trim()}
- **禁止触及的红线**：${values.redlines.trim()}

## 原作剧情时间线
| 时间节点 | 原作事件 | 涉及人物 | 章节参考 | 你的同人如何切入 |
|---------|---------|---------|---------|----------------|
| 待补充 | 待补充 | 待补充 | 待补充 | 待补充 |

## 故事背景时间线（你的同人）
| 你的时间节点 | 你的事件 | 对应原作时间 | 涉及人物 |
|------------|---------|------------|---------|
| 待补充 | 待补充 | 待补充 | 待补充 |
`;
}

export function extractFanficWorkName(content: string, fallbackProject: string): string {
  const fm = content.match(/^作品名称:\s*(.+)$/m)?.[1]?.trim();
  const heading = content.match(/^#\s*(.+?)\s*同人设定\s*$/m)?.[1]?.trim();
  return sanitizeFilePart(fm || heading || fallbackProject);
}

export function getFanficSettingsPath(project: string, content: string, fallbackProject: string): string {
  return `${pjFanficDir(project)}/${extractFanficWorkName(content, fallbackProject)}设定.md`;
}

export function isFanficSettingsContentValidEnough(content: string) {
  // 向导口径：表单只收集 9 个字段，时间线由用户后续在设定文件里补；
  // 但占位「（待补充）」不是内容，否则绑定/保存都会误报「✅ 已…」。
  const base = validateFanficSettings(content, { requireTimelineData: false });
  const required = ['作品名称', '作品类型', '作者', '世界观类型', '力量体系', '核心规则', '必须遵守的原作规则', '允许改编的范围', '禁止触及的红线'];
  const missing = new Set(base.missingFields);
  const lines = content.split(/\r?\n/);
  for (const key of required) {
    const fmLine = lines.find(line => line.startsWith(`${key}:`));
    const bodyLine = lines.find(line => line.includes(`**${key}**`));
    const fm = fmLine?.replace(`${key}:`, '').trim();
    const body = bodyLine?.replace(new RegExp(`.*\\*\\*${key}\\*\\*[：:]`), '').trim();
    if ((fm !== undefined && !isFanficValueFilled(fm)) || (body !== undefined && !isFanficValueFilled(body))) missing.add(key);
  }
  return { valid: missing.size === 0, missingFields: Array.from(missing) };
}

/**
 * 把同人设定文件路径回写到项目 `.project` 的「## 同人设定路径」段。
 * 向导内保存同人设定时调用，保证重新进入向导后能按同一路径恢复。
 */
export async function attachFanficPathToProject(app: App, project: string, filePath: string): Promise<void> {
  const dotPath = pjProjectMeta(project);
  const section = `## 同人设定路径\n${filePath}`;
  const file = app.vault.getAbstractFileByPath(dotPath);
  if (file instanceof TFile) {
    const raw = await app.vault.read(file);
    const next = /^##\s*同人设定路径\s*$/m.test(raw)
      ? raw.replace(/^##\s*同人设定路径\s*\r?\n[^\n]*/m, section)
      : `${raw.trimEnd()}\n\n${section}\n`;
    if (next !== raw) await app.vault.modify(file, next);
    return;
  }
  await app.vault.create(dotPath, `# ${project}\n\n## 类型\nfanfic\n\n${section}\n`);
}

/**
 * 覆盖保存同人设定文件。
 * 必须对已存在文件走 modify：delete + create 的中间态一旦失败（权限/磁盘/路径竞态），
 * 旧设定已删除、新文件未创建，而 `.project` 仍指向该路径 → 同人约束静默全部失效。
 */
export async function saveFanficSettingFile(app: App, filePath: string, content: string): Promise<void> {
  const existing = app.vault.getAbstractFileByPath(filePath);
  if (existing instanceof TFile) {
    await app.vault.modify(existing, content);
    return;
  }
  await app.vault.create(filePath, content);
}

export function missingFanficValueLabels(values: FanficSettingsValues): string[] {
  const entries: Array<[keyof FanficSettingsValues, string]> = [
    ['workName', '作品名称'],
    ['workType', '作品类型'],
    ['author', '作者'],
    ['worldviewType', '世界观类型'],
    ['powerSystem', '力量体系'],
    ['coreRules', '核心规则'],
    ['mustFollow', '必须遵守的原作规则'],
    ['adaptScope', '允许改编的范围'],
    ['redlines', '禁止触及的红线'],
  ];
  return entries.filter(([key]) => !values[key].trim()).map(([, label]) => label);
}

function sanitizeFilePart(value: string): string {
  return value.replace(/[\\/:*?"<>|]/g, '').trim() || '同人设定';
}
