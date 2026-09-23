// Public gallery renderer — reads data/photos.json (static file in the repo)
// and builds the grid + lightbox. No backend involved; GitHub Pages just
// serves this JSON like any other static asset.

async function loadPhotos() {
  try {
    // cache-bust so visitors see new uploads without a hard refresh
    const res = await fetch('data/photos.json?v=' + Date.now());
    if (!res.ok) throw new Error('Could not load photos.json');
    return await res.json();
  } catch (err) {
    console.error(err);
    return [];
  }
}

function cardTemplate(photo, index) {
  return `
    <div class="card" data-index="${index}">
      <img src="images/${photo.filename}" alt="${escapeHtml(photo.alt)}" loading="lazy">
      <div class="card-overlay">
        <div>
          <h3>${escapeHtml(photo.title)}</h3>
          <p>${escapeHtml(photo.description || '')}</p>
        </div>
      </div>
    </div>`;
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

let PHOTOS = [];
let currentIndex = 0;

function openLightbox(index) {
  currentIndex = index;
  const p = PHOTOS[index];
  document.getElementById('lbImage').src = 'images/' + p.filename;
  document.getElementById('lbImage').alt = p.alt || '';
  document.getElementById('lbTitle').textContent = p.title || '';
  document.getElementById('lbDesc').textContent = p.description || '';
  document.getElementById('lightbox').classList.add('active');
  document.body.style.overflow = 'hidden';
}

function closeLightbox() {
  document.getElementById('lightbox').classList.remove('active');
  document.body.style.overflow = '';
}

function showRelative(delta) {
  currentIndex = (currentIndex + delta + PHOTOS.length) % PHOTOS.length;
  openLightbox(currentIndex);
}

(async function init() {
  const gallery = document.getElementById('gallery');
  PHOTOS = await loadPhotos();

  if (!PHOTOS.length) {
    gallery.innerHTML = `<div class="empty-state">No photos yet &mdash; check back soon.</div>`;
    return;
  }

  gallery.innerHTML = PHOTOS.map(cardTemplate).join('');

  gallery.querySelectorAll('.card').forEach((card) => {
    card.addEventListener('click', () => openLightbox(Number(card.dataset.index)));
  });

  document.getElementById('lbClose').addEventListener('click', closeLightbox);
  document.getElementById('lbPrev').addEventListener('click', () => showRelative(-1));
  document.getElementById('lbNext').addEventListener('click', () => showRelative(1));
  document.getElementById('lightbox').addEventListener('click', (e) => {
    if (e.target.id === 'lightbox') closeLightbox();
  });
  document.addEventListener('keydown', (e) => {
    if (!document.getElementById('lightbox').classList.contains('active')) return;
    if (e.key === 'Escape') closeLightbox();
    if (e.key === 'ArrowLeft') showRelative(-1);
    if (e.key === 'ArrowRight') showRelative(1);
  });
})();
