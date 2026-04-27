# Backend DIAN para n8n.cloud

Este backend corre Playwright fuera de n8n.cloud.

## Variables de entorno en Railway/Render/VPS

```env
REPRESENTANTE_CC=1107047209
EMPRESA_NIT=901588412
AGENTE_SECRETO_DE_DIAN=pon_un_token_largo_aqui
HEADLESS=true
DOWNLOAD_DIR=/app/downloads
```

## Endpoints

- `GET /health`
- `POST /proceso-completo`
- `POST /continuar-con-link`

Ambos POST requieren header:

```text
Authorization: Bearer TU_AGENTE_SECRETO_DE_DIAN
```

## Railway

1. Sube esta carpeta a GitHub.
2. Crea proyecto en Railway desde GitHub.
3. Agrega las variables de entorno.
4. Copia la URL pública, por ejemplo:
   `https://dian-backend-production.up.railway.app`

Esa URL se usa en el workflow de n8n.cloud.
