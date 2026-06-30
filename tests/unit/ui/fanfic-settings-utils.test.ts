import { describe, expect, it } from 'vitest';
import {
  buildFanficSettingsContent,
  extractFanficWorkName,
  getFanficSettingsPath,
  isFanficSettingsContentValidEnough,
  type FanficSettingsValues,
} from '../../../ui/full-writer/fanfic-settings-utils';

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
});
