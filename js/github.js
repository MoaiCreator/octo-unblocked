// github.js - tiny GitHub REST client for the admin page (publishing data/mods.json).
// The token never leaves the browser except in requests to api.github.com.
export class GitHub {
  constructor({ owner, repo, branch = 'main', token }) { Object.assign(this, { owner, repo, branch, token }); }
  async api(path, opts = {}) {
    const r = await fetch('https://api.github.com' + path, {
      ...opts,
      headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(this.token ? { Authorization: 'Bearer ' + this.token } : {}), ...(opts.headers || {}) },
    });
    if (r.status === 404 && opts.allow404) return null;
    if (!r.ok) {
      let msg = r.status + ' ' + r.statusText; try { const j = await r.json(); if (j.message) msg += ': ' + j.message; } catch (_) { }
      if (r.status === 401) msg = 'The token was rejected (401). Check that it is correct and not expired.';
      if (r.status === 403 || r.status === 404) msg += ' - the token needs "Contents: Read and write" access to ' + this.owner + '/' + this.repo + '.';
      throw new Error(msg);
    }
    return r.status === 204 ? null : r.json();
  }
  async check() {
    const repo = await this.api(`/repos/${this.owner}/${this.repo}`);
    return { canPush: !!(repo.permissions && (repo.permissions.push || repo.permissions.admin)), defaultBranch: repo.default_branch, pages: repo.has_pages };
  }
  async getFile(path) {
    const f = await this.api(`/repos/${this.owner}/${this.repo}/contents/${path}?ref=${encodeURIComponent(this.branch)}`, { allow404: true });
    if (!f) return null;
    const bin = atob(f.content.replace(/\n/g, '')), bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
    return { sha: f.sha, text: new TextDecoder().decode(bytes) };
  }
  async putFile(path, text, message) {
    const cur = await this.getFile(path);
    const bytes = new TextEncoder().encode(text); let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    const body = { message, content: btoa(bin), branch: this.branch, ...(cur ? { sha: cur.sha } : {}) };
    const res = await this.api(`/repos/${this.owner}/${this.repo}/contents/${path}`, { method: 'PUT', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
    return { commitUrl: res.commit && res.commit.html_url, sha: res.commit && res.commit.sha };
  }
}

// Several files in ONE commit (Git Data API). files: [{ path, text } | { path, bytes: Uint8Array }]
GitHub.prototype.commitFiles = async function (files, message) {
  const R = `/repos/${this.owner}/${this.repo}`, json = { 'Content-Type': 'application/json' };
  const ref = await this.api(`${R}/git/ref/heads/${encodeURIComponent(this.branch)}`);
  const parent = await this.api(`${R}/git/commits/${ref.object.sha}`);
  const tree = [];
  for (const f of files) {
    let blob;
    if (f.bytes) {
      let bin = ''; for (let i = 0; i < f.bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, f.bytes.subarray(i, i + 0x8000));
      blob = await this.api(`${R}/git/blobs`, { method: 'POST', headers: json, body: JSON.stringify({ content: btoa(bin), encoding: 'base64' }) });
    } else blob = await this.api(`${R}/git/blobs`, { method: 'POST', headers: json, body: JSON.stringify({ content: f.text, encoding: 'utf-8' }) });
    tree.push({ path: f.path, mode: '100644', type: 'blob', sha: blob.sha });
  }
  const newTree = await this.api(`${R}/git/trees`, { method: 'POST', headers: json, body: JSON.stringify({ base_tree: parent.tree.sha, tree }) });
  const commit = await this.api(`${R}/git/commits`, { method: 'POST', headers: json, body: JSON.stringify({ message, tree: newTree.sha, parents: [ref.object.sha] }) });
  await this.api(`${R}/git/refs/heads/${encodeURIComponent(this.branch)}`, { method: 'PATCH', headers: json, body: JSON.stringify({ sha: commit.sha, force: false }) });
  return { commitUrl: commit.html_url, sha: commit.sha };
};

// Which branch GitHub Pages deploys from (null if the token can't read the Pages settings).
GitHub.prototype.pagesBranch = async function () {
  try { const p = await this.api(`/repos/${this.owner}/${this.repo}/pages`); return (p && p.source && p.source.branch) || null; }
  catch (_) { return null; }
};
// Move another branch to a commit, fast-forward only (fails safely if that branch has its own commits).
GitHub.prototype.fastForward = async function (branch, sha) {
  const R = `/repos/${this.owner}/${this.repo}`;
  const ref = await this.api(`${R}/git/ref/heads/${encodeURIComponent(branch)}`, { allow404: true });
  if (!ref) return false;
  if (ref.object.sha === sha) return true;
  await this.api(`${R}/git/refs/heads/${encodeURIComponent(branch)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sha, force: false }) });
  return true;
};

// owner/repo guess from a GitHub Pages URL like https://owner.github.io/repo/admin.html
export function guessRepo(loc = location) {
  const m = /^([a-z0-9-]+)\.github\.io$/i.exec(loc.hostname);
  if (!m) return { owner: '', repo: '' };
  const first = loc.pathname.split('/').filter(Boolean)[0];
  return { owner: m[1], repo: first && !/\.html?$/.test(first) ? first : m[1] + '.github.io' };
}
