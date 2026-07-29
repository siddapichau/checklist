const initialTasks = [
  { id: 1, title: 'Revisar wireframes da página inicial', project: 'Redesign do produto', time: '09:00', priority: 'high', done: false },
  { id: 2, title: 'Enviar briefing para o time de conteúdo', project: 'Marketing Q3', time: '10:30', priority: 'medium', done: false },
  { id: 3, title: 'Daily com o time de produto', project: 'Redesign do produto', time: '11:00', priority: 'low', done: true },
  { id: 4, title: 'Atualizar documentação da API', project: 'Redesign do produto', time: '14:00', priority: 'medium', done: false },
  { id: 5, title: 'Comprar ingressos para o cinema', project: 'Pessoal', time: '18:30', priority: 'low', done: true }
];
let tasks = JSON.parse(localStorage.getItem('flowlist-tasks')) || initialTasks;
let filter = 'all';
const list = document.querySelector('#task-list');
const toast = document.querySelector('#toast');

function save() { localStorage.setItem('flowlist-tasks', JSON.stringify(tasks)); }
function showToast(message) { toast.textContent = message; toast.classList.add('show'); clearTimeout(window.toastTimer); window.toastTimer = setTimeout(() => toast.classList.remove('show'), 2600); }
function projectClass(project) { return project === 'Marketing Q3' ? 'orange' : project === 'Pessoal' ? 'green' : 'violet'; }
function render() {
  const query = document.querySelector('#search').value.toLowerCase().trim();
  const visible = tasks.filter(task => (filter === 'all' || (filter === 'done' ? task.done : !task.done)) && task.title.toLowerCase().includes(query));
  list.innerHTML = visible.length ? visible.map(task => `
    <div class="task-row ${task.done ? 'done' : ''}" data-id="${task.id}">
      <button class="check ${task.done ? 'checked' : ''}" aria-label="${task.done ? 'Reabrir' : 'Concluir'} tarefa">${task.done ? '✓' : ''}</button>
      <div class="task-info"><div class="task-title">${escapeHTML(task.title)}</div><div class="task-meta"><span class="project-tag"><i class="dot ${projectClass(task.project)}"></i> ${escapeHTML(task.project)}</span><span><i class="priority ${task.priority}"></i> ${task.priority === 'high' ? 'Alta' : task.priority === 'medium' ? 'Média' : 'Baixa'}</span></div></div>
      <span class="task-date">Hoje, ${task.time}</span><button class="more-btn task-more" aria-label="Opções da tarefa">•••</button>
    </div>`).join('') : '<div class="empty-state">Nenhuma tarefa encontrada.<br><button class="text-btn" data-open-modal>+ Criar uma tarefa</button></div>';
  document.querySelector('#task-total').textContent = tasks.filter(t => !t.done).length;
  document.querySelectorAll('.tab').forEach(tab => { const type = tab.dataset.filter; const count = type === 'all' ? tasks.length : type === 'done' ? tasks.filter(t => t.done).length : tasks.filter(t => !t.done).length; tab.querySelector('span').textContent = count; });
  document.querySelectorAll('.check').forEach(button => button.addEventListener('click', () => { const item = tasks.find(t => t.id === +button.closest('.task-row').dataset.id); item.done = !item.done; save(); render(); showToast(item.done ? 'Tarefa concluída. Muito bem!' : 'Tarefa reaberta.'); }));
  document.querySelectorAll('[data-open-modal]').forEach(button => button.addEventListener('click', openModal));
}
function escapeHTML(value) { return value.replace(/[&<>'"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[c])); }
function openModal() { document.querySelector('#modal').classList.add('open'); document.querySelector('#modal').setAttribute('aria-hidden', 'false'); setTimeout(() => document.querySelector('[name="title"]').focus(), 50); }
function closeModal() { document.querySelector('#modal').classList.remove('open'); document.querySelector('#modal').setAttribute('aria-hidden', 'true'); document.querySelector('#task-form').reset(); }

document.querySelectorAll('.tab').forEach(tab => tab.addEventListener('click', () => { document.querySelectorAll('.tab').forEach(t => t.classList.remove('active')); tab.classList.add('active'); filter = tab.dataset.filter; render(); }));
document.querySelector('#search').addEventListener('input', render);
document.querySelectorAll('[data-open-modal]').forEach(button => button.addEventListener('click', openModal));
document.querySelectorAll('[data-close-modal]').forEach(button => button.addEventListener('click', closeModal));
document.querySelector('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });
document.querySelector('#task-form').addEventListener('submit', e => { e.preventDefault(); const data = new FormData(e.target); tasks.unshift({ id: Date.now(), title: data.get('title'), project: data.get('project'), time: data.get('date') ? new Date(data.get('date') + 'T12:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : 'Sem prazo', priority: data.get('priority'), done: false }); save(); render(); closeModal(); showToast('Nova tarefa criada com sucesso.'); });
document.querySelector('#mobile-menu').addEventListener('click', () => document.querySelector('#sidebar').classList.toggle('open'));
document.querySelector('#theme-toggle').addEventListener('click', () => { document.body.classList.toggle('dark'); localStorage.setItem('flowlist-dark', document.body.classList.contains('dark')); });
if (localStorage.getItem('flowlist-dark') === 'true') document.body.classList.add('dark');
document.querySelector('#export-btn').addEventListener('click', () => { const csv = 'Tarefa,Projeto,Prioridade,Status\n' + tasks.map(t => `"${t.title}","${t.project}","${t.priority}","${t.done ? 'Concluída' : 'Em andamento'}"`).join('\n'); const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' }); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = 'flowlist-tarefas.csv'; link.click(); showToast('Sua lista foi exportada.'); });
document.addEventListener('keydown', e => { if (e.key.toLowerCase() === 'n' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) openModal(); if (e.key === 'Escape') closeModal(); });
render();