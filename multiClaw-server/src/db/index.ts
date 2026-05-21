import sqlite3 from 'sqlite3';
import { Database } from 'sqlite3';
import path from 'path';
import fs from 'fs/promises';

// WORKSPACE_ROOT 用于 Agent 工作区目录，不影响数据库路径
// 数据库始终在 ~/.multiclaw/ 下
const DB_DIR = path.join(require('os').homedir(), '.multiclaw');
const DB_PATH = path.join(DB_DIR, 'database.sqlite');

let db: Database | null = null;

export async function getDb(): Promise<Database> {
  if (!db) {
    // 确保目录存在
    await fs.mkdir(DB_DIR, { recursive: true });
    
    db = new Database(DB_PATH);
    
    // 使用 Promise 包装 Database 方法
    db.runAsync = function(sql: string, params?: any[]): Promise<void> {
      return new Promise((resolve, reject) => {
        this.run(sql, params || [], function(err) {
          if (err) reject(err);
          else resolve();
        });
      });
    };
    
    db.getAsync = function<T = any>(sql: string, params?: any[]): Promise<T | undefined> {
      return new Promise((resolve, reject) => {
        this.get(sql, params || [], (err, row) => {
          if (err) reject(err);
          else resolve(row as T);
        });
      });
    };
    
    db.allAsync = function<T = any>(sql: string, params?: any[]): Promise<T[]> {
      return new Promise((resolve, reject) => {
        this.all(sql, params || [], (err, rows) => {
          if (err) reject(err);
          else resolve(rows as T[]);
        });
      });
    };
    
    db.execAsync = function(sql: string): Promise<void> {
      return new Promise((resolve, reject) => {
        this.exec(sql, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    };
  }
  return db;
}

/**
 * 初始化数据库 — 使用迁移版本管理
 * 保留此函数以兼容现有调用
 */
export async function initDatabase(): Promise<void> {
  // 先确保基础表存在（兼容无 _migrations 表的旧数据库）
  const database = await getDb();
  await database.execAsync(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      applied_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 动态导入避免循环依赖
  const { runMigrations } = await import('./migrations');
  await runMigrations();

  console.log('Database initialized');
}

export { DB_PATH };
