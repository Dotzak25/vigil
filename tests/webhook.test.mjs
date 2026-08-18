import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { formatWebhookPayload, isPlausibleWebhookUrl } from '../src/core/webhook.js';

describe('formatWebhookPayload — compatible with Discord and Slack without asking which', () => {
  test('carries both `content` (Discord) and `text` (Slack) with the same message', () => {
    const hit = { watcherName: 'CineStar H', title: '2 seats opened — score 96', body: 'Row H, seats 1, 2', url: 'https://example.com/book' };
    const payload = formatWebhookPayload(hit);
    assert.equal(payload.content, payload.text);
    assert.match(payload.content, /CineStar H/);
    assert.match(payload.content, /2 seats opened/);
    assert.match(payload.content, /Row H, seats 1, 2/);
    assert.match(payload.content, /https:\/\/example\.com\/book/);
  });

  test('omits the url line entirely when there is no url, rather than printing "null"', () => {
    const hit = { watcherName: 'Nike drop', title: 'Back in stock', body: 'US 10', url: null };
    const payload = formatWebhookPayload(hit);
    assert.ok(!payload.content.includes('null'));
    assert.equal(payload.content.split('\n').length, 2);
  });
});

describe('isPlausibleWebhookUrl', () => {
  test('accepts https URLs', () => {
    assert.equal(isPlausibleWebhookUrl('https://discord.com/api/webhooks/123/abc'), true);
    assert.equal(isPlausibleWebhookUrl('https://hooks.slack.com/services/x/y/z'), true);
  });

  test('rejects http, non-URLs, and empty input', () => {
    assert.equal(isPlausibleWebhookUrl('http://insecure.example.com/hook'), false);
    assert.equal(isPlausibleWebhookUrl('not a url'), false);
    assert.equal(isPlausibleWebhookUrl(''), false);
    assert.equal(isPlausibleWebhookUrl(null), false);
    assert.equal(isPlausibleWebhookUrl(undefined), false);
  });
});
