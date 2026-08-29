import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

interface PackageMetadata {
  version?: unknown;
}

export function readServiceVersion(): string {
  const packagePath = fileURLToPath(new URL('../package.json', import.meta.url));
  const packageMetadata = JSON.parse(
    readFileSync(packagePath, 'utf8'),
  ) as PackageMetadata;

  if (
    typeof packageMetadata.version !== 'string' ||
    !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(packageMetadata.version)
  ) {
    throw new Error('Service package version must be a valid semantic version.');
  }

  return packageMetadata.version;
}
