/**
 * Metrics Module
 *
 * Single factory that builds a prom-client Registry and the eight named
 * counter/histogram handles the app uses. Returning them as an object lets
 * the app pass the registry to the /metrics route and the individual
 * handles to whatever code records them.
 */

const promClient = require('prom-client');

/**
 * Build a fresh metrics registry with the standard handles populated.
 *
 * @returns {{
 *   registry: import('prom-client').Registry,
 *   httpDuration: import('prom-client').Histogram,
 *   httpTotal: import('prom-client').Counter,
 *   dbDuration: import('prom-client').Histogram,
 *   dbErrors: import('prom-client').Counter,
 *   cacheHits: import('prom-client').Counter,
 *   cacheMisses: import('prom-client').Counter,
 * }}
 */
function buildMetrics() {
    const registry = new promClient.Registry();

    promClient.collectDefaultMetrics({ register: registry });

    const httpDuration = new promClient.Histogram({
        name: 'http_request_duration_seconds',
        help: 'Duration of HTTP requests in seconds',
        labelNames: ['method', 'route', 'status_code'],
        buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5],
    });

    const httpTotal = new promClient.Counter({
        name: 'http_requests_total',
        help: 'Total number of HTTP requests',
        labelNames: ['method', 'route', 'status_code'],
    });

    const dbDuration = new promClient.Histogram({
        name: 'database_query_duration_seconds',
        help: 'Duration of database queries in seconds',
        labelNames: ['query_type'],
        buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1],
    });

    const dbErrors = new promClient.Counter({
        name: 'database_errors_total',
        help: 'Total number of database errors',
        labelNames: ['query_type'],
    });

    const cacheHits = new promClient.Counter({
        name: 'cache_hits_total',
        help: 'Total number of cache hits',
        labelNames: ['cache_key'],
    });

    const cacheMisses = new promClient.Counter({
        name: 'cache_misses_total',
        help: 'Total number of cache misses',
        labelNames: ['cache_key'],
    });

    registry.registerMetric(httpDuration);
    registry.registerMetric(httpTotal);
    registry.registerMetric(dbDuration);
    registry.registerMetric(dbErrors);
    registry.registerMetric(cacheHits);
    registry.registerMetric(cacheMisses);

    return {
        registry,
        httpDuration,
        httpTotal,
        dbDuration,
        dbErrors,
        cacheHits,
        cacheMisses,
    };
}

module.exports = { buildMetrics };
