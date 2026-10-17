/**
 * Coffee Shops Write Routes — community proposals
 *
 * POST /coffee-shops        — propose a new shop
 * PUT  /coffee-shops/:id    — propose a change to an existing shop
 *
 * Neither route modifies the published `coffee_shops` table. A valid request
 * is queued in `shop_submissions` as 'pending' and answered with
 * 202 Accepted + `status: 'pending_review'`. There is deliberately no public
 * (or private) publication/moderation endpoint yet.
 *
 * Every write under /api has already passed the shared write rate limiter
 * (src/lib/middleware.js). Per-route order is load-bearing:
 *   0. kill switch     — SUBMISSIONS_ENABLED=false → 503 before any work.
 *   1. validate        — pure; a malformed request is rejected with 400
 *                        before it can reserve an idempotency key or touch
 *                        the queue.
 *   2. withIdempotency — dedupes retries of the same logical submission.
 *   3. handler         — existence check (PUT) + capacity-bounded insert.
 *
 * Body shape mirrors what the frontend `public/submit.js` sends:
 *   { shop: { displayName: { text }, formattedAddress, state,
 *             priceLevel?, phoneNumber?, website?, description? } }
 */

const { asyncHandler } = require('../lib/async-handler');
const { withIdempotency } = require('../lib/idempotency');
const { UnavailableError } = require('../usecases/errors');
const {
    parseShopId,
    validateShopProposal,
    makeSubmitShopProposalUseCase,
} = require('../usecases/submissions');

// Operator kill switch (SUBMISSIONS_ENABLED=false): refuse before any work.
function requireSubmissionsEnabled(config) {
    return (req, res, next) => {
        if (config.submissionsEnabled) return next();
        return next(new UnavailableError(
            'SUBMISSIONS_DISABLED',
            'Community submissions are temporarily closed. Please try again later.',
        ));
    };
}

function validate(kind, enums) {
    return (req, res, next) => {
        try {
            req.submission = {
                kind,
                targetShopId: kind === 'update' ? parseShopId(req.params.id) : null,
                proposal: validateShopProposal(req.body, enums),
            };
            next();
        } catch (err) {
            next(err);
        }
    };
}

function sendAccepted(res, { submissionId }, { kind, targetShopId, proposal }) {
    res.set('Cache-Control', 'no-store');
    res.status(202).json({
        success: true,
        data: {
            submissionId,
            status: 'pending_review',
            kind,
            targetShopId,
            message: 'Thanks! Your submission was received and is pending review.',
            displayName: { text: proposal.name, languageCode: proposal.languageCode },
            formattedAddress: proposal.address,
            state: proposal.state,
            priceLevel: proposal.priceLevel,
        },
    });
}

function mountCoffeeShops(router, deps) {
    const { db, logger, enums, config } = deps;
    const idempotent = withIdempotency({ db, logger });
    const submitShopProposal = makeSubmitShopProposalUseCase({
        db,
        queueMax: config.submissionQueueMax,
    });

    const handle = asyncHandler(async (req, res) => {
        const result = await submitShopProposal(req.submission);
        (req.log || logger).info(
            {
                event: 'shop_submission_queued',
                submissionId: result.submissionId,
                kind: req.submission.kind,
                targetShopId: req.submission.targetShopId,
            },
            'Community submission queued for review',
        );
        return sendAccepted(res, result, req.submission);
    });

    const open = requireSubmissionsEnabled(config);

    router.post('/coffee-shops', open, validate('create', enums), idempotent, handle);
    router.put('/coffee-shops/:id', open, validate('update', enums), idempotent, handle);
}

module.exports = { mountCoffeeShops };
