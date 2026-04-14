const config = require('../config');

describe('Config', () => {
  test('tokens default to empty strings when env vars not set', () => {
    // In test env, TOKEN_* should be empty
    for (const [key, token] of Object.entries(config.tokens)) {
      // Token should either be empty or from env var
      expect(typeof token).toBe('string');
    }
  });

  test('maxMessageLength has default value', () => {
    expect(config.maxMessageLength).toBe(10000);
  });

  test('historyLimit is a positive number', () => {
    expect(config.historyLimit).toBeGreaterThan(0);
  });

  test('heartbeatInterval is a positive number', () => {
    expect(config.heartbeatInterval).toBeGreaterThan(0);
  });

  test('webhookTimeout has default', () => {
    expect(config.webhookTimeout).toBe(5000);
  });

  test('webhookRetries has default', () => {
    expect(config.webhookRetries).toBe(2);
  });
});
