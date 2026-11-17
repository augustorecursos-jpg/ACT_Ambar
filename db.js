// Banco de dados SQLite (módulo nativo node:sqlite, sem dependências nativas).
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const PDF_DIR = path.join(DATA_DIR, 'acordos');
fs.mkdirSync(PDF_DIR, { recursive: true });

const ARQUIVO_DB = path.join(DATA_DIR, 'act.db');
const db = new DatabaseSync(ARQUIVO_DB);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

db.exec(`
CREATE TABLE IF NOT EXISTS usuarios (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  nome          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  senha_hash    TEXT NOT NULL,
  papel         TEXT NOT NULL DEFAULT 'leitor' CHECK (papel IN ('admin', 'editor', 'leitor')),
  ativo         INTEGER NOT NULL DEFAULT 1,
  trocar_senha  INTEGER NOT NULL DEFAULT 1,     -- obriga a criar a própria senha no primeiro acesso
  versao_sessao INTEGER NOT NULL DEFAULT 1,     -- muda ao trocar/redefinir senha ou desativar: derruba sessões abertas
  ultimo_acesso TEXT,
  criado_em     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS usinas (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  nome            TEXT NOT NULL,
  nome_planilha   TEXT,                          -- nome como aparece no cabeçalho da planilha (para reimportar)
  sindicato       TEXT,
  data_base_mes   INTEGER CHECK (data_base_mes BETWEEN 1 AND 12),
  vigencia_inicio TEXT,                          -- AAAA-MM-DD
  vigencia_fim    TEXT,
  observacoes     TEXT,
  ordem           INTEGER NOT NULL DEFAULT 0,
  criado_em       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS itens (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  nome      TEXT NOT NULL,
  categoria TEXT NOT NULL DEFAULT 'Outros',
  destaque  INTEGER NOT NULL DEFAULT 0,          -- aparece no cartão da usina no Panorama
  ordem     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS valores (
  usina_id      INTEGER NOT NULL REFERENCES usinas(id) ON DELETE CASCADE,
  item_id       INTEGER NOT NULL REFERENCES itens(id) ON DELETE CASCADE,
  valor         TEXT NOT NULL DEFAULT '',
  nota          TEXT NOT NULL DEFAULT '',        -- comentário da célula (cláusula de origem e observações)
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_por TEXT,
  PRIMARY KEY (usina_id, item_id)
);

CREATE TABLE IF NOT EXISTS documentos (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  usina_id      INTEGER NOT NULL REFERENCES usinas(id) ON DELETE CASCADE,
  titulo        TEXT NOT NULL,
  tipo          TEXT NOT NULL DEFAULT 'ACT' CHECK (tipo IN ('ACT', 'Aditivo', 'Outro')),
  vigencia      TEXT,
  arquivo       TEXT NOT NULL,
  nome_original TEXT,
  tamanho       INTEGER,
  paginas       INTEGER,
  enviado_por   TEXT,
  enviado_em    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS doc_paginas (
  documento_id INTEGER NOT NULL REFERENCES documentos(id) ON DELETE CASCADE,
  n            INTEGER NOT NULL,
  texto        TEXT NOT NULL,
  PRIMARY KEY (documento_id, n)
);

CREATE TABLE IF NOT EXISTS doc_clausulas (
  documento_id INTEGER NOT NULL REFERENCES documentos(id) ON DELETE CASCADE,
  numero       INTEGER NOT NULL,
  secao        INTEGER NOT NULL DEFAULT 0,
  titulo       TEXT,
  pagina       INTEGER NOT NULL,
  PRIMARY KEY (documento_id, secao, numero)
);

CREATE TABLE IF NOT EXISTS alteracoes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  em         TEXT NOT NULL DEFAULT (datetime('now')),
  usuario    TEXT,
  acao       TEXT NOT NULL,
  usina_id   INTEGER,
  item_id    INTEGER,
  descricao  TEXT,
  antes      TEXT,
  depois     TEXT
);
CREATE INDEX IF NOT EXISTS alteracoes_celula ON alteracoes (usina_id, item_id);
`);

/** Executa fn dentro de uma transação. */
function transacao(fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

module.exports = { db, DATA_DIR, PDF_DIR, ARQUIVO_DB, transacao };
