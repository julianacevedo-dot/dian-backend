const express  = require('express');
const { chromium } = require('playwright');
const { google }   = require('googleapis');
const path  = require('path');
const fs    = require('fs');

const app  = express();
app.use(express.json());

// ─── Seguridad: API Key ────────────────────────────────────────────────────
const API_KEY = process.env.API_KEY || 'cambia-esta-clave-secreta';
function auth(req, res, next) {
  const key = req.headers['x-api-key'] || req.query.apikey;
  if (key !== API_KEY) return res.status(401).json({ error: 'No autorizado' });
  next();
}

// ─── Health check ──────────────────────────────────────────────────────────
app.get('/health', (_, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

// ─── Endpoint principal ────────────────────────────────────────────────────
app.post('/descargar-facturas', auth, async (req, res) => {
  const {
    nit_representante,  // ej: "1107047209"
    nit_empresa,        // ej: "901588412"
    gmail_token,        // access_token OAuth2 de Gmail
    tipo_id = '13',     // 13 = cédula de ciudadanía
    rol     = 'RepresentanteLegal'
  } = req.body;

  if (!nit_representante || !nit_empresa || !gmail_token) {
    return res.status(400).json({ error: 'Faltan: nit_representante, nit_empresa, gmail_token' });
  }

  let browser;
  try {
    console.log('[DIAN] Iniciando navegador...');
    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--single-process'
      ]
    });

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
      acceptDownloads: true,
      locale: 'es-CO'
    });
    const page = await context.newPage();

    // ── PASO 1: Ir a la página de login ──────────────────────────────────
    console.log('[DIAN] Navegando a CompanyLogin...');
    await page.goto('https://catalogo-vpfe.dian.gov.co/User/CompanyLogin', {
      waitUntil: 'networkidle',
      timeout: 30000
    });

    // ── PASO 2: Seleccionar "Empresa" si hay pestañas ─────────────────────
    const empresaTab = page.locator('text=Empresa').first();
    if (await empresaTab.isVisible()) {
      await empresaTab.click();
      await page.waitForTimeout(800);
    }

    // ── PASO 3: Seleccionar "Representante Legal" ─────────────────────────
    const repLegal = page.locator('text=Representante legal').first();
    if (await repLegal.isVisible()) {
      await repLegal.click();
      await page.waitForTimeout(800);
    }

    // ── PASO 4: Llenar el formulario ──────────────────────────────────────
    console.log('[DIAN] Llenando formulario...');

    // Tipo de documento
    const selectTipo = page.locator('select').first();
    if (await selectTipo.isVisible()) {
      await selectTipo.selectOption({ value: tipo_id });
    }

    // NIT Representante Legal
    const inputNitRep = page.locator('input[name="Documento"], input[placeholder*="NIT Representante"], input[placeholder*="documento"]').first();
    await inputNitRep.fill(nit_representante);

    // NIT Empresa
    const inputNitEmp = page.locator('input[name="NitEmpresa"], input[placeholder*="NIT Empresa"], input[placeholder*="empresa"]').first();
    await inputNitEmp.fill(nit_empresa);

    // ── PASO 5: Click "Entrar" ────────────────────────────────────────────
    console.log('[DIAN] Enviando login...');
    await page.locator('button:has-text("Entrar"), input[type="submit"]:has-text("Entrar")').first().click();

    // Esperar pantalla de confirmación "Se ha enviado la ruta de acceso"
    await page.waitForSelector('text=Se ha enviado', { timeout: 15000 });
    console.log('[DIAN] ✅ Login enviado. Esperando email...');

    // ── PASO 6: Leer el link mágico desde Gmail ───────────────────────────
    const tokenUrl = await esperarLinkGmail(gmail_token, 90); // hasta 90 seg
    console.log('[DIAN] ✅ Link obtenido:', tokenUrl.slice(0, 60) + '...');

    // ── PASO 7: Navegar al link mágico ────────────────────────────────────
    await page.goto(tokenUrl, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);

    // Verificar que llegamos al dashboard
    const titulo = await page.title();
    console.log('[DIAN] Dashboard:', titulo);

    // ── PASO 8: Ir a "Descargar listados" ─────────────────────────────────
    console.log('[DIAN] Navegando a Descargar listados...');
    await page.goto('https://catalogo-vpfe.dian.gov.co/Document/Export', {
      waitUntil: 'networkidle',
      timeout: 20000
    });

    // ── PASO 9: Configurar fechas (mes actual) ────────────────────────────
    const hoy    = new Date();
    const year   = hoy.getFullYear();
    const month  = String(hoy.getMonth() + 1).padStart(2, '0');
    const dia    = String(hoy.getDate()).padStart(2, '0');
    const desde  = `${year}-${month}-01`;
    const hasta  = `${year}-${month}-${dia}`;

    console.log(`[DIAN] Rango: ${desde} → ${hasta}`);

    // Limpiar y establecer fecha inicio
    const inputDesde = page.locator('input[name="FechaDesde"], input[placeholder*="Desde"], input[placeholder*="inicio"]').first();
    if (await inputDesde.isVisible()) {
      await inputDesde.fill('');
      await inputDesde.fill(desde);
    }

    // Fecha fin
    const inputHasta = page.locator('input[name="FechaHasta"], input[placeholder*="Hasta"], input[placeholder*="fin"]').first();
    if (await inputHasta.isVisible()) {
      await inputHasta.fill('');
      await inputHasta.fill(hasta);
    }

    // Grupo: "Todos" o "Enviados y Recibidos"
    const selectGrupo = page.locator('select[name="Grupo"], select').last();
    if (await selectGrupo.isVisible()) {
      // Intentar seleccionar "Todos" o el valor que englobe ambos
      try {
        await selectGrupo.selectOption({ label: 'Todos' });
      } catch {
        try { await selectGrupo.selectOption({ label: 'Enviados y Recibidos' }); } catch {}
      }
    }

    // ── PASO 10: Click "Exportar Excel" ───────────────────────────────────
    console.log('[DIAN] Exportando Excel...');
    const [ download ] = await Promise.all([
      context.waitForEvent('download', { timeout: 60000 }),
      page.locator('button:has-text("Exportar Excel"), input[value*="Exportar"]').first().click()
    ]);

    // Si el botón no dispara descarga directa, esperar y buscar el ícono de descarga
    let filePath;
    if (download) {
      filePath = path.join('/tmp', download.suggestedFilename() || `DIAN_${hasta}.xlsx`);
      await download.saveAs(filePath);
      console.log('[DIAN] ✅ Descarga directa:', filePath);
    } else {
      // Esperar 20 seg y hacer click en el ícono ⬇ de la primera fila
      await page.waitForTimeout(20000);
      const [ dl2 ] = await Promise.all([
        context.waitForEvent('download', { timeout: 30000 }),
        page.locator('table tbody tr:first-child a[href*="Download"], table tbody tr:first-child button').first().click()
      ]);
      filePath = path.join('/tmp', dl2.suggestedFilename() || `DIAN_${hasta}.xlsx`);
      await dl2.saveAs(filePath);
      console.log('[DIAN] ✅ Descarga por lista:', filePath);
    }

    await browser.close();
    browser = null;

    // ── PASO 11: Leer el archivo y devolverlo en base64 ───────────────────
    const fileBuffer = fs.readFileSync(filePath);
    const base64     = fileBuffer.toString('base64');
    const filename   = `DIAN_Facturas_${year}-${month}.xlsx`;

    // Limpiar
    fs.unlinkSync(filePath);

    console.log('[DIAN] ✅ Completado. Tamaño:', fileBuffer.length, 'bytes');
    return res.json({
      success:  true,
      filename,
      base64,
      size:     fileBuffer.length,
      periodo:  `${desde} al ${hasta}`,
      timestamp: new Date().toISOString()
    });

  } catch (err) {
    console.error('[DIAN] ❌ Error:', err.message);
    if (browser) await browser.close().catch(() => {});
    return res.status(500).json({
      success: false,
      error:   err.message,
      hint:    'Revisa los logs en Railway para más detalle'
    });
  }
});

// ─── Función: esperar y leer el link mágico desde Gmail ───────────────────
async function esperarLinkGmail(accessToken, maxSegundos = 90) {
  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: accessToken });
  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

  const inicio = Date.now();
  while ((Date.now() - inicio) < maxSegundos * 1000) {
    try {
      // Buscar email sin leer de la DIAN
      const list = await gmail.users.messages.list({
        userId: 'me',
        q:      'from:facturacionelectronica@dian.gov.co subject:"Token Acceso DIAN" is:unread',
        maxResults: 1
      });

      if (list.data.messages && list.data.messages.length > 0) {
        const msgId = list.data.messages[0].id;
        const msg   = await gmail.users.messages.get({
          userId: 'me',
          id:     msgId,
          format: 'full'
        });

        // Extraer HTML del cuerpo
        const parts = msg.data.payload.parts || [msg.data.payload];
        let html = '';
        for (const part of parts) {
          if (part.mimeType === 'text/html' && part.body?.data) {
            html = Buffer.from(part.body.data, 'base64').toString('utf-8');
            break;
          }
        }
        if (!html && msg.data.payload.body?.data) {
          html = Buffer.from(msg.data.payload.body.data, 'base64').toString('utf-8');
        }

        // Extraer el link mágico
        const patrones = [
          /href="(https:\/\/catalogo-vpfe\.dian\.gov\.co\/User\/LoginToken[^"]+)"/i,
          /href="(https:\/\/catalogo-vpfe\.dian\.gov\.co[^"]*[Tt]oken[^"]{10,})"/i,
          /href="(https:\/\/catalogo-vpfe\.dian\.gov\.co[^"]{30,})"/i
        ];

        for (const p of patrones) {
          const m = html.match(p);
          if (m) {
            const url = m[1].replace(/&amp;/g, '&');
            // Marcar como leído
            await gmail.users.messages.modify({
              userId: 'me',
              id:     msgId,
              requestBody: { removeLabelIds: ['UNREAD'] }
            }).catch(() => {});
            return url;
          }
        }
      }
    } catch (e) {
      console.warn('[Gmail] Error consultando:', e.message);
    }

    // Esperar 5 segundos antes del siguiente intento
    await new Promise(r => setTimeout(r, 5000));
    console.log(`[Gmail] Esperando email... ${Math.round((Date.now()-inicio)/1000)}s`);
  }

  throw new Error(`Email de la DIAN no llegó en ${maxSegundos} segundos`);
}

// ─── Iniciar servidor ─────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ DIAN Service corriendo en puerto ${PORT}`));
