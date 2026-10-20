# Roaster-subscription interest waitlist

An **interest-only** list for a possible monthly coffee subscription featuring
local roasters. It is not a checkout, takes no payment, and promises no price,
roaster partnership or launch date. Public shop submissions are unrelated and
unchanged.

## Flow (double opt-in, stateless)

1. `POST /api/v1/waitlist/subscribe` `{ email, consent: true, source: "home"|"roasters", company: "" }`
   validates the body, applies spam controls, and sends one confirmation email
   through Resend. Response: `202 { status: "pending_confirmation" }`.
   Provider acceptance means the email was handed off; the person is **not**
   on the list. No contact or segment is written at this step. Addresses
   that are globally unsubscribed or on the suppression segment get the same
   202 but no email (the response never reveals list state). Retries in the
   same 10-minute window, on any instance or after a restart, send a
   byte-identical payload under the same `Idempotency-Key`, so Resend sends
   once.
2. The email links to `https://<frontend>/waitlist/confirm/#token=…`. The token
   is in the URL fragment (never sent to a server). The page scrubs it from the
   URL before Google Analytics configures, and does nothing until the person
   presses **Confirm my interest**. Link scanners that GET the page confirm
   nothing, and the API has no GET waitlist routes.
3. `POST /api/v1/waitlist/confirm` `{ token }` → `200 { status, conversion }`:
   - `confirmed`: the contact was created if absent and added to the dedicated segment.
   - `already_confirmed`: a replay, a second tab, or an existing member. No writes.
   - `unsubscribed_globally`: the contact has Resend's global `unsubscribed`
     flag. Nothing is written; the person is not silently re-subscribed.
   - `suppressed`: the address is on the CoffeeShop suppression segment
     (it unsubscribed). Nothing is added. If a concurrent unsubscribe landed
     during this confirm, the membership just added is removed again.
4. `POST /api/v1/waitlist/unsubscribe` `{ token }` (link in the email) first
   adds the contact to the dedicated **suppression segment**, creating the
   contact (`email`, `unsubscribed: false` only) if it doesn't exist, and then
   removes list membership → `unsubscribed` | `not_subscribed`. Both
   statuses record the opt-out, so an old confirm token can never re-add the
   address, even if it unsubscribed before confirming, and even after a
   restart or on another instance. Rejoining after an unsubscribe is an
   operator action: remove the contact from the suppression segment in
   Resend, then the person signs up again.

### `conversion` — what a confirm can honestly claim

Resend has no conditional ("add only if not a member") operation and its
add-to-segment call does not say whether membership is new. So the backend
cannot guarantee a globally unique "new signup" across instances. Every
confirm result carries `conversion`:

| `conversion` | Meaning | Analytics |
| --- | --- | --- |
| `observed_new` | This request read "not a member", and its add succeeded. | Count as a confirmed signup (best effort: two instances racing on one token can both observe it). |
| `ambiguous` | Now a member, but this request's add errored and the re-read showed membership, so it can't tell who created it. | Show success; **do not** count. |
| `none` | No new membership (`already_confirmed`, `suppressed`, `unsubscribed_globally`). | Do not count. |

In-process concurrent confirms of the same address (double click, two tabs)
are collapsed: only the first can return `observed_new`.

Errors use the standard envelope with a stable `error.code`:
`VALIDATION_FAILED` (400, with `fields: [{field, code}]`),
`WAITLIST_TOKEN_INVALID` (400), `WAITLIST_TOKEN_EXPIRED` (410),
`WAITLIST_ORIGIN_FORBIDDEN` (403), `WAITLIST_RATE_LIMITED` (429),
`WAITLIST_PROVIDER_ERROR` (502), and `WAITLIST_UNAVAILABLE` (503, `Retry-After`).
All responses are `Cache-Control: no-store`.

Tokens (`src/waitlist/tokens.js`, `v2.`) are deterministic authenticated
encryption, built SIV-style from purpose-specific HKDF keys derived from
`WAITLIST_SIGNING_SECRET`. The synthetic IV is `HMAC(macKey, plaintext)`. A
one-time AES-256-GCM key and nonce are derived from it, so distinct messages
never share a key/nonce pair (no GCM nonce reuse). Opening re-checks the HMAC
over the decrypted plaintext. The address is never in cleartext in a link.
Identical inputs give identical tokens, which is what makes retried emails
byte-identical. Expiry is measured from the end of the 10-minute signup
bucket (confirm 48h by default, unsubscribe ~400 days), and tokens are bound
to the segment id and frontend origin. A token minted for another
configuration is rejected. Resend is the only durable store (list
membership and suppression); nothing is written to SQLite.

## Provider isolation (Resend)

Resend contacts are global to a Resend team, and `unsubscribed` is a global
flag. The adapter (`src/waitlist/resend-provider.js`):

- is bound to two dedicated segment ids, the list and the suppression list,
  and cannot address any other segment;
- verifies **both** segments by id **and** exact expected name before any
  write. `WAITLIST_RESEND_SEGMENT_NAME` must contain "localcoffeeshop".
  `WAITLIST_RESEND_SUPPRESSION_SEGMENT_NAME` must also contain
  "suppression"/"unsubscribe"/"opt-out", and its id and name must differ from
  the list's. On mismatch it fails closed with 503. The app never creates
  segments; both must be provisioned by an operator first;
- never removes suppression membership;
- creates a contact only if none exists (`email`, `unsubscribed: false`), never
  PATCHes or deletes contacts, and never flips the global flag;
- reads provider state again after any failed create or segment add, because
  Resend does not document the "already exists" or "already a member"
  responses;
- retries timeouts, network errors, 429 and 5xx (bounded `Retry-After`).
  The email `Idempotency-Key` is an HMAC of the full payload. Identical
  payload means identical key, so Resend never sees one key with two bodies
  (`409 invalid_idempotent_request`), even across deploys that change the
  email copy.
- assumes Resend reads reflect completed writes (read-your-writes). The
  confirm/unsubscribe race handling depends on it.

**Known limitation (shared Resend team).** If the team is shared with another
business, an address that is already a contact there is the same contact.
Confirming only adds our segment membership. However, a Resend-hosted
unsubscribe (broadcast footer or preference page) sets the global flag, and
that flag affects every business on the team. Our own unsubscribe link is
segment-scoped. For full isolation, use a Resend team or account dedicated to
LocalCoffeeShop, or Resend Topics, before sending any broadcasts to this
segment.

**Suppression durability.** The opt-out lives in Resend as membership of the
suppression segment. It survives restarts and redeploys, but not deletion of
the contact or the segment. Contacts are team-global, so deleting the contact
for any business erases the suppression too. Never delete contacts in this
Resend team without checking the suppression segment, and never broadcast to
the suppression segment.

## Spam and abuse controls

- The shared write limiter (all `/api` writes) applies, plus a per-IP
  subscribe limit (`WAITLIST_IP_MAX` per `WAITLIST_IP_WINDOW_MS`).
- At most `WAITLIST_EMAIL_MAX_PER_DAY` confirmation emails per address,
  keyed by HMAC so addresses are not held in memory.
- `WAITLIST_GLOBAL_SENDS_PER_HOUR` caps total sends.
- Quota is reserved synchronously before any provider call, so concurrent
  requests cannot overshoot. It is charged once per address per 10-minute
  bucket: retries in the bucket share the in-flight send or return 202 with
  no provider call. A definite provider rejection (4xx other than
  408/409/429, or failing before the send) releases the reservation. An
  ambiguous failure (timeout, network, 5xx) keeps it, and a retry in the
  same bucket reuses it.
- Honeypot field `company`: when filled, the response is the normal 202 and nothing is sent.
- Bodies are allowlisted and bounded (10kb parser limit; email ≤ 254 chars,
  token ≤ 1024 chars, `[A-Za-z0-9._-]`). A foreign `Origin` gets 403.
- Limits and send dedup are in-memory, per process; the API runs as a single
  instance. With N instances, the caps become N× per window. Correctness
  (no duplicate email per bucket, no re-subscribe after opt-out) does not
  depend on this memory.

## Logging

Logs contain only event names (`waitlist_confirmation_sent`,
`waitlist_confirmed`, `waitlist_provider_error` with kind/status/code, and so
on). They never contain addresses, tokens or provider response bodies.

## Configuration

See `.env.example` (`WAITLIST_*`). Required: `WAITLIST_ENABLED=true`,
`WAITLIST_RESEND_API_KEY`, `WAITLIST_RESEND_SEGMENT_ID`,
`WAITLIST_RESEND_SEGMENT_NAME`, `WAITLIST_SIGNING_SECRET`, `WAITLIST_FROM`
(sender on the frontend domain or a subdomain), `WAITLIST_RESEND_SUPPRESSION_SEGMENT_ID`,
`WAITLIST_RESEND_SUPPRESSION_SEGMENT_NAME`, and `WAITLIST_FRONTEND_ORIGIN`
(listed in `CORS_ORIGIN`; an unset/empty `CORS_ORIGIN` keeps the waitlist
disabled). If anything is missing or invalid, the waitlist is
disabled with a boot warning that names only the variables. The rest of the
API is unaffected. `.do/app-spec.yaml` is intentionally unchanged: the
deployed API stays closed (503) until an operator adds these as secrets.
