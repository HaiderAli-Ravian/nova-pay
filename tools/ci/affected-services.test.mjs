import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyChanges,
  compareSemver,
  parseSemver,
  SERVICES,
  validateVersionChange,
} from './affected-services.mjs';

test('selects only directly changed services in stable order', () => {
  assert.deepEqual(
    classifyChanges([
      'services/transaction-service/src/main.ts',
      'services/account-service/src/main.ts',
    ]).selected,
    ['account-service', 'transaction-service'],
  );
});

test('supports changed filenames containing whitespace', () => {
  assert.deepEqual(
    classifyChanges(['services/fx-service/notes with spaces.md']).selected,
    ['fx-service'],
  );
});

test('selects every service for shared, workflow, infrastructure, and unknown paths', () => {
  for (const file of [
    'package-lock.json',
    '.github/workflows/validate.yml',
    'infra/docker-compose.yml',
    'unexpected-runtime-file.js',
  ]) {
    assert.deepEqual(classifyChanges([file]).selected, [...SERVICES]);
  }
  assert.equal(classifyChanges(['infra/nginx/nginx.conf']).infrastructureChanged, true);
});

test('does not build services for public documentation-only changes', () => {
  assert.deepEqual(classifyChanges(['README.md', 'decisions.md']).selected, []);
});

test('rejects invalid semantic versions', () => {
  assert.throws(() => parseSemver('1.2'), /Invalid semantic version/);
  assert.throws(() => parseSemver('01.2.3'), /Invalid semantic version/);
});

test('compares patch, minor, major, and prerelease versions', () => {
  assert.equal(compareSemver('1.2.4', '1.2.3'), 1);
  assert.equal(compareSemver('1.3.0', '1.2.9'), 1);
  assert.equal(compareSemver('2.0.0', '1.99.99'), 1);
  assert.equal(compareSemver('1.0.0', '1.0.0-rc.1'), 1);
  assert.equal(compareSemver('1.0.0-rc.1', '1.0.0'), -1);
});

test('requires a strict version increase for directly changed services', () => {
  assert.throws(
    () => validateVersionChange('account-service', '1.2.3', '1.2.3'),
    /must increase/,
  );
  assert.throws(
    () => validateVersionChange('account-service', '1.2.3', '1.2.2'),
    /must increase/,
  );
  assert.doesNotThrow(() =>
    validateVersionChange('account-service', '1.2.3', '1.2.4'),
  );
});

test('requires new services to begin at 0.1.0', () => {
  assert.doesNotThrow(() =>
    validateVersionChange('new-service', null, '0.1.0', true),
  );
  assert.throws(
    () => validateVersionChange('new-service', null, '1.0.0', true),
    /must start at version 0.1.0/,
  );
});
