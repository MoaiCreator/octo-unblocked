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

// owner/repo guess from a GitHub Pages URL like https://owner.github.io/repo/admin.html
export function guessRepo(loc = location) {
  const m = /^([a-z0-9-]+)\.github\.io$/i.exec(loc.hostname);
  if (!m) return { owner: '', repo: '' };
  const first = loc.pathname.split('/').filter(Boolean)[0];
  return { owner: m[1], repo: first && !/\.html?$/.test(first) ? first : m[1] + '.github.io' };
}
