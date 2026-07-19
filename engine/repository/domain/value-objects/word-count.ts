/**
 * domain/value-objects/word-count.ts — 字数值对象
 *
 * 封装字数统计相关逻辑，确保字数的有效性和一致性。
 */

export interface WordCountProps {
    /** 正文字数（不含标点和空白的纯汉字数） */
    chinese: number;
    /** 总字数（含标点、空格、英文等） */
    total: number;
    /** 段落数 */
    paragraphs: number;
}

/**
 * 字数值对象
 * 不可变，通过 create 工厂方法创建，确保数据有效性
 */
export class WordCount {
    readonly chinese: number;
    readonly total: number;
    readonly paragraphs: number;

    private constructor(props: WordCountProps) {
        this.chinese = props.chinese;
        this.total = props.total;
        this.paragraphs = props.paragraphs;
    }

    /**
     * 创建 WordCount 实例
     * 自动校验数值有效性，非法值归零
     */
    static create(chinese: number = 0, total: number = 0, paragraphs: number = 0): WordCount {
        return new WordCount({
            chinese: Math.max(0, Math.floor(chinese)),
            total: Math.max(0, Math.floor(total)),
            paragraphs: Math.max(0, Math.floor(paragraphs)),
        });
    }

    /**
     * 从文本内容统计字数
     */
    static fromText(text: string): WordCount {
        if (!text) {
            return WordCount.create(0, 0, 0);
        }

        const chinese = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
        const total = text.length;
        const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 0).length;

        return WordCount.create(chinese, total, paragraphs);
    }

    /** 空字数对象 */
    static zero(): WordCount {
        return WordCount.create(0, 0, 0);
    }

    /**
     * 两个字数相加
     */
    add(other: WordCount): WordCount {
        return WordCount.create(
            this.chinese + other.chinese,
            this.total + other.total,
            this.paragraphs + other.paragraphs,
        );
    }

    /**
     * 减去另一个字数
     */
    subtract(other: WordCount): WordCount {
        return WordCount.create(
            Math.max(0, this.chinese - other.chinese),
            Math.max(0, this.total - other.total),
            Math.max(0, this.paragraphs - other.paragraphs),
        );
    }

    /**
     * 判断是否为空（零字数）
     */
    isZero(): boolean {
        return this.chinese === 0 && this.total === 0 && this.paragraphs === 0;
    }

    /**
     * 转换为普通对象（用于序列化）
     */
    toJSON(): WordCountProps {
        return {
            chinese: this.chinese,
            total: this.total,
            paragraphs: this.paragraphs,
        };
    }

    /**
     * 从普通对象创建
     */
    static fromJSON(json: Partial<WordCountProps> | undefined | null): WordCount {
        if (!json) return WordCount.zero();
        return WordCount.create(json.chinese ?? 0, json.total ?? 0, json.paragraphs ?? 0);
    }

    /**
     * 值对象相等性比较
     */
    equals(other: WordCount): boolean {
        return (
            this.chinese === other.chinese &&
            this.total === other.total &&
            this.paragraphs === other.paragraphs
        );
    }
}
