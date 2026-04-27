FROM mcr.microsoft.com/playwright:v1.44.0-jammy

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

ENV HEADLESS=true
ENV DOWNLOAD_DIR=/app/downloads

EXPOSE 3000

CMD ["npm", "start"]
