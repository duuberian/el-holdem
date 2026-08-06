import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cacheControlForPath, createRateLimiter, isAllowedOrigin, safeAck, securityHeaders } from '../server/security.js';

describe('socket hardening', () => {
  it('turns a non-function acknowledgement into a safe no-op', () => {
    assert.doesNotThrow(() => safeAck('attacker-controlled')({ ok: false }));
  });

  it('limits repeated events by client identity within a time window', () => {
    let now = 1_000;
    const limiter = createRateLimiter({ limit: 2, windowMs: 10_000, now: () => now });
    assert.equal(limiter.allow('client-a'), true);
    assert.equal(limiter.allow('client-a'), true);
    assert.equal(limiter.allow('client-a'), false);
    assert.equal(limiter.allow('client-b'), true);
    now += 10_001;
    assert.equal(limiter.allow('client-a'), true);
  });

  it('rejects browser socket requests from another origin', () => {
    assert.equal(isAllowedOrigin({ origin: 'https://el-holdem.example', host: 'el-holdem.example' }), true);
    assert.equal(isAllowedOrigin({ origin: 'https://evil.example', host: 'el-holdem.example' }), false);
    assert.equal(isAllowedOrigin({ origin: undefined, host: 'el-holdem.example' }), true);
  });
});

describe('HTTP hardening', () => {
  it('sets browser isolation and content security headers', () => {
    const headers = securityHeaders();
    assert.equal(headers['X-Content-Type-Options'], 'nosniff');
    assert.equal(headers['X-Frame-Options'], 'DENY');
    assert.match(headers['Content-Security-Policy'], /default-src 'self'/);
    assert.match(headers['Content-Security-Policy'], /connect-src 'self'/);
  });

  it('prevents stale HTML and JavaScript after a deployment', () => {
    assert.equal(cacheControlForPath('/app/public/index.html'), 'no-cache');
    assert.equal(cacheControlForPath('/app/public/client.js'), 'no-cache');
    assert.equal(cacheControlForPath('/app/public/sw.js'), 'no-cache');
    assert.equal(cacheControlForPath('/app/public/style.css'), 'public, max-age=3600');
  });
});
