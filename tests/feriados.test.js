// Testes do calendário de feriados e dias úteis. Rodar com: node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const F = require("../sistema/js/feriados.js");

test("Páscoa de anos conhecidos", () => {
  assert.equal(F.pascoa(2024), "2024-03-31");
  assert.equal(F.pascoa(2025), "2025-04-20");
  assert.equal(F.pascoa(2026), "2026-04-05");
  assert.equal(F.pascoa(2027), "2027-03-28");
});

test("feriados nacionais de 2026", () => {
  const f = F.nacionais(2026);
  assert.equal(f["2026-11-02"], "Finados");
  assert.equal(f["2026-11-20"], "Dia da Consciência Negra");
  assert.equal(f["2026-02-16"], "Carnaval (segunda)");
  assert.equal(f["2026-02-17"], "Carnaval (terça)");
  assert.equal(f["2026-04-03"], "Sexta-feira Santa");
  assert.equal(f["2026-06-04"], "Corpus Christi");
  assert.equal(Object.keys(f).length, 13);
});

test("dia útil", () => {
  assert.equal(F.ehDiaUtil("2026-11-02"), false, "Finados");
  assert.equal(F.ehDiaUtil("2026-10-31"), false, "sábado");
  assert.equal(F.ehDiaUtil("2026-11-01"), false, "domingo");
  assert.equal(F.ehDiaUtil("2026-11-03"), true);
  assert.equal(F.ehDiaUtil("2026-11-03", { "2026-11-03": "feriado municipal" }), false, "feriado extra");
});

test("n-ésimo dia útil (prazo de pagamento)", () => {
  assert.equal(F.diaUtil("2026-11-03", 1), "2026-11-04", "terça → quarta");
  assert.equal(F.diaUtil("2026-10-30", 1), "2026-11-03", "sexta → pula sábado, domingo e Finados");
  assert.equal(F.diaUtil("2026-10-31", 1), "2026-11-03", "venda de sábado");
  assert.equal(F.diaUtil("2026-11-19", 1), "2026-11-23", "pula Consciência Negra e o fim de semana");
  assert.equal(F.diaUtil("2026-11-01", 0), "2026-11-03", "mesmo dia: domingo → próximo útil");
  assert.equal(F.diaUtil("2026-11-04", 0), "2026-11-04");
  assert.equal(F.diaUtil("2026-12-31", 1), "2027-01-04", "virada de ano");
});

test("dias úteis entre duas datas", () => {
  assert.equal(F.diasUteisEntre("2026-11-03", "2026-11-04"), 1);
  assert.equal(F.diasUteisEntre("2026-10-30", "2026-11-03"), 1);
  assert.equal(F.diasUteisEntre("2026-11-03", "2026-11-06"), 3);
  assert.equal(F.diasUteisEntre("2026-11-04", "2026-11-03"), -1);
  assert.equal(F.diasUteisEntre("2026-11-04", "2026-11-04"), 0);
});
