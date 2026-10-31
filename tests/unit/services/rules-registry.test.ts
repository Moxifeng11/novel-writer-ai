import { describe, expect, it } from 'vitest';
import { App } from '../../__mocks__/obsidian';
import {
    BUILTIN_RULES_VERSION,
    builtinRulesDocs,
    listRulesVersions,
    resolveActiveRulesText,
} from '../../../services/rules-registry';
import { WRITING_RULES } from '../../../shared/writing-rules';
import { WRITING_RULES_LEGACY } from '../../../shared/writing-rules-legacy';
import { hashContent } from '../../../shared/versioned-registry';

function makeApp(files: Record<string, string> = {}): App {
    const app = new App();
    for (const [path, content] of Object.entries(files)) {
        (app.vault as any)._seedFile(path, content);
    }
    return app;
}

/** 构造一份带版本号的规则文件正文（结构无关，只测选择逻辑） */
function rulesFile(version: string, body: string): string {
    return `---\nversion: "${version}"\n---\n\n# 写作规则 v${version}\n\n${body}\n`;
}

describe('rules-registry — 写作规则多版本注册', () => {
    describe('内置版本', () => {
        it('内置两版：新版默认 + 旧版对照，id 与内容都可区分', () => {
            const docs = builtinRulesDocs();
            const [current, legacy] = docs;
            expect(current.id).toBe(`builtin:${BUILTIN_RULES_VERSION}`);
            expect(current.version).toBe(BUILTIN_RULES_VERSION);
            expect(current.content).toBe(WRITING_RULES);
            expect(legacy.id).toBe('builtin:3.6.0-legacy');
            expect(legacy.content).toBe(WRITING_RULES_LEGACY);
            // 版本号前缀相同但内容不同：正是本次事故的形态，哈希必须能区分
            expect(legacy.version.startsWith('3.6.0')).toBe(true);
            expect(current.hash).not.toBe(legacy.hash);
            expect(current.hash).toBe(hashContent(WRITING_RULES));
        });

        it('三个「不同思路」实验版都已注册，id/哈希互不相同', () => {
            const docs = builtinRulesDocs();
            expect(docs).toHaveLength(5);
            const ids = docs.map((doc) => doc.id);
            expect(ids).toEqual(expect.arrayContaining([
                'builtin:3.6.0',
                'builtin:3.6.0-legacy',
                'builtin:3.7.0-anchor',
                'builtin:3.8.0-scene-beat',
                'builtin:3.9.0-voiceprint',
            ]));
            expect(new Set(docs.map((doc) => doc.hash)).size).toBe(5);
            for (const doc of docs.slice(2)) {
                expect(doc.notes && doc.notes.length).toBeTruthy();
                expect(doc.content.length).toBeGreaterThan(400);
            }
        });
    });

    describe('生效版本选择', () => {
        it('无配置时默认生效内置新版，不回退', async () => {
            const listing = await listRulesVersions(makeApp() as any);
            expect(listing.active.doc?.id).toBe(`builtin:${BUILTIN_RULES_VERSION}`);
            expect(listing.active.fellBack).toBe(false);
            expect(listing.active.warnings).toEqual([]);
            expect(listing.drift).toEqual([]);
        });

        it('按 id 精确指定生效旧版', async () => {
            const listing = await listRulesVersions(makeApp() as any, { activeVersion: 'builtin:3.6.0-legacy' });
            expect(listing.active.doc?.id).toBe('builtin:3.6.0-legacy');
            expect(listing.active.fellBack).toBe(false);
        });

        it('可以切到实验版（3.9 真人特征）', async () => {
            const listing = await listRulesVersions(makeApp() as any, { activeVersion: 'builtin:3.9.0-voiceprint' });
            expect(listing.active.doc?.id).toBe('builtin:3.9.0-voiceprint');
            expect(listing.active.doc?.content).toContain('真人文本的八个可观察特征');
        });

        it('只写版本号也能选中对应版本', async () => {
            const listing = await listRulesVersions(makeApp() as any, { activeVersion: '3.6.0-legacy' });
            expect(listing.active.doc?.id).toBe('builtin:3.6.0-legacy');
        });

        it('指定版本不存在时回退到默认并给出告警', async () => {
            const listing = await listRulesVersions(makeApp() as any, { activeVersion: '9.9.9' });
            expect(listing.active.doc?.id).toBe(`builtin:${BUILTIN_RULES_VERSION}`);
            expect(listing.active.fellBack).toBe(true);
            expect(listing.active.warnings.join()).toContain('9.9.9');
        });
    });

    describe('文件版本（vault / project）', () => {
        it('vault 根模板参与候选，且优先级高于内置', async () => {
            const app = makeApp({ '元文件/00-系统模板/写作规则.md': rulesFile('3.7.0', 'vault 版规则') });
            const listing = await listRulesVersions(app as any);
            const vaultDoc = listing.docs.find((doc) => doc.source === 'vault');
            expect(vaultDoc?.version).toBe('3.7.0');
            expect(vaultDoc?.path).toBe('元文件/00-系统模板/写作规则.md');
            expect(listing.active.doc?.source).toBe('vault');
        });

        it('项目级规则优先于 vault 与内置', async () => {
            const app = makeApp({
                '元文件/00-系统模板/写作规则.md': rulesFile('3.7.0', 'vault 版'),
                '长篇小说/测试书/00-系统模板/写作规则.md': rulesFile('3.8.0', '项目版'),
            });
            const listing = await listRulesVersions(app as any, { project: '长篇小说/测试书' });
            expect(listing.active.doc?.source).toBe('project');
            expect(listing.active.doc?.version).toBe('3.8.0');
            expect(listing.active.doc?.path).toBe('长篇小说/测试书/00-系统模板/写作规则.md');
        });

        it('设置了 activeRulesVersion 时文件版本不会抢走命中', async () => {
            const app = makeApp({ '元文件/00-系统模板/写作规则.md': rulesFile('3.7.0', 'vault 版') });
            const listing = await listRulesVersions(app as any, { activeVersion: 'builtin:3.6.0-legacy' });
            expect(listing.active.doc?.id).toBe('builtin:3.6.0-legacy');
        });
    });

    describe('哈希漂移检测', () => {
        it('版本号相同、内容被换掉 → 产出漂移告警（旧实现只比版本号，漏检）', async () => {
            const app = makeApp({
                '元文件/00-系统模板/写作规则.md': rulesFile(BUILTIN_RULES_VERSION, '被旧版覆盖的内容：一句一段'),
            });
            const listing = await listRulesVersions(app as any);
            expect(listing.active.doc?.source).toBe('vault');
            expect(listing.drift.length).toBeGreaterThan(0);
            expect(listing.drift.join()).toContain('版本号相同但内容不同');
        });

        it('文件没有版本号但内容匹配内置时，版本号被正确重标注（P0 修复）', async () => {
            const app = makeApp({ '元文件/00-系统模板/写作规则.md': WRITING_RULES });
            const listing = await listRulesVersions(app as any);
            expect(listing.active.doc?.source).toBe('vault');
            // v4.27：内容哈希匹配 builtin:3.6.0 → 版本号重标注为 3.6.0（不再 unknown）
            expect(listing.active.doc?.version).toBe('3.6.0');
            // 同版本同内容 → 无漂移
            expect(listing.drift).toEqual([]);
        });
    });

    describe('resolveActiveRulesText', () => {
        it('返回生效版本正文与文档元数据', async () => {
            const app = makeApp({ '元文件/00-系统模板/写作规则.md': rulesFile('3.7.0', '正文内容 A') });
            const resolved = await resolveActiveRulesText(app as any);
            expect(resolved.text).toContain('正文内容 A');
            expect(resolved.doc.version).toBe('3.7.0');
            expect(resolved.warnings).toEqual([]);
        });

        it('没有文件时回退内置新版（保证正文永不缺规则）', async () => {
            const resolved = await resolveActiveRulesText(makeApp() as any);
            expect(resolved.text).toBe(WRITING_RULES);
            expect(resolved.doc.source).toBe('builtin');
        });
    });
});

describe('rules-registry — 内容哈希重标注（启动弹窗修复）', () => {
    it('vault 文件内容匹配 legacy 内置时版本号被纠正为 legacy，不再报同版本漂移', async () => {
        const app = makeApp({ '元文件/00-系统模板/写作规则.md': WRITING_RULES_LEGACY });
        const listing = await listRulesVersions(app as any);
        // vault 文件内容 = legacy → 版本号被重标注为 3.6.0-legacy
        const vaultDoc = listing.docs.find(d => d.source === 'vault');
        expect(vaultDoc?.version).toBe('3.6.0-legacy');
        // selectActive 选中 vault 文件（优先级高于 builtin），但 drift 为空
        // 因为同版本（3.6.0-legacy）的 builtin 哈希与 vault 文件一致
        expect(listing.drift).toEqual([]);
    });

    it('vault 文件内容匹配新版内置时版本号不变，drift 为空', async () => {
        const app = makeApp({ '元文件/00-系统模板/写作规则.md': WRITING_RULES });
        const listing = await listRulesVersions(app as any);
        expect(listing.drift).toEqual([]);
    });
});
