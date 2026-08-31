#!/usr/bin/env node

import { appendFileSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const SERVICES = Object.freeze([
  'account-service',
  'admin-service',
  'fx-service',
  'ledger-service',
  'payroll-service',
  'transaction-service',
]);

const SERVICE_SET = new Set(SERVICES);
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export function classifyChanges(paths) {
  const selected = new Set();
  const directlyChanged = new Set();
  let allServices = false;
  let infrastructureChanged = false;

  for (const rawPath of paths) {
    const file = rawPath.replace(/^\.\//, '');
    if (!file) continue;

    const serviceMatch = /^services\/([^/]+)\//.exec(file);
    if (serviceMatch) {
      if (!SERVICE_SET.has(serviceMatch[1])) {
        allServices = true;
      } else {
        selected.add(serviceMatch[1]);
        directlyChanged.add(serviceMatch[1]);
      }
      continue;
    }

    if (file.startsWith('infra/')) {
      infrastructureChanged = true;
      allServices = true;
      continue;
    }

    if (file === 'postman/docker-compose.yml') {
      infrastructureChanged = true;
      allServices = true;
      continue;
    }

    if (file.startsWith('postman/')) continue;

    if (
      file.startsWith('.github/') ||
      file.startsWith('tools/ci/') ||
      /^(package(?:-lock)?\.json|tsconfig(?:\.[^/]+)?\.json|eslint\.config\.[^/]+)$/.test(file)
    ) {
      allServices = true;
      continue;
    }

    if (
      file.startsWith('docs/') ||
      /^(README|API_EXAMPLES|decisions|LICENSE|SECURITY|CONTRIBUTING)(?:\.md)?$/i.test(file)
    ) {
      continue;
    }

    // Unknown paths are treated as shared runtime impact rather than skipped.
    allServices = true;
  }

  return {
    selected: allServices ? [...SERVICES] : [...selected].sort(),
    directlyChanged: [...directlyChanged].sort(),
    infrastructureChanged,
    allServices,
  };
}

export function parseSemver(version) {
  const match = SEMVER.exec(version);
  if (!match) throw new Error(`Invalid semantic version: ${version}`);
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4]?.split('.') ?? [],
  };
}

export function compareSemver(left, right) {
  const a = parseSemver(left);
  const b = parseSemver(right);
  for (const key of ['major', 'minor', 'patch']) {
    if (a[key] !== b[key]) return a[key] > b[key] ? 1 : -1;
  }
  if (a.prerelease.length === 0 || b.prerelease.length === 0) {
    return a.prerelease.length === b.prerelease.length
      ? 0
      : a.prerelease.length === 0
        ? 1
        : -1;
  }
  const length = Math.max(a.prerelease.length, b.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const av = a.prerelease[index];
    const bv = b.prerelease[index];
    if (av === undefined || bv === undefined) return av === undefined ? -1 : 1;
    if (av === bv) continue;
    const an = /^\d+$/.test(av);
    const bn = /^\d+$/.test(bv);
    if (an && bn) return Number(av) > Number(bv) ? 1 : -1;
    if (an !== bn) return an ? -1 : 1;
    return av > bv ? 1 : -1;
  }
  return 0;
}

export function validateVersionChange(service, baseVersion, currentVersion, isNew = false) {
  parseSemver(currentVersion);
  if (isNew) {
    if (currentVersion !== '0.1.0') {
      throw new Error(`${service} is new and must start at version 0.1.0`);
    }
    return;
  }
  if (!baseVersion) throw new Error(`Cannot read the base version for ${service}`);
  parseSemver(baseVersion);
  if (compareSemver(currentVersion, baseVersion) <= 0) {
    throw new Error(
      `${service} must increase its version above ${baseVersion}; current version is ${currentVersion}`,
    );
  }
}

function git(args, allowFailure = false) {
  const result = spawnSync('git', args, { encoding: 'utf8' });
  if (result.status !== 0 && !allowFailure) {
    throw new Error(result.stderr.trim() || `git ${args.join(' ')} failed`);
  }
  return result;
}

function packageVersion(service) {
  const packageJson = JSON.parse(
    readFileSync(`services/${service}/package.json`, 'utf8'),
  );
  parseSemver(packageJson.version);
  return packageJson.version;
}

function basePackageVersion(base, service) {
  const result = git(
    ['show', `${base}:services/${service}/package.json`],
    true,
  );
  if (result.status !== 0) return null;
  return JSON.parse(result.stdout).version;
}

function matrixFor(services) {
  return {
    include: services.map((service) => ({
      service,
      directory: `services/${service}`,
      workspace: `@novapay/${service}`,
      version: packageVersion(service),
    })),
  };
}

function fallbackResult(reason) {
  return {
    matrix: matrixFor(SERVICES),
    hasServices: true,
    infrastructureChanged: true,
    fallback: true,
    summary: `Selected all services: ${reason}`,
  };
}

export function parseArguments(argv) {
  const result = { mode: 'manual', head: 'HEAD' };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith('--')) throw new Error(`Unknown argument: ${argument}`);
    const key = argument.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${argument}`);
    result[key] = value;
    index += 1;
  }
  return result;
}

export function runDetection(options) {
  const zeroSha = /^0{40}$/;
  if (!options.base || zeroSha.test(options.base) || options.mode === 'manual') {
    return fallbackResult('no trustworthy comparison base was supplied');
  }
  if (git(['cat-file', '-e', `${options.base}^{commit}`], true).status !== 0) {
    return fallbackResult('the comparison base is unavailable');
  }

  let comparisonBase = options.base;
  if (options.mode === 'pull_request') {
    const mergeBase = git(['merge-base', options.base, options.head], true);
    if (mergeBase.status !== 0 || !mergeBase.stdout.trim()) {
      return fallbackResult('the pull-request merge base is unavailable');
    }
    comparisonBase = mergeBase.stdout.trim();
  }

  const diff = git(['diff', '--name-only', '-z', comparisonBase, options.head], true);
  if (diff.status !== 0) return fallbackResult('the changed-path diff failed');
  const paths = diff.stdout.split('\0').filter(Boolean);
  const classification = classifyChanges(paths);

  for (const service of classification.directlyChanged) {
    const baseVersion = basePackageVersion(comparisonBase, service);
    validateVersionChange(service, baseVersion, packageVersion(service), baseVersion === null);
  }

  return {
    matrix: matrixFor(classification.selected),
    hasServices: classification.selected.length > 0,
    infrastructureChanged: classification.infrastructureChanged,
    fallback: false,
    summary:
      classification.selected.length > 0
        ? `Selected services: ${classification.selected.join(', ')}`
        : 'No runtime services selected.',
  };
}

function emit(result, outputPath, summaryPath) {
  const output = {
    matrix: JSON.stringify(result.matrix),
    has_services: String(result.hasServices),
    infrastructure_changed: String(result.infrastructureChanged),
    fallback: String(result.fallback),
  };
  if (outputPath) {
    appendFileSync(
      outputPath,
      Object.entries(output).map(([key, value]) => `${key}=${value}\n`).join(''),
    );
  }
  if (summaryPath) appendFileSync(summaryPath, `### Change detection\n\n${result.summary}\n`);
  process.stdout.write(`${JSON.stringify({ ...result, ...output })}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const options = parseArguments(process.argv.slice(2));
    emit(runDetection(options), options.githubOutput, options.stepSummary);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
