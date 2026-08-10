#!/usr/bin/env node
/**
 * build-feed.mjs — assembles templates/*.json into the single feed file
 * fetchTemplatePack() (src/core/registry.js) expects at TEMPLATE_FEED.
 *
 * This is deliberately dumb: read files, validate shape, dedupe, write one
 * JSON blob. No server, no accounts — matches the README's "v1 stays a pure
 * client-side product" stance, since the output is static JSON deployable
 * to literally any static host.
 */
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SECRET_HEADER, SECRET_PARAM } from '../src/core/registry.js';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const TEMPLATES_DIR = join(ROOT, 'templates');
const OUT_FILE = join(ROOT, 'dist', 'templates.json');

const REQUIRED_FIELDS = ['v', 'host', 'urlPattern', 'method', 'spec'];

export function validateTemplate(t) {
  if (!t || typeof t !== 'object') return 'not an object';
  for (const f of REQUIRED_FIELDS) {
    if (t[f] === undefined || t[f] === null) return `missing "${f}"`;
  }
  if (typeof t.host !== 'string' || !t.host.includes('.')) return 'host looks wrong';
  if (typeof t.urlPattern !== 'string' || !t.urlPattern.startsWith('/')) return 'urlPattern looks wrong';
  if (!t.spec || !Array.isArray(t.spec.itemsPath) || typeof t.spec.fields !== 'object') {
    return 'spec.itemsPath / spec.fields missing or malformed';
  }
  // The export flow (toTemplate() in registry.js) already strips these; this
  // re-checks against the SAME patterns as a safety net, not a second
  // independent guess at what "looks secret" means.
  for (const h of t.headerNames || []) {
    if (SECRET_HEADER.test(h)) return `headerNames contains something that looks like a secret: "${h}"`;
  }
  for (const q of t.queryKeys || []) {
    if (SECRET_PARAM.test(q)) return `queryKeys contains something that looks like a secret: "${q}"`;
  }
  return null;
}

export function templateKeyOf(t) {
  return `${t.host}|${t.urlPattern}`;
}

/** Given raw {filename, template} entries, drop invalid ones and dedupe by
 * (host, urlPattern), keeping whichever is more recently contributed. */
export function buildFeed(entries) {
  const warnings = [];
  const byKey = new Map();

  for (const { filename, template } of entries) {
    const reason = validateTemplate(template);
    if (reason) {
      warnings.push(`${filename}: skipped — ${reason}`);
      continue;
    }
    const key = templateKeyOf(template);
    const existing = byKey.get(key);
    if (!existing || (template.contributedAt || 0) >= (existing.template.contributedAt || 0)) {
      if (existing) warnings.push(`${filename}: superseded an older contribution for ${key}`);
      byKey.set(key, { filename, template });
    } else {
      warnings.push(`${filename}: duplicate of ${existing.filename} for ${key}, older — skipped`);
    }
  }

  return {
    templates: [...byKey.values()].map((v) => v.template),
    warnings,
  };
}

async function main() {
  let files = [];
  try {
    files = (await readdir(TEMPLATES_DIR)).filter((f) => f.endsWith('.json'));
  } catch {
    console.log('No templates/ directory yet — writing an empty feed.');
  }

  const entries = [];
  for (const filename of files) {
    try {
      const raw = await readFile(join(TEMPLATES_DIR, filename), 'utf8');
      entries.push({ filename, template: JSON.parse(raw) });
    } catch (e) {
      entries.push({ filename, template: null });
      console.warn(`${filename}: could not parse — ${e.message}`);
    }
  }

  const { templates, warnings } = buildFeed(entries);
  for (const w of warnings) console.warn(w);

  await mkdir(dirname(OUT_FILE), { recursive: true });
  await writeFile(OUT_FILE, JSON.stringify({ v: 1, generatedAt: new Date().toISOString(), templates }, null, 2));

  console.log(`Wrote ${templates.length} template(s) from ${files.length} file(s) to ${OUT_FILE}`);
}

// Only run when invoked directly (`node scripts/build-feed.mjs`), not when
// imported by tests.
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
