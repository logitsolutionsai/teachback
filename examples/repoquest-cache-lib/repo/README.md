# cache-lib

A synthetic least-recently-used cache, written for the teachback RepoQuest example. It is not a real project.

`LruCache` holds at most `capacity` entries. Reading or writing a key marks it as used. When the cache is full, adding a new key drops one entry.

Run the tests with `node --test test/lru.test.js`. One test fails on purpose: the eviction choice has a bug for the learner to find and fix.
