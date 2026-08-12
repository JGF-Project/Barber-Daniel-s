# Configuração: Plano de Pezinhos

## Para ativar o plano de pezinhos, faça o seguinte:

1. **No painel admin**, vá até a aba **Serviços e preços**
2. Clique em **+ Adicionar novo serviço**
3. Preencha:
   - **Nome**: `Pezinhos` (exatamente assim)
   - **Descrição**: `Serviço de pezinhos do plano`
   - **Preço**: `0` (gratuito no plano)
   - **Duração**: `30` (minutos)
   - **Ativo**: sim

4. **Salvar**

## Pronto! Agora:

- O cliente verá **duas seções** na aba "Minha assinatura":
  - **Seu plano** → Cortes normais (4/semana)
  - **Pezinhos** → Serviço de pezinhos (4/semana separado)

- Pode agendar **ambos** na mesma semana (4 cortes + 4 pezinhos)
- Cada um tem sua própria **cota de 1/semana**
- Cancelamento de 1 hora funciona para ambos

## Faturamento

- Ambos contam automaticamente no faturamento desde "confirmado"
- Se faltar: edite o valor para 0 (desconta do faturamento)

---

**Nota**: Se o banco não tiver os campos `pezinhos_restantes` e `pezinhos_usado_semana`, o sistema vai usar os mesmos campos de corte. Para uma separação completa, será necessário uma migração no Supabase.
