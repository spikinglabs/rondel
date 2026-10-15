import type { Entry } from './protocol';
import type { RoomStore } from './room';

/** A RoomStore in memory: for tests and throwaway local runs. */
export class MemoryStore implements RoomStore {
  private auth: string | null = null;
  private entries: Entry[] = [];
  private next = 1;
  private last: number | null = null;
  private gone = false;
  /** Tests can move the clock. */
  now = () => Date.now();

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
    this.last = this.now();
    return seq;
  }
  async compact(upTo: number, data: string) {
    this.entries = [{ seq: upTo, data }, ...this.entries.filter((e) => e.seq > upTo)];
    this.last = this.now();
  }
  async stats() {
    return { count: this.entries.length, bytes: this.entries.reduce((n, e) => n + e.data.length, 0) };
  }
  async lastWrite() {
    return this.last;
  }
  async clear(tombstone: boolean) {
    this.entries = [];
    this.auth = null;
    this.last = null;
    this.gone ||= tombstone;
  }
  async isGone() {
    return this.gone;
  }
}
