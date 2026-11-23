/**
 * Unit Tests — reviewer email notification for community submissions
 * (src/submissions/notify-config.js, src/submissions/email-notifier.js)
 */

const { loadSubmissionNotifyConfig } = require('../../../src/submissions/notify-config');
const { makeSubmissionNotifier, buildSubmissionEmail } = require('../../../src/submissions/email-notifier');

const KEY = 're_test_abcdefghijklmnop';
const ENV = {
    SUBMISSION_NOTIFY_ENABLED: 'true',
    SUBMISSION_NOTIFY_RESEND_API_KEY: KEY,
    SUBMISSION_NOTIFY_TO: 'reviewer@example.com',
    SUBMISSION_NOTIFY_FROM: 'LocalCoffeeShop <submissions@mail.example.com>',
};

const PROPOSAL = {
    name: 'Corner Roasters',
    address: '10 Market St, San Francisco, California 94105',
    state: 'CA',
    priceLevel: 'PRICE_LEVEL_MODERATE',
    phoneNumber: '+1 555 0100',
    website: 'https://corner.example/menu',
    description: 'Line one\nSee www.spam.example or http://phish.example/login',
    languageCode: 'en',
};

function submission(overrides = {}) {
    return { submissionId: 42, kind: 'create', targetShopId: null, proposal: { ...PROPOSAL }, ...overrides };
}

function fakeLogger() {
    const entries = [];
    const at = (level) => (obj, msg) => entries.push({ level, obj, msg });
    return { entries, info: at('info'), warn: at('warn'), error: at('error'), debug: at('debug') };
}

function fakeFetch(statuses = [200]) {
    const calls = [];
    const fn = async (url, init) => {
        calls.push({ url, init, body: JSON.parse(init.body) });
        const status = statuses[Math.min(calls.length - 1, statuses.length - 1)];
        if (status === 'throw') throw new TypeError('network down');
        return { status, ok: status >= 200 && status < 300, json: async () => ({ id: 'email_1' }) };
    };
    fn.calls = calls;
    return fn;
}

describe('loadSubmissionNotifyConfig', () => {
    it('is disabled unless SUBMISSION_NOTIFY_ENABLED is exactly true', () => {
        expect(loadSubmissionNotifyConfig({ ...ENV, SUBMISSION_NOTIFY_ENABLED: '' })).toMatchObject({ enabled: false, reason: 'disabled' });
        expect(loadSubmissionNotifyConfig({ ...ENV, SUBMISSION_NOTIFY_ENABLED: 'yes' })).toMatchObject({ enabled: false, reason: 'disabled' });
    });

    it('enables with every setting valid; the cap defaults to 20 per hour', () => {
        expect(loadSubmissionNotifyConfig(ENV)).toMatchObject({
            enabled: true, to: 'reviewer@example.com', from: ENV.SUBMISSION_NOTIFY_FROM, apiKey: KEY, maxPerHour: 20,
        });
    });

    it.each([
        ['SUBMISSION_NOTIFY_RESEND_API_KEY', '', /SUBMISSION_NOTIFY_RESEND_API_KEY is required/],
        ['SUBMISSION_NOTIFY_RESEND_API_KEY', 'sk_live_nope', /must be a Resend API key/],
        ['SUBMISSION_NOTIFY_TO', '', /SUBMISSION_NOTIFY_TO is required/],
        ['SUBMISSION_NOTIFY_TO', 'a@example.com, b@example.com', /single email address/],
        ['SUBMISSION_NOTIFY_FROM', 'Bad <Name> <x@example.com>', /SUBMISSION_NOTIFY_FROM must be/],
        ['SUBMISSION_NOTIFY_MAX_PER_HOUR', '0', /SUBMISSION_NOTIFY_MAX_PER_HOUR must be an integer between 1 and 1000$/],
    ])('%s=%j is misconfigured, and the problem never echoes the value', (name, value, message) => {
        const cfg = loadSubmissionNotifyConfig({ ...ENV, [name]: value });
        expect(cfg).toMatchObject({ enabled: false, reason: 'misconfigured' });
        expect(cfg.problems.join('\n')).toMatch(message);
        if (value.length > 3) expect(cfg.problems.join('\n')).not.toContain(value);
    });

    it('never falls back to the waitlist key', () => {
        const cfg = loadSubmissionNotifyConfig({ ...ENV, SUBMISSION_NOTIFY_RESEND_API_KEY: '', WAITLIST_RESEND_API_KEY: KEY });
        expect(cfg.enabled).toBe(false);
    });
});

describe('buildSubmissionEmail', () => {
    it('includes every submitted field, the review commands and the not-published warning', () => {
        const { subject, text } = buildSubmissionEmail(submission());
        expect(subject).toBe('[LocalCoffeeShop] Submission #42 pending review: New shop: Corner Roasters');
        for (const part of ['Corner Roasters', '10 Market St', 'CA', 'Moderate ($$)', '+1 555 0100', 'Line one']) {
            expect(text).toContain(part);
        }
        expect(text).toContain('npm run review -- --postgres show 42');
        expect(text).toContain('--postgres approve 42 --expect-sha256');
        expect(text).toMatch(/Approving does not publish anything/);
    });

    it('labels update proposals with the targeted published shop', () => {
        const { subject, text } = buildSubmissionEmail(submission({ kind: 'update', targetShopId: 7 }));
        expect(subject).toContain('Update to shop 7');
        expect(text).toContain('Type: Update to published shop 7');
    });

    it('escapes HTML and makes no submitted URL clickable', () => {
        const { text, html } = buildSubmissionEmail(submission({
            proposal: { ...PROPOSAL, name: '<img src=x onerror=alert(1)>', description: '<a href="https://evil.example">click</a> & www.evil.example' },
        }));
        expect(html).not.toMatch(/<img|<a /i);
        expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
        expect(html).not.toMatch(/https?:\/\/(corner|evil|phish)/);
        expect(text).not.toMatch(/https?:\/\/(corner|evil|phish)/);
        expect(text).toContain('https[:]//corner[.]example/menu');
        expect(text).toContain('www[.]evil[.]example');
    });

    it('defuses bare domains and email addresses in free text, but leaves ordinary prose alone', () => {
        const { text, html } = buildSubmissionEmail(submission({
            proposal: { ...PROPOSAL, description: 'Visit attacker.com or mail help@attacker.co.uk, e.g. at 10 Main St. today', address: '1 Main St. Ste 2' },
        }));
        for (const body of [text, html]) {
            expect(body).not.toMatch(/attacker\.com|attacker\.co|help@/);
            expect(body).toContain('attacker[.]com');
            expect(body).toContain('help[@]attacker[.]co[.]uk');
            expect(body).toContain('e.g. at 10 Main St. today');
            expect(body).toContain('1 Main St. Ste 2');
        }
    });

    it('keeps the subject on one line, free of bidi tricks, and bounded', () => {
        const { subject } = buildSubmissionEmail(submission({
            proposal: { ...PROPOSAL, name: `Evil‮gnp.exe ${'x'.repeat(200)}` },
        }));
        expect(subject).not.toMatch(/[\u0000-\u001F‪-‮⁦-⁩]/);
        expect(subject.length).toBeLessThan(140);
        expect(subject.endsWith('…')).toBe(true);
    });
});

describe('makeSubmissionNotifier', () => {
    const config = loadSubmissionNotifyConfig(ENV);

    it('is inert when disabled: never calls fetch', async () => {
        const fetchImpl = fakeFetch();
        const n = makeSubmissionNotifier({ config: loadSubmissionNotifyConfig({}), logger: fakeLogger(), fetchImpl });
        expect(n.enabled).toBe(false);
        expect(await n.notify(submission())).toBe('disabled');
        expect(fetchImpl.calls).toHaveLength(0);
    });

    it('sends one email to the reviewer with an idempotency key derived from the submission id', async () => {
        const fetchImpl = fakeFetch([200]);
        const logger = fakeLogger();
        const n = makeSubmissionNotifier({ config, logger, fetchImpl });
        expect(await n.notify(submission())).toBe('sent');
        expect(fetchImpl.calls).toHaveLength(1);
        const [{ url, init, body }] = fetchImpl.calls;
        expect(url).toBe('https://api.resend.com/emails');
        expect(init.headers.Authorization).toBe(`Bearer ${KEY}`);
        expect(init.headers['Idempotency-Key']).toBe('lcs-submission-42');
        expect(body).toMatchObject({ from: ENV.SUBMISSION_NOTIFY_FROM, to: ['reviewer@example.com'] });
        expect(body.subject).toContain('#42');
    });

    it('retries once on 5xx, 429 or a network error, with the same idempotency key', async () => {
        for (const first of [500, 429, 'throw']) {
            const fetchImpl = fakeFetch([first, 200]);
            const n = makeSubmissionNotifier({ config, logger: fakeLogger(), fetchImpl });
            expect(await n.notify(submission())).toBe('sent');
            expect(fetchImpl.calls.map((c) => c.init.headers['Idempotency-Key'])).toEqual(['lcs-submission-42', 'lcs-submission-42']);
        }
    });

    it('does not retry a 4xx; a failure resolves (never throws) and logs no content, address or key', async () => {
        const fetchImpl = fakeFetch([422]);
        const logger = fakeLogger();
        const n = makeSubmissionNotifier({ config, logger, fetchImpl });
        await expect(n.notify(submission())).resolves.toBe('failed');
        expect(fetchImpl.calls).toHaveLength(1);
        const logged = JSON.stringify(logger.entries);
        expect(logged).toContain('"submissionId":42');
        for (const secret of [KEY, 'reviewer@example.com', 'Corner Roasters', '555 0100']) {
            expect(logged).not.toContain(secret);
        }
    });

    it('a throwing fetch on every attempt still resolves to failed', async () => {
        const n = makeSubmissionNotifier({ config, logger: fakeLogger(), fetchImpl: fakeFetch(['throw']) });
        await expect(n.notify(submission())).resolves.toBe('failed');
    });

    it('concurrent sends report each skipped submission exactly once; a failed send hands its count on', async () => {
        let now = 0;
        const pending = [];
        let failNext = false;
        const fetchImpl = async (url, init) => {
            const body = JSON.parse(init.body);
            const status = failNext ? 422 : 200;
            await new Promise((r) => pending.push(r));
            return { status, ok: status === 200, body };
        };
        const calls = [];
        const recording = async (url, init) => { calls.push(JSON.parse(init.body)); return fetchImpl(url, init); };
        const n = makeSubmissionNotifier({
            config: loadSubmissionNotifyConfig({ ...ENV, SUBMISSION_NOTIFY_MAX_PER_HOUR: '1' }),
            logger: fakeLogger(),
            fetchImpl: recording,
            nowMs: () => now,
        });
        const settle = async () => { while (pending.length) pending.shift()(); await new Promise((r) => setImmediate(r)); };

        const first = n.notify(submission({ submissionId: 1 }));
        await n.notify(submission({ submissionId: 2 })); // capped
        await n.notify(submission({ submissionId: 3 })); // capped
        await settle();
        expect(await first).toBe('sent');

        // New hour, cap 1: one send carries the 2 skips; a concurrent one is capped.
        now += 60 * 60 * 1000;
        failNext = true;
        const carrier = n.notify(submission({ submissionId: 4 }));
        expect(await n.notify(submission({ submissionId: 5 }))).toBe('capped');
        await settle();
        expect(await carrier).toBe('failed');
        expect(calls[1].text).toMatch(/2 earlier submission\(s\)/);

        // The failed send's 2 skips plus #5 are all reported by the next email.
        now += 60 * 60 * 1000;
        failNext = false;
        const next = n.notify(submission({ submissionId: 6 }));
        await settle();
        expect(await next).toBe('sent');
        expect(calls[2].text).toMatch(/3 earlier submission\(s\)/);
    });

    it('caps emails per hour; the next email after the window reports how many were skipped', async () => {
        let now = 0;
        const fetchImpl = fakeFetch([200]);
        const n = makeSubmissionNotifier({
            config: loadSubmissionNotifyConfig({ ...ENV, SUBMISSION_NOTIFY_MAX_PER_HOUR: '2' }),
            logger: fakeLogger(),
            fetchImpl,
            nowMs: () => now,
        });
        const results = [];
        for (let id = 1; id <= 5; id++) results.push(await n.notify(submission({ submissionId: id })));
        expect(results).toEqual(['sent', 'sent', 'capped', 'capped', 'capped']);
        expect(fetchImpl.calls).toHaveLength(2);

        now += 60 * 60 * 1000;
        expect(await n.notify(submission({ submissionId: 6 }))).toBe('sent');
        expect(fetchImpl.calls[2].body.text).toMatch(/3 earlier submission\(s\) were queued without an email/);

        expect(await n.notify(submission({ submissionId: 7 }))).toBe('sent');
        expect(fetchImpl.calls[3].body.text).not.toMatch(/queued without an email/);
    });
});
