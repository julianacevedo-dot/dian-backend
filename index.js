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

let browser, context, page;

function auth(req, res, next) {
  if (!SECRET) {
    return res.status(500).json({ ok: false, error: "Falta AGENTE_SECRETO_DE_DIAN" });
  }

  if (req.headers.authorization !== `Bearer ${SECRET}`) {
    return res.status(401).json({ ok: false, error: "No autorizado" });
  }

  next();
}

async function getPage() {
  if (!browser) {
    browser = await chromium.launch({
      headless: process.env.HEADLESS !== "false",
      args: ["--no-sandbox", "--disable-setuid-sandbox"]
    });
  }

  if (!context) {
    context = await browser.newContext({
      acceptDownloads: true,
      viewport: { width: 1366, height: 768 }
    });
  }

  if (!page || page.isClosed()) {
    page = await context.newPage();
  }

  return page;
}

async function clickByText(page, text) {
  const target = page.getByText(text, { exact: false }).first();
  await target.waitFor({ state: "visible", timeout: 60000 });
  await target.click();
}

async function typeLikeHuman(locator, value) {
  await locator.click();
  await locator.fill("");
  await locator.type(value, { delay: 100 });
}

app.get("/", (req, res) => {
  res.json({
    ok: true,
    service: "Backend DIAN v6 eventos reales",
    routes: ["/health", "/proceso-completo", "/continuar-con-link"]
  });
});

app.get("/health", (req, res) => {
  res.json({ ok: true, status: "online", version: "v6" });
});

app.post("/proceso-completo", auth, async (req, res) => {
  try {
    if (!CC || !NIT) {
      return res.status(500).json({
        ok: false,
        error: "Faltan REPRESENTANTE_CC o EMPRESA_NIT"
      });
    }

    const p = await getPage();

    // Ruta correcta según flujo manual confirmado
    await p.goto("https://catalogo-vpfe.dian.gov.co/User/Login", {
      waitUntil: "domcontentloaded",
      timeout: 90000
    });

    await p.waitForTimeout(3000);

    // 1) Seleccionar Empresa
    await clickByText(p, "Empresa");
    await p.waitForTimeout(1500);

    // 2) Seleccionar Representante legal dentro de Empresa
    await clickByText(p, "Representante legal");
    await p.waitForTimeout(2500);

    // 3) Llenar campos visibles como humano para disparar eventos Angular/JS
    const inputs = p.locator("input:visible");
    await inputs.first().waitFor({ state: "visible", timeout: 60000 });

    await typeLikeHuman(inputs.nth(0), CC);
    await p.waitForTimeout(500);

    await typeLikeHuman(inputs.nth(1), NIT);
    await p.waitForTimeout(500);

    // Disparar validaciones reales
    await inputs.nth(1).press("Tab");
    await p.waitForTimeout(1200);

    // 4) Clic en botón Entrar correcto
    const entrarButton = p.locator("button:has-text('Entrar'), input[type='submit'][value*='Entrar']").first();
    await entrarButton.waitFor({ state: "visible", timeout: 60000 });
    await entrarButton.click();

    // Esperar procesamiento real de DIAN
    await p.waitForLoadState("domcontentloaded", { timeout: 60000 }).catch(() => {});
    await p.waitForTimeout(6000);

    res.json({
      ok: true,
      step: "login_enviado",
      message: "Login DIAN enviado con eventos reales. Esperando correo con link."
    });

  } catch (e) {
    console.error("ERROR /proceso-completo:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post("/continuar-con-link", auth, async (req, res) => {
  try {
    const { url } = req.body;

    if (!url || !String(url).startsWith("http")) {
      return res.status(400).json({ ok: false, error: "URL inválida o vacía" });
    }

    const p = await getPage();

    await p.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 120000
    });

    await p.waitForTimeout(6000);

    await p.goto("https://catalogo-vpfe.dian.gov.co/Document/Export", {
      waitUntil: "domcontentloaded",
      timeout: 120000
    });

    await p.waitForTimeout(4000);

    await p.getByText("Exportar Excel", { exact: false }).first().click({ timeout: 90000 });

    // La DIAN genera el archivo y luego habilita descarga.
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

    for (let i = 0; i < 36; i++) {
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
      throw new Error("No apareció el botón de descarga después de esperar");
    }

    if (!fs.existsSync(DOWNLOAD_DIR)) {
      fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
    }

    const [download] = await Promise.all([
      p.waitForEvent("download", { timeout: 120000 }),
      downloadButton.click()
    ]);

    const fileName = download.suggestedFilename() || `dian_export_${Date.now()}.xlsx`;
    const filePath = path.join(DOWNLOAD_DIR, fileName);

    await download.saveAs(filePath);

    res.json({
      ok: true,
      step: "archivo_descargado",
      fileName,
      filePath
    });

  } catch (e) {
    console.error("ERROR /continuar-con-link:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`Backend DIAN v6 corriendo en puerto ${PORT}`);
});
