# Private submission review CLI (local SQLite operator tooling)

Status as of 2026-10-17, branch `feat/submission-review-local-20261017`, base `a41e136`.

`scripts/review-submissions.js` lets an operator **list, inspect and record a moderation decision** on rows in the `shop_submissions` queue (see [community-submissions.md](community-submissions.md)). It is a local command-line tool. Nothing in `src/` imports it, it has no HTTP surface, and a test enforces this (`scope guard` in `tests/integration/review-submissions.test.js`).

This slice does **not** make the queue durable, does **not** publish anything, and does **not** change production. Submissions stay closed in production (`SUBMISSIONS_ENABLED` unset). The release gates below are all still open.

## What a decision means

| Command | Stored status | Meaning |
|---|---|---|
| `approve` | `approved` | A moderator judged the proposal acceptable. **It is NOT published.** |
| `reject` | `rejected` | A moderator declined the proposal. |

The tool never reads or writes `coffee_shops`. No publication path exists, whether endpoint, export or job. Every `show`, dry-run and apply output carries `"published": false` plus a notice saying so.

*Naming decision.* The commands keep the existing schema vocabulary (`approved`/`rejected`, already enforced by the `shop_submissions` CHECK constraint) rather than introducing `accept-for-export`. Adding a new status would mean rebuilding a forward-only table. Using a command name that differs from the stored status would make the audit harder to read. "Export" would also imply a pipeline that does not exist. Any future publication step must treat `approved` as "eligible for a separate, human-reviewed publication change", not as "live".

## Usage

```bash
DB=/path/outside/repo/copy.db          # required; there is no default
node scripts/review-submissions.js --db "$DB" list [--status pending|approved|rejected|all] [--limit 1-500]
node scripts/review-submissions.js --db "$DB" show <id>
# copy payloadSha256 from `show`, then:
node scripts/review-submissions.js --db "$DB" approve <id> --expect-sha256 <hex> --reviewer <id> --reason "<text>"          # dry run
node scripts/review-submissions.js --db "$DB" approve <id> --expect-sha256 <hex> --reviewer <id> --reason "<text>" --apply  # writes
```

`reject` takes the same options. Output is JSON on stdout. Errors go to stderr. Exit codes: `0` ok, `1` refused/failed, `2` usage error.

## Safety properties (each covered by a subprocess test against a real SQLite file)

- **Database selection.** `--db` is mandatory. `:memory:`, `file:` URIs and empty values are rejected. The path must already exist as a regular file and is opened without `OPEN_CREATE`, so a typo never creates a database. The tracked `data/coffee_shops.db` is refused by canonical path and by inode, so absolute, relative, `..`, file-symlink and directory-symlink spellings are all refused. All arguments are validated **before** the database is touched.
- **No automatic migrations.** If `shop_submissions` or `submission_reviews` is missing, the tool refuses and tells the operator to run `npm run migrate -- up` explicitly against that file.
- **Read-only by default.** `list`, `show` and decision dry runs open the file `OPEN_READONLY`. Tests prove the file and its directory are byte-identical afterwards (no journal). Only `--apply` opens read-write.
- **Minimal output.** Columns come from an explicit allowlist (never `SELECT *`), so request metadata such as an IP, user agent or token would not be printed even if a future schema added it. Output escapes C0/C1 controls, DEL, line separators and bidi overrides. Echoed error text is sanitized.
- **Explicit mutation gates.** A decision requires a strict submission id (`^[1-9][0-9]{0,9}$`), `--expect-sha256`, `--reviewer` (1–64 of `A-Za-z0-9._@-`), `--reason` (1–500 chars after trimming, single line) and `--apply`. Duplicate, unknown or misplaced options are usage errors.
- **Stale-review protection.** `payloadSha256` is SHA-256 over `JSON.stringify(["lcs-shop-submission-v1", id, kind, target_shop_id, name, address, state, price_level, phone_number, website, description, language_code, created_at])`. If the row's content changed after `show`, or the digest belongs to another submission, both dry run and apply refuse it as `stale review`. Status is not part of the digest; it is guarded separately.
- **Pending-only, final, atomic.** Apply runs in `BEGIN IMMEDIATE`. It re-reads the row, checks the digest and `status = 'pending'`, inserts the audit row, then runs `UPDATE … WHERE id = ? AND status = 'pending'` (exactly one row), then commits. Any failure rolls back both writes; this is tested by injecting a trigger failure after the audit insert. Replays and contradicting decisions fail with "not pending". Concurrent processes wait on an explicit 5 s busy timeout, and exactly one decision lands (tested with 8 racing processes).
- **Audit table** (`migrations/20261017_03_create_submission_reviews.sql`, additive and forward-only): `submission_id` (UNIQUE), `old_status` (= `pending`), `new_status`, `reviewer`, `reason`, `payload_sha256`, `decided_at` (epoch seconds). CHECK constraints bound every field. Triggers reject `UPDATE`/`DELETE`, so rows are append-only. `migrate down` refuses the file (no down section), and the ledger and audit rows are retained.

## Identity and authority

`--reviewer` is **audit attribution, not authentication.** Anyone who can run the script can type any reviewer id. The actual authority is whoever has OS-level and file-level write access to the database file. Restrict that with normal filesystem permissions and, once storage moves, with database roles. **The owner of the review process is still unconfirmed.** Recording a reviewer id does not establish who that owner is.

## Known limitations

- The path check and the open are not one atomic operation. Someone with write access to the directories involved could swap a symlink in between. The tracked-DB refusal guards against operator mistakes, not against an adversary who already has that access.
- Free-text `reason` is stored indefinitely in an append-only table. Reviewers should not put personal data in it. Retention and redaction policy is undecided.
- A decision is final in this tool. Reopening a submission needs a separate, audited design.

## Deferred: storage and release gates (unchanged by this slice)

Production serves an ephemeral SQLite file baked into the image, so queued proposals **and** this audit would be lost on every deploy. This tool is for local or operator-held copies only. Storage design is deliberately deferred. A managed PostgreSQL option exists in the account, but whether it can be shared, how much capacity it has, and who owns it are all unknown. No adapter was written and no deployment was chosen. Before `SUBMISSIONS_ENABLED=true`:

1. **Durable storage** chosen by the owner. Proposals, idempotency reservations/outcomes and this review audit must move together, with transactional enqueue, idempotency and capacity enforcement. Re-run the fresh/existing migration, rollback, concurrency and retention tests on that storage, plus a restore drill.
2. **Idempotency** edge cases closed on the new storage: the expired-key 409 (B-01) and fail-open on storage error (B-02b).
3. **Confirmed reviewer/owner** with a documented cadence, retention and privacy policy, plus least-privilege identities. The public app must not be able to decide or publish. Reviewer access must be separate and authenticated by the storage/OS layer.
4. **Proxy verification**: the real DigitalOcean App Platform `X-Forwarded-For` hop behaviour must be verified against `trust proxy = 1` before relying on per-IP write limits.
5. **Publication** stays a separate, explicitly reviewed change (for example, a human-reviewed data PR). It is not built here.
