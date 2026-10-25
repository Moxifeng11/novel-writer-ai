/**
 * fanfic-rules-load-warning.test.ts — 同人设定加载失败必须可被用户感知
 *
 * 同人项目在「路径未绑定 / 文件不存在 / 读取异常」时都会退化为空规则，
 * 协同会以「无原作约束」继续写作。这里验证失败原因能带出并格式化为提示文案。
 */
import { describe, expect, it } from 'vitest';
import type { App } from 'obsidian';
import { Vault } from 'obsidian';
import {
    formatFanficRulesForPrompt,
    formatFanficRulesLoadWarning,
    parseFanficRules,
    readFanficRules,
    readFanficRulesFromFS,
} from '../../../shared/fanfic-rules';
import { pjProjectMeta } from '../../../shared/paths';
import { MockFileSystem } from '../../../shared/file-system-port';

type TestVault = Vault & { write(path: string, content: string): Promise<void> };

function makeApp(): { app: App; vault: TestVault } {
    const vault = new Vault() as TestVault;
    return { app: { vault } as unknown as App, vault };
}

const PROJECT = '测试项目';
const FANFIC_PATH = `${PROJECT}/05-同人设定库/星尘学院设定.md`;

const FANFIC_CONTENT = `# 星尘学院 同人设定

## 原作核心设定
- **世界观类型**：学院奇幻
- **力量体系**：星图观测、星尘回路
- **核心规则**：能力来自星图共鸣。

## 创作规则
- **必须遵守的原作规则**：星术能力必须与星图观测有关。
- **允许改编的范围**：可以新增支线角色。
- **禁止触及的红线**：不能改写原作主角结局。
`;

const PLACEHOLDER_CONTENT = `# 星尘学院 同人设定

## 原作核心设定
- **世界观类型**：（待补充）
- **力量体系**：待补充
- **核心规则**：(待补充)

## 创作规则
- **必须遵守的原作规则**：（待补充）
- **允许改编的范围**：（待补充）
- **禁止触及的红线**：（待补充）

## 原作剧情时间线
| 章节 | 事件 |
|---|---|
| 待补充 | （待补充） |
`;

const FANFIC_WITH_CHARACTERS = `# 星尘学院 同人设定

## 主要人物
### 星野
- **人物名**：星野
- **原作定位**：星图学院首席
- **在同人中的变化**：提前觉醒
`;

describe('formatFanficRulesLoadWarning', () => {
    it('原创项目不提示', () => {
        expect(formatFanficRulesLoadWarning({ ...emptyRules(), isFanfic: false, loadError: 'missing-path' })).toBeNull();
    });

    it('同人设定正常解析时不提示', () => {
        expect(formatFanficRulesLoadWarning(parseFanficRules(FANFIC_CONTENT, FANFIC_PATH))).toBeNull();
    });

    it('未绑定路径时提示去向导或命令绑定', () => {
        const text = formatFanficRulesLoadWarning({ ...emptyRules(), isFanfic: true, loadError: 'missing-path' });
        expect(text).toContain('尚未绑定设定文件');
        expect(text).toContain('添加同人设定');
    });

    it('文件不存在时提示带出路径', () => {
        const text = formatFanficRulesLoadWarning({
            ...emptyRules(),
            isFanfic: true,
            path: FANFIC_PATH,
            loadError: 'missing-file',
        });
        expect(text).toContain(FANFIC_PATH);
        expect(text).toContain('不存在');
    });

    it('读取失败时提示检查文件权限', () => {
        const text = formatFanficRulesLoadWarning({
            ...emptyRules(),
            isFanfic: true,
            path: FANFIC_PATH,
            loadError: 'read-failed',
        });
        expect(text).toContain('读取失败');
    });
});

describe('readFanficRules — 失败原因', () => {
    it('设定文件缺失时返回 missing-file', async () => {
        const { app, vault } = makeApp();
        await vault.write(pjProjectMeta(PROJECT), `# ${PROJECT}\n\n## 类型\nfanfic\n\n## 同人设定路径\n${FANFIC_PATH}\n`);

        const rules = await readFanficRules(app, PROJECT);
        expect(rules.loadError).toBe('missing-file');
        expect(formatFanficRulesLoadWarning(rules)).toContain('不存在');
    });

    it('同人项目未写路径时返回 missing-path', async () => {
        const { app, vault } = makeApp();
        await vault.write(pjProjectMeta(PROJECT), `# ${PROJECT}\n\n## 类型\nfanfic\n`);

        const rules = await readFanficRules(app, PROJECT);
        expect(rules.loadError).toBe('missing-path');
    });
});

describe('readFanficRulesFromFS — 失败原因', () => {
    it('原创项目返回空规则且不提示', async () => {
        const fs = new MockFileSystem();
        fs.setFile(pjProjectMeta(PROJECT), `# ${PROJECT}\n\n## 类型\noriginal\n`);

        const rules = await readFanficRulesFromFS(fs, PROJECT);
        expect(rules.isFanfic).toBe(false);
        expect(formatFanficRulesLoadWarning(rules)).toBeNull();
    });

    it('文件不存在时返回 missing-file', async () => {
        const fs = new MockFileSystem();
        fs.setFile(pjProjectMeta(PROJECT), `# ${PROJECT}\n\n## 类型\nfanfic\n\n## 同人设定路径\n${FANFIC_PATH}\n`);

        const rules = await readFanficRulesFromFS(fs, PROJECT);
        expect(rules.loadError).toBe('missing-file');
        expect(rules.path).toBe(FANFIC_PATH);
    });

    it('正常文件解析成功且无 loadError', async () => {
        const fs = new MockFileSystem();
        fs.setFile(pjProjectMeta(PROJECT), `# ${PROJECT}\n\n## 类型\nfanfic\n\n## 同人设定路径\n${FANFIC_PATH}\n`);
        fs.setFile(FANFIC_PATH, FANFIC_CONTENT);

        const rules = await readFanficRulesFromFS(fs, PROJECT);
        expect(rules.loadError).toBeUndefined();
        expect(rules.redlines).toContain('主角结局');
        expect(formatFanficRulesLoadWarning(rules)).toBeNull();
    });
});

describe('同人设定为空 / 全占位时同样必须提示', () => {
    it('文件存在但内容全是占位时提示「没有可用内容」', async () => {
        const fs = new MockFileSystem();
        fs.setFile(pjProjectMeta(PROJECT), `# ${PROJECT}\n\n## 类型\nfanfic\n\n## 同人设定路径\n${FANFIC_PATH}\n`);
        fs.setFile(FANFIC_PATH, PLACEHOLDER_CONTENT);

        const rules = await readFanficRulesFromFS(fs, PROJECT);
        // 文件确实读到了：不是 missing-file / read-failed
        expect(rules.isFanfic).toBe(true);
        expect(rules.loadError).toBeUndefined();
        const warning = formatFanficRulesLoadWarning(rules);
        expect(warning).toContain('没有可用内容');
        expect(warning).toContain(FANFIC_PATH);
        expect(warning).toContain('不会带原作约束');
    });

    it('只填了原作人物时不误报（约束块非空）', () => {
        const rules = parseFanficRules(FANFIC_WITH_CHARACTERS, FANFIC_PATH);
        expect(formatFanficRulesForPrompt(rules)).not.toBe('');
        expect(formatFanficRulesLoadWarning(rules)).toBeNull();
    });

    it('只有作品名标题、其余全空时仍提示（作品名不产生约束块）', () => {
        const rules = parseFanficRules(`# 星尘学院 同人设定\n\n## 原作核心设定\n- **世界观类型**：\n`, FANFIC_PATH);
        expect(formatFanficRulesForPrompt(rules)).toBe('');
        expect(formatFanficRulesLoadWarning(rules)).toContain('没有可用内容');
    });

    it('不变量：同人项目注入块为空 ⇔ 必须给出警告', () => {
        const fixtures = [
            parseFanficRules(FANFIC_CONTENT, FANFIC_PATH),
            parseFanficRules(PLACEHOLDER_CONTENT, FANFIC_PATH),
            parseFanficRules(FANFIC_WITH_CHARACTERS, FANFIC_PATH),
        ];
        for (const rules of fixtures) {
            const promptBlock = formatFanficRulesForPrompt(rules);
            const warning = formatFanficRulesLoadWarning(rules);
            expect(promptBlock === '').toBe(warning !== null);
        }
        // 原创项目两边都为空，但那是正常态
        expect(formatFanficRulesForPrompt({ ...emptyRules(), isFanfic: false })).toBe('');
        expect(formatFanficRulesLoadWarning({ ...emptyRules(), isFanfic: false })).toBeNull();
    });
});

function emptyRules() {
    return {
        isFanfic: false,
        path: '',
        workName: '',
        worldviewType: '',
        powerSystem: '',
        coreRules: '',
        mustFollow: '',
        adaptScope: '',
        redlines: '',
    };
}
