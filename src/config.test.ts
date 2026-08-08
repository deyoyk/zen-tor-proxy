import test from 'node:test';
import assert from 'node:assert/strict';
import { ConfigError, loadConfig, socksUrlForPort } from './config.js';

test('loads defaults from empty env', () => {
  const cfg = loadConfig({});
  assert.equal(cfg.PORT, 5678);
  assert.equal(cfg.HOST, '127.0.0.1');
  assert.equal(cfg.UPSTREAM_URL, 'https://opencode.ai/zen/v1/chat/completions');
  assert.equal(cfg.IP_ROTATE_INTERVAL_MS, 600_000);
  assert.equal(cfg.AUTO_INSTALL_TOR, true);
  assert.equal(cfg.UPSTREAM_TIMEOUT_MS, 300_000);
  assert.equal(cfg.LOG_LEVEL, 'info');
  assert.ok(cfg.IP_CHECK_PROVIDERS.length >= 1);
});

test('rejects an invalid port', () => {
  assert.throws(() => loadConfig({ PORT: 'not-a-number' }), ConfigError);
});

test('rejects an invalid log level', () => {
  assert.throws(() => loadConfig({ LOG_LEVEL: 'verbose' }), ConfigError);
});

test('parses explicit values', () => {
  const cfg = loadConfig({
    PORT: '9000',
    IP_ROTATE_INTERVAL_MS: '300000',
    AUTO_INSTALL_TOR: 'false',
    LOG_LEVEL: 'debug',
    ZEN_API_KEY: 'sk-test',
  });
  assert.equal(cfg.PORT, 9000);
  assert.equal(cfg.IP_ROTATE_INTERVAL_MS, 300_000);
  assert.equal(cfg.AUTO_INSTALL_TOR, false);
  assert.equal(cfg.LOG_LEVEL, 'debug');
  assert.equal(cfg.ZEN_API_KEY, 'sk-test');
});

test('parses comma-separated IP check providers', () => {
  const cfg = loadConfig({ IP_CHECK_PROVIDERS: 'https://a.example/ip, https://b.example/ip' });
  assert.deepEqual(cfg.IP_CHECK_PROVIDERS, ['https://a.example/ip', 'https://b.example/ip']);
});

test('treats empty-string values as unset (works with a copied .env.example)', () => {
  const cfg = loadConfig({
    ZEN_API_KEY: '',
    TOR_BINARY_PATH: '',
    PORT: '',
    LOG_LEVEL: '',
  });
  assert.equal(cfg.ZEN_API_KEY, 'public');
  assert.equal(cfg.TOR_BINARY_PATH, undefined);
  assert.equal(cfg.PORT, 5678);
  assert.equal(cfg.LOG_LEVEL, 'info');
});

test('socks url helper', () => {
  assert.equal(socksUrlForPort(9150), 'socks5h://127.0.0.1:9150');
});
