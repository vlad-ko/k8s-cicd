# Webo's Money World — container image.
#
# No build stage: the app has no bundler and no dependencies (see package.json).
# The static files ship as authored and the Vercel handlers are executed by
# server.js, so there is nothing to compile and nothing to install. A multi-stage
# build here would add a layer and save nothing.

FROM node:22-alpine

# Run unprivileged. node:alpine already ships a `node` user, so there is no
# reason to create another or to run as root.
WORKDIR /app

# Ownership is set at copy time rather than with a later `chown -R`, which would
# duplicate every file into a second layer.
COPY --chown=node:node package.json server.js ./
COPY --chown=node:node api ./api
COPY --chown=node:node lib ./lib
COPY --chown=node:node lessons ./lessons
COPY --chown=node:node vendor ./vendor
COPY --chown=node:node assets ./assets
COPY --chown=node:node index.html styles.css app.mjs ./

# Numeric uid, not the `node` username: Kubernetes runAsNonRoot cannot verify a
# non-numeric user and refuses to start the container. Same uid, stated in the
# form the orchestrator can check.
USER 1000

EXPOSE 8080
ENV PORT=8080 NODE_ENV=production

# Exec form, so node is PID 1 and receives SIGTERM directly from Kubernetes.
# Wrapped in a shell it would not, the SIGTERM handler in server.js would never
# fire, and rolling deploys would cut off in-flight requests.
ENTRYPOINT ["node", "server.js"]
