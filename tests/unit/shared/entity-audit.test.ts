import { describe, it, expect } from 'vitest';
import { App, TFile } from 'obsidian';
import { auditEntityFiles, overwriteEntityIfComplete } from '../../../shared/entity-audit';
import { pjCharFile } from '../../../shared/paths';

interface SeedableVault {
    _seedFile(path: string, content: string): TFile;
}

const PROJECT = '审计项目';

function seed(app: App, path: string, content: string): void {
    (app.vault as unknown as SeedableVault)._seedFile(path, content);
}

function completeCharacter(name: string): string {
    return `---
tags: [人物]
姓名: "${name}"
年龄: "二十"
身份: "主角"
人物背景: "出身寒门，幼年失怙。"
外貌特征: "青衫长剑"
当前目标: "复仇"
核心动机: "活下去"
核心驱动力_软肋: "妹妹"
习惯性小动作: "摸刀柄"
当前状态: "受伤"
当前情绪: "冷静"
性格标签: "隐忍"
金手指/特殊能力: "读心"
功法/技能树: "刀法"
所属势力: "青云宗"
entity_status: active
entity_created_at: "第1章"
性格三层:
  表层_面具: "温和"
  中层_真实: "警惕"
  深层_内核: "偏执"
角色弧光:
  起点状态: "逃避"
  成长触发点: "妹妹失踪"
  终点状态: "担当"
  弧光类型: "成长弧"
character_core:
  desire: "守护"
  fear: "失去"
  obsession: "复仇"
  shame: "逃跑"
  trauma: "灭门"
  weakness: "妹妹"
  soft_spot: "孤儿"
  rage_trigger: "提到灭门"
  moral_boundary: "不杀无辜"
---
# ${name}
## 确定性设定
- 外貌：青衫
## 不确定性
- 内心矛盾：复仇与守护
## 关系网
- [[阿宁]]：妹妹
## 自信息事件储备
- 可能做出的出人意料举动：放过仇人
## 功法/技能
- 修为：筑基
## 灵魂层
- desire：守护
## 变更记录
- 第1章 | 初次登场`;
}

const STUB = `---
tags: [人物]
名称: 季云归
---

# 季云归
`;

describe('auditEntityFiles（存量实体完整性审计）', () => {
    it('识别只有 frontmatter 的空壳人物卡', async () => {
        const app = new App();
        seed(app, pjCharFile(PROJECT, '季云归'), STUB);

        const incomplete = await auditEntityFiles(app, PROJECT);

        expect(incomplete).toHaveLength(1);
        expect(incomplete[0].kind).toBe('characters');
        expect(incomplete[0].name).toBe('季云归');
        expect(incomplete[0].missingFields.length).toBeGreaterThan(0);
    });

    it('完整人物卡不计入，模板文件被跳过', async () => {
        const app = new App();
        seed(app, pjCharFile(PROJECT, '沈砚'), completeCharacter('沈砚'));
        seed(app, pjCharFile(PROJECT, '人物模板'), STUB);

        const incomplete = await auditEntityFiles(app, PROJECT);

        expect(incomplete).toHaveLength(0);
    });
});

describe('overwriteEntityIfComplete（复检后原地覆写）', () => {
    it('补全结果仍不完整时拒绝写回，原文件保持不变', async () => {
        const app = new App();
        const path = pjCharFile(PROJECT, '季云归');
        seed(app, path, STUB);
        const [item] = await auditEntityFiles(app, PROJECT);

        const result = await overwriteEntityIfComplete(app, item, STUB);

        expect(result.ok).toBe(false);
        expect(result.missingFields.length).toBeGreaterThan(0);
        const file = app.vault.getAbstractFileByPath(path) as TFile;
        expect(await app.vault.read(file)).toBe(STUB);
    });

    it('补全结果完整时原地覆写，不产生同名副本', async () => {
        const app = new App();
        const path = pjCharFile(PROJECT, '季云归');
        seed(app, path, STUB);
        const [item] = await auditEntityFiles(app, PROJECT);

        const result = await overwriteEntityIfComplete(app, item, completeCharacter('季云归'));

        expect(result.ok).toBe(true);
        const charFiles = app.vault.getFiles().filter(f => f.path.includes('/人物/'));
        expect(charFiles).toHaveLength(1);
        const file = app.vault.getAbstractFileByPath(path) as TFile;
        expect(await app.vault.read(file)).toContain('角色弧光');
    });
});
