# Citation Verifier sidecar — Next.js app exposing POST /api/verify-entry.
# Verifies BibTeX entries against DOI.org/Crossref/OpenAlex/Semantic Scholar/
# arXiv/DBLP and (optionally) writes a Vietnamese AI explanation per entry.

FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:20-alpine AS run
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/package.json ./package.json
COPY --from=deps /app/node_modules ./node_modules
EXPOSE 3200
# next start binds 0.0.0.0 — reachable from the backend container; the compose
# file deliberately does NOT publish this port to the host.
CMD ["npm", "run", "start"]
