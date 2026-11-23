/**
 * Reviewer email notification for community submissions.
 *
 * After a proposal is queued, the reviewer is emailed its contents so it can
 * be reviewed without polling the queue. Rules:
 *
 *   - Best effort and off the request path. `notify` never throws and never
 *     delays the 202; a failed email is logged by submission id only. The
 *     queue stays the source of truth (`npm run review`, operator-only).
 *   - Bounded. At most `maxPerHour` emails per process per hour. Past the cap
 *     submissions are still queued; the next email that goes out says how many
 *     were skipped. A burst of spam submissions cannot flood the inbox or
 *     exhaust the Resend quota.
 *   - Inert content. Everything in the email comes from an anonymous
 *     visitor. The text part is plain text. The HTML part escapes every
 *     value and makes nothing clickable, so a submitted "website" is shown,
 *     never linked. The subject is truncated and stripped of control
 *     characters.
 *   - At most once per submission. The Resend Idempotency-Key is derived from
 *     the submission id, so a retry cannot send a duplicate. An idempotent
 *     HTTP replay never reaches the use case, so it doesn't send one either.
 *   - Logs never contain the recipient, the key or any submitted content.
 */

const API = 'https://api.resend.com/emails';
const USER_AGENT = 'localcoffeeshop-backend-submissions/1.0';
const SUBJECT_NAME_MAX = 60;
const HOUR_MS = 60 * 60 * 1000;

const PRICE_LABELS = {
    PRICE_LEVEL_INEXPENSIVE: 'Inexpensive ($)',
    PRICE_LEVEL_MODERATE: 'Moderate ($$)',
    PRICE_LEVEL_EXPENSIVE: 'Expensive ($$$)',
};

// Bidi overrides/isolates and line separators can visually reorder or split
// text; C0/C1 controls have no business in a subject line.
const UNSAFE_INLINE = /[\u0000-\u001F\u007F-\u009F\u2028\u2029\u202A-\u202E\u2066-\u2069]/g;

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Defuse auto-linking in mail clients: "https://x.example" → "https://x[.]example".
 * The reviewer can still read and copy the address; nothing is clickable.
 */
function defang(value) {
    return String(value).replace(/\./g, '[.]').replace(/^(https?):\/\//i, '$1[:]//');
}

/**
 * Free-text fields: break anything a mail client might auto-link. That covers
 * schemes ("https://"), email addresses ("@") and bare domains ("evil.com"):
 * a dot between a word character and two or more letters becomes "[.]".
 * Ordinary prose ("e.g.", "10 Main St.") is untouched.
 */
function defangText(value) {
    return String(value)
        .replace(/\b([a-z][a-z0-9+.-]*):\/\//gi, '$1[:]//')
        .replace(/@/g, '[@]')
        .replace(/([A-Za-z0-9-])\.(?=[A-Za-z]{2,})/g, '$1[.]');
}

function inline(value) {
    return String(value).replace(UNSAFE_INLINE, ' ');
}

/**
 * @param {{ submissionId: number, kind: 'create'|'update', targetShopId: number|null,
 *           proposal: Object, skipped?: number }} s
 * @returns {{ subject: string, text: string, html: string }}
 */
function buildSubmissionEmail({ submissionId, kind, targetShopId, proposal, skipped = 0 }) {
    let name = inline(proposal.name).trim();
    if (name.length > SUBJECT_NAME_MAX) name = `${name.slice(0, SUBJECT_NAME_MAX - 1)}…`;
    const what = kind === 'update' ? `Update to shop ${targetShopId}` : 'New shop';
    const subject = `[LocalCoffeeShop] Submission #${submissionId} pending review: ${what}: ${name}`;

    const fields = [
        ['Submission', `#${submissionId}`],
        ['Type', kind === 'update' ? `Update to published shop ${targetShopId}` : 'New shop'],
        ['Name', proposal.name],
        ['Address', proposal.address],
        ['State', proposal.state],
        ['Price level', proposal.priceLevel ? (PRICE_LABELS[proposal.priceLevel] || proposal.priceLevel) : null],
        ['Phone', proposal.phoneNumber],
        ['Website', proposal.website ? defang(proposal.website) : null],
        ['Language', proposal.languageCode],
        ['Description', proposal.description],
    ].filter(([, v]) => v !== null && v !== undefined && v !== '')
        .map(([k, v]) => [k, k === 'Website' ? v : defangText(v)]);

    const commands = [
        `npm run review -- --postgres show ${submissionId}`,
        `npm run review -- --postgres approve ${submissionId} --expect-sha256 <payloadSha256 from show> --reviewer <you> --reason "<why>" --apply`,
        `npm run review -- --postgres reject ${submissionId} --expect-sha256 <payloadSha256 from show> --reviewer <you> --reason "<why>" --apply`,
    ];
    const skippedNote = skipped > 0
        ? `${skipped} earlier submission(s) were queued without an email (hourly email cap). Run \`list\` to see them all.`
        : null;
    const warning = 'Submitted anonymously and not yet verified. Treat every field as untrusted; '
        + 'links are deliberately not clickable. Approving does not publish anything.';

    const text = [
        'A community submission is waiting for review.',
        '',
        ...fields.map(([k, v]) => `${k}: ${String(v).includes('\n') ? `\n  ${String(v).split('\n').join('\n  ')}` : v}`),
        '',
        warning,
        ...(skippedNote ? ['', skippedNote] : []),
        '',
        'Review it from the backend checkout, with REVIEW_DATABASE_URL set to your lcs_review login (docs/security/submission-review-cli.md):',
        ...commands.map((c) => `  ${c}`),
        '',
    ].join('\n');

    const rows = fields.map(([k, v]) => `<tr><th align="left" valign="top" style="padding:4px 12px 4px 0">${escapeHtml(k)}</th>`
        + `<td style="padding:4px 0;white-space:pre-wrap">${escapeHtml(v)}</td></tr>`).join('');
    const html = '<!doctype html><html><body style="font-family:sans-serif;font-size:14px;color:#222">'
        + '<p>A community submission is waiting for review.</p>'
        + `<table cellspacing="0" cellpadding="0">${rows}</table>`
        + `<p style="color:#8a4b00">${escapeHtml(warning)}</p>`
        + (skippedNote ? `<p><b>${escapeHtml(skippedNote)}</b></p>` : '')
        + '<p>Review it with <code>REVIEW_DATABASE_URL</code> set to your <code>lcs_review</code> login:</p>'
        + `<pre style="background:#f4f1ec;padding:8px;white-space:pre-wrap">${escapeHtml(commands.join('\n'))}</pre>`
        + '</body></html>';

    return { subject, text, html };
}

/**
 * @param {Object} deps
 * @param {ReturnType<import('./notify-config').loadSubmissionNotifyConfig>} deps.config
 * @param {Object} deps.logger Pino-shaped logger
 * @param {Function} [deps.fetchImpl]
 * @param {() => number} [deps.nowMs]
 * @param {number} [deps.timeoutMs]
 * @returns {{ enabled: boolean, notify: (s: Object) => Promise<'sent'|'capped'|'failed'|'disabled'> }}
 */
function makeSubmissionNotifier({ config, logger, fetchImpl = globalThis.fetch, nowMs = Date.now, timeoutMs = 5000 }) {
    if (!config || !config.enabled) {
        return { enabled: false, notify: async () => 'disabled' };
    }

    let windowStart = nowMs();
    let sentInWindow = 0;
    let skipped = 0;

    function takeSlot() {
        const now = nowMs();
        if (now - windowStart >= HOUR_MS) {
            windowStart = now;
            sentInWindow = 0;
        }
        if (sentInWindow >= config.maxPerHour) return false;
        sentInWindow += 1;
        return true;
    }

    async function post(body, idempotencyKey) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const res = await fetchImpl(API, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${config.apiKey}`,
                    'User-Agent': USER_AGENT,
                    'Content-Type': 'application/json',
                    Accept: 'application/json',
                    'Idempotency-Key': idempotencyKey,
                },
                body: JSON.stringify(body),
                signal: controller.signal,
            });
            return res.status;
        } finally {
            clearTimeout(timer);
        }
    }

    async function notify(submission) {
        const log = { event: 'submission_notify', submissionId: submission.submissionId };
        let carried = 0;
        try {
            if (!takeSlot()) {
                skipped += 1;
                logger.warn({ ...log, outcome: 'capped' }, 'Submission email skipped: hourly cap reached');
                return 'capped';
            }
            // Reserve the skipped count synchronously, before any await, so
            // concurrent sends never report (or subtract) the same skips twice.
            // Restored below if this email fails.
            carried = skipped;
            skipped = 0;
            const email = buildSubmissionEmail({ ...submission, skipped: carried });
            const body = { from: config.from, to: [config.to], subject: email.subject, text: email.text, html: email.html };
            const key = `lcs-submission-${submission.submissionId}`;

            let status;
            for (let attempt = 0; attempt < 2; attempt++) {
                try {
                    status = await post(body, key);
                } catch {
                    status = 0; // network error or timeout
                }
                if (status >= 200 && status < 300) break;
                if (status !== 0 && status !== 429 && status < 500) break; // not retryable
            }
            if (status >= 200 && status < 300) {
                logger.info({ ...log, outcome: 'sent' }, 'Submission email sent to reviewer');
                return 'sent';
            }
            skipped += carried;
            logger.error({ ...log, outcome: 'failed', status }, 'Submission email failed; the submission is queued regardless');
            return 'failed';
        } catch (err) {
            skipped += carried;
            logger.error({ ...log, outcome: 'failed', errName: err && err.name }, 'Submission email failed; the submission is queued regardless');
            return 'failed';
        }
    }

    return { enabled: true, notify };
}

module.exports = { makeSubmissionNotifier, buildSubmissionEmail };
