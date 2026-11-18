/**
 * novel-format-i18n.test.ts — 小说正文契约描述双语 + 可见实际字符（缺口⑦ 跨层数据④/⑧）
 *
 * **甄别结论**：`BodyFormatContract` 的 `separator` / `indent` 是**结构数据**——
 * 落盘（`BodyWriter`）与解析都按它们逐字比对，绝不能翻译；
 * 只有 `describeContractShort()` 拼出来的**展示串**需要双语。
 *
 * 因此这里锁三件事：
 * 1. 契约字段在翻译前后不变（数据不漂移）；
 * 2. zh 展示串与迁移前逐字一致（零回归）；
 * 3. en 展示串全英文、无键名回退，且三种缩进/两种分段都覆盖。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { setLocale } from '../../../i18n';
import { describeContractParts, describeContractShort, describeContractVisible, describeContractWithVisible } from '../../../shared/novel-format';
import { DEFAULT_BODY_FORMAT, type BodyFormatContract } from '../../../shared/body-format';

afterEach(() => {
    setLocale('zh-CN');
});

const CONTRACTS: BodyFormatContract[] = [
    { ...DEFAULT_BODY_FORMAT, separator: '\n\n', indent: '\u3000\u3000' },
    { ...DEFAULT_BODY_FORMAT, separator: '\n\n', indent: '\t' },
    { ...DEFAULT_BODY_FORMAT, separator: '\n\n', indent: '' },
    { ...DEFAULT_BODY_FORMAT, separator: '\n', indent: '\u3000\u3000' },
    { ...DEFAULT_BODY_FORMAT, separator: '\n', indent: '' },
];

describe('正文契约描述双语（缺口⑦ 跨层数据④）', () => {
    it('zh：展示串与迁移前逐字一致（零回归）', () => {
        setLocale('zh-CN');
        expect(describeContractShort(CONTRACTS[0])).toBe('空行分段 · 首行空两格');
        expect(describeContractShort(CONTRACTS[1])).toBe('空行分段 · 首行 Tab');
        expect(describeContractShort(CONTRACTS[2])).toBe('空行分段 · 无缩进');
        expect(describeContractShort(CONTRACTS[3])).toBe('单换行分段 · 首行空两格');
        expect(describeContractShort(CONTRACTS[4])).toBe('单换行分段 · 无缩进');
    });

    it('en：展示串全英文且无键名回退', () => {
        setLocale('en-US');
        expect(describeContractShort(CONTRACTS[0])).toBe('Blank-line paragraphing · Two-character first-line indent');
        expect(describeContractShort(CONTRACTS[1])).toBe('Blank-line paragraphing · Tab first-line indent');
        expect(describeContractShort(CONTRACTS[2])).toBe('Blank-line paragraphing · No indent');
        expect(describeContractShort(CONTRACTS[3])).toBe('Single-newline paragraphing · Two-character first-line indent');
        for (const contract of CONTRACTS) {
            const text = describeContractShort(contract);
            expect(text).not.toMatch(/[\u4e00-\u9fff]/);
            expect(text).not.toMatch(/novelFormat\./);
        }
    });

    it('契约字段是数据：翻译前后 separator/indent 逐字不变', () => {
        for (const contract of CONTRACTS) {
            setLocale('zh-CN');
            const zhParts = describeContractParts(contract);
            setLocale('en-US');
            const enParts = describeContractParts(contract);
            // key 与中文兜底都不随语言变；只有求值后的展示串变
            expect(enParts.separatorKey).toBe(zhParts.separatorKey);
            expect(enParts.separatorFallback).toBe(zhParts.separatorFallback);
            expect(enParts.indentKey).toBe(zhParts.indentKey);
            expect(enParts.indentFallback).toBe(zhParts.indentFallback);
            // 原始契约对象本身完全没被触碰
            expect(contract.separator).toBe(zhParts.separatorKey.includes('blank') ? '\n\n' : '\n');
        }
    });

    it('缺省参数沿用默认契约', () => {
        setLocale('zh-CN');
        expect(describeContractShort()).toBe(describeContractShort(DEFAULT_BODY_FORMAT));
        setLocale('en-US');
        expect(describeContractShort()).toBe(describeContractShort(DEFAULT_BODY_FORMAT));
    });
});

describe('契约的可见实际字符（缺口⑦ 跨层数据⑧）', () => {
    it('label/key/visible 三件套齐备，且 visible 与语言无关', () => {
        const cases: Array<[BodyFormatContract, string, string, string]> = [
            // [契约, separatorKey, separatorVisible, indentVisible]
            [CONTRACTS[0], 'novelFormat.separator.blankLine', '↵↵', '▪▪'],
            [CONTRACTS[1], 'novelFormat.separator.blankLine', '↵↵', '⇥'],
            [CONTRACTS[2], 'novelFormat.separator.blankLine', '↵↵', '∅'],
            [CONTRACTS[3], 'novelFormat.separator.singleLine', '↵', '▪▪'],
            [CONTRACTS[4], 'novelFormat.separator.singleLine', '↵', '∅'],
        ];
        for (const [contract, sepKey, sepVisible, indentVisible] of cases) {
            setLocale('zh-CN');
            const zh = describeContractParts(contract);
            expect(zh.separatorKey).toBe(sepKey);
            expect(zh.separatorVisible).toBe(sepVisible);
            expect(zh.indentVisible).toBe(indentVisible);

            setLocale('en-US');
            const en = describeContractParts(contract);
            // key 与 visible 都不随语言变——它们描述的是**文件里真实的字符**
            expect(en.separatorKey).toBe(zh.separatorKey);
            expect(en.separatorVisible).toBe(zh.separatorVisible);
            expect(en.indentVisible).toBe(zh.indentVisible);
            // 但语义标签随语言变
            expect(en.separator).not.toBe(zh.separator);
        }
    });

    it('带可见字符的描述：语义标签 + 括号里的实际符号', () => {
        setLocale('zh-CN');
        expect(describeContractWithVisible(CONTRACTS[0])).toBe('空行分段（↵↵） · 首行空两格（▪▪）');
        expect(describeContractWithVisible(CONTRACTS[2])).toBe('空行分段（↵↵） · 无缩进（∅）');

        setLocale('en-US');
        const en = describeContractWithVisible(CONTRACTS[0]);
        // 语义标签是英文，但括号里的实际字符仍是同一组符号——用户可对上文件
        expect(en).toBe('Blank-line paragraphing（↵↵） · Two-character first-line indent（▪▪）');
        expect(en).not.toMatch(/[\u4e00-\u9fff]/);
    });

    it('契约字段本身不被 describeContractVisible 触碰', () => {
        const contract: BodyFormatContract = { ...DEFAULT_BODY_FORMAT, separator: '\n\n', indent: '\u3000\u3000' };
        const snapshot = { separator: contract.separator, indent: contract.indent };
        describeContractVisible(contract);
        describeContractWithVisible(contract);
        expect(contract.separator).toBe(snapshot.separator);
        expect(contract.indent).toBe(snapshot.indent);
    });
});
