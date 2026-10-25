import { describe, it, expect } from 'vitest';
import { countPlannedChapters, hasBlockingIssues, parseVolumePlan } from '../../../shared/volume-plan';

function volumeSection(vol: number, name: string, start: number, end: number, rows?: number[]): string {
    const chapterRows = (rows ?? Array.from({ length: end - start + 1 }, (_, i) => start + i))
        .map(n => `| ${n} | 冲突${n} |`)
        .join('\n');
    return `### 第${vol}卷 《${name}》
- **卷名**：《${name}》
- **章节范围**：第${start}章 - 第${end}章

| 章号 | 核心冲突 |
|---|---|
${chapterRows}
`;
}

describe('parseVolumePlan — 全书规划解析与校验', () => {
    it('解析连续多卷并提取章号', () => {
        const content = `## 分卷大纲\n\n${volumeSection(1, '初入宗门', 1, 3)}\n${volumeSection(2, '风起', 4, 5)}`;
        const result = parseVolumePlan(content);

        expect(result.volumes).toHaveLength(2);
        expect(result.volumes[0]).toMatchObject({
            volumeNumber: 1,
            volumeName: '初入宗门',
            startChapter: 1,
            endChapter: 3,
            chapterNumbers: [1, 2, 3],
        });
        expect(result.volumes[1].chapterNumbers).toEqual([4, 5]);
        expect(countPlannedChapters(result)).toBe(5);
        expect(hasBlockingIssues(result)).toBe(false);
    });

    it('没有任何分卷标题 → 阻断', () => {
        const result = parseVolumePlan('# 全书规划\n没有分卷');
        expect(result.volumes).toHaveLength(0);
        expect(hasBlockingIssues(result)).toBe(true);
        expect(result.issues[0].message).toContain('未找到任何分卷');
    });

    it('缺少章节范围 → 阻断', () => {
        const content = '### 第1卷 《测试》\n- **卷名**：《测试》\n\n| 章号 | 核心冲突 |\n|---|---|\n| 1 | A |\n';
        const result = parseVolumePlan(content);
        expect(hasBlockingIssues(result)).toBe(true);
        expect(result.issues.some(i => i.message.includes('缺少「- **章节范围**'))).toBe(true);
    });

    it('表格章数与声明范围不一致 → 阻断', () => {
        const content = volumeSection(1, '少一章', 1, 3, [1, 2]);
        const result = parseVolumePlan(content);
        expect(hasBlockingIssues(result)).toBe(true);
        expect(result.issues.some(i => i.message.includes('不一致'))).toBe(true);
    });

    it('表格章号顺序错乱 → 阻断', () => {
        const content = volumeSection(1, '跳号', 1, 3, [1, 3, 4]);
        const result = parseVolumePlan(content);
        expect(hasBlockingIssues(result)).toBe(true);
        expect(result.issues.some(i => i.message.includes('表格第 2 行'))).toBe(true);
    });

    it('卷间章节范围重叠 → 阻断', () => {
        const content = `${volumeSection(1, '甲', 1, 5)}\n${volumeSection(2, '乙', 5, 8)}`;
        const result = parseVolumePlan(content);
        expect(hasBlockingIssues(result)).toBe(true);
        expect(result.issues.some(i => i.message.includes('范围重叠'))).toBe(true);
    });

    it('卷间断档 → 仅警告，不阻断', () => {
        const content = `${volumeSection(1, '甲', 1, 3)}\n${volumeSection(2, '乙', 5, 6)}`;
        const result = parseVolumePlan(content);
        expect(hasBlockingIssues(result)).toBe(false);
        expect(result.issues.some(i => i.level === 'warning' && i.message.includes('缺第4章'))).toBe(true);
    });

    it('没有章节表格 → 按声明范围回退并警告', () => {
        const content = '### 第1卷 《无表》\n- **卷名**：《无表》\n- **章节范围**：第1章 - 第3章\n';
        const result = parseVolumePlan(content);
        expect(result.volumes[0].chapterNumbers).toEqual([1, 2, 3]);
        expect(result.issues.some(i => i.level === 'warning' && i.message.includes('未检测到章节表格'))).toBe(true);
        expect(hasBlockingIssues(result)).toBe(false);
    });

    it('卷内其他数字表格不会污染章节解析', () => {
        const content = `### 第1卷 《多表》
- **卷名**：《多表》
- **章节范围**：第1章 - 第2章

| 章号 | 核心冲突 |
|---|---|
| 1 | A |
| 2 | B |

| 序号 | 爽点 |
|---|---|
| 1 | 打脸 |
| 2 | 升级 |
| 3 | 反转 |
`;
        const result = parseVolumePlan(content);
        expect(result.volumes[0].chapterNumbers).toEqual([1, 2]);
        expect(hasBlockingIssues(result)).toBe(false);
    });

    it('全书总览声明的分卷数 / 总章节数与明细一致时不报错', () => {
        const content = `## 全书总览
- **分卷数**：2
- **总章节数**：5

${volumeSection(1, '甲', 1, 3)}
${volumeSection(2, '乙', 4, 5)}`;
        const result = parseVolumePlan(content);
        expect(hasBlockingIssues(result)).toBe(false);
    });

    it('全书总览声明的总章节数与分卷明细不一致 → 阻断', () => {
        const content = `## 全书总览
- **总章节数**：10

${volumeSection(1, '甲', 1, 3)}`;
        const result = parseVolumePlan(content);
        expect(hasBlockingIssues(result)).toBe(true);
        expect(result.issues.some(i => i.message.includes('声明 10 章'))).toBe(true);
    });

    it('全书总览声明的分卷数与实际解析不一致 → 阻断', () => {
        const content = `## 全书总览
- **分卷数**：3

${volumeSection(1, '甲', 1, 3)}`;
        const result = parseVolumePlan(content);
        expect(hasBlockingIssues(result)).toBe(true);
        expect(result.issues.some(i => i.message.includes('声明 3 卷'))).toBe(true);
    });

    it('卷号重复 → 阻断', () => {
        const content = `${volumeSection(1, '甲', 1, 2)}\n${volumeSection(1, '乙', 3, 4)}`;
        const result = parseVolumePlan(content);
        expect(hasBlockingIssues(result)).toBe(true);
        expect(result.issues.some(i => i.message.includes('卷号重复'))).toBe(true);
    });

    it('范围起点大于终点 → 阻断', () => {
        const content = '### 第1卷 《倒挂》\n- **卷名**：《倒挂》\n- **章节范围**：第5章 - 第2章\n';
        const result = parseVolumePlan(content);
        expect(hasBlockingIssues(result)).toBe(true);
        expect(result.issues.some(i => i.message.includes('章节范围非法'))).toBe(true);
    });

    it('生成端省略表格分隔行时仍能解析全部章节（真实大纲格式）', () => {
        const content = `### 第1卷 《无分隔线》
- **卷名**：《无分隔线》
- **章节范围**：第1章 - 第3章

| 章号 | 核心冲突 |
| 1 | A |
| 2 | B |
| 3 | C |
`;
        const result = parseVolumePlan(content);
        expect(result.volumes[0].chapterNumbers).toEqual([1, 2, 3]);
        expect(hasBlockingIssues(result)).toBe(false);
    });

    it('章节单元格兼容 **N** / 第N章 / N. 写法', () => {
        const content = `### 第1卷 《容错》
- **卷名**：《容错》
- **章节范围**：第1章 - 第3章

| 章号 | 核心冲突 |
| **1** | A |
| 第2章 | B |
| 3. | C |
`;
        const result = parseVolumePlan(content);
        expect(result.volumes[0].chapterNumbers).toEqual([1, 2, 3]);
        expect(hasBlockingIssues(result)).toBe(false);
    });

    it('三卷 400 章无分隔行的全书规划不再漏算首章', () => {
        const section = (vol: number, start: number, end: number): string => {
            const rows = Array.from({ length: end - start + 1 }, (_, i) => `| ${start + i} | 冲突${start + i} |`).join('\n');
            return `### 第${vol}卷
- **卷名**：第${vol}卷
- **章节范围**：第${start}章 - 第${end}章

| 章号 | 核心冲突 |
${rows}
`;
        };
        const content = `## 全书总览
- **分卷数**：3
- **总章节数**：400

## 分卷大纲

${section(1, 1, 130)}
${section(2, 131, 290)}
${section(3, 291, 400)}`;
        const result = parseVolumePlan(content);
        expect(result.volumes.map(v => v.chapterNumbers.length)).toEqual([130, 160, 110]);
        expect(countPlannedChapters(result)).toBe(400);
        expect(hasBlockingIssues(result)).toBe(false);
    });
});
