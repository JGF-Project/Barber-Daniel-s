/* Janela de agendamento do plano x semana usada na cota (banco: semana começa na segunda).
   Varre cada hora de 2026-2027 com relógio falso e confere que a cota consultada
   (referenciaCotaPlano) cai na MESMA semana dos dias que o plano pode agendar.
   Rodar: node test/plano-janela.js */
const fs = require('fs');
const vm = require('vm');

const ler = (f) => fs.readFileSync(`${__dirname}/../js/${f}`, 'utf8');
const pega = (src, nome) => src.match(new RegExp(`function ${nome}\\([\\s\\S]*?\\r?\\n}\\r?\\n`))[0];
const supa = ler('supabase.js');
const ag = ler('agendar.js');

const ctx = { Intl, FUSO: 'America/Sao_Paulo', agora: 0 };
class DataFalsa extends Date { constructor(...a) { super(...(a.length ? a : [ctx.agora])); } static now() { return ctx.agora; } }
ctx.Date = DataFalsa;
vm.createContext(ctx);
vm.runInContext(`${pega(supa, 'partesNoFuso')}\n${pega(ag, 'sabadoDaSemanaYmd')}\n${pega(ag, 'referenciaCotaPlano')}`, ctx);

const segundaDaSemana = (ymd) => {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
};

let erros = 0, checados = 0, semDia = 0;
for (let t = Date.parse('2026-01-01T00:00:00-03:00'); t < Date.parse('2027-12-31T00:00:00-03:00'); t += 3600000) {
  ctx.agora = t;
  const hoje = vm.runInContext('partesNoFuso(new Date())', ctx);
  const sabado = vm.runInContext('sabadoDaSemanaYmd()', ctx);
  const elegiveis = [];
  for (let i = 0; i <= 7; i++) {
    const d = new Date(`${hoje.ymd}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + i);
    const ymd = d.toISOString().slice(0, 10), dow = d.getUTCDay();
    if (dow >= 1 && dow <= 5 && ymd <= sabado) elegiveis.push(ymd); // mesma regra de diaDisponivel() para plano
  }
  const ref = vm.runInContext('referenciaCotaPlano()', ctx);
  if (!elegiveis.length) { semDia++; continue; }
  checados++;
  const refYmd = vm.runInContext(`partesNoFuso(new Date(${ref.getTime()})).ymd`, ctx);
  const semanas = new Set(elegiveis.map(segundaDaSemana));
  if (semanas.size !== 1 || !semanas.has(segundaDaSemana(refYmd)) || refYmd !== elegiveis[elegiveis.length - 1]) {
    erros++;
    if (erros <= 5) console.log('ERRO', new Date(t).toISOString(), { elegiveis, refYmd });
  }
}
console.log(`horas conferidas: ${checados} (sem dia agendável: ${semDia}) — erros: ${erros}`);
process.exit(erros ? 1 : 0);
