# Backend DIAN FINAL v6

Ajuste principal:
- Escribe CC y NIT con `.type(..., delay)` para simular teclado humano.
- Presiona `Tab` para disparar validaciones JS/Angular.
- Espera procesamiento después del clic en `Entrar`.

Flujo:
1. Abre `https://catalogo-vpfe.dian.gov.co/User/Login`
2. Selecciona `Empresa`
3. Selecciona `Representante legal`
4. Escribe CC y NIT como humano
5. Clic en `Entrar`
6. n8n lee correo y envía link al endpoint `/continuar-con-link`

Variables Railway:
- REPRESENTANTE_CC
- EMPRESA_NIT
- AGENTE_SECRETO_DE_DIAN
- HEADLESS=true
- DOWNLOAD_DIR=/app/downloads
