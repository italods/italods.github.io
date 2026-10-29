/*
 * Configuração do Sistema Veneza.
 * O repositório é PÚBLICO: aqui só podem ficar a URL do projeto e a chave "anon" (pública).
 * Nunca coloque aqui a chave "service_role" nem senhas.
 */
window.VENEZA_CONFIG = {
  // Supabase > Project Settings > API (ou "Connect")
  SUPABASE_URL: "https://ywpdngjtqostisqoehzi.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl3cGRuZ2p0cW9zdGlzcW9laHppIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMyMzA4OTksImV4cCI6MjEwODgwNjg5OX0.e3eqA44Ze_Nj1wkxhqC7RGbGbk9-GmpJsCZLZuKU9qI",

  // Caixas da loja. Para incluir um novo, copie uma linha e troque o id e os nomes.
  // O "id" fica gravado no banco: depois de usar, não mude o id de um caixa.
  CAIXAS: [
    { id: "caixa1", nome: "Caixa 1 (Terminal 1)", curto: "Caixa 1" },
    { id: "caixa2", nome: "Caixa 2 (Terminal 3)", curto: "Caixa 2" }
  ],

  // Sugestões no campo Operador / Responsável (pode digitar outro nome)
  OPERADORES: ["Italo", "Irmã", "Cida"],

  // Sugestões de motivo para sangria e suprimento
  MOTIVOS: ["Levado ao cofre", "Pagamento fornecedor", "Reforço de moedas", "Reforço de troco", "Despesa da loja"]
};
