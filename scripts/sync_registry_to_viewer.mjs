#!/usr/bin/env node
/**
 * Copy the measurement registry into the production viewer's served assets.
 *
 * The viewer fetches the registry at runtime rather than bundling an import, so
 * the numbers it shows come from a file on disk that can be checked against the
 * source. This script keeps that copy honest: it is a copy, never a fork, and
 * scripts/test_viewer_measurement_parity.mjs fails the build if the two differ.
 */
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(ROOT, 'contracts', 'measurement-registry.json');
const TARGET = join(ROOT, 'viewer', 'public', 'measurement-registry.json');
mkdirSync(dirname(TARGET), { recursive: true });
copyFileSync(SOURCE, TARGET);
const sha = createHash('sha256').update(readFileSync(TARGET)).digest('hex');
console.log(`SYNCED ${relative(ROOT, SOURCE)} -> ${relative(ROOT, TARGET)} (sha256 ${sha.slice(0, 12)}…)`);
