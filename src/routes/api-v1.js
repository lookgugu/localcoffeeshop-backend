/**
 * API v1 Router
 *
 * Composes the per-resource mounters under /api/v1 and applies the
 * cache-header envelope middleware to every response on that subtree.
 *
 * Also installs the legacy /api/* → /api/v1/* redirect for backward compat.
 */

const express = require('express');
const { attachCacheHeaders } = require('../lib/responses');
const { mountStates } = require('./states');
const { mountSearch } = require('./search');
const { mountOps } = require('./ops');

function mountApiV1(app, deps) {
    const router = express.Router();
    router.use(attachCacheHeaders);

    mountStates(router, deps);
    mountSearch(router, deps);
    mountOps(router, deps);

    app.use('/api/v1', router);

    // Backward compatibility: /api/* (not /api/v1/*) → /api/v1/*
    app.use('/api', (req, res, next) => {
        if (!req.path.startsWith('/v1/')) {
            const newPath = `/api/v1${req.path}`;
            deps.logger.debug({ oldPath: req.path, newPath }, 'Redirecting to API v1');
            const qs = req.url.includes('?')
                ? req.url.substring(req.url.indexOf('?'))
                : '';
            return res.redirect(301, `${newPath}${qs}`);
        }
        next();
    });
}

module.exports = { mountApiV1 };
