FROM node:24.13.1-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends git python3 make g++ ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/robinhood
COPY package.json package-lock.json ./
RUN npm ci --include=optional
COPY tsconfig.json ./
COPY src ./src
COPY prompts ./prompts
RUN npm run build
CMD ["node", "--version"]
