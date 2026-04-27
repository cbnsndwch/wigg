#!/usr/bin/env node
// oxlint-disable no-console

import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const target = join(__dirname, '../wigg.ts');

const { status, error } = spawnSync(process.execPath, ['--import', 'tsx', target, ...process.argv.slice(2)], {
    stdio: 'inherit',
    windowsHide: true,
});

if (error) {
    console.error(error);
    process.exit(1);
}

process.exit(status ?? 1);
