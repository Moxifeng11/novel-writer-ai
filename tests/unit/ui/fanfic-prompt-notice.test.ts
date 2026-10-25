import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 实体生成（人物/势力/地点/物品/统一实体/AI 建卡）此前直接
 * `formatFanficRulesForPrompt(await readFanficRules(...))`：同人设定缺失、路径未绑定、
 * 或文件只有「（待补充）」骨架时，返回空串且没有任何提示，
 * 用户以为「同人项目生成的人物一定受原作约束」，实际完全脱离原作体系。
 * 这里锁定统一入口「读约束块 + 失效提示」的行为。
 */
const noticeLog = vi.hoisted(() => [] as Array<{ message: string; timeout?: number }>);

vi.mock('obsidian', async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>();
    class Notice {
        message: string;
        timeout?: number;
        constructor(message: string, timeout?: number) {
            this.message = message;
            this.timeout = timeout;
            noticeLog.push({ message, timeout });
        }
        setMessage(): this {
            return this;
        }
        hide(): void {}
    }
    return { ...actual, Notice };
});

import type { App } from 'obsidian';
import { Vault } from 'obsidian';
import { pjProjectMeta } from '../../../shared/paths';
import { readFanficPromptBlockWithNotice } from '../../../ui/fanfic-prompt-notice';

type TestVault = Vault & { write(path: string, content: string): Promise<void> };

const PROJECT = '书甲';
const FANFIC_PATH = `${PROJECT}/05-同人设定库/星尘学院设定.md`;

function makeApp(): App {
    return { vault: new Vault() as TestVault } as unknown as App;
}

async function seedFanfic(app: App, settingBody: string): Promise<void> {
    const vault = app.vault as TestVault;
    await vault.write(
        pjProjectMeta(PROJECT),
        `# ${PROJECT}\n\n## 类型\nfanfic\n\n## 同人设定路径\n${FANFIC_PATH}\n`
    );
    await vault.write(FANFIC_PATH, settingBody);
}

const VALID_CONTENT = `# 星尘学院 同人设定

## 原作核心设定
- **世界观类型**：学院奇幻
- **力量体系**：星图观测

## 创作规则
- **必须遵守的原作规则**：能力必须与星图有关。
`;

const PLACEHOLDER_CONTENT = `# 星尘学院 同人设定

## 原作核心设定
- **世界观类型**：（待补充）
- **力量体系**：待补充
- **核心规则**：(待补充)

## 创作规则
- **必须遵守的原作规则**：（待补充）
- **禁止触及的红线**：（待补充）
`;

describe('readFanficPromptBlockWithNotice', () => {
    beforeEach(() => {
        noticeLog.length = 0;
    });

    it('设定有效时返回约束块且不提示', async () => {
        const app = makeApp();
        await seedFanfic(app, VALID_CONTENT);

        const block = await readFanficPromptBlockWithNotice(app, PROJECT);

        expect(block).toContain('【同人创作约束');
        expect(block).toContain('星图观测');
        expect(noticeLog).toHaveLength(0);
    });

    it('文件只有骨架占位时返回空块并提示没有可用内容', async () => {
        const app = makeApp();
        await seedFanfic(app, PLACEHOLDER_CONTENT);

        const block = await readFanficPromptBlockWithNotice(app, PROJECT);

        expect(block).toBe('');
        expect(noticeLog).toHaveLength(1);
        expect(noticeLog[0].message).toContain('没有可用内容');
        expect(noticeLog[0].message).toContain(FANFIC_PATH);
        expect(noticeLog[0].timeout).toBe(8000);
    });

    it('未绑定设定路径时返回空块并提示去绑定', async () => {
        const app = makeApp();
        await (app.vault as TestVault).write(pjProjectMeta(PROJECT), `# ${PROJECT}\n\n## 类型\nfanfic\n`);

        const block = await readFanficPromptBlockWithNotice(app, PROJECT);

        expect(block).toBe('');
        expect(noticeLog).toHaveLength(1);
        expect(noticeLog[0].message).toContain('尚未绑定设定文件');
    });

    it('原创项目返回空块且不提示', async () => {
        const app = makeApp();
        await (app.vault as TestVault).write(pjProjectMeta(PROJECT), `# ${PROJECT}\n\n## 类型\noriginal\n`);

        const block = await readFanficPromptBlockWithNotice(app, PROJECT);

        expect(block).toBe('');
        expect(noticeLog).toHaveLength(0);
    });
});
