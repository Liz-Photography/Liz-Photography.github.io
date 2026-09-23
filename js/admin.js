// Admin panel logic. Because GitHub Pages only serves static files, there is
// no server to upload to. Instead, this page talks DIRECTLY to the GitHub
// REST API (which supports CORS for browser requests) using a personal
// access token, and commits the image + an updated data/photos.json
// manifest straight into the repo. GitHub Pages then rebuilds automatically.
//
// The token is stored ONLY in this browser's localStorage — it is never
// sent anywhere except api.github.com.

const API = 'https://api.github.com';
const CFG_KEY = 'portfolio_admin_cfg';

function getCfg() {
  try { return JSON.parse(localStorage.getItem(CFG_KEY)) || null; }
  catch { return null; }
}
function setCfg(cfg) { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); }
function clearCfg() { localStorage.removeItem(CFG_KEY); }

function ghHeaders(cfg) {
  return {
    Authorization: `Bearer ${cfg.token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

async function ghGetFile(cfg, path) {
  const url = `${API}/repos/${cfg.owner}/${cfg.repo}/contents/${path}?ref=${cfg.branch}`;
  const res = await fetch(url, { headers: ghHeaders(cfg) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub error ${res.status}: ${(await res.json()).message || res.statusText}`);
  return res.json(); // { content (base64), sha, ... }
}

async function ghPutFile(cfg, path, base64Content, message, sha) {
  const body = {
    message,
    content: base64Content,
    branch: cfg.branch,
  };
  if (sha) body.sha = sha;
  const res = await fetch(`${API}/repos/${cfg.owner}/${cfg.repo}/contents/${path}`, {
    method: 'PUT',
    headers: { ...ghHeaders(cfg), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`GitHub error ${res.status}: ${(await res.json()).message || res.statusText}`);
  return res.json();
}

async function ghDeleteFile(cfg, path, message, sha) {
  const res = await fetch(`${API}/repos/${cfg.owner}/${cfg.repo}/contents/${path}`, {
    method: 'DELETE',
    headers: { ...ghHeaders(cfg), 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, sha, branch: cfg.branch }),
  });
  if (!res.ok) throw new Error(`GitHub error ${res.status}: ${(await res.json()).message || res.statusText}`);
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function getManifest(cfg) {
  const file = await ghGetFile(cfg, 'data/photos.json');
  if (!file) return { photos: [], sha: null };
  const json = decodeURIComponent(escape(atob(file.content.replace(/\n/g, ''))));
  return { photos: JSON.parse(json || '[]'), sha: file.sha };
}

async function saveManifest(cfg, photos, sha, message) {
  const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(photos, null, 2))));
  await ghPutFile(cfg, 'data/photos.json', b64, message, sha);
}

function slugify(name) {
  const dot = name.lastIndexOf('.');
  const base = (dot > -1 ? name.slice(0, dot) : name)
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  const ext = dot > -1 ? name.slice(dot) : '';
  return `${base}-${Date.now()}${ext}`;
}

// ---------- UI wiring ----------

const loginPanel = document.getElementById('loginPanel');
const mainPanel = document.getElementById('mainPanel');
const loginStatus = document.getElementById('loginStatus');

function setStatus(el, msg, ok) {
  el.textContent = msg;
  el.className = 'status-msg ' + (ok ? 'ok' : 'err');
}

async function tryConnect(cfg) {
  const res = await fetch(`${API}/repos/${cfg.owner}/${cfg.repo}`, { headers: ghHeaders(cfg) });
  if (!res.ok) throw new Error('Could not access that repository. Check the owner, repo name, branch, and token.');
  return res.json();
}

async function showMain() {
  loginPanel.style.display = 'none';
  mainPanel.style.display = 'block';
  await refreshList();
}

document.getElementById('connectBtn').addEventListener('click', async () => {
  const cfg = {
    owner: document.getElementById('ghOwner').value.trim(),
    repo: document.getElementById('ghRepo').value.trim(),
    branch: document.getElementById('ghBranch').value.trim() || 'main',
    token: document.getElementById('ghToken').value.trim(),
  };
  if (!cfg.owner || !cfg.repo || !cfg.token) {
    setStatus(loginStatus, 'Please fill in owner, repo, and token.', false);
    return;
  }
  setStatus(loginStatus, 'Connecting…', true);
  try {
    await tryConnect(cfg);
    setCfg(cfg);
    setStatus(loginStatus, 'Connected.', true);
    await showMain();
  } catch (err) {
    setStatus(loginStatus, err.message, false);
  }
});

document.getElementById('disconnectBtn').addEventListener('click', () => {
  clearCfg();
  location.reload();
});

// Auto-connect if config already saved
(async function initAuth() {
  const cfg = getCfg();
  if (!cfg) return;
  try {
    await tryConnect(cfg);
    await showMain();
  } catch {
    clearCfg();
  }
})();

// ---------- Upload form ----------

const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
const preview = document.getElementById('preview');
const dropzoneText = document.getElementById('dropzoneText');
let selectedFile = null;

dropzone.addEventListener('click', () => fileInput.click());
dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('drag-over'); });
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));
dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropzone.classList.remove('drag-over');
  if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
});
fileInput.addEventListener('change', () => {
  if (fileInput.files[0]) handleFile(fileInput.files[0]);
});

function handleFile(file) {
  selectedFile = file;
  preview.src = URL.createObjectURL(file);
  preview.style.display = 'block';
  dropzoneText.textContent = file.name;
}

document.getElementById('uploadForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const cfg = getCfg();
  const statusEl = document.getElementById('uploadStatus');
  const btn = document.getElementById('uploadBtn');

  if (!selectedFile) { setStatus(statusEl, 'Please choose an image file first.', false); return; }

  const title = document.getElementById('title').value.trim();
  const alt = document.getElementById('alt').value.trim();
  const description = document.getElementById('description').value.trim();

  btn.disabled = true;
  setStatus(statusEl, 'Uploading image…', true);

  try {
    const filename = slugify(selectedFile.name);
    const base64 = await fileToBase64(selectedFile);

    await ghPutFile(cfg, `images/${filename}`, base64, `Add photo: ${title}`);

    setStatus(statusEl, 'Updating gallery listing…', true);
    const { photos, sha } = await getManifest(cfg);
    photos.push({ filename, title, alt, description, addedAt: new Date().toISOString() });
    await saveManifest(cfg, photos, sha, `Add "${title}" to gallery`);

    setStatus(statusEl, 'Uploaded! It will appear on the live site shortly.', true);
    e.target.reset();
    selectedFile = null;
    preview.style.display = 'none';
    dropzoneText.textContent = 'Click to choose an image, or drag one here';
    await refreshList();
  } catch (err) {
    setStatus(statusEl, err.message, false);
  } finally {
    btn.disabled = false;
  }
});

// ---------- Photo list: edit / replace / delete ----------

async function refreshList() {
  const cfg = getCfg();
  const listEl = document.getElementById('photoList');
  const statusEl = document.getElementById('listStatus');
  setStatus(statusEl, 'Loading…', true);
  try {
    const { photos } = await getManifest(cfg);
    if (!photos.length) {
      listEl.innerHTML = '';
      setStatus(statusEl, 'No photos uploaded yet.', true);
      return;
    }
    statusEl.textContent = '';
    listEl.innerHTML = photos.map((p, i) => `
      <li>
        <img src="https://raw.githubusercontent.com/${cfg.owner}/${cfg.repo}/${cfg.branch}/images/${p.filename}" alt="">
        <div class="meta">
          <strong>${escapeHtml(p.title)}</strong>
          <span>${escapeHtml(p.description || '')}</span>
        </div>
        <div class="actions">
          <button class="secondary" data-edit="${i}">Edit / Replace</button>
          <button class="danger" data-delete="${i}">Delete</button>
        </div>
      </li>
      <div class="edit-panel" id="edit-${i}"></div>
    `).join('');

    listEl.querySelectorAll('[data-delete]').forEach((btn) =>
      btn.addEventListener('click', () => deletePhoto(Number(btn.dataset.delete)))
    );
    listEl.querySelectorAll('[data-edit]').forEach((btn) =>
      btn.addEventListener('click', () => toggleEdit(Number(btn.dataset.edit), photos[Number(btn.dataset.edit)]))
    );
  } catch (err) {
    setStatus(statusEl, err.message, false);
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

function toggleEdit(index, photo) {
  const panel = document.getElementById(`edit-${index}`);
  const isOpen = panel.classList.contains('active');
  document.querySelectorAll('.edit-panel').forEach((p) => p.classList.remove('active'));
  if (isOpen) return;

  panel.innerHTML = `
    <label>Title</label>
    <input type="text" id="e-title-${index}" value="${escapeHtml(photo.title)}">
    <label>Alt text</label>
    <input type="text" id="e-alt-${index}" value="${escapeHtml(photo.alt)}">
    <label>Description</label>
    <textarea id="e-desc-${index}">${escapeHtml(photo.description || '')}</textarea>
    <label>Replace image (optional)</label>
    <input type="file" accept="image/*" id="e-file-${index}">
    <button id="e-save-${index}">Save Changes</button>
    <div class="status-msg" id="e-status-${index}"></div>
  `;
  panel.classList.add('active');

  document.getElementById(`e-save-${index}`).addEventListener('click', () => saveEdit(index));
}

async function saveEdit(index) {
  const cfg = getCfg();
  const statusEl = document.getElementById(`e-status-${index}`);
  const saveBtn = document.getElementById(`e-save-${index}`);
  saveBtn.disabled = true;
  setStatus(statusEl, 'Saving…', true);

  try {
    const { photos, sha } = await getManifest(cfg);
    const photo = photos[index];
    photo.title = document.getElementById(`e-title-${index}`).value.trim();
    photo.alt = document.getElementById(`e-alt-${index}`).value.trim();
    photo.description = document.getElementById(`e-desc-${index}`).value.trim();

    const newFile = document.getElementById(`e-file-${index}`).files[0];
    if (newFile) {
      const oldPath = `images/${photo.filename}`;
      const oldFileMeta = await ghGetFile(cfg, oldPath);
      const newFilename = slugify(newFile.name);
      const base64 = await fileToBase64(newFile);
      await ghPutFile(cfg, `images/${newFilename}`, base64, `Replace image for "${photo.title}"`);
      if (oldFileMeta) {
        await ghDeleteFile(cfg, oldPath, `Remove old image for "${photo.title}"`, oldFileMeta.sha);
      }
      photo.filename = newFilename;
    }

    await saveManifest(cfg, photos, sha, `Update "${photo.title}"`);
    setStatus(statusEl, 'Saved.', true);
    await refreshList();
  } catch (err) {
    setStatus(statusEl, err.message, false);
  } finally {
    saveBtn.disabled = false;
  }
}

async function deletePhoto(index) {
  if (!confirm('Delete this photo? This cannot be undone.')) return;
  const cfg = getCfg();
  const statusEl = document.getElementById('listStatus');
  setStatus(statusEl, 'Deleting…', true);
  try {
    const { photos, sha } = await getManifest(cfg);
    const photo = photos[index];
    const imgPath = `images/${photo.filename}`;
    const imgMeta = await ghGetFile(cfg, imgPath);
    if (imgMeta) await ghDeleteFile(cfg, imgPath, `Delete photo: ${photo.title}`, imgMeta.sha);

    photos.splice(index, 1);
    await saveManifest(cfg, photos, sha, `Remove "${photo.title}" from gallery`);
    await refreshList();
  } catch (err) {
    setStatus(statusEl, err.message, false);
  }
}
