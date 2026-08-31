/************************************************************
 * Ascen Cripto — Consultoria Gratuita: registro blindado (v2)
 *
 * Mesma arquitetura já validada em produção no onboarding.
 * Recebe cada formulário do site e:
 *   1. grava numa planilha Google (criada automaticamente na 1ª vez)
 *   2. avisa por e-mail o dono do script
 *   3. repassa ao Google Forms SÓ se o site não tiver enviado (raro)
 *   4. devolve confirmação real ({ok:true}) para o site
 *
 * v2 — captura parcial: ao concluir a Seção 1 o site já manda nome,
 * WhatsApp e e-mail com status "parcial". Quando (e se) o formulário
 * completo chegar, a MESMA linha é sobrescrita — um lead, uma linha.
 * Quem abandona no meio fica registrado como "parcial".
 *
 * Deduplica pelo id — reenvios automáticos do site não duplicam nada.
 ************************************************************/

const FORM_ACTION = "https://docs.google.com/forms/d/e/1FAIpQLSelc-2uGZE1mvHtwtOCPqC4J7QAHlXtTrgjDxiFdnbL45KtpQ/formResponse";
const NOME_PLANILHA = "Ascen Consultoria Gratuita — Cadastros";
const CAMPOS = ["Nome","E-mail","Telefone","Cidade - Estado","Nacionalidade",
  "Investe tradicional","Investe cripto","Tempo em cripto","Nível","Alocação pretendida",
  "Tolerância a risco","Objetivos","Dificuldades","Origem","Info adicional","Declaração",
  "Origem (campanha)"];

// Colunas: ID | Lead | Recebido em | ...CAMPOS... | Status | Forms
const COL_LEAD   = 2;
const COL_QUANDO = 3;
const COL_STATUS = CAMPOS.length + 4;
const COL_FORMS  = CAMPOS.length + 5;
const TOTAL_COLS = CAMPOS.length + 5;

// Quanto tempo esperar antes de considerar um lead parcial "abandonado"
const MINUTOS_ABANDONO = 30;

function doGet() {
  return _json({ ok: true, ping: true, servico: "ascen-consultoria-gratuita", versao: 2 });
}

function doPost(e) {
  let dados = {};
  try { dados = JSON.parse(e.postData.contents); } catch (err) { return _json({ ok: false, erro: "json" }); }

  const legivel = dados.legivel || dados;
  const id = dados.id || ("sem-id-" + new Date().getTime());
  const lead = dados.lead || id;
  const parcial = !!dados.parcial;
  const quando = dados.quando || new Date().toISOString();
  const precisaRepassar = !parcial && !!(dados.payload && !dados.form_ja_enviado);

  // ---- Seção crítica CURTA: dedupe + gravação (nada de rede/e-mail aqui) ----
  const lock = LockService.getScriptLock();
  let aba, minhaLinha = 0;
  try {
    lock.waitLock(25000);
    aba = _aba();
    const ultima = aba.getLastRow();
    const linhas = ultima > 1 ? aba.getRange(2, 1, ultima - 1, TOTAL_COLS).getValues() : [];

    for (let i = 0; i < linhas.length; i++) {
      if (String(linhas[i][0]) === id) {
        lock.releaseLock();
        return _json({ ok: true, duplicado: true, id: id });
      }
    }

    const nova = _linha(id, lead, quando, legivel,
      parcial ? "parcial" : "completo",
      parcial ? "" : (precisaRepassar ? "pendente" : "site"));

    // Envio completo: se já existe a captura parcial deste lead, sobrescreve.
    let alvo = 0;
    if (!parcial) {
      for (let i = 0; i < linhas.length; i++) {
        if (String(linhas[i][COL_LEAD - 1]) === lead &&
            String(linhas[i][COL_STATUS - 1]).indexOf("parcial") === 0) { alvo = i + 2; break; }
      }
    }
    if (alvo) {
      aba.getRange(alvo, 1, 1, TOTAL_COLS).setValues([nova]);
      minhaLinha = alvo;
    } else {
      aba.appendRow(nova);
      minhaLinha = aba.getLastRow();
    }
    lock.releaseLock();
  } catch (err) {
    try { lock.releaseLock(); } catch (e2) {}
    return _json({ ok: false, erro: String(err) });
  }

  // Captura parcial não manda e-mail: senão você receberia um aviso por lead
  // que só passou da Seção 1. Quem abandona é avisado por avisarAbandonos().
  if (parcial) return _json({ ok: true, id: id, parcial: true });

  // ---- Fora do lock: repasse ao Forms (raro) e e-mail de aviso ----
  let formStatus = "site";
  if (precisaRepassar) {
    formStatus = _repassarAoForms(dados.payload);
    try { aba.getRange(minhaLinha, COL_FORMS).setValue(formStatus); } catch (e3) {}
  }

  let emailStatus = "ok";
  try {
    const alerta = (formStatus.indexOf("falhou") === 0) ? "⚠️ " : "";
    MailApp.sendEmail({
      to: Session.getEffectiveUser().getEmail(),
      subject: alerta + "🟠 Nova Consultoria Gratuita — " + (legivel["Nome"] || "sem nome"),
      body: _corpoEmail(legivel, "Novo formulário de consultoria gratuita recebido.", id, quando, formStatus)
    });
  } catch (err) { emailStatus = "falhou"; }

  return _json({ ok: true, id: id, form: formStatus, email: emailStatus });
}

/**
 * Avisa por e-mail os leads que preencheram o contato e não terminaram.
 * Rodar num acionador de tempo (ver INSTALAR.md). Sem o acionador nada
 * quebra — os parciais só ficam na planilha esperando você olhar.
 */
function avisarAbandonos() {
  const aba = _aba();
  const ultima = aba.getLastRow();
  if (ultima < 2) return;
  const linhas = aba.getRange(2, 1, ultima - 1, TOTAL_COLS).getValues();
  const limite = new Date().getTime() - MINUTOS_ABANDONO * 60 * 1000;

  for (let i = 0; i < linhas.length; i++) {
    if (String(linhas[i][COL_STATUS - 1]) !== "parcial") continue;
    const t = new Date(linhas[i][COL_QUANDO - 1]).getTime();
    if (isNaN(t) || t > limite) continue;

    const legivel = {};
    CAMPOS.forEach(function (c, j) { legivel[c] = linhas[i][COL_QUANDO + j]; });
    try {
      MailApp.sendEmail({
        to: Session.getEffectiveUser().getEmail(),
        subject: "🟡 Lead incompleto — " + (legivel["Nome"] || "sem nome"),
        body: _corpoEmail(legivel,
          "Preencheu os dados de contato e não terminou o formulário. Vale um WhatsApp.",
          String(linhas[i][0]), String(linhas[i][COL_QUANDO - 1]), "não enviado (incompleto)")
      });
      aba.getRange(i + 2, COL_STATUS).setValue("parcial-avisado");
    } catch (err) {}
  }
}

function _linha(id, lead, quando, legivel, status, formStatus) {
  return [id, lead, quando]
    .concat(CAMPOS.map(function (c) { return _celula(legivel[c]); }))
    .concat([status, formStatus]);
}

function _aba() {
  const props = PropertiesService.getScriptProperties();
  const planId = props.getProperty("PLANILHA_ID");
  let plan = null;
  if (planId) {
    try { plan = SpreadsheetApp.openById(planId); } catch (e) { plan = null; }
  }
  if (!plan) {
    plan = SpreadsheetApp.create(NOME_PLANILHA);
    props.setProperty("PLANILHA_ID", plan.getId());
  }
  let aba = plan.getSheetByName("Cadastros");
  if (!aba) {
    aba = plan.getSheets()[0];
    aba.setName("Cadastros");
  }
  // cabeçalho só em aba vazia — nunca no meio dos dados
  if (aba.getLastRow() === 0) {
    aba.appendRow(["ID", "Lead", "Recebido em"].concat(CAMPOS).concat(["Status", "Forms"]));
    aba.setFrozenRows(1);
  }
  return aba;
}

// Anti-injeção de fórmula: valor começando com = + - @ vira texto puro
function _celula(v) {
  v = String(v === null || v === undefined ? "" : v);
  return /^[=+\-@]/.test(v) ? "'" + v : v;
}

function _repassarAoForms(payload) {
  try {
    const partes = [];
    Object.keys(payload).forEach(function (k) {
      const v = payload[k];
      const vals = Array.isArray(v) ? v : [v];
      vals.forEach(function (x) {
        if (x !== "" && x !== null && x !== undefined) {
          partes.push(encodeURIComponent(k) + "=" + encodeURIComponent(x));
        }
      });
    });
    const resp = UrlFetchApp.fetch(FORM_ACTION, {
      method: "post",
      contentType: "application/x-www-form-urlencoded",
      payload: partes.join("&"),
      muteHttpExceptions: true,
      followRedirects: true
    });
    return resp.getResponseCode() === 200 ? "ok" : "falhou-" + resp.getResponseCode();
  } catch (err) { return "falhou"; }
}

function _corpoEmail(legivel, cabecalho, id, quando, formStatus) {
  let corpo = cabecalho + "\n\n";
  CAMPOS.forEach(function (c) { if (legivel[c]) corpo += c + ": " + legivel[c] + "\n"; });
  corpo += "\n---\nID: " + id + "\nRecebido em: " + quando + "\nGoogle Forms: " + formStatus;
  if (String(formStatus).indexOf("falhou") === 0) {
    corpo += "\n⚠️ O repasse ao Google Forms falhou — o cadastro está seguro na planilha. " +
             "Se isso se repetir, o Form pode ter sido editado (IDs das perguntas mudam).";
  }
  try {
    const planId = PropertiesService.getScriptProperties().getProperty("PLANILHA_ID");
    if (planId) corpo += "\nPlanilha: " + SpreadsheetApp.openById(planId).getUrl();
  } catch (e) {}
  return corpo;
}

function _json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
