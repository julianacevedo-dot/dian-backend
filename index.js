const express = require("express");
const cors = require("cors");
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

const PORT = process.env.PORT || 3000;
const SECRET = process.env.AGENTE_SECRETO_DE_DIAN;
const CC = process.env.REPRESENTANTE_CC;
const NIT = process.env.EMPRESA_NIT;
const DOWNLOAD_DIR = process.env.DOWNLOAD_DIR || path.join(__dirname, "downloads");

let browser;
let context;
let page;

function auth(req, res, next) {
  if (!SECRET) return res.status(500).json({ ok: false, error: "Falta AGENTE_SECRETO_DE_DIAN en el backend" });
  if (req.headers.authorization !== `Bearer ${SECRET}`) {
    return res.status(401).json({ ok: false, error: "No autorizado" });
  }
  next();
}

async function ensureBrowser() {
  if (!browser) {
    browser = await chromium.launch({
      headless: process.env.HEADLESS !== "false",
      args: ["--no-sandbox", "--disable-setuid-sandbox"]
    });
  }

  if (!context) {
    context = await browser.newContext({ acceptDownloads: true });
  }

  if (!page || page.isClosed()) {
    page = await context.newPage();
  }

  return page;
}

app.get("/", (req, res) => {
  res.json({ ok: true, service: "Agente DIAN Playwright", endpoints: ["/proceso-completo", "/continuar-con-link"] });
});

app.get("/health", (req, res) => {
  res.json({ ok: true, status: "online" });
});

app.post("/proceso-completo", auth, async (req, res) => {
  try {
    if (!CC || !NIT) {
      return res.status(500).json({ ok: false, error: "Faltan REPRESENTANTE_CC o EMPRESA_NIT" });
    }

    const p = await ensureBrowser();

    console.log("Abriendo DIAN...");
    await p.goto("https://catalogo-vpfe.dian.gov.co/", {
      waitUntil: "domcontentloaded",
      timeout: 90000
    });

    console.log("Seleccionando Empresa...");
    await p.getByText("Empresa", { exact: false }).click({ timeout: 45000 });

    console.log("Seleccionando Representante legal...");
    await p.getByText("Representante legal", { exact: false }).click({ timeout: 45000 });

    console.log("Llenando formulario...");
    const inputs = p.locator("input");
    await inputs.nth(0).fill(CC);
    await inputs.nth(1).fill(NIT);

    console.log("Enviando login...");
    await p.getByText("Entrar", { exact: false }).click({ timeout: 45000 });

    await p.waitForTimeout(4000);

    res.json({
      ok: true,
      step: "login_enviado",
      message: "Formulario DIAN enviado. Esperando link por correo."
    });
  } catch (error) {
    console.error("ERROR proceso-completo:", error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post("/continuar-con-link", auth, async (req, res) => {
  try {
    const { url } = req.body;

    if (!url || !String(url).startsWith("http")) {
      return res.status(400).json({ ok: false, error: "URL inválida o vacía" });
    }

    const p = await ensureBrowser();

    console.log("Abriendo link DIAN del correo...");
    await p.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 120000
    });

    await p.waitForTimeout(6000);

    console.log("Entrando a descarga de listados...");
    await p.goto("https://catalogo-vpfe.dian.gov.co/Document/Export", {
      waitUntil: "domcontentloaded",
      timeout: 120000
    });

    await p.waitForTimeout(3000);

    console.log("Clic en Exportar Excel...");
    await p.getByText("Exportar Excel", { exact: false }).click({ timeout: 90000 });

    console.log("Esperando que DIAN genere el archivo...");

    let downloadButton = null;
    const selectors = [
      "text=Descargar",
      "a[download]",
      "button:has-text('Descargar')",
      "a:has-text('Descargar')",
      "[title*='Descargar']",
      "[aria-label*='Descargar']",
      ".fa-download",
      "i.fa-download",
      "svg"
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

      console.log(`Archivo no listo todavía. Reintento ${i + 1}/36`);
      await p.waitForTimeout(5000);
      await p.reload({ waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
    }

    if (!downloadButton) {
      throw new Error("No apareció botón de descarga después de esperar");
    }

    if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

    console.log("Descargando archivo...");
    const [download] = await Promise.all([
      p.waitForEvent("download", { timeout: 120000 }),
      downloadButton.click()
    ]);

    const fileName = download.suggestedFilename() || `dian_export_${Date.now()}.xlsx`;
    const finalPath = path.join(DOWNLOAD_DIR, fileName);

    await download.saveAs(finalPath);

    console.log("Archivo descargado:", finalPath);

    res.json({
      ok: true,
      step: "archivo_descargado",
      fileName,
      path: finalPath
    });
  } catch (error) {
    console.error("ERROR continuar-con-link:", error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

process.on("SIGTERM", async () => {
  if (browser) await browser.close();
  process.exit(0);
});

app.listen(PORT, () => {
  console.log(`Agente DIAN corriendo en puerto ${PORT}`);
});
