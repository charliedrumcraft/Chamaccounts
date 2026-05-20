#!/usr/bin/env node
/**
 * Génère build/release-notes.md pour electron-builder (corps de la GitHub Release).
 * Usage : node scripts/generate-release-notes.mjs [tag]   (ex. v1.0.1)
 * CI : GITHUB_REF_NAME=refs/tags/v1.0.1
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

function resolveTag() {
  const ref = process.env.GITHUB_REF_NAME ?? '';
  if (ref.startsWith('refs/tags/')) return ref.replace('refs/tags/', '');
  if (process.argv[2]) return process.argv[2];
  try {
    return execSync('git describe --tags --abbrev=0', { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    return 'v0.0.0';
  }
}

function listTags() {
  try {
    return execSync('git tag --sort=-version:refname', { cwd: root, encoding: 'utf8' })
      .trim()
      .split('\n')
      .filter(Boolean);
  } catch {
    return [];
  }
}

function previousTag(tag, tags) {
  const i = tags.indexOf(tag);
  if (i >= 0 && tags[i + 1]) return tags[i + 1];
  return null;
}

const tag = resolveTag();
const version = tag.replace(/^v/, '');
const tags = listTags();
const prev = previousTag(tag, tags);

/** Corps manuel versionné (RELEASE.md) — prioritaire pour les notes GitHub / electron-builder. */
function readReleaseDoc() {
  const releaseFile = path.join(root, 'RELEASE.md');
  if (!fs.existsSync(releaseFile)) return null;
  const raw = fs.readFileSync(releaseFile, 'utf8');
  const heading = `# Chamaccounts v${version}`;
  const altHeading = `# Chamaccounts ${version}`;
  const start =
    raw.indexOf(heading) >= 0
      ? raw.indexOf(heading)
      : raw.indexOf(altHeading) >= 0
        ? raw.indexOf(altHeading)
        : -1;
  if (start < 0) return null;
  const rest = raw.slice(start);
  const next = rest.slice(1).search(/^# Chamaccounts v/m);
  const section = next >= 0 ? rest.slice(0, next + 1) : rest;
  return section.trim();
}

let commits = '';
try {
  const cmd = prev
    ? `git log ${prev}..${tag} --pretty=format:"- %s (%h)" --no-merges`
    : tagExists(tag)
      ? `git log ${tag} --pretty=format:"- %s (%h)" --no-merges -30`
      : 'git log -30 --pretty=format:"- %s (%h)" --no-merges';
  commits = execSync(cmd, { cwd: root, encoding: 'utf8' }).trim();
} catch {
  try {
    commits = execSync('git log -30 --pretty=format:"- %s (%h)" --no-merges', {
      cwd: root,
      encoding: 'utf8',
    }).trim();
  } catch {
    commits = '';
  }
}

function tagExists(t) {
  try {
    execSync(`git rev-parse ${t}^{commit}`, { cwd: root, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

const releaseDoc = readReleaseDoc();
const body = releaseDoc
  ? releaseDoc
  : [
      `## Chamaccounts ${version}`,
      '',
      commits || '- Aucun commit listé pour cette plage.',
      '',
      `Tag : \`${tag}\``,
    ].join('\n');

const outDir = path.join(root, 'build');
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, 'release-notes.md');
fs.writeFileSync(outFile, `${body}\n`, 'utf8');
console.log(`Notes écrites dans ${outFile}`);
console.log(body);
