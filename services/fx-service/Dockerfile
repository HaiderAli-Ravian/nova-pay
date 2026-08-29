FROM node:24-alpine AS build

WORKDIR /workspace

COPY package.json package-lock.json ./
COPY services/account-service/package.json services/account-service/package.json
COPY services/transaction-service/package.json services/transaction-service/package.json
COPY services/ledger-service/package.json services/ledger-service/package.json
COPY services/fx-service/package.json services/fx-service/package.json
COPY services/payroll-service/package.json services/payroll-service/package.json
COPY services/admin-service/package.json services/admin-service/package.json

RUN npm ci --workspace @novapay/fx-service

COPY services/fx-service services/fx-service

RUN npm run build --workspace @novapay/fx-service

FROM build AS migration

ENV NODE_ENV=production

WORKDIR /workspace/services/fx-service

USER node

CMD ["npm", "run", "prisma:migrate:deploy"]

FROM node:24-alpine AS production-dependencies

WORKDIR /workspace

COPY package.json package-lock.json ./
COPY services/account-service/package.json services/account-service/package.json
COPY services/transaction-service/package.json services/transaction-service/package.json
COPY services/ledger-service/package.json services/ledger-service/package.json
COPY services/fx-service/package.json services/fx-service/package.json
COPY services/payroll-service/package.json services/payroll-service/package.json
COPY services/admin-service/package.json services/admin-service/package.json

RUN npm ci --omit=dev --workspace @novapay/fx-service

FROM node:24-alpine AS runtime

ENV NODE_ENV=production
ENV PORT=3004

WORKDIR /app

COPY --from=production-dependencies /workspace/node_modules ./node_modules
COPY --from=build /workspace/services/fx-service/dist ./dist
COPY --from=build /workspace/services/fx-service/package.json ./package.json

USER node

EXPOSE 3004

CMD ["node", "dist/main.js"]
