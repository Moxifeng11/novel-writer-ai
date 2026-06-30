import { validateFanficSettings } from '../../shared/template-validator';
import { pjFanficDir } from '../../shared/paths';

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
  const base = validateFanficSettings(content);
  const required = ['作品名称', '作品类型', '作者', '世界观类型', '力量体系', '核心规则', '必须遵守的原作规则', '允许改编的范围', '禁止触及的红线'];
  const missing = new Set(base.missingFields);
  const lines = content.split(/\r?\n/);
  for (const key of required) {
    const fmLine = lines.find(line => line.startsWith(`${key}:`));
    const bodyLine = lines.find(line => line.includes(`**${key}**`));
    const fm = fmLine?.replace(`${key}:`, '').trim();
    const body = bodyLine?.replace(new RegExp(`.*\\*\\*${key}\\*\\*[：:]`), '').trim();
    if ((fm !== undefined && !fm) || (body !== undefined && !body)) missing.add(key);
  }
  return { valid: missing.size === 0, missingFields: Array.from(missing) };
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
