// 轻量 LRU：限制搜索缓存容量，避免离线批量分析时全局 Map 无界增长。
export class LruCache {
  constructor(limit) {
    this.limit = Math.max(1, limit);
    this.map = new Map();
    this.head = null;
    this.tail = null;
  }

  get size() {
    return this.map.size;
  }

  has(key) {
    return this.map.has(key);
  }

  get(key) {
    const node = this.map.get(key);
    if (!node) return undefined;
    this.moveToFront(node);
    return node.value;
  }

  set(key, value) {
    const existing = this.map.get(key);
    if (existing) {
      existing.value = value;
      this.moveToFront(existing);
      return this;
    }

    const node = { key, value, newer: null, older: null };
    this.map.set(key, node);
    this.insertFront(node);

    if (this.map.size > this.limit) {
      this.evictTail();
    }
    return this;
  }

  clear() {
    this.map.clear();
    this.head = null;
    this.tail = null;
  }

  moveToFront(node) {
    if (node === this.head) return;
    this.detach(node);
    this.insertFront(node);
  }

  insertFront(node) {
    node.newer = null;
    node.older = this.head;
    if (this.head) this.head.newer = node;
    this.head = node;
    if (!this.tail) this.tail = node;
  }

  detach(node) {
    if (node.newer) node.newer.older = node.older;
    if (node.older) node.older.newer = node.newer;
    if (node === this.head) this.head = node.older;
    if (node === this.tail) this.tail = node.newer;
    node.newer = null;
    node.older = null;
  }

  evictTail() {
    if (!this.tail) return;
    const oldest = this.tail;
    this.detach(oldest);
    this.map.delete(oldest.key);
  }
}
