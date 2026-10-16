import { DatabaseSync } from 'node:sqlite';
import type { Entry } from '../core/protocol';
import type { RoomStore } from '../core/room';

/** One SQLite file holds every room. */
export function openDatabase(file: string) {
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS rooms (id TEXT PRIMARY KEY, auth_hash TEXT NOT NULL, created_at TEXT NOT NULL, touched_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS entries (room TEXT NOT NULL, seq INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY (room, seq));
    CREATE TABLE IF NOT EXISTS gone (id TEXT PRIMARY KEY, deleted_at TEXT NOT NULL);
  `);
  return db;
}

export class SqliteStore implements RoomStore {
  constructor(private db: DatabaseSync, private room: string) {}

  async getAuthHash() {
    const row = this.db.prepare('SELECT auth_hash FROM rooms WHERE id = ?').get(this.room) as { auth_hash: string } | undefined;
    return row?.auth_hash ?? null;
  }
  async setAuthHash(hash: string) {
    const now = new Date().toISOString();
    this.db.prepare('INSERT OR IGNORE INTO rooms (id, auth_hash, created_at, touched_at) VALUES (?, ?, ?, ?)').run(this.room, hash, now, now);
  }
  async entriesSince(since: number): Promise<Entry[]> {
    return this.db.prepare('SELECT seq, data FROM entries WHERE room = ? AND seq > ? ORDER BY seq').all(this.room, since) as unknown as Entry[];
  }
  async append(data: string) {
    const row = this.db.prepare('SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM entries WHERE room = ?').get(this.room) as { next: number };
    this.db.prepare('INSERT INTO entries (room, seq, data) VALUES (?, ?, ?)').run(this.room, row.next, data);
    this.db.prepare('UPDATE rooms SET touched_at = ? WHERE id = ?').run(new Date().toISOString(), this.room);
    return Number(row.next);
  }
  async compact(upTo: number, data: string) {
    this.db.exec('BEGIN');
    try {
      this.db.prepare('DELETE FROM entries WHERE room = ? AND seq <= ?').run(this.room, upTo);
      this.db.prepare('INSERT INTO entries (room, seq, data) VALUES (?, ?, ?)').run(this.room, upTo, data);
      this.db.prepare('UPDATE rooms SET touched_at = ? WHERE id = ?').run(new Date().toISOString(), this.room);
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }
  async stats() {
    const row = this.db.prepare('SELECT COUNT(*) AS count, COALESCE(SUM(LENGTH(data)), 0) AS bytes FROM entries WHERE room = ?').get(this.room) as { count: number; bytes: number };
    return { count: Number(row.count), bytes: Number(row.bytes) };
  }
  async lastWrite() {
    const has = this.db.prepare('SELECT 1 FROM entries WHERE room = ? LIMIT 1').get(this.room);
    if (!has) return null;
    const row = this.db.prepare('SELECT touched_at FROM rooms WHERE id = ?').get(this.room) as { touched_at: string } | undefined;
    return row ? Date.parse(row.touched_at) : null;
  }
  async clear(tombstone: boolean) {
    this.db.exec('BEGIN');
    try {
      this.db.prepare('DELETE FROM entries WHERE room = ?').run(this.room);
      this.db.prepare('DELETE FROM rooms WHERE id = ?').run(this.room);
      if (tombstone) this.db.prepare('INSERT OR IGNORE INTO gone (id, deleted_at) VALUES (?, ?)').run(this.room, new Date().toISOString());
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }
  async isGone() {
    return !!this.db.prepare('SELECT 1 FROM gone WHERE id = ?').get(this.room);
  }
}

/** Rooms whose last change is older than the retention time: candidates for Room.expire(). */
export function staleRooms(db: DatabaseSync, retentionDays: number): string[] {
  const before = new Date(Date.now() - retentionDays * 86_400_000).toISOString();
  return (db.prepare('SELECT id FROM rooms WHERE touched_at < ?').all(before) as { id: string }[]).map((r) => r.id);
}
