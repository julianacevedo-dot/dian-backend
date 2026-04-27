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
  message: "Backend DIAN robusto v7 iniciado",
  updatedAt: new Date().toISOString()
};

function log(step, message, extra = {}) {
  lastStatus = {
    ok: true,
    step,
    message,
    updatedAt: new Date().toISOString(),
    ...extra
  };
  console.log(`[${step}] ${message}`);
}

function logError(step, error) {
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

async function takeScreenshot(name) {
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
    return res.status(500).json({
      ok: false,
      error: "Falta AGENTE_SECRETO_DE_DIAN en Railway"
    });
  }

  if (req.headers.authorization !== `Bearer ${SECRET}`) {
    return res.status(401).json({
      ok: false,
      error: "No autorizado: token incorrecto"
    });
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
    log("browser", `Lanzando Chromium HEADLESS=${HEADLESS}`);

    browser = await chromium.launch({
      headless: HEADLESS,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-blink-features=AutomationControlled",
        "--disable-infobars"
      ]
    });
  }

  if (!context) {
    context = await browser.newContext({
      acceptDownloads: true,
      viewport: { width: 1366, height: 768 },
      deviceScaleFactor: 1,
      isMobile: false,
      hasTouch: false,
      locale: "es-CO",
      timezoneId: "America/Bogota",
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    });

    await context.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
      Object.defineProperty(navigator, "languages", { get: () => ["es-CO", "es", "en-US", "en"] });
      Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3, 4, 5] });
    });
  }

  if (!page || page.isClosed()) {
    page = await context.newPage();
    page.setDefaultTimeout(60000);
    page.setDefaultNavigationTimeout(120000);
  }

  return page;
}

async function humanPause(min = 350, max = 1200) {
  const ms = Math.floor(min + Math.random() * (max - min));
  await page.waitForTimeout(ms);
}

async function humanMoveAndClick(locator) {
  await locator.waitFor({ state: "visible", timeout: 60000 });
  await locator.scrollIntoViewIfNeeded().catch(() => {});
  await humanPause();

  const box = await locator.boundingBox();
  if (box) {
    const x = box.x + box.width / 2 + (Math.random() * 10 - 5);
    const y = box.y + box.height / 2 + (Math.random() * 10 - 5);
    await page.mouse.move(x - 40, y - 20, { steps: 8 });
    await humanPause(200, 500);
    await page.mouse.move(x, y, { steps: 12 });
    await humanPause(200, 700);
    await page.mouse.down();
    await humanPause(80, 180);
    await page.mouse.up();
  } else {
    await locator.hover().catch(() => {});
    await humanPause();
    await locator.click();
  }
}

async function humanType(locator, value) {
  await locator.waitFor({ state: "visible", timeout: 60000 });
  await locator.scrollIntoViewIfNeeded().catch(() => {});
  await humanMoveAndClick(locator);
  await locator.fill("");
  await humanPause(200, 500);
  await locator.type(value, { delay: 120 });
  await humanPause(300, 800);
  await locator.press("Tab");
  await humanPause(500, 1200);
}

async function waitCloudflareIfPresent(p) {
  const text = await p.locator("body").innerText({ timeout: 5000 }).catch(() => "");
  if (/Cloudflare|Verificando|verifique que es un ser humano|Operación exitosa/i.test(text)) {
    log("cloudflare", "Cloudflare detectado. Esperando validación automática.");
    await takeScreenshot("cloudflare");
    await p.waitForTimeout(15000);
  }
}

async function loginDian(p) {
  log("login", "Abriendo ruta oficial /User/Login");

  await p.goto("https://catalogo-vpfe.dian.gov.co/User/Login", {
    waitUntil: "domcontentloaded",
    timeout: 120000
  });

  await waitCloudflareIfPresent(p);
  await p.waitForTimeout(3000);
  await takeScreenshot("01-login");

  log("login", "Seleccionando Empresa");
  await humanMoveAndClick(p.getByText("Empresa", { exact: false }).first());
  await humanPause(800, 1500);
  await takeScreenshot("02-empresa");

  log("login", "Seleccionando Representante legal");
  await humanMoveAndClick(p.getByText("Representante legal", { exact: false }).first());
  await humanPause(1500, 2500);
  await takeScreenshot("03-representante");

  log("login", "Llenando campos CC y NIT");

  const inputs = p.locator("input:visible");
  await inputs.first().waitFor({ state: "visible", timeout: 60000 });

  const count = await inputs.count();
  if (count < 2) {
    await takeScreenshot("error-sin-inputs");
    throw new Error(`No se encontraron dos inputs visibles. Encontrados: ${count}`);
  }

  await humanType(inputs.nth(0), CC);
  await humanType(inputs.nth(1), NIT);
  await takeScreenshot("04-form-lleno");

  log("login", "Presionando botón Entrar con interacción humana");

  const boton = p.locator("button:has-text('Entrar'), input[type='submit'][value*='Entrar']").first();
  await humanMoveAndClick(boton);

  await p.waitForTimeout(9000);
  await waitCloudflareIfPresent(p);
  await takeScreenshot("05-despues-entrar");

  const currentUrl = p.url();
  const bodyText = await p.locator("body").innerText({ timeout: 10000 }).catch(() => "");

  const confirmed =
    /LoginConfirmed/i.test(currentUrl) ||
    /Se ha enviado la ruta de acceso/i.test(bodyText) ||
    /acceso estará disponible/i.test(bodyText) ||
    /reenviar el correo/i.test(bodyText);

  if (!confirmed) {
    await p.waitForTimeout(10000);
    await takeScreenshot("06-no-confirmado-reintento-espera");

    const currentUrl2 = p.url();
    const bodyText2 = await p.locator("body").innerText({ timeout: 10000 }).catch(() => "");

    const confirmed2 =
      /LoginConfirmed/i.test(currentUrl2) ||
      /Se ha enviado la ruta de acceso/i.test(bodyText2) ||
      /acceso estará disponible/i.test(bodyText2) ||
      /reenviar el correo/i.test(bodyText2);

    if (!confirmed2) {
      return {
        confirmed: false,
        currentUrl: currentUrl2,
        pageTextSample: bodyText2.slice(0, 700)
      };
    }

    return {
      confirmed: true,
      currentUrl: currentUrl2
    };
  }

  return {
    confirmed: true,
    currentUrl
  };
}

app.get("/", (req, res) => {
  res.json({
    ok: true,
    service: "Backend DIAN robusto v7",
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
  res.json({
    ok: true,
    status: "online",
    headless: HEADLESS
  });
});

app.get("/status", (req, res) => {
  res.json(lastStatus);
});

app.post("/reset", auth, async (req, res) => {
  await resetBrowser();
  log("reset", "Browser reiniciado");
  res.json({ ok: true });
});

app.post("/proceso-completo", auth, async (req, res) => {
  try {
    if (!CC || !NIT) {
      return res.status(500).json({
        ok: false,
        error: "Faltan REPRESENTANTE_CC o EMPRESA_NIT"
      });
    }

    const p = await getPage({ fresh: true });
    const result = await loginDian(p);

    if (!result.confirmed) {
      const error = new Error("No se detectó confirmación de envío de correo");
      logError("login_no_confirmado", error);

      return res.status(500).json({
        ok: false,
        step: "login_no_confirmado",
        error: error.message,
        currentUrl: result.currentUrl,
        pageTextSample: result.pageTextSample
      });
    }

    log("login_confirmado", "DIAN confirmó envío de correo", {
      currentUrl: result.currentUrl
    });

    res.json({
      ok: true,
      step: "login_confirmado",
      message: "DIAN confirmó envío de correo. n8n puede buscar el email.",
      currentUrl: result.currentUrl
    });
  } catch (e) {
    logError("proceso-completo", e);
    await takeScreenshot("error-proceso-completo");
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

    log("link", "Abriendo link DIAN del correo");
    await p.goto(url, { waitUntil: "domcontentloaded", timeout: 120000 });
    await waitCloudflareIfPresent(p);
    await p.waitForTimeout(6000);
    await takeScreenshot("07-link-correo");

    log("export", "Navegando a Document/Export");
    await p.goto("https://catalogo-vpfe.dian.gov.co/Document/Export", {
      waitUntil: "domcontentloaded",
      timeout: 120000
    });

    await p.waitForTimeout(5000);
    await takeScreenshot("08-export");

    log("export", "Click en Exportar Excel");
    await humanMoveAndClick(p.getByText("Exportar Excel", { exact: false }).first());

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

    log("download", "Esperando botón de descarga");
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
      await takeScreenshot("error-no-descarga");
      throw new Error("No apareció botón de descarga después de esperar");
    }

    ensureDirs();

    log("download", "Descargando archivo");
    const [download] = await Promise.all([
      p.waitForEvent("download", { timeout: 120000 }),
      downloadButton.click()
    ]);

    const fileName = download.suggestedFilename() || `dian_export_${Date.now()}.xlsx`;
    const filePath = path.join(DOWNLOAD_DIR, fileName);

    await download.saveAs(filePath);

    log("completado", "Archivo descargado", {
      fileName,
      filePath
    });

    res.json({
      ok: true,
      step: "archivo_descargado",
      fileName,
      filePath
    });
  } catch (e) {
    logError("continuar-con-link", e);
    await takeScreenshot("error-continuar-con-link");

    res.status(500).json({
      ok: false,
      step: "continuar-con-link",
      error: e.message
    });
  }
});

app.listen(PORT, () => {
  ensureDirs();
  console.log(`Backend DIAN robusto v7 corriendo en puerto ${PORT}`);
});
