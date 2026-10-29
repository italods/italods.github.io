# Site do Italo / Sistema Veneza

Site pessoal do Italo Pereira, hospedado na **Vercel** (projeto ligado a este repositório; a
branch `main` vai para produção e as outras branches geram uma prévia). Sem `vercel.json`: a Vercel
serve os arquivos estáticos da raiz como estão. Domínio: https://italods.com.br/ (sistema em https://italods.com.br/sistema/). Dentro dele fica o **Sistema Veneza**, o sistema gerencial do
Supermercado Veneza (Paes Landim - PI), usado só pelo Italo e pela irmã (sócia).

Tudo é HTML/CSS/JS puro, sem framework e sem etapa de build. O que estiver no `main` vai ao ar.

## Estrutura

```
index.html, calculadora_precos.html, compras.html, Cheques.html,
conversor-extenso.html, linkwhatsapp.html, styles/style.css   ← páginas antigas (não quebrar)
sistema/
  index.html        ← app de página única (login + abas: Caixa, Histórico, Sangrias, Relatório)
  config.js         ← URL do Supabase, chave anon, lista de CAIXAS, OPERADORES e MOTIVOS
  css/sistema.css   ← visual (celular primeiro, claro/escuro por prefers-color-scheme)
  js/calculos.js    ← contas puras em centavos (navegador + Node)
  js/formatos.js    ← texto do WhatsApp e CSV (puras, navegador + Node)
  js/db.js          ← acesso ao Supabase + modo demonstração (?demo=1, guarda no localStorage)
  js/app.js         ← telas e eventos
supabase/schema.sql ← tabelas, gatilhos e RLS (colar no SQL Editor do Supabase; pode rodar de novo)
tests/calculos.test.js ← testes em Node dos cálculos e formatos
```

## Regras do projeto

- **Repositório público.** Nenhum dado do caixa no código. Só podem estar no código a URL do
  projeto Supabase e a chave pública `anon`. Nunca a `service_role`, senhas ou e-mails reais de
  autorizados (eles vão direto no banco).
- **Segurança no banco**: RLS ligado em todas as tabelas; só quem está em `usuarios_autorizados`
  lê ou grava (`public.autorizado()`). Visitante sem login (`anon`) não tem acesso a nada.
- **Dinheiro sempre em centavos inteiros** (`bigint` no banco, inteiros no JS). Nada de float nas
  contas; `toLocaleString("pt-BR", {style:"currency", currency:"BRL"})` só para mostrar.
- Fórmulas: `Esperado = Fundo + Vendas dinheiro + Recebimentos dinheiro + Suprimentos − Sangrias`;
  `Diferença = Contado − Esperado` (positivo = Sobra, negativo = Falta, zero = Caixa bateu).
  O banco recalcula totais/esperado/diferença por gatilho (`conferencia_calcular`) e refaz os
  fechamentos quando uma sangria/suprimento muda. Se mudar uma fórmula, mude em `calculos.js`,
  no `schema.sql` e nos testes.
- Contas novas vão em `calculos.js`/`formatos.js` (funções puras) com teste, não em `app.js`.
- **Celular primeiro**: botões de no mínimo 48px, sem rolagem lateral em 360–390px de largura.
- Tudo em **português do Brasil**, visual limpo, sem gradientes.
- Páginas do sistema com `<meta name="robots" content="noindex">`.
- Bibliotecas só por CDN com versão exata (jsDelivr/cdnjs): supabase-js 2.109.0, jsPDF 2.5.2,
  Chart.js 4.5.1. jsPDF e Chart.js são carregados só quando usados.
- Não apagar nem renomear as páginas antigas. Para incluir um caixa, editar `CAIXAS` em
  `sistema/config.js` (não mudar o `id` de um caixa já usado).
- Erros devem ser claros (sem internet, sessão expirada, sem permissão) e nunca apagar o que foi
  digitado: a contagem fica em rascunho no `localStorage` até salvar.

## Testes

```bash
node --test tests/*.test.js
```

Inclui os números reais de 23/10/2026 (Caixa 1: falta R$ 54,38; Caixa 2: sobra R$ 863,92).

Para ver as telas localmente:

```bash
python3 -m http.server 8000
# abrir http://localhost:8000/sistema/?demo=1  (modo demonstração, sem Supabase)
```

O `schema.sql` pode ser testado num Postgres local criando antes um esquema `auth` com a função
`auth.jwt()` e os papéis `anon`/`authenticated` (imitando o Supabase).

## Publicar

1. Rodar os testes e conferir as telas em `?demo=1` (celular 390px e computador, claro e escuro).
2. Commits pequenos, mensagens em português.
3. Enviar para `main` (a Vercel publica sozinha em 1–2 minutos). Um push em outra branch só gera
   uma prévia na Vercel, que usa o mesmo Supabase: cuidado ao testar lá, os dados são os reais.
4. Mudança no banco: atualizar `supabase/schema.sql` de forma que possa rodar de novo sem apagar
   dados (`if not exists`, `create or replace`) e avisar o Italo para colar no SQL Editor.
