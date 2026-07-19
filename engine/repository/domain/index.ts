/**
 * domain/index.ts — 领域模型层统一导出
 *
 * 用法：
 *   import { Project, Chapter, Character, DomainValidator, EntityFactory } from './domain';
 */

export * from './aggregates';
export * from './value-objects';
export * from './serializers';
export * from './validators';
