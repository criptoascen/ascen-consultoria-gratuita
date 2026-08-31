# Apps Script da Consultoria Gratuita — como instalar

O site já funciona sem isso: ele posta direto no Google Forms, com o payload no
formato certo. O Apps Script acrescenta o que o Forms não dá:

- **confirmação real** de que o cadastro entrou (hoje a tela de sucesso é um chute);
- **captura parcial**: quem preenche a Seção 1 e abandona já fica registrado como lead;
- **planilha própria** + **e-mail de aviso** na hora;
- **origem de campanha** (utm_source/medium/campaign, gclid, fbclid) junto de cada lead;
- **fila de reenvio** (lead que caiu a conexão volta sozinho na próxima visita);
- **beacon iOS** (lead que fechou a página no meio do envio não se perde).

Enquanto a URL não estiver no site, tudo isso fica dormindo — inclusive a captura
parcial e o registro de campanha. O Google Forms não aceita resposta pela metade
em pergunta obrigatória, então não dá pra fazer isso sem o script.

## Passo a passo (5 min, uma vez só)

1. Abrir <https://script.google.com> logado na conta **criptoascen@gmail.com**
   e criar um **Novo projeto**.
2. Nomear o projeto: `Ascen — Consultoria Gratuita`.
3. Apagar o conteúdo do `Código.gs` e colar o conteúdo de [`Code.gs`](Code.gs).
4. **Implantar → Nova implantação → tipo: App da Web**
   - Executar como: **Eu**
   - Quem pode acessar: **Qualquer pessoa**
   - Implantar → autorizar (vai aparecer o aviso "app não verificado" →
     *Avançado* → *Acessar Ascen — Consultoria Gratuita*).
5. Copiar a **URL do app da web** (termina em `/exec`) e me mandar. Eu ponho no
   `index.html` (constante `ENDPOINT_URL`, no topo do `<script>`) e subo.

Teste rápido: abrir a URL `/exec` no navegador deve responder
`{"ok":true,"ping":true,"servico":"ascen-consultoria-gratuita","versao":2}`.

## Passo 6 (opcional) — aviso de lead abandonado

Sem isso os leads incompletos ficam na planilha com status `parcial`, esperando
você olhar. Com isso você recebe um e-mail por lead que parou no meio.

**Acionadores (⏰ na barra esquerda) → Adicionar acionador**
- Função: `avisarAbandonos`
- Origem do evento: **Baseado no tempo** → Temporizador por minuto → **A cada 30 minutos**

Ele só avisa depois de 30 min de silêncio (constante `MINUTOS_ABANDONO`), pra não
tocar enquanto a pessoa ainda está preenchendo, e marca a linha como
`parcial-avisado` pra não repetir.

## Ao atualizar o Code.gs depois

**Implantar → Gerenciar implantações → ✏️ (editar) → Versão: Nova versão → Implantar.**
Isso mantém a MESMA URL. Criar uma implantação nova gera URL diferente e quebra o site.

## Se o Google Form for editado

Mudar opções ou perguntas no Form troca os `entry.IDs` → o repasse ao Forms quebra,
mas a planilha do script continua registrando tudo (o campo `legivel` não depende
dos IDs). Nesse caso é só reconferir os IDs e atualizar o `FORM_ENTRIES` do site.
