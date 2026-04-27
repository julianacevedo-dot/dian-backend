# DIAN Playwright Service — Guía de instalación

## Qué hace esto
Microservicio Node.js que automatiza completamente la descarga de facturas electrónicas
de la DIAN (catalogo-vpfe.dian.gov.co) usando Playwright (navegador headless real).
n8n Cloud lo llama una vez al día y guarda el Excel en Google Drive.

---

## PASO 1 — Subir el código a GitHub

1. Crea un repositorio nuevo en github.com (puede ser privado)
2. Sube estos 3 archivos:
   - `server.js`
   - `package.json`
   - `Dockerfile`

```bash
git init
git add server.js package.json Dockerfile
git commit -m "DIAN Playwright Service"
git remote add origin https://github.com/TU_USUARIO/dian-service.git
git push -u origin main
```

---

## PASO 2 — Crear proyecto en Railway

1. Ve a https://railway.app y entra con tu cuenta
2. Clic en **"New Project"** → **"Deploy from GitHub repo"**
3. Selecciona el repositorio `dian-service`
4. Railway detecta el Dockerfile automáticamente y empieza a construir

---

## PASO 3 — Configurar variables de entorno en Railway

En tu proyecto Railway → pestaña **"Variables"**, agrega:

| Variable        | Valor                          |
|-----------------|-------------------------------|
| `API_KEY`       | Una clave secreta que tú elijas (ej: `mi-clave-super-secreta-2024`) |
| `PORT`          | `3000`                         |

---

## PASO 4 — Obtener la URL de Railway

1. En Railway → pestaña **"Settings"** → **"Domains"**
2. Clic en **"Generate Domain"**
3. Copia la URL — se verá así: `https://dian-service-production.up.railway.app`

Prueba que funciona:
```
GET https://dian-service-production.up.railway.app/health
```
Debes ver: `{"status":"ok","ts":"..."}`

---

## PASO 5 — Configurar Variables en n8n Cloud

En n8n Cloud → **Settings** → **Variables**, crea estas 4 variables:

| Variable            | Valor                                      |
|---------------------|--------------------------------------------|
| `RAILWAY_URL`       | `https://dian-service-production.up.railway.app` |
| `RAILWAY_API_KEY`   | La misma clave que pusiste en Railway      |
| `NIT_REPRESENTANTE` | `1107047209`                               |
| `NIT_EMPRESA`       | `901588412`                                |

---

## PASO 6 — Importar el workflow en n8n

1. En n8n → menú ☰ → **"Import from File"**
2. Sube el archivo `workflow_n8n_railway.json`
3. Conecta las credenciales:
   - Nodo **"1️⃣ Obtener Token Gmail"** → credencial Gmail OAuth2
   - Nodo **"4️⃣ Subir a Google Drive"** → credencial Google Drive OAuth2

---

## PASO 7 — Activar el workflow

1. En n8n, activa el toggle del workflow
2. Para probarlo manualmente: clic en **"Execute Workflow"**
3. El proceso tarda ~60-90 segundos (Playwright navega la DIAN completa)
4. Al terminar verás el Excel en tu Google Drive ✅

---

## Solución de problemas

### El microservicio da timeout
- Aumenta el timeout del nodo HTTP en n8n a 180000ms (3 min)
- Verifica en Railway logs que Playwright arrancó correctamente

### Error "Email no llegó en 90 segundos"
- La DIAN a veces demora más. Aumenta `maxSegundos` en server.js a 120
- Verifica que el email de la DIAN llega a `billing@bia.app`

### Error al llenar el formulario
- La DIAN puede cambiar sus selectores HTML
- Abre Railway → Logs y busca en qué paso falló
- Ajusta los selectores en server.js (líneas PASO 2-4)

### Railway apaga el servicio (plan gratuito)
- El plan gratuito de Railway da 500 horas/mes — suficiente para 1 ejecución/día
- Si necesitas más, Railway Hobby Plan cuesta $5/mes con tiempo ilimitado

---

## Arquitectura del flujo

```
n8n (trigger diario)
    ↓ POST /descargar-facturas
Railway (Playwright headless)
    ↓ 1. Abre catalogo-vpfe.dian.gov.co
    ↓ 2. Llena NIT Representante + NIT Empresa
    ↓ 3. Click "Entrar" → DIAN envía email
    ↓ 4. Consulta Gmail API → extrae link mágico
    ↓ 5. Navega al link → sesión autenticada
    ↓ 6. Va a /Document/Export
    ↓ 7. Configura fechas (mes actual)
    ↓ 8. Click "Exportar Excel" → descarga .xlsx
    ↓ Devuelve archivo en base64 a n8n
n8n
    ↓ Convierte base64 → binario
    ↓ Sube a Google Drive
✅ Excel guardado automáticamente
```
