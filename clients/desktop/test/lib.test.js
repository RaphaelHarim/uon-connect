'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { normalizeServerUrl, permissionAllowed, sameOrigin, isExternalWebLink } = require('../src/lib.js');

test('normalizes typed addresses and requires https on public hosts', () => {
  assert.equal(normalizeServerUrl('connect.exemplo.com.br'), 'https://connect.exemplo.com.br');
  assert.equal(normalizeServerUrl(' https://connect.exemplo.com.br/login?x=1 '), 'https://connect.exemplo.com.br');
  assert.equal(normalizeServerUrl('http://connect.exemplo.com.br'), null);
  assert.equal(normalizeServerUrl('http://192.168.1.50:3000'), 'http://192.168.1.50:3000');
  assert.equal(normalizeServerUrl('http://localhost:3000'), 'http://localhost:3000');
  assert.equal(normalizeServerUrl('https://user:pw@connect.exemplo.com.br'), null);
  assert.equal(normalizeServerUrl('javascript:alert(1)'), null);
  assert.equal(normalizeServerUrl(''), null);
});

test('grants only call/notification permissions and only to the server', () => {
  const o = 'https://connect.exemplo.com.br';
  assert.equal(permissionAllowed('media', `${o}/reunioes/1`, o), true);
  assert.equal(permissionAllowed('notifications', o, o), true);
  assert.equal(permissionAllowed('geolocation', o, o), false);
  assert.equal(permissionAllowed('media', 'https://evil.example/x', o), false);
  assert.equal(sameOrigin('https://connect.exemplo.com.br.evil.example/', o), false);
});

test('only web links go to the system browser', () => {
  assert.equal(isExternalWebLink('https://www.exemplo.com'), true);
  assert.equal(isExternalWebLink('file:///etc/passwd'), false);
  assert.equal(isExternalWebLink('ms-settings:privacy'), false);
});
