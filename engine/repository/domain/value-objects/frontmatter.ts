/**
 * domain/value-objects/frontmatter.ts — Frontmatter 值对象
 *
 * 封装 frontmatter 数据的统一访问和操作。
 */

/**
 * Frontmatter 值对象
 * 不可变，封装 frontmatter 数据的安全访问
 */
export class Frontmatter {
    private readonly data: Record<string, any>;

    private constructor(data: Record<string, any>) {
        this.data = { ...data };
    }

    /**
     * 创建空 Frontmatter
     *
      * @returns Frontmatter 实例
     */
    static empty(): Frontmatter {
        return new Frontmatter({});
    }

    /**
     * 从普通对象创建
     *
     * @param data - 数据
      * @returns Frontmatter 实例
     */
    static from(data: Record<string, any> | undefined | null): Frontmatter {
        return new Frontmatter(data || {});
    }

    /**
     * 获取指定字段的值
     * @param key - 键
     * @param defaultValue - 默认值
      * @returns T 实例
     */
    get<T = any>(key: string, defaultValue?: T): T {
        const value = this.data[key];
        return value !== undefined ? (value as T) : (defaultValue as T);
    }

    /**
     * 检查字段是否存在
     * @param key - 键
     * @returns 是否成功
     */
    has(key: string): boolean {
        return key in this.data;
    }

    /**
     * 设置字段值，返回新的 Frontmatter 实例（不可变）
     * @param key - 键
     * @param value - 值
      * @returns Frontmatter 实例
     */
    set(key: string, value: any): Frontmatter {
        const newData = { ...this.data };
        if (value === undefined) {
            delete newData[key];
        } else {
            newData[key] = value;
        }
        return new Frontmatter(newData);
    }

    /**
     * 合并多个字段，返回新的 Frontmatter 实例
     * @param patch - 补丁
      * @returns Frontmatter 实例
     */
    merge(patch: Record<string, any>): Frontmatter {
        const newData = { ...this.data };
        for (const [key, value] of Object.entries(patch)) {
            if (value === undefined) {
                delete newData[key];
            } else {
                newData[key] = value;
            }
        }
        return new Frontmatter(newData);
    }

    /**
     * 删除字段，返回新的 Frontmatter 实例
     * @param key - 键
      * @returns Frontmatter 实例
     */
    remove(key: string): Frontmatter {
        const newData = { ...this.data };
        delete newData[key];
        return new Frontmatter(newData);
    }

    /**
     * 获取所有 keys
     * @returns 结果数组
     */
    keys(): string[] {
        return Object.keys(this.data);
    }

    /**
     * 获取所有 values
     * @returns 结果数组
     */
    values(): any[] {
        return Object.values(this.data);
    }

    /**
     * 获取所有 entries
     * @returns 结果数组
     */
    entries(): [string, any][] {
        return Object.entries(this.data);
    }

    /**
     * 转换为普通对象（深拷贝）
     * @returns 映射结果
     */
    toObject(): Record<string, any> {
        return { ...this.data };
    }

    /**
     * 是否为空
     * @returns 是否成功
     */
    isEmpty(): boolean {
        return Object.keys(this.data).length === 0;
    }

    /**
     * 字段数量
     * @returns 数值结果
     */
    size(): number {
        return Object.keys(this.data).length;
    }

    /**
     * 以字符串数组形式获取 tags 字段
     * @returns 结果数组
     */
    getTags(): string[] {
        const tags = this.data['tags'];
        if (!tags) return [];
        if (Array.isArray(tags)) return tags.filter(Boolean);
        if (typeof tags === 'string') {
            return tags.split(',').map(t => t.trim()).filter(Boolean);
        }
        return [];
    }

    /**
     * 等值比较
     * @param other - 另一侧值
     * @returns 是否成功
     */
    equals(other: Frontmatter): boolean {
        const keys1 = Object.keys(this.data).sort();
        const keys2 = Object.keys(other.data).sort();
        if (keys1.length !== keys2.length) return false;
        for (let i = 0; i < keys1.length; i++) {
            if (keys1[i] !== keys2[i]) return false;
            if (this.data[keys1[i]] !== other.data[keys2[i]]) return false;
        }
        return true;
    }

    /**
     * 转换为JSON。
     * @returns 映射结果
     */
    toJSON(): Record<string, any> {
        return { ...this.data };
    }
}
