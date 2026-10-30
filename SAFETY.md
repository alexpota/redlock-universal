# Safety

What a lock from redlock-universal guarantees, what it does not, how quickly a lost lock is noticed, and when to use something else. Read this before you rely on a lock to protect data.

## Summary

- A lock is a lease. It expires when its TTL runs out, whether or not your code has finished.
- The library cannot stop your code. If your process pauses or loses its connection, the lock can expire and another client can acquire it while your code keeps running. The library tells you afterwards: the `using()` signal is aborted, and `extend()` and `release()` return `false`.
- Use a lock to avoid duplicate work. If two holders at the same time would corrupt data, also protect the data itself (see [Protect the resource](#protect-the-resource)).
- This library does not issue fencing tokens.

## Single-instance locks

`createLock()`, and a `LockManager` with one node, write the lock with one `SET key value NX PX ttl` command to one Redis or Valkey server. Release and extension run a Lua script that compares the stored value with the handle's value first, so a client can only release or extend its own lock.

While the server keeps the key, only one client holds the lock. The key can disappear early, or be acquired by a second client, when:

- **Your process pauses.** A garbage-collection pause, a suspended VM or container, or a blocked event loop can outlast the TTL. The key expires, another client acquires it, and your code resumes without knowing.
- **The server's clock jumps.** Key expiry follows the server's wall clock, not a monotonic clock, so a forward jump expires keys early.
- **A failover happens.** Replication is asynchronous: the primary confirms the `SET` before any replica has it. If the primary fails before the write reaches a replica, the promoted replica has no lock and another client can acquire it. This applies to Sentinel, Redis Cluster and managed services with replicas. `WAIT` narrows the window but does not close it, and this library does not send it.
- **The server restarts without persistence**, or with the default `appendfsync everysec`, which can lose the last second of writes, or it restores an older snapshot. Recent locks are gone.
- **Memory runs out.** Under any eviction policy other than `noeviction`, the server can evict lock keys, because they have a TTL. Some managed services default to such a policy: the default ElastiCache parameter group uses `volatile-lru`.
- **The connection drops.** A client cut off from the server keeps running until its next extension fails.
- **The reply to `acquire()` arrives late.** `acquire()` dates the lock from when its winning attempt was sent. If that attempt took so long that the time plus the clock drift allowance (1% of the TTL plus 2 ms) reaches the TTL, it releases the grant and retries, or throws `LockAcquisitionError`. A reply can take up to the command timeout (5 seconds by default), so with a TTL close to that, slow replies turn into failed acquisitions. Keep the TTL well above the command timeout.

## Redlock

`createRedlock()` writes the lock to several independent servers. It succeeds when a quorum, by default a majority, accepts the lock within its validity time: the TTL minus the time the acquisition took and a clock-drift allowance.

What Redlock adds: the lock stays available while a minority of the servers is down.

What it does not add: Redlock is not a consensus protocol. Its safety rests on assumptions that the code cannot check:

- the servers' clocks run at about the same rate and do not jump;
- process pauses and network delays stay well below the TTL;
- a server that restarts either keeps its data (AOF with `appendfsync always`) or stays down for longer than the TTL;
- the servers are independent primaries, not replicas of one another.

If one of these fails, two clients can hold the lock at the same time. The `quorum` option accepts any value from 1 to the number of servers. A quorum below a majority, for example `quorum: 1` with three servers, lets two clients hold the lock even when nothing fails; `RedLock` emits a one-time process warning (`REDLOCK_UNIVERSAL_MINORITY_QUORUM`) for it. Keep the default.

## When a lost lock is noticed

- **With `using()`**, the library extends the lock when about 80% of the TTL has passed. If that extension fails, because the key expired, another client holds it, or the server returned an error or timed out, the `AbortSignal` passed to your callback is aborted and `signal.error` holds the reason. Before that extension runs, a lost lock goes unnoticed, for up to about 80% of the TTL.
- For a single-server lock, an extension that starts with less than 10% of the TTL left (at most 2 seconds) is refused, even if the key is still yours, and the signal is aborted.
- Each Redis command times out after 5 seconds by default. A hanging extension can abort the signal that much later; with a short TTL, that can be after the lock has expired.
- `using()` does not stop your callback. Check `signal.aborted` in long-running work, or pass the signal to APIs that accept one, and stop when it fires.
- `signal.reason` and `signal.throwIfAborted()` carry a generic `AbortError`. Read `signal.error` for the cause.
- **With `acquire()` and `release()`**, nothing extends the lock. You learn that it was lost when `extend()` or `release()` returns `false`.

## Efficiency or correctness

Ask what happens if two processes hold the lock at the same time.

- **Efficiency:** the work runs twice. That costs time or money, but the data stays correct. Examples: rebuilding a cache entry, running a cleanup job. A Redis lock fits well.
- **Correctness:** two holders corrupt data, charge a customer twice or send a message twice. A lock alone is not enough. Protect the resource itself.

### Protect the resource

Make the write fail when someone else changed the data after you read it:

- **Version check.** Store a version with the data and update only if it is unchanged:

  ```sql
  UPDATE orders SET status = 'paid', version = version + 1
  WHERE id = $1 AND version = $2;
  -- 0 rows updated: another writer got there first. Stop.
  ```

- **Compare-and-set** in the data store: a Lua script or `WATCH`/`MULTI` in Redis, a condition expression in DynamoDB, a conditional write (`If-Match`) in S3 or Google Cloud Storage, a transaction in etcd.
- **Idempotency keys or unique constraints**, so that repeating an operation has no second effect.
- **Fencing tokens** checked by the resource. This library does not issue them.

## When to use something else

- **Postgres advisory locks, or `SELECT … FOR UPDATE SKIP LOCKED`**, when the data lives in Postgres. The lock and the data share one transaction.
- **etcd or ZooKeeper**, when the lock must stay correct through failures. They are built on consensus, and the etcd revision or ZooKeeper zxid can serve as a fencing token.
- **A durable-execution platform or a job queue**, when work must run exactly once across retries and crashes, or when callers must wait in order. Waiting for a lock here is polling, not a queue.

## Checklist for servers that hold locks

- `maxmemory-policy noeviction`.
- Persistence that matches your needs. For Redlock servers: AOF with `appendfsync always`, or keep a restarted server out of service for longer than the TTL.
- Server clocks kept in sync without step changes.
- A TTL well above the expected run time plus possible pauses. Use `using()` for long work.

## Further reading

- Redis: [Distributed locks with Redis](https://redis.io/docs/latest/develop/clients/patterns/distributed-locks/)
- Martin Kleppmann: [How to do distributed locking](https://martin.kleppmann.com/2016/02/08/how-to-do-distributed-locking.html)
- Salvatore Sanfilippo: [Is Redlock safe?](https://antirez.com/news/101)
- Valkey: [Replication](https://valkey.io/topics/replication/)
- Amazon ElastiCache: [Durability options](https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/Durability.Options.html)
