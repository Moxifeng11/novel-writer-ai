import { describe, expect, it, vi } from 'vitest';
import type { App } from 'obsidian';
import { Vault } from 'obsidian';
import {
  buildFanficSettingsContent,
  extractFanficWorkName,
  getFanficSettingsPath,
  isFanficSettingsContentValidEnough,
  saveFanficSettingFile,
  type FanficSettingsValues,
} from '../../../ui/full-writer/fanfic-settings-utils';
import { validateFanficSettings } from '../../../shared/template-validator';
import { extractFanficRuleValue, formatFanficRulesForPrompt, parseFanficRules } from '../../../shared/fanfic-rules';

const completeValues: FanficSettingsValues = {
  workName: '星尘学院',
  workType: '学院奇幻',
  author: '测试作者',
  worldviewType: '星术学院',
  powerSystem: '星图观测、星尘回路、禁忌观测',
  coreRules: '能力来自星图共鸣，越界观测会造成记忆污染。',
  mustFollow: '星术能力不能凭空出现，所有能力必须与星图观测有关。',
  adaptScope: '可以新增支线角色、边缘学院事件和未展开的星图派系。',
  redlines: '不能改写原作主角结局，不能让学院体系崩塌。',
};

describe('fanfic-settings-utils', () => {
  it('builds valid fanfic settings content from required fields', () => {
    const content = buildFanficSettingsContent(completeValues);

    expect(content).toContain('作品名称: 星尘学院');
    expect(content).toContain('作品类型: 学院奇幻');
    expect(content).toContain('作者: 测试作者');
    expect(content).toContain('- **世界观类型**：星术学院');
    expect(content).toContain('- **必须遵守的原作规则**：星术能力不能凭空出现');
    expect(isFanficSettingsContentValidEnough(content).valid).toBe(true);
  });

  it('extracts work name and builds project settings path', () => {
    const content = buildFanficSettingsContent(completeValues);

    expect(extractFanficWorkName(content, '备用项目')).toBe('星尘学院');
    expect(getFanficSettingsPath('测试项目', content, '备用项目')).toBe('测试项目/05-同人设定库/星尘学院设定.md');
  });

  it('rejects missing required fanfic fields', () => {
    const content = buildFanficSettingsContent({ ...completeValues, coreRules: '', redlines: '' });
    const result = isFanficSettingsContentValidEnough(content);

    expect(result.valid).toBe(false);
    expect(result.missingFields).toContain('核心规则');
    expect(result.missingFields).toContain('禁止触及的红线');
  });

  it('生成 → 校验 → 解析 → 注入 全链路可用', () => {
    const content = buildFanficSettingsContent(completeValues);

    // 向导表单只收集 9 个字段，保存前校验与 .project 步骤回读必须同为「向导口径」
    expect(isFanficSettingsContentValidEnough(content).valid).toBe(true);

    const rules = parseFanficRules(content, 'p');
    expect(rules.workName).toBe('星尘学院');
    expect(rules.mustFollow).toContain('星图观测');
    expect(rules.adaptScope).toContain('支线角色');
    expect(rules.redlines).toContain('主角结局');

    const prompt = formatFanficRulesForPrompt(rules);
    expect(prompt).toContain('【同人创作约束（最高优先级，违反即返工）】');
    expect(prompt).toContain('禁止触及的红线：不能改写原作主角结局');
  });

  it('从正文回填三条创作规则（生成后再次进入向导不丢字段）', () => {
    const content = buildFanficSettingsContent(completeValues);

    expect(extractFanficRuleValue(content, '必须遵守的原作规则')).toBe(completeValues.mustFollow);
    expect(extractFanficRuleValue(content, '允许改编的范围')).toBe(completeValues.adaptScope);
    expect(extractFanficRuleValue(content, '禁止触及的红线')).toBe(completeValues.redlines);
  });

  it('生成骨架包含原作主要人物/势力组织，占位不会被当成真实人物注入', () => {
    const content = buildFanficSettingsContent(completeValues);

    expect(content).toContain('## 主要人物');
    expect(content).toContain('## 势力组织');
    // 骨架的时间线仍是占位行，严格口径（AI 落盘前）不通过；向导口径只要求 9 个字段
    expect(isFanficSettingsContentValidEnough(content).valid).toBe(true);

    // 占位「（待补充）」必须被解析器忽略，否则 prompt 里会出现一个叫「（待补充）」的原作角色
    const rules = parseFanficRules(content, 'p');
    expect(rules.characters).toEqual([]);
    expect(formatFanficRulesForPrompt(rules)).not.toContain('【原作主要人物】');
  });

  it('保留手写文件的多行规则续行', () => {
    const content = [
      '## 创作规则',
      '- **必须遵守的原作规则**：尊重原作战力体系；',
      '  不得让主角越过境界壁垒。',
      '- **允许改编的范围**：可以新增支线。',
      '',
      '- **禁止触及的红线**：不能改写结局。',
    ].join('\n');

    expect(extractFanficRuleValue(content, '必须遵守的原作规则'))
      .toBe('尊重原作战力体系；\n不得让主角越过境界壁垒。');
    expect(extractFanficRuleValue(content, '允许改编的范围')).toBe('可以新增支线。');
  });

  it('遇到下一条规则/标题/空行即停止，不吞并后文', () => {
    const content = [
      '- **必须遵守的原作规则**：第一条',
      '## 原作剧情时间线',
      '| 时间节点 | 原作事件 |',
    ].join('\n');
    expect(extractFanficRuleValue(content, '必须遵守的原作规则')).toBe('第一条');

    const blankLine = '- **禁止触及的红线**：不能改写结局。\n\n后续正文';
    expect(extractFanficRuleValue(blankLine, '禁止触及的红线')).toBe('不能改写结局。');
  });

  it('规则缺失时返回空字符串', () => {
    expect(extractFanficRuleValue('', '必须遵守的原作规则')).toBe('');
    expect(extractFanficRuleValue('# 空文件', '必须遵守的原作规则')).toBe('');
  });

  it('全占位骨架不算有效同人设定（AI 原样回显骨架时不得提示已保存）', () => {
    const placeholder = '（待补充）';
    const content = buildFanficSettingsContent({
      workName: placeholder,
      workType: placeholder,
      author: placeholder,
      worldviewType: placeholder,
      powerSystem: placeholder,
      coreRules: placeholder,
      mustFollow: placeholder,
      adaptScope: placeholder,
      redlines: placeholder,
    });

    const strict = validateFanficSettings(content);
    expect(strict.valid).toBe(false);
    expect(strict.missingFields).toEqual(
      expect.arrayContaining(['frontmatter.作品名称', '核心规则', '必须遵守的原作规则'])
    );
    // 绑定/向导同一口径：占位字段不是内容，不得提示「✅ 已保存并绑定」
    expect(isFanficSettingsContentValidEnough(content).valid).toBe(false);
  });

  it('时间线只有占位行时不算数据行', () => {
    const content = buildFanficSettingsContent(completeValues);
    const strict = validateFanficSettings(content);

    expect(strict.valid).toBe(false);
    expect(strict.missingFields).toContain('原作剧情时间线(需要至少1行真实数据)');
    expect(strict.missingFields).toContain('故事背景时间线(需要至少1行真实数据)');
    // 向导表单不收集时间线：保存与步骤回读仍按「向导口径」通过
    expect(isFanficSettingsContentValidEnough(content).valid).toBe(true);
  });

  it('两张时间线各有真实数据行时严格校验通过', () => {
    const content = buildFanficSettingsContent(completeValues)
      .replace('| 待补充 | 待补充 | 待补充 | 待补充 | 待补充 |', '| 开篇 | 主角觉醒 | 主角 | 第1章 | 提前相遇 |')
      .replace('| 待补充 | 待补充 | 待补充 | 待补充 |', '| 第一年 | 加入组织 | 开篇 | 主角、配角 |');

    expect(validateFanficSettings(content).valid).toBe(true);
    expect(isFanficSettingsContentValidEnough(content).valid).toBe(true);
  });

  it('引号包裹的占位同样不算填写', () => {
    const content = buildFanficSettingsContent(completeValues)
      .replace('作品名称: 星尘学院', '作品名称: "（待补充）"');

    expect(validateFanficSettings(content).missingFields).toContain('frontmatter.作品名称');
  });

});

describe('saveFanficSettingFile', () => {
  const SETTING_PATH = '测试项目/05-同人设定库/星尘学院设定.md';
  // 测试辅助方法只存在于 mock Vault 上，类型用交叉声明补出来
  type TestVault = Vault & {
    _seedFile(path: string, content: string): unknown;
    readByPath(path: string): Promise<string>;
  };

  function makeApp(): { app: App; vault: TestVault } {
    const vault = new Vault() as TestVault;
    return { app: { vault } as unknown as App, vault };
  }

  it('覆盖已有设定走 modify，不删除文件（避免中间态丢设定）', async () => {
    const { app, vault } = makeApp();
    vault._seedFile(SETTING_PATH, '旧设定');
    const deleteSpy = vi.spyOn(vault, 'delete');

    await saveFanficSettingFile(app, SETTING_PATH, '新设定');

    expect(deleteSpy).not.toHaveBeenCalled();
    expect(await vault.readByPath(SETTING_PATH)).toBe('新设定');
  });

  it('文件不存在时创建', async () => {
    const { app, vault } = makeApp();

    await saveFanficSettingFile(app, SETTING_PATH, '新设定');

    expect(await vault.readByPath(SETTING_PATH)).toBe('新设定');
  });
});
