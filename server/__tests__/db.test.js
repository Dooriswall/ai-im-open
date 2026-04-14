const db = require('../db');
const config = require('../config');

describe('Database Operations', () => {
  beforeAll(async () => {
    await db.init();
  });

  test('getUserByToken returns null for empty token', () => {
    const user = db.getUserByToken('');
    expect(user).toBeNull();
  });

  test('getUserByToken returns null for non-existent token', () => {
    const user = db.getUserByToken('nonexistent-token-12345');
    expect(user).toBeNull();
  });

  test('createUser creates a valid user', () => {
    const user = db.createUser({
      username: 'testuser',
      displayName: 'Test User',
      emoji: '🤖',
      role: 'ai'
    });
    expect(user.username).toBe('testuser');
    expect(user.displayName).toBe('Test User');
    expect(user.token).toBeTruthy();
    expect(user.token.length).toBeGreaterThanOrEqual(16);
  });

  test('getUserByToken finds created user', () => {
    const user = db.createUser({ username: 'tokenfindtest', displayName: 'Token Find' });
    const found = db.getUserByToken(user.token);
    expect(found).toBeTruthy();
    expect(found.username).toBe('tokenfindtest');
  });

  test('saveMessage and getMessages work with normal content', () => {
    const msg = db.saveMessage('testuser', 'general', 'Hello world', 'text');
    expect(msg).toBeTruthy();
    const msgs = db.getMessages('general', 10);
    expect(Array.isArray(msgs)).toBe(true);
  });

  test('saveMessage handles empty content', () => {
    const msg = db.saveMessage('testuser', 'general', '', 'text');
    expect(msg).toBeTruthy();
  });

  test('saveMessage handles very long content', () => {
    const longContent = 'A'.repeat(15000);
    const msg = db.saveMessage('testuser', 'general', longContent, 'text');
    expect(msg).toBeTruthy();
  });

  test('saveMessage handles special characters (emoji, SQL quotes)', () => {
    const specialContent = '🎉 Hello "world" \'test\' <script>alert(1)</script>';
    const msg = db.saveMessage('testuser', 'general', specialContent, 'text');
    expect(msg).toBeTruthy();
    const msgs = db.getMessages('general', 1);
    if (msgs.length > 0) {
      expect(msgs[0].content).toContain('🎉');
    }
  });

  test('searchMessages with LIKE injection - percent sign returns 0 results', () => {
    db.saveMessage('testuser', 'general', 'normal message for search test', 'text');
    const results = db.searchMessages('%', 'general', 10);
    // Should NOT return all messages when searching for %
    expect(results.length).toBe(0);
  });

  test('searchMessages with LIKE injection - underscore', () => {
    db.saveMessage('testuser', 'general', 'abc', 'text');
    const results = db.searchMessages('_', 'general', 10);
    // Should NOT match single character messages via _
    expect(results.length).toBe(0);
  });

  test('searchMessages with normal keyword works', () => {
    db.saveMessage('testuser', 'general', 'unique_keyword_hello', 'text');
    const results = db.searchMessages('unique_keyword', 'general', 10);
    expect(results.length).toBeGreaterThan(0);
  });
});
