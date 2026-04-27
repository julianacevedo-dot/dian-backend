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
  if (!SECRET) return res.status(500).json({ ok: false, error: "Falta AGENTE_SECRETO_DE_DIAN" });
  if (req.headers.authorization !== `Bearer ${SECRET}`) {
    return res.status(401).json({ ok: false, error: "No autorizado" });
  }
  next();
}

async function getPage() {
  if (!browser) {
    browser = await chromium.launch({
      headless: process.env.HEADLESS !== "false",
      args: ["--no-sandbox"]
    });
  }
  if (!context) context = await browser.newContext({ acceptDownloads: true });
  if (!page) page = await context.newPage();
  return page;
}

app.get("/health", (req, res) => res.json({ ok: true }));

app.post("/proceso-completo", auth, async (req, res) => {
  try {
    const p = await getPage();

    await p.goto("https://catalogo-vpfe.dian.gov.co/", { timeout: 90000 });
    await p.waitForTimeout(4000);

    await p.locator("text=Empresa").first().click();
    await p.waitForTimeout(2000);

    await p.getByText("Representante legal").first().click();
    await p.waitForTimeout(2000);

    // 🔥 FIX DEFINITIVO
    const inputs = p.locator("input:visible");

    await inputs.first().waitFor({ timeout: 60000 });

    await inputs.nth(0).click();
    await inputs.nth(0).fill(CC);

    await inputs.nth(1).click();
    await inputs.nth(1).fill(NIT);

    await p.getByText("Entrar").click();

    res.json({ ok: true, step: "login_enviado" });

  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post("/continuar-con-link", auth, async (req, res) => {
  try {
    const { url } = req.body;
    const p = await getPage();

    await p.goto(url, { timeout: 120000 });
    await p.waitForTimeout(5000);

    await p.goto("https://catalogo-vpfe.dian.gov.co/Document/Export", { timeout: 120000 });
    await p.waitForTimeout(5000);

    await p.getByText("Exportar Excel").click();

    const download = await p.waitForEvent("download", { timeout: 120000 });

    if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

    const filePath = path.join(DOWNLOAD_DIR, download.suggestedFilename());
    await download.saveAs(filePath);

    res.json({ ok: true, file: filePath });

  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.listen(PORT, () => console.log("Backend DIAN OK"));
