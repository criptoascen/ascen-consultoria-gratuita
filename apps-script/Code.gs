/************************************************************
 * Ascen Cripto — Consultoria Gratuita: registro blindado (v1)
 *
 * Mesma arquitetura já validada em produção no onboarding.
 * Recebe cada formulário do site e:
 *   1. grava numa planilha Google (criada automaticamente na 1ª vez)
 *   2. avisa por e-mail o dono do script
 *   3. repassa ao Google Forms SÓ se o site não tiver enviado (raro)
 *   4. devolve confirmação real ({ok:true}) para o site
 *
 * Deduplica pelo id do formulário — reenvios automáticos do site
 * não criam linha nem e-mail duplicados.
 ************************************************************/

const FORM_ACTION = "https://docs.google.com/forms/d/e/1FAIpQLSelc-2uGZE1mvHtwtOCPqC4J7QAHlXtTrgjDxiFdnbL45KtpQ/formResponse";
const NOME_PLANILHA = "Ascen Consultoria Gratuita — Cadastros";
const CAMPOS = ["Nome","E-mail","Telefone","Cidade - Estado","Nacionalidade",
  "Investe tradicional","Investe cripto","Tempo em cripto","Nível","Alocação pretendida",
  "Tolerância a risco","Objetivos","Dificuldades","Origem","Info adicional","Declaração"];
const COL_FORMS = CAMPOS.length + 3;   // ID + Recebido em + campos + coluna Forms

function doGet() {
  return _json({ ok: true, ping: true, servico: "ascen-consultoria-gratuita", versao: 1 });
}

function doPost(e) {
  let dados = {};
  try { dados = JSON.parse(e.postData.contents); } catch (err) { return _json({ ok: false, erro: "json" }); }

  const legivel = dados.legivel || dados;
  const id = dados.id || ("sem-id-" + new Date().getTime());
  const quando = dados.quando || new Date().toISOString();
  const precisaRepassar = !!(dados.payload && !dados.form_ja_enviado);

  // ---- Seção crítica CURTA: dedupe + gravação (nada de rede/e-mail aqui) ----
  const lock = LockService.getScriptLock();
  let aba, minhaLinha = 0;
  try {
    lock.waitLock(25000);
    aba = _aba();
    const ids = aba.getRange(1, 1, Math.max(aba.getLastRow(), 1), 1).getValues().map(function (r) { return String(r[0]); });
    if (ids.indexOf(id) !== -1) {
      lock.releaseLock();
      return _json({ ok: true, duplicado: true, id: id });
    }
    const linha = [id, quando].concat(CAMPOS.map(function (c) { return _celula(legivel[c]); }))
      .concat([precisaRepassar ? "pendente" : "site"]);
    aba.appendRow(linha);
    minhaLinha = aba.getLastRow();
    lock.releaseLock();
  } catch (err) {
    try { lock.releaseLock(); } catch (e2) {}
    return _json({ ok: false, erro: String(err) });
  }

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
      body: _corpoEmail(legivel, id, quando, formStatus)
    });
  } catch (err) { emailStatus = "falhou"; }

  return _json({ ok: true, id: id, form: formStatus, email: emailStatus });
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
    aba.appendRow(["ID", "Recebido em"].concat(CAMPOS).concat(["Forms"]));
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

function _corpoEmail(legivel, id, quando, formStatus) {
  let corpo = "Novo formulário de consultoria gratuita recebido.\n\n";
  CAMPOS.forEach(function (c) { if (legivel[c]) corpo += c + ": " + legivel[c] + "\n"; });
  corpo += "\n---\nID: " + id + "\nRecebido em: " + quando + "\nGoogle Forms: " + formStatus;
  if (formStatus.indexOf("falhou") === 0) {
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
