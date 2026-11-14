# cache-lib

A synthetic least-recently-used cache, written for the teachback RepoQuest examples. It is not a real project.

`LruCache` holds at most `capacity` entries. Reading or writing a key marks it as used. When the cache is full, adding a new key drops one entry.

This copy has the proposed change from `../change.patch` applied: the eviction choice now drops the entry used longest ago. Run the tests with `node --test test/lru.test.js`.
