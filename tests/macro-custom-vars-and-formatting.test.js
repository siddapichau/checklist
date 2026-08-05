/*
 * Testes para preservação de quebras de linha e variáveis personalizadas em macros.
 * Execute: node tests/macro-custom-vars-and-formatting.test.js
 */
const assert = require('node:assert/strict');

// 1. Mock do DOM para testar stripHtml
const mockDoc = {
  createElement: () => ({
    _html: '',
    set innerHTML(v) { this._html = v; },
    get textContent() {
      return this._html.replace(/<[^>]+>/g, '');
    }
  })
};

function stripHtml(html, document = mockDoc) {
  if (!html) return '';
  let processed = String(html)
    .replace(/<br\s*[\/]?>/gi, '\n')
    .replace(/<\/p>\s*<p[^>]*>/gi, '\n\n')
    .replace(/<\/div>\s*<div[^>]*>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr|blockquote|section|article)>/gi, '\n')
    .replace(/<(p|div|h[1-6]|li|tr|blockquote|section|article)[^>]*>/gi, (match, tag, offset) => {
      return offset > 0 ? '\n' : '';
    })
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/&nbsp;/gi, ' ');
  const tmp = document.createElement('div');
  tmp.innerHTML = processed;
  let text = tmp.textContent || '';
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+/, '')
    .replace(/\n+$/, '');
}

// 2. Funções auxiliares de variáveis
function extractVars(html) {
  const found = new Set();
  const re = /\{\{\s*([\wÀ-ÿ.-]+)\s*\}\}/g;
  let match;
  while ((match = re.exec(html)) !== null) found.add(match[1]);
  return [...found];
}

function substituteVars(html, values, highlightEmpty) {
  const normalized = html
    .replace(/<span class="var-chip">\s*\{\{\s*([\wÀ-ÿ.-]+)\s*\}\}\s*<\/span>/gi, '{{$1}}')
    .replace(/<span class="var-chip">\s*(\{\s*c(?:[1-9]|10)\s*\})\s*<\/span>/gi, '$1');
  let out = normalized.replace(/\{\{\s*([\wÀ-ÿ.-]+)\s*\}\}/gi, (all, name) => {
    const v = values[name] !== undefined ? values[name] : values[name.toLowerCase()];
    if (v !== undefined && v !== '') return v;
    return highlightEmpty ? `<span class="var-chip">{{${name}}}</span>` : `{{${name}}}`;
  });
  out = out.replace(/\{\s*(c(?:[1-9]|10))\s*\}/gi, (all, name) => {
    const key = name.toLowerCase();
    const v = values[key];
    if (v !== undefined && v !== '') return v;
    return highlightEmpty ? `<span class="var-chip">{${key}}</span>` : `{${key}}`;
  });
  return out;
}

function runTests() {
  // Teste 1: Preservação de quebras de linha com <br>
  const html1 = 'Olá,<br><br>Aqui está a lista:<br><br>- item 1<br>- item 2';
  assert.equal(
    stripHtml(html1),
    'Olá,\n\nAqui está a lista:\n\n- item 1\n- item 2',
    'Deve preservar quebras de linha com <br><br>'
  );

  // Teste 2: Preservação de quebras com tags <div> e <p>
  const html2 = '<div>Olá,</div><div><br></div><div>Obrigado</div>';
  assert.equal(
    stripHtml(html2),
    'Olá,\n\nObrigado',
    'Deve preservar parágrafos divididos por div'
  );

  // Teste 3: Extração de variáveis customizadas em todo o macro (título, assunto, conteúdo)
  const allText = ['Relatório para {{email}}', 'Assunto de {{nome}}', '', 'Dados {{setor}} {c1}'].join(' ');
  const vars = extractVars(allText);
  assert.deepEqual(vars, ['email', 'nome', 'setor'], 'Deve extrair todas as variáveis do título, assunto e texto');
  assert.equal(/\{c([1-9]|10)\}/i.test(allText), true, 'Deve detectar campo c1 no texto');

  // Teste 4: Substituição de variáveis (case insensitive)
  const template = 'Título: {{Email}} - Setor: {{SETOR}} - {c1}';
  const resolved = substituteVars(template, {
    email: 'ana@empresa.com',
    setor: 'Financeiro',
    c1: 'Ativo'
  }, false);
  assert.equal(resolved, 'Título: ana@empresa.com - Setor: Financeiro - Ativo', 'Deve substituir variáveis case-insensitive');

  console.log('# ✓ macro custom vars and formatting tests passed');
}

runTests();
