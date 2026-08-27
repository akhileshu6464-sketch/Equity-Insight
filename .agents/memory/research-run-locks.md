---
name: Fail-closed research run locks
description: Why long-running publication locks use owner-fenced release and do not auto-expire.
---

Use a fixed primary-key lock row with a per-run owner token. Release must match both the fixed row ID and the owner token. Do not automatically reclaim a lock based only on age unless every later publication write is also fenced by the current owner.

**Why:** An age-based reclaim can let a second run acquire the lock while the original process is still generating. Owner-aware release stops the old process from deleting the new lock, but it does not stop the old process from publishing. Failing closed trades availability after a crash for protection against concurrent publishers and mixed research generations.

**How to apply:** Keep automatic stale reclamation disabled for research publication. If a process is interrupted, use an authorized operational cleanup that verifies no run is active, clears the matching lock safely, and reconciles research, evidence, and cross-check row counts before retrying.