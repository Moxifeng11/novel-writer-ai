/**
 * 项目标准校验单测
 *
 * 每类问题都配一条「不应报」的负例——体检类功能最怕误报，
 * 一旦用户看到"报告有问题"但实际没问题，就再也不信了。
 */

import { describe, expect, it } from 'vitest';
import {
    chapterNumOfFile,
    validateProjectStandard,
    type DirListing,
    type StandardFs,
} from '../../../services/project-standard-service';
import {
    PROJECT_STANDARD,
    PROJECT_STANDARD_VERSION,
    isStandardOutdated,
    namingRuleFor,
    requiredDirPaths,
} from '../../../shared/project-standard';

/** 造一个内存文件系统端口 */
function makeFs(files: Map<string, string>, folders: Set<string> = new Set()): StandardFs {
    return {
        exists: async (path: string) => files.has(path) || folders.has(path),
        read: async (path: string) => {
            const value = files.get(path);
            if (value === undefined) throw new Error(`missing ${path}`);
            return value;
        },
        list: async (path: string): Promise<DirListing> => {
            const prefix = `${path}/`;
            const childFiles: string[] = [];
            const childFolders = new Set<string>();
            for (const key of files.keys()) {
                if (!key.startsWith(prefix)) continue;
                const rest = key.slice(prefix.length);
                if (rest.includes('/')) {
                    childFolders.add(`${path}/${rest.split('/')[0]}`);
                } else {
                    childFiles.push(key);
                }
            }
            for (const key of folders) {
                if (!key.startsWith(prefix)) continue;
                const rest = key.slice(prefix.length);
                if (!rest.includes('/')) childFolders.add(key);
            }
            return { files: childFiles, folders: [...childFolders] };
        },
    };
}

/** 造一个完全合规的项目 */
function compliantProject(): { files: Map<string, string>; folders: Set<string> } {
    const files = new Map<string, string>();
    const folders = new Set<string>();
    const P = '书A';
    for (const dir of requiredDirPaths()) folders.add(`${P}/${dir}`);
    files.set(`${P}/.project`, `# 书A\n\nstandardVersion: ${PROJECT_STANDARD_VERSION}\n`);
    files.set(`${P}/03-大纲与章节/正文/第1卷/第1章_正文.md`, '# 第1章\n\n正文');
    files.set(`${P}/04-项目总控/剧情记忆/第1章_摘要.md`, '---\n章: 第1章\n---\n');
    return { files, folders };
}

describe('标准声明自身', () => {
    it('必备目录覆盖 01~04 四个顶层目录', () => {
        const tops = new Set(PROJECT_STANDARD.requiredDirs.map(d => d.path.split('/')[0]));
        expect([...tops].sort()).toEqual(['01-世界架构', '02-时间线与伏笔', '03-大纲与章节', '04-项目总控']);
    });

    it('命名规则可按目录取到', () => {
        expect(namingRuleFor('03-大纲与章节/正文')).not.toBeNull();
        expect(namingRuleFor('不存在的目录')).toBeNull();
    });

    it('版本比较：未声明或更低都算落后', () => {
        expect(isStandardOutdated(undefined)).toBe(true);
        expect(isStandardOutdated(0)).toBe(true);
        expect(isStandardOutdated(PROJECT_STANDARD_VERSION)).toBe(false);
    });
});

describe('合规项目：不应报任何问题', () => {
    it('完全合规 → issues 为空', async () => {
        const { files, folders } = compliantProject();
        const report = await validateProjectStandard(makeFs(files, folders), '书A');
        expect(report.issues).toEqual([]);
        expect(report.summary).toEqual({});
        expect(report.checkedBodies).toBe(1);
    });
});

describe('missing-dir：缺必备目录', () => {
    it('缺 01-世界架构/人物 → error 且说明修复方式', async () => {
        const { files, folders } = compliantProject();
        folders.delete('书A/01-世界架构/人物');
        const report = await validateProjectStandard(makeFs(files, folders), '书A');
        const hit = report.issues.find(i => i.kind === 'missing-dir');
        expect(hit).toBeDefined();
        expect(hit!.severity).toBe('error');
        expect(hit!.detail).toContain('修复');
    });
});

describe('missing-file：缺必备文件', () => {
    it('缺 .project → error', async () => {
        const { files, folders } = compliantProject();
        files.delete('书A/.project');
        const report = await validateProjectStandard(makeFs(files, folders), '书A');
        expect(report.issues.some(i => i.kind === 'missing-file')).toBe(true);
    });
});

describe('standard-outdated：标准版本', () => {
    it('未声明版本 → warning', async () => {
        const { files, folders } = compliantProject();
        files.set('书A/.project', '# 书A\n');
        const report = await validateProjectStandard(makeFs(files, folders), '书A');
        expect(report.issues.some(i => i.kind === 'standard-outdated')).toBe(true);
    });

    it('版本等于当前 → 不报（负例）', async () => {
        const { files, folders } = compliantProject();
        const report = await validateProjectStandard(makeFs(files, folders), '书A');
        expect(report.issues.some(i => i.kind === 'standard-outdated')).toBe(false);
    });
});

describe('bad-naming：命名不符规范', () => {
    it('正文命名不规范（缺「_正文」）→ warning', async () => {
        const { files, folders } = compliantProject();
        files.set('书A/03-大纲与章节/正文/第1卷/第2章.md', '# 第2章');
        files.set('书A/04-项目总控/剧情记忆/第2章_摘要.md', 'x');
        const report = await validateProjectStandard(makeFs(files, folders), '书A');
        expect(report.issues.some(i => i.kind === 'bad-naming')).toBe(true);
    });

    it('命名合规 → 不报（负例）', async () => {
        const { files, folders } = compliantProject();
        const report = await validateProjectStandard(makeFs(files, folders), '书A');
        expect(report.issues.some(i => i.kind === 'bad-naming')).toBe(false);
    });
});

describe('digest-missing：有正文无摘要（本会话踩过的坑）', () => {
    it('第2章有正文无摘要 → warning', async () => {
        const { files, folders } = compliantProject();
        files.set('书A/03-大纲与章节/正文/第1卷/第2章_正文.md', '# 第2章');
        const report = await validateProjectStandard(makeFs(files, folders), '书A');
        const hit = report.issues.find(i => i.kind === 'digest-missing');
        expect(hit).toBeDefined();
        expect(hit!.detail).toContain('一致性审核会漏掉');
    });

    it('正文与摘要配对 → 不报（负例）', async () => {
        const { files, folders } = compliantProject();
        const report = await validateProjectStandard(makeFs(files, folders), '书A');
        expect(report.issues.some(i => i.kind === 'digest-missing')).toBe(false);
    });
});

describe('fact-store：事实库完整性', () => {
    it('JSON 损坏 → error', async () => {
        const { files, folders } = compliantProject();
        files.set('书A/04-项目总控/一致性审核/事实库.json', '{broken');
        const report = await validateProjectStandard(makeFs(files, folders), '书A');
        const hit = report.issues.find(i => i.kind === 'fact-store-invalid');
        expect(hit).toBeDefined();
        expect(hit!.severity).toBe('error');
    });

    it('缺 facts 数组 → error', async () => {
        const { files, folders } = compliantProject();
        files.set('书A/04-项目总控/一致性审核/事实库.json', '{"version":1}');
        const report = await validateProjectStandard(makeFs(files, folders), '书A');
        expect(report.issues.some(i => i.kind === 'fact-store-invalid')).toBe(true);
    });

    it('缺 version → warning', async () => {
        const { files, folders } = compliantProject();
        files.set('书A/04-项目总控/一致性审核/事实库.json', '{"facts":[]}');
        const report = await validateProjectStandard(makeFs(files, folders), '书A');
        expect(report.issues.some(i => i.kind === 'fact-store-version')).toBe(true);
    });

    it('事实库不存在不报错（负例：新项目还没有库）', async () => {
        const { files, folders } = compliantProject();
        const report = await validateProjectStandard(makeFs(files, folders), '书A');
        expect(report.issues.some(i => i.kind === 'fact-store-invalid')).toBe(false);
        expect(report.issues.some(i => i.kind === 'fact-store-version')).toBe(false);
    });

    it('合法事实库 → 不报（负例）', async () => {
        const { files, folders } = compliantProject();
        files.set('书A/04-项目总控/一致性审核/事实库.json', '{"version":1,"facts":[]}');
        const report = await validateProjectStandard(makeFs(files, folders), '书A');
        expect(report.issues).toEqual([]);
    });
});

describe('chapterNumOfFile', () => {
    it('从文件名取章号', () => {
        expect(chapterNumOfFile('第12章_正文.md')).toBe(12);
        expect(chapterNumOfFile('第1卷/第3章_摘要.md')).toBe(3);
    });

    it('无章号返回 0', () => {
        expect(chapterNumOfFile('README.md')).toBe(0);
    });
});

describe('summary 汇总', () => {
    it('按类型计数', async () => {
        const { files, folders } = compliantProject();
        folders.delete('书A/01-世界架构/人物');
        folders.delete('书A/01-世界架构/地点');
        const report = await validateProjectStandard(makeFs(files, folders), '书A');
        expect(report.summary['missing-dir']).toBe(2);
    });
});
