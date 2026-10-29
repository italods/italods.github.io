// Testes do valor por extenso. Rodar com: node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const E = require("../js/extenso.js");

const casos = [
  [0, "zero reais"],
  [1, "um centavo"],
  [50, "cinquenta centavos"],
  [100, "um real"],
  [101, "um real e um centavo"],
  [150, "um real e cinquenta centavos"],
  [1000, "dez reais"],
  [1700, "dezessete reais"],
  [2100, "vinte e um reais"],
  [10000, "cem reais"],
  [15000, "cento e cinquenta reais"],
  [19999, "cento e noventa e nove reais e noventa e nove centavos"],
  [100000, "mil reais"],
  [110000, "mil e cem reais"],
  [123456, "mil duzentos e trinta e quatro reais e cinquenta e seis centavos"],
  [147500, "mil quatrocentos e setenta e cinco reais"],
  [150000, "mil e quinhentos reais"],
  [200100, "dois mil e um reais"],
  [202000, "dois mil e vinte reais"],
  [295000, "dois mil novecentos e cinquenta reais"],
  [10000000, "cem mil reais"],
  [25000050, "duzentos e cinquenta mil reais e cinquenta centavos"],
  [100000000, "um milhão de reais"],
  [120000000, "um milhão e duzentos mil reais"],
  [123456789, "um milhão duzentos e trinta e quatro mil quinhentos e sessenta e sete reais e oitenta e nove centavos"],
  [100005000, "um milhão e cinquenta reais"],
  [300000000000, "três bilhões de reais"]
];

for (const [centavos, esperado] of casos) {
  test(`${centavos} centavos`, () => assert.equal(E.reais(centavos), esperado));
}
