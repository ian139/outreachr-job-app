#!/usr/bin/env node

import { createRequire } from 'node:module';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..');
const generatedResources = path.join(repositoryRoot, 'apps', 'desktop', 'resources', 'generated');
const desktopRequire = createRequire(path.join(repositoryRoot, 'apps', 'desktop', 'package.json'));
const wasmSource = desktopRequire.resolve('sql.js/dist/sql-wasm.wasm');

await fs.rm(generatedResources, { recursive: true, force: true });
await fs.mkdir(generatedResources, { recursive: true });
await fs.copyFile(wasmSource, path.join(generatedResources, 'sql-wasm.wasm'));

const wasm = await fs.readFile(path.join(generatedResources, 'sql-wasm.wasm'));
if (!WebAssembly.validate(wasm)) throw new Error('Prepared sql.js WASM runtime is invalid');

console.log('Prepared development SQLite runtime resources.');
