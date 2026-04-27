# Backend DIAN robusto v7

## Cambios v7
- Movimiento de mouse más humano.
- Escritura con delay.
- Click con mouse real.
- Detección de pantalla LoginConfirmed.
- Endpoint `/status`.
- Endpoint `/reset`.
- Screenshots en `/app/debug`.

## Variables Railway

```env
REPRESENTANTE_CC=1107047209
EMPRESA_NIT=901588412
AGENTE_SECRETO_DE_DIAN=tu_token
HEADLESS=false
DOWNLOAD_DIR=/app/downloads
DEBUG_DIR=/app/debug
```

Recomendado para DIAN:

```env
HEADLESS=false
```

## Endpoints

- `GET /health`
- `GET /status`
- `POST /reset`
- `POST /proceso-completo`
- `POST /continuar-con-link`
