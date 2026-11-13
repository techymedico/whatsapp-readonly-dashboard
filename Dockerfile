FROM node:22-bookworm-slim AS web
WORKDIR /build
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build
FROM python:3.13-slim
WORKDIR /app
COPY server/ server/
COPY --from=web /build/dist web/dist
RUN useradd -u 10001 -m inbox && mkdir /data && chown inbox /data
USER inbox
ENV DATA_DIR=/data BIND=0.0.0.0 PORT=3100
EXPOSE 3100
CMD ["python", "-m", "server.app"]
