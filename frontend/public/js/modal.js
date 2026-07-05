// Простой хелпер модальных окон без фреймворков — используется и для
// ставки на матч, и для профиля друга.
export function openModal(html, { center = false } = {}) {
  const root = document.getElementById('modal-root');
  root.innerHTML = `<div class="modal-overlay"><div class="modal-card ${center ? 'modal-center' : ''}" style="position:relative">${html}</div></div>`;
  root.querySelector('.modal-overlay').addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-overlay')) closeModal();
  });
  const closeBtn = root.querySelector('#modal-close-btn');
  if (closeBtn) closeBtn.onclick = closeModal;
  return root.querySelector('.modal-card');
}

export function closeModal() {
  document.getElementById('modal-root').innerHTML = '';
}
