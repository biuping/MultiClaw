import { getDb } from './index';

/**
 * 迁移记录
 */
interface MigrationRow {
  id: number;
  name: string;
  applied_at: string;
}

/**
 * 获取已执行的迁移列表
 */
async function getAppliedMigrations(): Promise<Set<string>> {
  const db = await getDb();
  // 先确保 _migrations 表存在
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      applied_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
  const rows = await db.allAsync<MigrationRow>('SELECT name FROM _migrations');
  return new Set(rows.map(r => r.name));
}

/**
 * 记录已执行的迁移
 */
async function recordMigration(name: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('INSERT INTO _migrations (name) VALUES (?)', [name]);
}

/**
 * 迁移定义
 * 按顺序执行，name 唯一标识，不可重复
 */
const migrations: Array<{ name: string; up: (db: any) => Promise<void> }> = [
  {
    name: '001_initial_schema',
    up: async (db) => {
      // 初始表结构（与原 initDatabase 一致）
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS agents (
          id TEXT PRIMARY KEY,
          openclaw_id TEXT UNIQUE NOT NULL,
          name TEXT NOT NULL,
          avatar TEXT,
          role TEXT,
          tags TEXT DEFAULT '[]',
          status TEXT DEFAULT 'ready',
          persona TEXT,
          skills TEXT DEFAULT '[]',
          workspace TEXT,
          model TEXT DEFAULT 'default',
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS agent_relations (
          id TEXT PRIMARY KEY,
          source_id TEXT NOT NULL,
          target_id TEXT NOT NULL,
          relation_type TEXT DEFAULT 'visible',
          rules TEXT DEFAULT '{}',
          collaboration_count INTEGER DEFAULT 0,
          trust_score REAL DEFAULT 0,
          collaboration_log TEXT DEFAULT '[]',
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (source_id) REFERENCES agents(id),
          FOREIGN KEY (target_id) REFERENCES agents(id),
          UNIQUE(source_id, target_id)
        )
      `);
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS delegation_records (
          id TEXT PRIMARY KEY,
          from_agent_id TEXT NOT NULL,
          to_agent_id TEXT NOT NULL,
          task TEXT NOT NULL,
          result TEXT,
          status TEXT DEFAULT 'pending',
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          completed_at TEXT,
          FOREIGN KEY (from_agent_id) REFERENCES agents(id),
          FOREIGN KEY (to_agent_id) REFERENCES agents(id)
        )
      `);
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS agent_positions (
          agent_id TEXT PRIMARY KEY,
          x REAL DEFAULT 0,
          y REAL DEFAULT 0,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (agent_id) REFERENCES agents(id)
        )
      `);
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS chat_messages (
          id TEXT PRIMARY KEY,
          agent_id TEXT NOT NULL,
          task_id TEXT,
          role TEXT NOT NULL,
          content TEXT NOT NULL,
          metadata TEXT,
          timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (agent_id) REFERENCES agents(id)
        )
      `);
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS tasks (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          description TEXT,
          coordinator_id TEXT NOT NULL,
          status TEXT DEFAULT 'pending',
          priority TEXT DEFAULT 'medium',
          result TEXT,
          metadata TEXT DEFAULT '{}',
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (coordinator_id) REFERENCES agents(id)
        )
      `);
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS skill_configs (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT,
          risk_level TEXT DEFAULT 'low',
          category TEXT,
          enabled INTEGER DEFAULT 1,
          config TEXT DEFAULT '{}'
        )
      `);
    },
  },
  {
    name: '002_add_chat_messages_indexes',
    up: async (db) => {
      // 为聊天消息添加索引，提升查询性能
      await db.execAsync('CREATE INDEX IF NOT EXISTS idx_chat_messages_agent_id ON chat_messages(agent_id)');
      await db.execAsync('CREATE INDEX IF NOT EXISTS idx_chat_messages_task_id ON chat_messages(task_id)');
      await db.execAsync('CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)');
      await db.execAsync('CREATE INDEX IF NOT EXISTS idx_tasks_coordinator_id ON tasks(coordinator_id)');
      await db.execAsync('CREATE INDEX IF NOT EXISTS idx_agent_relations_source ON agent_relations(source_id)');
      await db.execAsync('CREATE INDEX IF NOT EXISTS idx_agent_relations_target ON agent_relations(target_id)');
    },
  },
  {
    name: '003_add_delegation_indexes',
    up: async (db) => {
      await db.execAsync('CREATE INDEX IF NOT EXISTS idx_delegation_from ON delegation_records(from_agent_id)');
      await db.execAsync('CREATE INDEX IF NOT EXISTS idx_delegation_to ON delegation_records(to_agent_id)');
      await db.execAsync('CREATE INDEX IF NOT EXISTS idx_delegation_status ON delegation_records(status)');
    },
  },
  {
    name: '004_agent_skills',
    up: async (db) => {
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS agent_skills (
          id TEXT PRIMARY KEY,
          agent_id TEXT NOT NULL,
          skill_id TEXT NOT NULL,
          skill_type TEXT NOT NULL DEFAULT 'persona',
          name TEXT NOT NULL,
          description TEXT,
          source TEXT DEFAULT 'custom',
          source_url TEXT,
          version TEXT,
          enabled INTEGER DEFAULT 1,
          installed_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
          UNIQUE(agent_id, skill_id)
        )
      `);
      await db.execAsync('CREATE INDEX IF NOT EXISTS idx_agent_skills_agent ON agent_skills(agent_id)');
      await db.execAsync('CREATE INDEX IF NOT EXISTS idx_agent_skills_skill_id ON agent_skills(skill_id)');
    },
  },
  {
    name: '005_task_guidance_and_restart',
    up: async (db) => {
      // 为 tasks 表添加 guidance 字段（人工定向指导/提示注入）
      try {
        await db.execAsync('ALTER TABLE tasks ADD COLUMN guidance TEXT');
      } catch (err: any) {
        // SQLite ALTER TABLE ADD COLUMN 会忽略重复列，但如果列已存在则报错，安全忽略
        if (!String(err).includes('duplicate column')) {
          console.warn('[migration 005] ALTER TABLE tasks ADD guidance:', err);
        }
      }
      // 为 tasks 表添加 restart_from_phase 字段（断点重执行起始阶段）
      try {
        await db.execAsync('ALTER TABLE tasks ADD COLUMN restart_from_phase TEXT');
      } catch (err: any) {
        if (!String(err).includes('duplicate column')) {
          console.warn('[migration 005] ALTER TABLE tasks ADD restart_from_phase:', err);
        }
      }
    },
  },
  {
    name: '006_task_type_iterative',
    up: async (db) => {
      // 为 tasks 表添加 task_type 字段（任务类型：standard / iterative）
      try {
        await db.execAsync("ALTER TABLE tasks ADD COLUMN task_type TEXT DEFAULT 'standard'");
      } catch (err: any) {
        if (!String(err).includes('duplicate column')) {
          console.warn('[migration 006] ALTER TABLE tasks ADD task_type:', err);
        }
      }
      // 为 tasks 表添加 reviewer_id 字段（审阅人，默认=coordinator_id）
      try {
        await db.execAsync('ALTER TABLE tasks ADD COLUMN reviewer_id TEXT');
      } catch (err: any) {
        if (!String(err).includes('duplicate column')) {
          console.warn('[migration 006] ALTER TABLE tasks ADD reviewer_id:', err);
        }
      }
      // 为 tasks 表添加 iteration 字段（当前迭代轮次，默认1）
      try {
        await db.execAsync('ALTER TABLE tasks ADD COLUMN iteration INTEGER DEFAULT 1');
      } catch (err: any) {
        if (!String(err).includes('duplicate column')) {
          console.warn('[migration 006] ALTER TABLE tasks ADD iteration:', err);
        }
      }
      // 为 tasks 表添加 review_comment 字段（最新审阅反馈）
      try {
        await db.execAsync('ALTER TABLE tasks ADD COLUMN review_comment TEXT');
      } catch (err: any) {
        if (!String(err).includes('duplicate column')) {
          console.warn('[migration 006] ALTER TABLE tasks ADD review_comment:', err);
        }
      }
      // 创建迭代审阅记录表
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS task_reviews (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL,
          iteration INTEGER NOT NULL,
          reviewer_id TEXT NOT NULL,
          comment TEXT,
          status TEXT NOT NULL DEFAULT 'review',
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
        )
      `);
      await db.execAsync('CREATE INDEX IF NOT EXISTS idx_task_reviews_task ON task_reviews(task_id)');
    },
  },
  {
    name: '007_task_type_scheduled',
    up: async (db) => {
      // schedule_type: once(一次性) / interval(固定间隔) / cron(cron表达式)
      try {
        await db.execAsync("ALTER TABLE tasks ADD COLUMN schedule_type TEXT");
      } catch (err: any) {
        if (!String(err).includes('duplicate column')) {
          console.warn('[migration 007] ALTER TABLE tasks ADD schedule_type:', err);
        }
      }
      // schedule_expr: cron 表达式，如 '0 9 * * 1-5' 表示周一到五9点
      try {
        await db.execAsync('ALTER TABLE tasks ADD COLUMN schedule_expr TEXT');
      } catch (err: any) {
        if (!String(err).includes('duplicate column')) {
          console.warn('[migration 007] ALTER TABLE tasks ADD schedule_expr:', err);
        }
      }
      // schedule_interval_ms: 间隔毫秒数（interval 类型使用）
      try {
        await db.execAsync('ALTER TABLE tasks ADD COLUMN schedule_interval_ms INTEGER');
      } catch (err: any) {
        if (!String(err).includes('duplicate column')) {
          console.warn('[migration 007] ALTER TABLE tasks ADD schedule_interval_ms:', err);
        }
      }
      // schedule_anchor: 首次执行时间 ISO 时间戳
      try {
        await db.execAsync('ALTER TABLE tasks ADD COLUMN schedule_anchor TEXT');
      } catch (err: any) {
        if (!String(err).includes('duplicate column')) {
          console.warn('[migration 007] ALTER TABLE tasks ADD schedule_anchor:', err);
        }
      }
      // next_run_at: 下次执行时间
      try {
        await db.execAsync('ALTER TABLE tasks ADD COLUMN next_run_at TEXT');
      } catch (err: any) {
        if (!String(err).includes('duplicate column')) {
          console.warn('[migration 007] ALTER TABLE tasks ADD schedule_next_run_at:', err);
        }
      }
      // last_run_at: 上次执行时间
      try {
        await db.execAsync('ALTER TABLE tasks ADD COLUMN last_run_at TEXT');
      } catch (err: any) {
        if (!String(err).includes('duplicate column')) {
          console.warn('[migration 007] ALTER TABLE tasks ADD schedule_last_run_at:', err);
        }
      }
      // run_count: 已执行次数
      try {
        await db.execAsync('ALTER TABLE tasks ADD COLUMN run_count INTEGER DEFAULT 0');
      } catch (err: any) {
        if (!String(err).includes('duplicate column')) {
          console.warn('[migration 007] ALTER TABLE tasks ADD schedule_run_count:', err);
        }
      }
      // 索引
      await db.execAsync('CREATE INDEX IF NOT EXISTS idx_tasks_schedule_next_run ON tasks(next_run_at)');
      await db.execAsync('CREATE INDEX IF NOT EXISTS idx_tasks_task_type ON tasks(task_type)');
    },
  },
];

/**
 * 执行所有待执行的迁移
 */
export async function runMigrations(): Promise<void> {
  const applied = await getAppliedMigrations();
  let ran = 0;

  for (const migration of migrations) {
    if (applied.has(migration.name)) continue;

    console.log('[migration] Running: ' + migration.name);
    const db = await getDb();

    try {
      await migration.up(db);
      await recordMigration(migration.name);
      ran++;
      console.log('[migration] Completed: ' + migration.name);
    } catch (err) {
      console.error('[migration] FAILED: ' + migration.name, err);
      throw err;
    }
  }

  if (ran > 0) {
    console.log('[migration] ' + ran + ' migration(s) applied');
  } else {
    console.log('[migration] All up to date');
  }
}

/**
 * 获取迁移状态
 */
export async function getMigrationStatus(): Promise<{ name: string; applied: boolean; appliedAt?: string }[]> {
  const db = await getDb();
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      applied_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
  const applied = await db.allAsync<MigrationRow>('SELECT name, applied_at FROM _migrations');
  const appliedMap = new Map(applied.map(r => [r.name, r.applied_at]));

  return migrations.map(m => ({
    name: m.name,
    applied: appliedMap.has(m.name),
    appliedAt: appliedMap.get(m.name),
  }));
}
