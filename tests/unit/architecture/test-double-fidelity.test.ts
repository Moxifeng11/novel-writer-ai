/**
 * 测试替身忠实性契约（架构约束测试）
 *
 * 真实事故（2026-11-12 对抗性审查）：
 * `tests/__mocks__/obsidian.ts` 的 `getAbstractFileByPath` 对点文件也返回 TFile，
 * 而真实 Obsidian 不把点文件纳入 vault 索引。于是
 * `readFanficRules` 用 `getAbstractFileByPath('.project')` 读同人元数据、
 * 永远拿到 null → 同人约束全线静默失效，**测试却全绿**。
 *
 * `check:test-standard` 只能校验 mock 里有没有守卫标记；本文件校验**行为**：
 * 就算有人把标记注释留下、把行为改回去，这里也会红。
 *
 * 配套标准：docs/handbook/05-testing.md「测试替身忠实性」。
 */

import { describe, expect, it } from 'vitest';
import type { App, TFile } from 'obsidian';
import { Vault } from 'obsidian';
import { pjProjectMeta, readProjectMeta, writeProjectMeta } from '../../../shared/paths';
import { readFanficRules } from '../../../shared/fanfic-rules';

type SeedableVault = Vault & {
    _seedFile(path: string, content: string): TFile;
};

const PROJECT = '测试项目';
const DOT_PATH = `${PROJECT}/.project`;
const FANFIC_PATH = `${PROJECT}/05-同人设定库/测试同人.md`;

const FANFIC_CONTENT = `---
作品名称: 测试同人
---

## 原作核心设定
- **世界观类型**：都市异能
- **力量体系**：灵气
- **核心规则**：历史主线不可改

## 创作规则
- **必须遵守的原作规则**：主线事件不变
- **允许改编的范围**：支线人物关系
- **禁止触及的红线**：主要角色死亡
`;

function makeApp(): { app: App; vault: SeedableVault } {
    const vault = new Vault() as SeedableVault;
    return { app: { vault } as unknown as App, vault };
}

describe('测试替身忠实性 — vault 索引语义', () => {
    it('点文件不进入 vault 索引：getAbstractFileByPath 返回 null（即使已落盘）', () => {
        const { app, vault } = makeApp();
        vault._seedFile(DOT_PATH, '# 测试项目\n');
        expect(app.vault.getAbstractFileByPath(DOT_PATH)).toBeNull();
    });

    it('普通文件正常可索引（守卫不能误伤）', () => {
        const { app, vault } = makeApp();
        vault._seedFile(FANFIC_PATH, FANFIC_CONTENT);
        expect(app.vault.getAbstractFileByPath(FANFIC_PATH)).not.toBeNull();
    });

    it('点文件必须走 adapter 才能读（readProjectMeta 契约）', async () => {
        const { app, vault } = makeApp();
        vault._seedFile(DOT_PATH, '# 测试项目\n\n## 类型\nfanfic\n');
        expect(await readProjectMeta(app, PROJECT)).toContain('fanfic');
    });

    it('readProjectMeta 对不存在的项目返回 null（区分「不存在」）', async () => {
        const { app } = makeApp();
        expect(await readProjectMeta(app, PROJECT)).toBeNull();
    });

    it('writeProjectMeta 能写点文件，且写完可读回', async () => {
        const { app } = makeApp();
        expect(await writeProjectMeta(app, PROJECT, '# 新项目\n')).toBe(true);
        expect(await readProjectMeta(app, PROJECT)).toBe('# 新项目\n');
    });
});

describe('测试替身忠实性 — 回归锁定（同人约束链路）', () => {
    it('同人项目的 readFanficRules 能真正读到约束（曾经永远返回空规则）', async () => {
        const { app, vault } = makeApp();
        vault._seedFile(DOT_PATH, `# ${PROJECT}\n\n## 类型\nfanfic\n\n## 同人设定路径\n${FANFIC_PATH}\n`);
        vault._seedFile(FANFIC_PATH, FANFIC_CONTENT);

        const rules = await readFanficRules(app, PROJECT);

        expect(rules.isFanfic).toBe(true);
        expect(rules.workName).toBe('测试同人');
        expect(rules.redlines).toContain('主要角色死亡');
    });

    it('原创项目仍返回非同类规则（守卫不破坏正常判断）', async () => {
        const { app, vault } = makeApp();
        vault._seedFile(DOT_PATH, `# ${PROJECT}\n\n## 类型\noriginal\n`);

        const rules = await readFanficRules(app, PROJECT);

        expect(rules.isFanfic).toBe(false);
    });
});
