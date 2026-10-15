import type { Entry } from './protocol';
import type { RoomStore } from './room';

/** A RoomStore in memory: for tests and throwaway local runs. */
export class MemoryStore implements RoomStore {
  private auth: string | null = null;
  private entries: Entry[] = [];
  private next = 1;

  async getAuthHash() {
    return this.auth;
  }
  async setAuthHash(h: string) {
    this.auth = h;
  }
  async entriesSince(since: number) {
    return this.entries.filter((e) => e.seq > since);
  }
  async append(data: string) {
    const seq = this.next++;
    this.entries.push({ seq, data });
    return seq;
  }
  async compact(upTo: number, data: string) {
    this.entries = [{ seq: upTo, data }, ...this.entries.filter((e) => e.seq > upTo)];
  }
  async stats() {
    return { count: this.entries.length, bytes: this.entries.reduce((n, e) => n + e.data.length, 0) };
  }
}
