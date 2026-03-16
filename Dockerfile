FROM node:20-slim

WORKDIR /app

COPY . .
RUN npm ci

# Install Playwright + browser deps inside the image
RUN npx playwright install --with-deps chromium

COPY . .

CMD ["npm", "start"]