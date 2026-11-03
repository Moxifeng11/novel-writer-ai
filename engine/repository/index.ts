/**
 * repository/index.ts — 统一导出
 *
 * 用法：
 *   import { IRepository, IBulkRepository, BaseMarkdownRepository, LruCache } from '@/engine/repository';
 *   import { Project, Chapter, Character, DomainValidator, EntityFactory } from '@/engine/repository/domain';
 */

export type {
    IRepository,
    IBulkRepository,
    BulkResult,
    BulkFailure,
} from './interfaces';

export { LruCache } from '@/shared/lru-cache';
export type { LruCacheOptions } from '@/shared/lru-cache';

export { BaseMarkdownRepository } from './base-markdown-repository';
export type { BaseMarkdownRepositoryOptions } from './base-markdown-repository';

export { CharacterRepository } from './character-repository';
export { ChapterRepository } from './chapter-repository';
export { ProjectRepository } from './project-repository';
export { FactionRepository } from './faction-repository';
export { LocationRepository } from './location-repository';
export { ItemRepository } from './item-repository';

export * from './domain';
