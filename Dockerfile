FROM mcr.microsoft.com/playwright:v1.43.0-jammy

WORKDIR /app

# Copiar dependencias primero (cache de Docker)
COPY package*.json ./
RUN npm install --only=production

# Instalar solo Chromium (más liviano que todos los browsers)
RUN npx playwright install chromium --with-deps

# Copiar código
COPY server.js ./

# Railway asigna PORT automáticamente
ENV PORT=3000
EXPOSE 3000

CMD ["node", "server.js"]
