/**
 * repository/interfaces.ts — Repository 模式接口定义
 *
 * 目的：
 * - 定义泛型仓储接口，统一数据访问层 API
 * - 支持基础 CRUD + 批量操作
 * - 为 Markdown / JSON / 数据库等多种存储后端提供统一抽象
 *
 * 使用方式：
 *   class CharacterRepository extends BaseMarkdownRepository<CharacterDomainModel>
 *       implements IRepository<CharacterDomainModel, string> { ... }
 */

// ============================================================
// 一、基础仓储接口
// ============================================================

/**
 * 泛型仓储基础接口
 *
 * @typeParam T    实体类型
 * @typeParam TId  实体 ID 类型（通常为 string）
 */
export interface IRepository<T, TId> {
    /**
     * 根据 ID 查找实体，不存在返回 null
     *
     * @param id - 标识
      * @returns T 或 null
     */
    findById(id: TId): Promise<T | null>;

    /**
     * 查找所有实体
     *
     * @returns 结果数组
     */
    findAll(): Promise<T[]>;

    /**
     * 保存实体（新增或更新）
     * - 若实体已存在（ID 匹配）则更新
     * - 若不存在则新增
     * @param entity - 实体
      * @returns T 实例
     */
    save(entity: T): Promise<T>;

    /**
     * 根据 ID 删除实体，返回是否删除成功
     *
     * @param id - 标识
     * @returns 是否成功
     */
    delete(id: TId): Promise<boolean>;

    /**
     * 检查指定 ID 的实体是否存在
     *
     * @param id - 标识
     * @returns 是否成功
     */
    exists(id: TId): Promise<boolean>;
}

// ============================================================
// 二、批量操作扩展接口
// ============================================================

/**
 * 批量操作结果
 */
export interface BulkResult<T> {
    /** 成功执行的实体列表 */
    success: T[];
    /** 失败的条目，包含错误信息 */
    failures: BulkFailure<T>[];
    /** 总成功数 */
    successCount: number;
    /** 总失败数 */
    failureCount: number;
}

/**
 * 批量操作失败条目
 */
export interface BulkFailure<T> {
    /** 导致失败的实体或 ID */
    item: T | unknown;
    /** 错误信息 */
    error: Error;
    /** 在批量数组中的索引位置 */
    index: number;
}

/**
 * 批量仓储扩展接口
 * 按顺序执行，失败记录错误，不中断整体流程
 *
 * @typeParam T    实体类型
 * @typeParam TId  实体 ID 类型
 */
export interface IBulkRepository<T, TId> extends IRepository<T, TId> {
    /**
     * 批量保存实体
     * 按顺序逐个执行，失败的记录错误，成功的继续
     * @param entities - 实体列表
      * @returns BulkResult<T> 实例
     */
    saveAll(entities: T[]): Promise<BulkResult<T>>;

    /**
     * 批量删除实体
     * 按顺序逐个执行，失败的记录错误，成功的继续
     * @param ids - 标识列表
      * @returns BulkResult<TId> 实例
     */
    deleteAll(ids: TId[]): Promise<BulkResult<TId>>;

    /**
     * 批量查找实体
     * 返回所有找到的实体，未找到的不包含在结果中
     * @param ids - 标识列表
     * @returns 结果数组
     */
    findAllById(ids: TId[]): Promise<T[]>;
}
