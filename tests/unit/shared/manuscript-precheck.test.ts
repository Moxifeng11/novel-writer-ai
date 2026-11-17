import { describe, expect, it } from 'vitest';
import {
    checkManuscript,
    checkManuscriptText,
    formatPrecheckSummary,
    splitFrontmatter,
} from '../../../shared/manuscript-precheck';

function rulesOf(text: string): string[] {
    return checkManuscriptText(text).map(issue => issue.ruleId);
}

describe('splitFrontmatter', () => {
    it('跳过 frontmatter 并保留正文偏移', () => {
        const content = '---\ntitle: 测试\n---\n他说,好的\n';
        const { body, offset } = splitFrontmatter(content);
        expect(body).toBe('他说,好的\n');
        expect(offset).toBe(content.indexOf('他说'));
    });

    it('没有 frontmatter 时偏移为 0', () => {
        expect(splitFrontmatter('正文')).toEqual({ body: '正文', offset: 0 });
    });
});

describe('checkManuscriptText：错别字', () => {
    it('命中查表里的错写并给出正确写法', () => {
        const issues = checkManuscriptText('他必竟还是来了，既使如此也不回头。');
        const typos = issues.filter(issue => issue.ruleId === 'typo');
        expect(typos.map(issue => issue.message)).toEqual([
            '「必竟」应为「毕竟」',
            '「既使」应为「即使」',
        ]);
        expect(typos[0].severity).toBe('error');
    });

    it('行号与列号为 1 基且相对整份文件', () => {
        const content = '---\ntitle: x\n---\n第一行正常\n第二行必竟出错\n';
        const issue = checkManuscriptText(content).find(item => item.ruleId === 'typo');
        expect(issue?.line).toBe(5);
        expect(issue?.column).toBe(4);
        expect(issue?.snippet).toContain('必竟');
    });

    it('正常用词不误报', () => {
        expect(rulesOf('他终于到了，毕竟天太晚了。')).toEqual([]);
    });
});

describe('checkManuscriptText：重复词', () => {
    it('相邻重复的词组会命中', () => {
        const issues = checkManuscriptText('我们我们走吧。');
        expect(issues.filter(issue => issue.ruleId === 'repeat')).toHaveLength(1);
        expect(issues[0].message).toContain('我们我们');
    });

    it('单字叠词与白名单词组放行', () => {
        expect(rulesOf('妈妈慢慢地走过来。')).toEqual([]);
        expect(rulesOf('他一个一个地数。')).toEqual([]);
        expect(rulesOf('许多许多年后。')).toEqual([]);
    });
});

describe('checkManuscriptText：标点', () => {
    it('中文语境里的英文标点会命中并给出中文写法', () => {
        const issues = checkManuscriptText('他说,好?不行!');
        const mix = issues.filter(issue => issue.ruleId === 'punct-mix');
        expect(mix).toHaveLength(3);
        expect(mix[0].message).toContain('「,」');
        expect(mix[0].message).toContain('「，」');
    });

    it('小数与英文段落不误报', () => {
        expect(rulesOf('身高 1.85 米。')).toEqual([]);
        expect(rulesOf('hello, world')).toEqual([]);
    });

    it('连续标点分级：逗号句号是 warning，感叹问号是 info', () => {
        const comma = checkManuscriptText('他走了，，然后呢');
        expect(comma[0].ruleId).toBe('punct-repeat');
        expect(comma[0].severity).toBe('warning');
        const bang = checkManuscriptText('不可能！！');
        expect(bang[0].ruleId).toBe('punct-repeat');
        expect(bang[0].severity).toBe('info');
    });

    it('引号与书名号必须成对', () => {
        const unbalanced = checkManuscriptText('他说：“走吧。');
        expect(unbalanced.filter(issue => issue.ruleId === 'quote-pair')).toHaveLength(1);
        expect(unbalanced[0].severity).toBe('error');
        expect(rulesOf('他说：“走吧。”《长夜》读完了。')).toEqual([]);
    });

    it('省略号与破折号：英文写法提示、中文标准写法放行', () => {
        expect(rulesOf('他等了好久...')).toEqual(['ellipsis']);
        expect(checkManuscriptText('他等了好久...')[0].message).toContain('……');
        expect(rulesOf('他等了好久……')).toEqual([]);
        expect(rulesOf('他跑--了出去')).toEqual(['dash']);
        expect(rulesOf('他跑——了出去')).toEqual([]);
        expect(rulesOf('他犹豫…')).toEqual(['ellipsis']);
    });
});

describe('checkManuscript：汇总', () => {
    it('跳过无问题章节并按规则/严重度统计', () => {
        const report = checkManuscript([
            { name: '第1章', path: 'a.md', text: '他必竟来了。' },
            { name: '第2章', text: '一切正常。' },
            { name: '第3章', text: '他说,好的。' },
        ]);
        expect(report.chapters.map(chapter => chapter.name)).toEqual(['第1章', '第3章']);
        expect(report.total).toBe(2);
        expect(report.byRule.typo).toBe(1);
        expect(report.byRule['punct-mix']).toBe(1);
        expect(report.bySeverity.error).toBe(1);
        expect(report.chapters[0].path).toBe('a.md');
    });

    it('摘要为空时返回 null', () => {
        expect(formatPrecheckSummary(checkManuscript([{ name: '第1章', text: '一切正常。' }]))).toBeNull();
    });

    it('摘要含总数、分类与章节名', () => {
        const report = checkManuscript([{ name: '第1章', text: '他必竟来了，他说,好的。' }]);
        const summary = formatPrecheckSummary(report);
        expect(summary).toContain('发现 2 处');
        expect(summary).toContain('错别字 1');
        expect(summary).toContain('中英标点 1');
        expect(summary).toContain('第1章（2）');
    });
});
