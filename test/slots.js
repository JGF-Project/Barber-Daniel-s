/* Teste da geração de horários livres — o coração da agenda.
   Rodar: node test/slots.js   (sem dependências, sem framework)

   Cada caso descreve um dia real da barbearia. Se algum quebrar, a agenda
   está oferecendo horário errado (buraco morto, conflito ou horário perdido). */

const assert = require('assert');
const { calcularSlotsLivres } = require('../js/slots.js');

const DIA = '2026-09-16'; // uma quarta qualquer
const h = (hhmm) => new Date(`${DIA}T${hhmm}:00-03:00`).getTime();
const hhmm = (ms) => new Date(ms).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });

const MIN = 60000;
const PASSO = 30 * MIN;
const TIPICA = 30 * MIN;  // duração do corte, o serviço mais comum
const ONTEM = h('00:00'); // "agora" no passado: nada é filtrado por antecedência

/** Roda um cenário e devolve os horários como "HH:MM" */
function slots({ abre = '10:00', fecha = '20:00', ocupados = [], duracaoMin = 30, agora = ONTEM, barbeiros = null }) {
  const candidatos = barbeiros || [{
    abre: h(abre),
    fecha: h(fecha),
    ocupados: ocupados.map(([i, f]) => ({ inicio: h(i), fim: h(f) })),
  }];
  return calcularSlotsLivres(candidatos, {
    duracaoMs: duracaoMin * MIN,
    agora,
    duracaoTipicaMs: TIPICA,
    passoMs: PASSO,
  }).map(hhmm);
}

let passou = 0;
function teste(nome, fn) {
  try {
    fn();
    passou++;
    console.log(`  ok  ${nome}`);
  } catch (erro) {
    console.error(`\n  FALHOU  ${nome}\n  ${erro.message}\n`);
    process.exitCode = 1;
  }
}

console.log('\nHorários livres:\n');

// --- O bug que custou 50 minutos de faturamento (15/09/2026) ---
teste('corte terminando 10:40-11:10 com almoço 12:00 ainda oferece 11:10', () => {
  const r = slots({ ocupados: [['10:40', '11:10'], ['12:00', '14:00']] });
  assert.ok(r.includes('11:10'), `11:10 sumiu — era o encaixe perfeito. Veio: ${r.join(', ')}`);
});

teste('manhã com um único corte não vira deserto até as 14:00', () => {
  const r = slots({ ocupados: [['10:40', '11:10'], ['12:00', '14:00']] });
  const manha = r.filter((x) => x < '12:00');
  assert.ok(manha.length >= 2, `a manhã inteira sumiu, sobrou: ${r.join(', ')}`);
});

teste('oferece o encaixe exato antes de um compromisso', () => {
  // compromisso às 10:40; um corte de 30min encaixa exato às 10:10
  const r = slots({ ocupados: [['10:40', '11:10']] });
  assert.ok(r.includes('10:10'), `10:10 encosta exato em 10:40. Veio: ${r.join(', ')}`);
});

teste('não oferece 11:30 quando 11:10 encosta melhor', () => {
  const r = slots({ ocupados: [['10:40', '11:10'], ['12:00', '14:00']] });
  assert.ok(!r.includes('11:30'), `11:30 deixa 20min mortos antes dele. Veio: ${r.join(', ')}`);
});

// --- Encaixe logo após um atendimento (fim fora da grade de 30) ---
teste('corte de 40min às 10:00 libera as 10:40', () => {
  const r = slots({ ocupados: [['10:00', '10:40']] });
  assert.strictEqual(r[0], '10:40', `veio ${r[0]}`);
});

teste('nunca oferece horário que conflita com atendimento existente', () => {
  const r = slots({ ocupados: [['10:00', '10:40']] });
  assert.ok(!r.includes('10:00') && !r.includes('10:30'), `conflito oferecido: ${r.join(', ')}`);
});

// --- Limites do expediente ---
teste('dia vazio começa na abertura e vai até o fechamento', () => {
  const r = slots({});
  assert.strictEqual(r[0], '10:00');
  assert.strictEqual(r[r.length - 1], '20:00', 'o fechamento é um horário válido de início');
});

teste('segunda abrindo 14:00 (sem almoço) começa em 14:00', () => {
  const r = slots({ abre: '14:00', fecha: '18:00' });
  assert.strictEqual(r[0], '14:00', `veio ${r[0]}`);
});

teste('dia vazio não marca nada como fragmentação', () => {
  const r = slots({});
  assert.ok(r.includes('11:00') && r.includes('15:30'), `grade incompleta: ${r.join(', ')}`);
});

// --- Almoço ---
teste('almoço bloqueia o intervalo e libera o fim dele', () => {
  const r = slots({ ocupados: [['12:00', '14:00']] });
  assert.ok(!r.includes('12:00') && !r.includes('13:00'), `ofereceu dentro do almoço: ${r.join(', ')}`);
  assert.ok(r.includes('14:00'), 'devia liberar 14:00, logo após o almoço');
});

teste('serviço longo não é oferecido se invade o almoço', () => {
  const r = slots({ ocupados: [['12:00', '14:00']], duracaoMin: 50 });
  assert.ok(!r.includes('11:30'), `11:30 + 50min invade o almoço. Veio: ${r.join(', ')}`);
});

// --- Buracos entre dois compromissos ---
teste('preenche buraco exato entre dois atendimentos', () => {
  const r = slots({ ocupados: [['10:00', '10:30'], ['11:00', '11:30']] });
  assert.ok(r.includes('10:30'), `10:30 cabe exato (30min). Veio: ${r.join(', ')}`);
});

teste('não oferece início que deixa buraco morto antes dele', () => {
  // livre 10:20–12:00; começar 10:30 deixaria 10min mortos
  const r = slots({ ocupados: [['10:00', '10:20'], ['12:00', '14:00']] });
  assert.ok(r.includes('10:20'), 'devia oferecer 10:20 (encosta)');
  assert.ok(!r.includes('10:30'), `10:30 deixa 10min mortos. Veio: ${r.join(', ')}`);
});

teste('buraco grande o suficiente continua sendo oferecido', () => {
  // livre a partir das 10:30; 11:00 deixa 30min antes — cabe um corte inteiro
  const r = slots({ ocupados: [['10:00', '10:30']] });
  assert.ok(r.includes('11:00'), `30min antes ainda é aproveitável. Veio: ${r.join(', ')}`);
});

// --- Antecedência mínima ---
teste('não oferece horário que já passou', () => {
  const r = slots({ agora: h('15:00') });
  assert.ok(!r.includes('10:00') && !r.includes('14:30'), `ofereceu passado: ${r.join(', ')}`);
  assert.strictEqual(r[0], '15:00');
});

// --- Dia lotado ---
teste('dia sem nenhum encaixe devolve lista vazia', () => {
  const r = slots({ abre: '10:00', fecha: '12:00', ocupados: [['10:00', '12:30']] });
  assert.deepStrictEqual(r, [], `devia estar vazio, veio: ${r.join(', ')}`);
});

teste('quando todo encaixe deixa buraco, oferece mesmo assim', () => {
  // livre só 10:10–10:30 (20min) e 11:00 em diante; um corte de 15min ali
  // sempre deixa sobra, mas perder o horário seria pior que o buraco
  const r = slots({ ocupados: [['10:00', '10:10'], ['10:30', '11:00']], duracaoMin: 15 });
  assert.ok(r.includes('10:10'), `devia oferecer 10:10 mesmo sobrando 5min. Veio: ${r.join(', ')}`);
});

// --- Vários barbeiros (cliente sem preferência) ---
teste('sem preferência: união dos horários dos barbeiros', () => {
  const r = slots({
    barbeiros: [
      { abre: h('10:00'), fecha: h('20:00'), ocupados: [{ inicio: h('10:00'), fim: h('11:00') }] },
      { abre: h('14:00'), fecha: h('18:00'), ocupados: [] },
    ],
  });
  assert.ok(r.includes('11:00'), 'Daniel livre às 11:00');
  assert.ok(r.includes('14:00'), 'Nicolas livre às 14:00');
  assert.ok(!r.includes('10:30'), `ninguém livre às 10:30: ${r.join(', ')}`);
});

// --- Duração do plano alterada pelo Daniel ---
teste('mudar a duração do serviço muda os horários oferecidos', () => {
  const de30 = slots({ ocupados: [['12:00', '14:00']], duracaoMin: 30 });
  const de60 = slots({ ocupados: [['12:00', '14:00']], duracaoMin: 60 });
  assert.ok(de30.includes('11:30'), '30min cabe antes do almoço');
  assert.ok(!de60.includes('11:30'), '60min não cabe antes do almoço');
});

console.log(`\n${passou} de ${passou + (process.exitCode ? 1 : 0)} passaram\n`);
