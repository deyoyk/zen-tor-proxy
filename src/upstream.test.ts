import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from './config.js';
import { isQuotaError, shouldRotateOnError } from './proxy/upstream.js';

const cfg = loadConfig({});

test('detects quota errors by status code', () => {
  assert.equal(isQuotaError(402, ''), true);
  assert.equal(isQuotaError(429, '{"error":"Free usage exceeded"}'), true);
  assert.equal(isQuotaError(200, 'ok body'), false);
  assert.equal(isQuotaError(400, 'bad request'), false);
});

test('detects quota errors by message keywords', () => {
  assert.equal(isQuotaError(200, 'Free usage exceeded. retrying in 4h 0m'), true);
  assert.equal(isQuotaError(200, 'You have exceeded your usage limit'), true);
  assert.equal(isQuotaError(403, 'quota exhausted for this IP'), true);
  assert.equal(isQuotaError(200, 'some unrelated message'), false);
});

test('shouldRotateOnError rotates on quota errors', () => {
  assert.equal(shouldRotateOnError(cfg, { status: 429, body: 'free usage exceeded', kind: 'http' }), true);
  assert.equal(shouldRotateOnError(cfg, { status: 402, body: '', kind: 'http' }), true);
  assert.equal(shouldRotateOnError(cfg, { status: 200, body: 'Free usage exceeded', kind: 'http' }), true);
});

test('shouldRotateOnError rotates on any 4xx/5xx by default', () => {
  assert.equal(shouldRotateOnError(cfg, { status: 400, body: 'bad request', kind: 'http' }), true);
  assert.equal(shouldRotateOnError(cfg, { status: 401, body: 'unauthorized', kind: 'http' }), true);
  assert.equal(shouldRotateOnError(cfg, { status: 500, body: 'internal', kind: 'http' }), true);
  assert.equal(shouldRotateOnError(cfg, { status: 200, body: 'ok', kind: 'http' }), false);
});

test('shouldRotateOnError rotates on network failures', () => {
  assert.equal(shouldRotateOnError(cfg, { status: null, body: '', kind: 'network' }), true);
});

test('shouldRotateOnError respects the any-error toggle', () => {
  const quotaOnly = loadConfig({ ROTATE_ON_ANY_UPSTREAM_ERROR: 'false' });
  assert.equal(shouldRotateOnError(quotaOnly, { status: 400, body: 'bad request', kind: 'http' }), false);
  assert.equal(shouldRotateOnError(quotaOnly, { status: 429, body: '', kind: 'http' }), true);
  assert.equal(shouldRotateOnError(quotaOnly, { status: null, body: '', kind: 'network' }), true);
});

test('shouldRotateOnError respects the master switch', () => {
  const off = loadConfig({ ROTATE_ON_UPSTREAM_ERROR: 'false' });
  assert.equal(shouldRotateOnError(off, { status: 429, body: '', kind: 'http' }), false);
  assert.equal(shouldRotateOnError(off, { status: null, body: '', kind: 'network' }), false);
});
