# Acordos Coletivos · Âmbar Energia (RH)

Painel para o time de RH consultar os Acordos Coletivos de Trabalho (ACTs) de cada usina: o resumo dos
benefícios lado a lado e o PDF do acordo a um clique da cláusula de origem de cada valor.

Mesmo padrão visual da Trilha DHO (azul-marinho `#0e3b5c`, laranja `#ec6b24`, Montserrat + Nunito Sans),
com navegação própria: abas no topo, fichário de usinas, matriz comparativa e leitor de documento lado a lado.

## Telas

- **Panorama**: indicadores (PDFs enviados, acordos vencendo ou vencidos, datas-base próximas), **linha do tempo das
  vigências** com as datas-base marcadas e um cartão por usina com os itens em destaque.
- **Comparativo**: matriz itens × usinas agrupada por categoria. O canto laranja indica que a célula tem anotação
  (a cláusula de origem, vinda dos comentários da planilha). Barras comparam valores em R$ ou % da mesma linha.
  Filtro por item, "só onde há diferença", escolha das usinas visíveis e **exportação para Excel** (com as anotações
  como comentários das células).
- **Usina**: ficha (sindicato, vigência, data-base, situação), resumo à esquerda e o PDF à direita. Cada cláusula citada
  na anotação vira um atalho (`Cl. 15ª · pág. 4`) que abre o PDF na página com o título da cláusula realçado.
  Sumário das cláusulas do acordo, busca dentro do PDF, zoom e download.
- **Busca nos acordos**: procura um termo no texto de todos os PDFs (ignora acentos e maiúsculas) e leva ao trecho.
- **Gaveta de detalhe** (clique em qualquer valor): valor, cláusulas de origem, anotação, o mesmo item nas outras
  usinas, edição e histórico de alterações.
- **Administração**: usuários, usinas e itens, importação da planilha e histórico.
- Busca rápida no topo (**Ctrl K**): usinas, itens e atalho para a busca no texto.

## Perfis de acesso

| Perfil | Pode |
|---|---|
| Administrador | tudo, inclusive criar usuários, redefinir senhas, desativar acessos e remover usinas/itens |
| Editor | consultar, editar valores e anotações, cadastrar usinas/itens, importar a planilha e enviar PDFs |
| Leitura | só consultar |

O administrador cria o usuário (nome, e-mail, perfil) e recebe uma **senha provisória**, mostrada uma única vez.
No primeiro acesso a pessoa é obrigada a criar a própria senha (mín. 8 caracteres). Redefinir a senha, desativar
ou mudar o perfil encerra as sessões abertas da pessoa. Senhas guardadas com scrypt; login limitado a 8 tentativas
erradas por IP a cada 15 minutos; sessão de 10 horas.

## Dados: planilha e PDFs

**Nada de dados vai para o repositório** (ele é público). Banco, PDFs e planilhas ficam em `DATA_DIR`, fora do Git.

- **Planilha** (Administração → Importar planilha): formato do "Resumo ACT" — usinas no cabeçalho (linha 1, a partir
  da coluna B), itens nas linhas, linhas `SINDICATOS`, `MÊS DATA BASE` e `VALIDADE - ANO` viram dados da usina, e os
  **comentários das células** viram as anotações. A planilha é lida no navegador e mostra uma prévia antes de gravar.
  Usinas e itens são reconhecidos pelo nome; reimportar atualiza os valores (com histórico) e não mexe nos PDFs.
- **PDFs** (tela da usina → Enviar PDF): tipo ACT, Termo Aditivo ou Outro. Ao enviar, o texto de cada página é extraído
  para a busca e os títulos das cláusulas são indexados. Referências como "ADITIVO CLÁUSULA SEGUNDA" apontam para o
  PDF do tipo Aditivo; enquanto ele não for enviado, o atalho aparece como pendente. PDFs digitalizados sem texto
  ficam disponíveis só para leitura.

As referências são reconhecidas por extenso ou em número, inclusive com erros comuns de digitação/OCR
("CLÁUSULA DÉCIMA NONA", "Cláusula 19ª", "CLÁUSULA9", "TRIGÉSSIMA", "CI,ÁUSULA"). Regras em `lib/clausulas.js`.

Carga pela linha de comando (alternativa às telas):

```bash
node scripts/importar.js --planilha "Resumo ACT.xlsx" --pdf "Cuiabá=ACT Cuiabá 2025-2027.pdf" --pdf "Amazonas=ACT AM.pdf"
```

## Como rodar

Requisito: **Node.js 22.5+** (usa o SQLite nativo do Node).

```bash
npm install
npm start          # http://localhost:3000
npm test           # testes do leitor de cláusulas e da planilha
```

| Variável | Para quê | Padrão |
|---|---|---|
| `ADMIN_EMAIL` / `ADMIN_SENHA` | Administrador criado ao iniciar, se ainda não existir usuário com esse e-mail | em desenvolvimento: `admin@ambar.local` / `ambar-act` |
| `ADMIN_REDEFINIR=sim` | Recuperação de acesso: a cada início, redefine a senha de `ADMIN_EMAIL` para `ADMIN_SENHA`. **Remova depois de entrar.** | – |
| `DATA_DIR` | Pasta do banco (`act.db`) e dos PDFs (`acordos/`) | `./data` |
| `SESSION_SECRET` | Chave dos cookies de sessão | gerada e salva em `DATA_DIR` |
| `PORT` | Porta HTTP | `3000` |
| `NODE_ENV=production` | Cookies só via HTTPS; exige `ADMIN_EMAIL`/`ADMIN_SENHA` no primeiro início | – |

## Publicação

**Render** – `render.yaml` descreve o serviço com disco persistente: render.com → New → Blueprint → este repositório,
informe `ADMIN_EMAIL` e `ADMIN_SENHA`. Custo aproximado: plano Starter (US$ 7/mês) + disco de 2 GB.

**Servidor próprio / outra nuvem** – `Dockerfile`:

```bash
docker build -t act-ambar .
docker run -d -p 3000:3000 -v act-dados:/data -e ADMIN_EMAIL=... -e ADMIN_SENHA=... act-ambar
```

com um proxy HTTPS na frente. O botão **Baixar backup do banco** (Administração → Usuários) baixa uma cópia do banco;
os PDFs ficam em `DATA_DIR/acordos`.

## Estrutura

```
server.js            API (login, painel, valores, usinas, itens, PDFs, busca, usuários) + estáticos
db.js                esquema SQLite
lib/clausulas.js     leitura de referências e títulos de cláusulas (servidor e navegador)
lib/planilha.js      leitura da planilha de resumo com comentários (servidor e navegador)
lib/pdf.js           extração de texto dos PDFs (pdf.js)
lib/acervo.js        gravação de valores, importação, PDFs e histórico
public/              entrada, app (Panorama, Comparativo, Usina, Busca, Administração)
scripts/importar.js  carga pela linha de comando
```
