/* ============================================================
   BARBER DANIEL'S — CONEXÃO E HELPERS COMPARTILHADOS
   Usado por agendar.html e admin.html
   Requer o SDK: https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2
============================================================ */

'use strict';

/**
 * Cliente Supabase.
 * A chave abaixo é PÚBLICA (publishable): o que cada usuário pode
 * fazer é controlado pelo Row Level Security no banco.
 */
const sb = supabase.createClient(
  'https://giduojgtoyjyxfndusqy.supabase.co',
  'sb_publishable_fnHeH_u1L-pIE1g4lPRLWA_lLrYyenF'
);

/* Projeto é multi-tenant (várias barbearias no mesmo banco).
   Cada deploy tem esse ID fixo — é assim que o front sabe qual é "sua" barbearia. */
const BARBEARIA_ID = 'f9f49a8b-18dd-471d-b5f8-c860e9105cec'; // Barber Daniel's

/* Fuso horário fixo da barbearia (Brasil não tem mais horário de verão) */
const FUSO = 'America/Sao_Paulo';
const OFFSET = '-03:00';

/* Rótulos de status, usados no painel do barbeiro e na área do cliente.
   'falta' = não compareceu; pelo regulamento da assinatura conta como
   serviço prestado (não devolve a visita do mês). */
const ROTULO_STATUS = {
  confirmado: 'Confirmado',
  cancelado: 'Cancelado',
  concluido: 'Concluído',
  falta: 'Falta',
};

const DIAS_SEMANA = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const DIAS_CURTOS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const MESES_CURTOS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/** Formata centavos como moeda: 6000 -> "R$ 60,00" */
function formatarPreco(centavos) {
  return (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/** Partes da data (ano-mês-dia e dia da semana) no fuso da barbearia */
function partesNoFuso(data) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const ymd = fmt.format(data); // ex.: "2026-07-02"
  // Meio-dia UTC garante o dia da semana correto do calendário
  const diaSemana = new Date(`${ymd}T12:00:00Z`).getUTCDay();
  return { ymd, diaSemana };
}

/** Exibe um timestamp do banco como "qua, 02 jul · 14:30" */
function formatarDataHora(iso) {
  const d = new Date(iso);
  const data = d.toLocaleDateString('pt-BR', {
    timeZone: FUSO, weekday: 'short', day: '2-digit', month: 'short',
  });
  const hora = d.toLocaleTimeString('pt-BR', {
    timeZone: FUSO, hour: '2-digit', minute: '2-digit',
  });
  return `${data} · ${hora}`;
}

/** Exibe apenas a hora: "14:30" */
function formatarHora(iso) {
  return new Date(iso).toLocaleTimeString('pt-BR', {
    timeZone: FUSO, hour: '2-digit', minute: '2-digit',
  });
}

/** Máscara de celular (11) 98765-4321 — mesma da landing page */
function mascararCelular(valor) {
  const digitos = valor.replace(/\D/g, '').slice(0, 11);
  if (digitos.length <= 2) return digitos.replace(/(\d{1,2})/, '($1');
  if (digitos.length <= 7) return digitos.replace(/(\d{2})(\d{1,5})/, '($1) $2');
  return digitos.replace(/(\d{2})(\d{5})(\d{1,4})/, '($1) $2-$3');
}

/** Atalhos de DOM */
const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

/** Escapa texto vindo do banco antes de inserir em HTML */
function escaparHtml(texto) {
  const div = document.createElement('div');
  div.textContent = texto ?? '';
  return div.innerHTML;
}

/**
 * Resumo dos serviços de um agendamento (que agora pode ter vários, via
 * a junção agendamento_servicos). Retorna { nomes, total, itens }.
 * Espera o embed: agendamento_servicos(servicos(nome, preco_centavos)).
 */
/**
 * Valor cobrado NO ATENDIMENTO, em centavos.
 * Visita de assinante vale 0: ela já foi paga na mensalidade, e somar o
 * preço do plano de novo aqui inflaria o faturamento do dia.
 * Fora isso vale o preço que o barbeiro editou (valor_centavos) ou, sem
 * edição, a soma dos serviços.
 */
function valorCobrado(agendamento) {
  if (agendamento.via_assinatura) return agendamento.valor_centavos ?? 0;
  return agendamento.valor_centavos ?? servicosResumo(agendamento).total;
}

function servicosResumo(agendamento) {
  const itens = (agendamento.agendamento_servicos || [])
    .map((x) => x.servicos)
    .filter(Boolean);
  return {
    nomes: itens.map((s) => s.nome).join(' + ') || 'Serviço',
    total: itens.reduce((soma, s) => soma + (s.preco_centavos || 0), 0),
    itens,
  };
}
