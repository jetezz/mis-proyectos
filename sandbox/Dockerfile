FROM node:20-alpine

# Herramientas de sistema:
# - git: para clonar repos
# - bash: shell más completo para la terminal interactiva
# - python3, make, g++, linux-headers: compilar node-pty (addon nativo)
# - curl: útil en la terminal interactiva
RUN apk add --no-cache \
    git \
    bash \
    curl \
    python3 \
    make \
    g++ \
    linux-headers

WORKDIR /app

# Instalar dependencias (node-pty requiere compilación nativa)
COPY package.json ./
RUN npm install

# Usuario no-root para seguridad
RUN addgroup -S sandboxuser && adduser -S sandboxuser -G sandboxuser -s /bin/bash
RUN mkdir -p /workspace/projects && chown -R sandboxuser:sandboxuser /workspace
RUN mkdir -p /home/sandboxuser && chown -R sandboxuser:sandboxuser /home/sandboxuser

COPY agent.js .

USER sandboxuser

EXPOSE 4000

CMD ["node", "agent.js"]
