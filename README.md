# Backend DIAN robusto v6

Flujo:
1. Abre `https://catalogo-vpfe.dian.gov.co/User/Login`
2. Selecciona `Empresa`
3. Selecciona `Representante legal`
4. Escribe CC y NIT como humano con delay
5. Presiona `Entrar`
6. Verifica que DIAN llegue a `LoginConfirmed` o muestre texto de confirmación
7. Toma screenshots de depuración

## Variables en Railway

```env
REPRESENTANTE_CC=1107047209
EMPRESA_NIT=901588412
AGENTE_SECRETO_DE_DIAN=tu_token
HEADLESS=true
DOWNLOAD_DIR=/app/downloads
DEBUG_DIR=/app/debug
```

Si DIAN/Cloudflare bloquea, prueba:

```env
HEADLESS=false
```

## Endpoints

- `GET /health`
- `GET /status`
- `POST /reset`
- `POST /proceso-completo`
- `POST /continuar-con-link`

Los POST protegidos requieren:

```text
Authorization: Bearer tu_token
```
