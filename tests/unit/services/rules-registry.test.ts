/**
 * rules-registry v4 单一来源回归。
 *
 * v4.26 改版后：唯一生效来源是 vault 的 `元文件/00-系统模板/写作规则.md`；
 * 内置常量只是首次写入模板；不再有 legacy/实验版/项目副本/漂移告警。
 */
import { describe, expect, it } from 'vitest';
import { App } from '../../__mocks__/obsidian';
import {
    BUILTIN_RULES_VERSION,
    VAULT_RULES_PATH,
    builtinRulesDocs,
    listRulesVersions,
    resolveActiveRulesText,
} from '../../../services/rules-registry';
import { WRITING_RULES } from '../../../shared/writing-rules';
import { canonicalContent, hashContent } from '../../../shared/versioned-registry';

function makeApp(files: Record<string, string> = {}): any {
    const app = new App();
    for (const [path, content] of Object.entries(files)) {
        (app.vault as any)._seedFile(path, content);
    }
    return app;
}

const VAULT_FILE = VAULT_RULES_PATH;

describe('rules-registry — v4 单一来源', () => {
    it('内置模板只有一个 v4 文档，内容与常量一致', () => {
        const docs = builtinRulesDocs();
        expect(docs.length).toBe(1);
        expect(docs[0].id).toBe(`builtin:${BUILTIN_RULES_VERSION}`);
        expect(docs[0].version).toBe(BUILTIN_RULES_VERSION);
        expect(docs[0].content).toBe(WRITING_RULES);
        expect(docs[0].hash).toBe(hashContent(canonicalContent(WRITING_RULES)));
    });

    it('vault 元文件存在时是唯一生效来源（project/activeVersion 参数被忽略）', async () => {
        const custom = WRITING_RULES.replace('单一镜头', '单一镜头（用户自定义）');
        const app = makeApp({
            [VAULT_FILE]: custom,
            '长篇小说/书甲/00-系统模板/写作规则.md': '---\nversion: "0.0.1"\n---\n项目副本',
        });
        const listing = await listRulesVersions(app, {
            activeVersion: 'builtin:999.0.0',
            project: '长篇小说/书甲',
        });
        expect(listing.active.doc?.source).toBe('vault');
        expect(listing.active.doc?.path).toBe(VAULT_FILE);
        expect(listing.active.doc?.content).toBe(custom);
        expect(listing.drift).toEqual([]);
        // 文档列表 = vault + 1 个内置兜底；不再有 legacy/实验版
        expect(listing.docs.length).toBe(2);
        expect(listing.docs.some(d => d.version.startsWith('3.6.0'))).toBe(false);
    });

    it('vault 文件缺失时回退内置模板并标记 fellBack', async () => {
        const app = makeApp({});
        const listing = await listRulesVersions(app);
        expect(listing.active.doc).toBeNull();
        expect(listing.active.fellBack).toBe(true);
        expect(listing.docs[0].source).toBe('builtin');
        const { text } = await resolveActiveRulesText(app);
        expect(text).toBe(WRITING_RULES);
    });

    it('旧版文件（version≠4.0.0）内容原样返回——覆写交给 RulesService 迁移', async () => {
        const legacy = '---\nversion: "3.6.0"\n---\n\n旧版内容';
        const app = makeApp({ [VAULT_FILE]: legacy });
        const { doc } = (await listRulesVersions(app)).active;
        expect(doc?.content).toBe(legacy);
        expect(doc?.version).toBe('3.6.0');
    });
});
