/* Teste exaustivo da geração de horários: compara calcularSlotsLivres com um
   oráculo de força bruta (testa cada minuto do dia). Sem rede, sem banco, sem
   mexer em nada do Daniel.
   Rodar: node test/slots-exaustivo.js [cenarios=200000] [seed=1]

   Garante, para qualquer dia/ocupação/duração/relógio:
   1) SEGURANÇA  — todo horário oferecido é válido (dentro do expediente,
      termina antes de fechar, sem sobrepor nada, não está no passado).
   2) COMPLETUDE — se existe QUALQUER início válido, a lista nunca vem vazia
      ("Nenhum horário livre" com buraco livre na agenda). */

const { calcularSlotsLivres } = require('../js/slots.js');

const MIN = 60000;
const N = Number(process.argv[2] || 200000);
let seed = Number(process.argv[3] || 1);
const rnd = () => { seed ^= seed << 13; seed >>>= 0; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0; return seed / 4294967296; };
const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const pick = (arr) => arr[int(0, arr.length - 1)];

// durações reais: serviços avulsos, plano (40), pezinho do plano (15) e somas de combos
const DURACOES = [10, 15, 20, 25, 30, 40, 45, 50, 55, 60, 70, 75, 85, 90, 100, 120];

function cenario() {
  const nb = pick([1, 1, 1, 2, 3]);
  const candidatos = [];
  for (let b = 0; b < nb; b++) {
    const abre = int(8 * 12, 14 * 12) * 5 * MIN;                 // 08:00..14:00, de 5 em 5
    const fecha = abre + int(2 * 12, 13 * 12) * 5 * MIN;          // expediente de 2h a 13h
    const ocupados = [];
    let cursor = abre - int(0, 6) * 5 * MIN;                      // pode começar antes de abrir
    const n = int(0, 7);
    for (let i = 0; i < n; i++) {
      cursor += int(0, 10) * 5 * MIN;                             // folga (0 = colado no anterior)
      const dur = int(1, 26) * 5 * MIN;                           // 5 a 130 min (almoço, bloqueio, cortes)
      ocupados.push({ inicio: cursor, fim: cursor + dur });
      cursor += dur;
    }
    candidatos.push({ abre, fecha, ocupados });
  }
  const inicioDia = Math.min(...candidatos.map((c) => c.abre)) - 3 * 60 * MIN;
  const fimDia = Math.max(...candidatos.map((c) => c.fecha));
  const duracaoMin = rnd() < 0.8 ? pick(DURACOES) : int(5, 140);
  // "agora": antes de abrir, no meio, colado no fim, depois de fechar; qualquer minuto/segundo
  const agora = rnd() < 0.15 ? 0 : inicioDia + Math.floor(rnd() * (fimDia - inicioDia + 60 * MIN));
  return { candidatos, duracaoMin, agora };
}

const valido = (candidatos, t, d, agora) =>
  t >= agora && candidatos.some((c) =>
    t >= c.abre && t < c.fecha && t + d <= c.fecha && !c.ocupados.some((o) => t < o.fim && t + d > o.inicio));

let falhasSeg = 0;
let falhasCompl = 0;
const amostras = [];
const porDuracao = new Map();

for (let k = 0; k < N; k++) {
  const { candidatos, duracaoMin, agora } = cenario();
  const d = duracaoMin * MIN;
  const slots = calcularSlotsLivres(candidatos, { duracaoMs: d, agora, duracaoTipicaMs: 30 * MIN, passoMs: 30 * MIN });

  for (const s of slots) {
    if (!valido(candidatos, s, d, agora)) { falhasSeg++; if (amostras.length < 5) amostras.push({ tipo: 'SEGURANCA', s, duracaoMin, agora, candidatos }); }
  }

  if (!slots.length) {
    // oráculo: algum início válido em qualquer segundo? (varre de minuto em minuto a partir de ceil(agora))
    const lo = Math.min(...candidatos.map((c) => c.abre));
    const hi = Math.max(...candidatos.map((c) => c.fecha));
    const primeiro = Math.max(lo, Math.ceil(agora / MIN) * MIN);
    let achou = null;
    for (let t = primeiro; t < hi; t += MIN) if (valido(candidatos, t, d, agora)) { achou = t; break; }
    if (achou !== null) {
      falhasCompl++;
      porDuracao.set(duracaoMin, (porDuracao.get(duracaoMin) || 0) + 1);
      if (amostras.length < 5) amostras.push({ tipo: 'COMPLETUDE', perdido: new Date(achou).toISOString().slice(11, 16), duracaoMin, agora: new Date(agora).toISOString().slice(11, 16), expediente: candidatos.map((c) => `${new Date(c.abre).toISOString().slice(11, 16)}-${new Date(c.fecha).toISOString().slice(11, 16)}`) });
    }
  }
}

console.log(`cenários: ${N}`);
console.log(`SEGURANÇA  (horário oferecido inválido): ${falhasSeg}`);
console.log(`COMPLETUDE (lista vazia com horário válido existindo): ${falhasCompl}`);
if (falhasCompl) console.log('  por duração (min):', [...porDuracao.entries()].sort((a, b) => b[1] - a[1]).map(([d, n]) => `${d}:${n}`).join(' '));
amostras.forEach((a) => console.log(JSON.stringify(a)));
process.exit(falhasSeg || falhasCompl ? 1 : 0);
