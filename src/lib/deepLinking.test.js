/**
 * Unit tests for deep linking utilities
 * Run with: npm test -- deepLinking.test.js
 */

import {
  parseCustomURI,
  parseWebURI,
  generateDeepLink,
  handleDeepLink,
} from './deepLinking';

describe('deepLinking', () => {
  describe('parseCustomURI', () => {
    it('should parse custom URI with screen and ID', () => {
      const result = parseCustomURI('billtap://session/abc123');
      expect(result).toEqual({
        route: '/SessionHost',
        params: { sessionId: 'abc123' },
      });
    });

    it('should parse custom URI with query params', () => {
      const result = parseCustomURI('billtap://claim/xyz?name=John');
      expect(result).toEqual({
        route: '/Claim',
        params: { sessionId: 'xyz', name: 'John' },
      });
    });

    it('should return null for invalid protocol', () => {
      const result = parseCustomURI('https://example.com');
      expect(result).toBeNull();
    });
  });

  describe('parseWebURI', () => {
    it('should parse web URI with normalized params', () => {
      const result = parseWebURI('/SessionHost', '?sessionId=abc123');
      expect(result).toEqual({
        route: '/SessionHost',
        params: { sessionId: 'abc123' },
      });
    });

    it('should normalize param names', () => {
      const result = parseWebURI('/Claim', '?session_id=xyz&rid=456');
      expect(result).toEqual({
        route: '/Claim',
        params: { sessionId: 'xyz', receiptId: '456' },
      });
    });
  });

  describe('generateDeepLink', () => {
    it('should generate web deep link', () => {
      const result = generateDeepLink('session', { sessionId: 'abc123' }, 'web');
      expect(result).toBe('/SessionHost?sessionId=abc123');
    });

    it('should generate custom URI', () => {
      const result = generateDeepLink('claim', { sessionId: 'xyz' }, 'custom');
      expect(result).toBe('billtap://claim?sessionId=xyz');
    });

    it('should handle missing params', () => {
      const result = generateDeepLink('dashboard', {}, 'web');
      expect(result).toBe('/Dashboard');
    });
  });

  describe('handleDeepLink', () => {
    it('should extract route and state from location', () => {
      const result = handleDeepLink({
        pathname: '/Claim',
        search: '?sessionId=abc123',
      });
      expect(result).toEqual({
        route: '/Claim',
        params: { sessionId: 'abc123' },
        state: { sessionId: 'abc123' },
      });
    });
  });
});