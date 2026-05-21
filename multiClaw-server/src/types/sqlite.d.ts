import { Database as SQLiteDatabase } from 'sqlite3';

// 扩展 Database 类型以包含我们的异步方法
declare module 'sqlite3' {
  interface Database {
    runAsync(sql: string, params?: any[]): Promise<void>;
    getAsync<T = any>(sql: string, params?: any[]): Promise<T | undefined>;
    allAsync<T = any>(sql: string, params?: any[]): Promise<T[]>;
    execAsync(sql: string): Promise<void>;
  }
}