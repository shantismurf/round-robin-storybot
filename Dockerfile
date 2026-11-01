# Container build for Coolify (set the app's Build Pack to "Dockerfile").
# Packages install in their own layer before the code is copied, so a deploy
# that only changes code reuses the cached install instead of rerunning npm.
FROM node:22-slim

WORKDIR /app
ENV NODE_ENV=production

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY . .

# config.json is not in git. Coolify supplies it as a File Mount at /app/config.json.
CMD ["node", "index.js"]
