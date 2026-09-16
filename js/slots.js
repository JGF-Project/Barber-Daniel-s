/* ============================================================
   BARBER DANIEL'S — CÁLCULO DOS HORÁRIOS LIVRES
   ------------------------------------------------------------
   Usado pela tela do cliente (agendar.html) e pelo painel do
   barbeiro (admin.html). Uma lógica só: quando a regra muda, muda
   nos dois lugares ao mesmo tempo.
   Coberto por test/slots.js — rode `node test/slots.js` ao mexer.
============================================================ */

'use strict';

/**
 * Horários livres de um dia, dado o expediente e as ocupações de cada barbeiro.
 * Função pura (sem DOM, sem rede) — é o coração da agenda e o que test/slots.js
 * cobre. Devolve os inícios possíveis, já ordenados.
 *
 * candidatos: [{ abre, fecha, ocupados: [{inicio, fim}] }] em ms
 * duracaoMs: quanto dura o serviço escolhido
 * agora: nada antes disso é oferecido (inclui a antecedência mínima)
 * duracaoTipicaMs: referência de "buraco aproveitável" (a duração mais comum)
 * passoMs: grade base
 */
function calcularSlotsLivres(candidatos, { duracaoMs, agora, duracaoTipicaMs, passoMs }) {
  if (!candidatos.length) return [];

  const janelaInicio = Math.min(...candidatos.map((c) => c.abre));
  const janelaFim = Math.max(...candidatos.map((c) => c.fecha));

  // Grade base + dois encaixes exatos em cada compromisso: logo depois dele
  // (o.fim) e logo antes dele (o.inicio - duração). Sem o primeiro, um corte
  // de 40min às 10:00 deixaria os 20min seguintes mortos — a grade só
  // ofereceria 10:30 (conflita) e 11:00. Sem o segundo, quem quer marcar
  // antes de um compromisso das 10:40 só teria 10:00 e sobrariam 10min.
  const pontos = new Set();
  for (let t = janelaInicio; t <= janelaFim; t += passoMs) pontos.add(t);
  candidatos.forEach((c) => c.ocupados.forEach((o) => {
    pontos.add(o.fim);
    pontos.add(o.inicio - duracaoMs);
  }));

  const slots = [];
  for (const inicio of [...pontos].sort((a, b) => a - b)) {
    const fim = inicio + duracaoMs;
    if (inicio < agora) continue; // já passou (ou está em cima da hora)

    // O horário só é válido se o atendimento inteiro cabe antes de fechar —
    // não só o início. Um corte de 40min às 17:30 num expediente até as
    // 18:00 terminava 18:10, passando do fechamento; ninguém checava o fim.
    const candidato = candidatos.find((c) =>
      inicio >= c.abre && inicio < c.fecha && fim <= c.fecha &&
      !c.ocupados.some((o) => inicio < o.fim && fim > o.inicio)
    );
    if (!candidato) continue;

    // Só o buraco ANTES desqualifica, e apenas contra um compromisso real
    // (não a abertura do dia, que ainda pode receber agendamento). O buraco
    // DEPOIS é criado pelo almoço/fechamento, não pela escolha do cliente:
    // punir por ele apagava justamente o melhor horário — um corte que
    // termina 11:10 com almoço às 12:00 deixa 20min sobrando faça o que
    // fizer, e descartar 11:10 por isso jogava a manhã inteira fora.
    const eventoAntes = Math.max(candidato.abre, ...candidato.ocupados.filter((o) => o.fim <= inicio).map((o) => o.fim));
    const buracoAntes = eventoAntes > candidato.abre ? inicio - eventoAntes : 0;
    const fragmenta = buracoAntes > 0 && buracoAntes < duracaoTipicaMs;

    slots.push({ inicio, fragmenta });
  }

  // Daniel prefere perder a chance de um cliente que só serve naquele horário
  // a ficar com um buraco morto no dia. Exceção: se sobrar só horário ruim,
  // oferece mesmo assim — nada é pior que nada.
  const bons = slots.filter((s) => !s.fragmenta);
  return (bons.length ? bons : slots).map((s) => s.inicio).sort((a, b) => a - b);
}

/* Exporta para o teste em Node; no browser `module` não existe e isso é ignorado. */
if (typeof module !== 'undefined') module.exports = { calcularSlotsLivres };
