const express = require("express");
const cors = require("cors");
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const SECRET = process.env.AGENTE_SECRETO_DE_DIAN;
const CC = process.env.REPRESENTANTE_CC;
const NIT = process.env.EMPRESA_NIT;

const DOWNLOAD_DIR = process.env.DOWNLOAD_DIR || "/app/downloads";
const DEBUG_DIR = process.env.DEBUG_DIR || "/app/debug";
const HEADLESS = process.env.HEADLESS !== "false";

let browser;
let context;
let page;
let lastStatus = {
  ok: true,
  step: "idle",
  message: "Backend iniciado",
  updatedAt: new Date().toISOString()
};

function setStatus(step, message, extra = {}) {
  lastStatus = {
    ok: true,
    step,
    message,
    updatedAt: new Date().toISOString(),
    ...extra
  };
  console.log(`[${step}] ${message}`);
}

function setError(step, error) {
  lastStatus = {
    ok: false,
    step,
    error: error.message || String(error),
    updatedAt: new Date().toISOString()
  };
  console.error(`[${step}]`, error);
}

function ensureDirs() {
  if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
  if (!fs.existsSync(DEBUG_DIR)) fs.mkdirSync(DEBUG_DIR, { recursive: true });
}

async function screenshot(name) {
  try {
    ensureDirs();
    if (!page || page.isClosed()) return null;
    const file = path.join(DEBUG_DIR, `${Date.now()}-${name}.png`);
    await page.screenshot({ path: file, fullPage: true });
    console.log("Screenshot:", file);
    return file;
  } catch (e) {
    console.warn("No se pudo tomar screenshot:", e.message);
    return null;
  }
}

function auth(req, res, next) {
  if (!SECRET) {
    return res.status(500).json({ ok: false, error: "Falta AGENTE_SECRETO_DE_DIAN en Railway" });
  }

  if (req.headers.authorization !== `Bearer ${SECRET}`) {
    return res.status(401).json({ ok: false, error: "No autorizado: token incorrecto" });
  }

  next();
}

async function resetBrowser() {
  try {
    if (browser) await browser.close();
  } catch {}
  browser = null;
  context = null;
  page = null;
}

async function getPage({ fresh = false } = {}) {
  ensureDirs();

  if (fresh) await resetBrowser();

  if (!browser) {
    setStatus("browser", `Lanzando navegador HEADLESS=${HEADLESS}`);
    browser = await chromium.launch({
      headless: HEADLESS,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-blink-features=AutomationControlled"
      ]
    });
  }

  if (!context) {
    context = await browser.newContext({
      acceptDownloads: true,
      viewport: { width: 1366, height: 768 },
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36",
      locale: "es-CO",
      timezoneId: "America/Bogota"
    });
  }

  if (!page || page.isClosed()) {
    page = await context.newPage();
    page.setDefaultTimeout(60000);
    page.setDefaultNavigationTimeout(120000);
  }

  return page;
}

async function humanType(locator, value) {
  await locator.click({ timeout: 60000 });
  await locator.fill("");
  await locator.type(value, { delay: 120 });
  await locator.press("Tab");
  await page.waitForTimeout(700);
}

async function clickHuman(locator) {
  await locator.waitFor({ state: "visible", timeout: 60000 });
  await locator.scrollIntoViewIfNeeded().catch(() => {});
  await locator.hover().catch(() => {});
  await page.waitForTimeout(500);
  await locator.click({ timeout: 60000 });
}

async function waitCloudflareIfPresent(p) {
  // No se evade Cloudflare. Solo esperamos si ya está verificando automáticamente.
  const bodyText = await p.locator("body").innerText({ timeout: 5000 }).catch(() => "");
  if (/Verificando|verifique que es un ser humano|Cloudflare/i.test(bodyText)) {
    setStatus("cloudflare", "Cloudflare detectado. Esperando validación automática o intervención manual.");
    await screenshot("cloudflare-detectado");
    await p.waitForTimeout(15000);
  }
}

async function goToCompanyLogin(p) {
  setStatus("login", "Abriendo ruta oficial /User/Login");
  await p.goto("https://catalogo-vpfe.dian.gov.co/User/Login", {
    waitUntil: "domcontentloaded",
    timeout: 120000
  });

  await waitCloudflareIfPresent(p);
  await p.waitForTimeout(3000);
  await screenshot("01-user-login");

  setStatus("login", "Seleccionando Empresa");
  await clickHuman(p.getByText("Empresa", { exact: false }).first());
  await p.waitForTimeout(1500);
  await screenshot("02-empresa");

  setStatus("login", "Seleccionando Representante legal");
  await clickHuman(p.getByText("Representante legal", { exact: false }).first());
  await p.waitForTimeout(2500);
  await screenshot("03-representante-legal");
}

async function fillCompanyLogin(p) {
  setStatus("login", "Llenando credenciales como humano");

  const visibleInputs = p.locator("input:visible");
  await visibleInputs.first().waitFor({ state: "visible", timeout: 60000 });

  const count = await visibleInputs.count();

  if (count < 2) {
    await screenshot("error-inputs-no-encontrados");
    throw new Error(`No se encontraron suficientes inputs visibles. Encontrados: ${count}`);
  }

  await humanType(visibleInputs.nth(0), CC);
  await humanType(visibleInputs.nth(1), NIT);

  await screenshot("04-formulario-llenado");

  setStatus("login", "Haciendo click en Entrar");

  const button = p.locator("button:has-text('Entrar'), input[type='submit'][value*='Entrar']").first();
  await clickHuman(button);

  // Esperamos confirmación real
  await p.waitForTimeout(7000);
  await screenshot("05-despues-de-entrar");

  const url = p.url();
  const body = await p.locator("body").innerText({ timeout: 10000 }).catch(() => "");

  if (/LoginConfirmed/i.test(url) || /Se ha enviado la ruta de acceso/i.test(body) || /acceso estará disponible/i.test(body)) {
    return {
      confirmed: true,
      url,
      message: "DIAN confirmó envío de correo"
    };
  }

  // Algunos casos tardan un poco más
  await p.waitForTimeout(8000);
  const url2 = p.url();
  const body2 = await p.locator("body").innerText({ timeout: 10000 }).catch(() => "");

  if (/LoginConfirmed/i.test(url2) || /Se ha enviado la ruta de acceso/i.test(body2) || /acceso estará disponible/i.test(body2)) {
    return {
      confirmed: true,
      url: url2,
      message: "DIAN confirmó envío de correo"
    };
  }

  return {
    confirmed: false,
    url: url2,
    message: "No se detectó confirmación de envío de correo",
    pageTextSample: body2.slice(0, 500)
  };
}

app.get("/", (req, res) => {
  res.json({
    ok: true,
    service: "Backend DIAN robusto v6",
    endpoints: [
      "GET /health",
      "GET /status",
      "POST /reset",
      "POST /proceso-completo",
      "POST /continuar-con-link"
    ]
  });
});

app.get("/health", (req, res) => {
  res.json({ ok: true, status: "online", headless: HEADLESS });
});

app.get("/status", (req, res) => {
  res.json(lastStatus);
});

app.post("/reset", auth, async (req, res) => {
  await resetBrowser();
  setStatus("reset", "Navegador reiniciado");
  res.json({ ok: true, message: "Browser reiniciado" });
});

app.post("/proceso-completo", auth, async (req, res) => {
  try {
    if (!CC || !NIT) {
      return res.status(500).json({
        ok: false,
        error: "Faltan variables REPRESENTANTE_CC o EMPRESA_NIT"
      });
    }

    const p = await getPage({ fresh: true });

    await goToCompanyLogin(p);
    const result = await fillCompanyLogin(p);

    if (!result.confirmed) {
      setError("login_no_confirmado", new Error(result.message));
      return res.status(500).json({
        ok: false,
        step: "login_no_confirmado",
        error: result.message,
        currentUrl: result.url,
        pageTextSample: result.pageTextSample
      });
    }

    setStatus("login_confirmado", "DIAN confirmó envío de correo", {
      currentUrl: result.url
    });

    res.json({
      ok: true,
      step: "login_confirmado",
      message: "DIAN confirmó envío de correo. n8n puede buscar el email.",
      currentUrl: result.url
    });
  } catch (e) {
    setError("proceso-completo", e);
    await screenshot("error-proceso-completo");
    res.status(500).json({
      ok: false,
      step: "proceso-completo",
      error: e.message
    });
  }
});

app.post("/continuar-con-link", auth, async (req, res) => {
  try {
    const { url } = req.body;

    if (!url || !String(url).startsWith("http")) {
      return res.status(400).json({ ok: false, error: "URL inválida o vacía" });
    }

    const p = await getPage();

    setStatus("link", "Abriendo link del correo DIAN");
    await p.goto(url, { waitUntil: "domcontentloaded", timeout: 120000 });
    await waitCloudflareIfPresent(p);
    await p.waitForTimeout(6000);
    await screenshot("06-link-correo");

    setStatus("export", "Navegando a Document/Export");
    await p.goto("https://catalogo-vpfe.dian.gov.co/Document/Export", {
      waitUntil: "domcontentloaded",
      timeout: 120000
    });

    await p.waitForTimeout(5000);
    await screenshot("07-document-export");

    setStatus("export", "Click en Exportar Excel");
    await clickHuman(p.getByText("Exportar Excel", { exact: false }).first());

    let downloadButton = null;
    const selectors = [
      "text=Descargar",
      "a[download]",
      "button:has-text('Descargar')",
      "a:has-text('Descargar')",
      "[title*='Descargar']",
      "[aria-label*='Descargar']",
      ".fa-download",
      "i.fa-download"
    ];

    setStatus("download", "Esperando botón de descarga");
    for (let i = 0; i < 48; i++) {
      for (const selector of selectors) {
        const locator = p.locator(selector).last();
        const count = await locator.count().catch(() => 0);
        if (count > 0) {
          try {
            if (await locator.isVisible({ timeout: 1000 })) {
              downloadButton = locator;
              break;
            }
          } catch {}
        }
      }

      if (downloadButton) break;

      await p.waitForTimeout(5000);
      await p.reload({ waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
    }

    if (!downloadButton) {
      await screenshot("error-no-descarga");
      throw new Error("No apareció el botón de descarga después de esperar");
    }

    ensureDirs();

    setStatus("download", "Descargando archivo");
    const [download] = await Promise.all([
      p.waitForEvent("download", { timeout: 120000 }),
      downloadButton.click()
    ]);

    const fileName = download.suggestedFilename() || `dian_export_${Date.now()}.xlsx`;
    const filePath = path.join(DOWNLOAD_DIR, fileName);

    await download.saveAs(filePath);

    setStatus("completado", "Archivo descargado", { fileName, filePath });

    res.json({
      ok: true,
      step: "archivo_descargado",
      fileName,
      filePath
    });
  } catch (e) {
    setError("continuar-con-link", e);
    await screenshot("error-continuar-con-link");
    res.status(500).json({
      ok: false,
      step: "continuar-con-link",
      error: e.message
    });
  }
});

app.listen(PORT, () => {
  ensureDirs();
  console.log(`Backend DIAN robusto v6 corriendo en puerto ${PORT}`);
});
